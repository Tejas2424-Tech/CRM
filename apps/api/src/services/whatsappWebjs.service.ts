/**
 * whatsappWebjs.service.ts
 *
 * Singleton that manages the whatsapp-web.js client lifecycle.
 *
 * Responsibilities:
 *  - Initialise Client with LocalAuth (session persistence)
 *  - Register all event listeners (qr, ready, message, disconnected, auth_failure)
 *  - On incoming message → normalise phone → push to inboundQueue (BullMQ)
 *  - Emit Socket.IO events so the dashboard can show connection state & QR
 *  - Export getWajsClient() so WaJsAdapter can call client.sendMessage()
 */

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — whatsapp-web.js ships CJS without full TS declarations
import pkg from "whatsapp-web.js";
const { Client, LocalAuth } = pkg;

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import qrcode from "qrcode-terminal";

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../config/env.js";
import { emitRealtime } from "../config/realtime.js";
import { redisConnection } from "../queues/connection.js";
import { inboundQueue } from "../queues/jobs.js";
import { audit } from "./audit.js";
import { syncAllChats } from "./chatSync.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WA_STATUS_KEY = `wajs:${env.WA_CLIENT_ID}:status`;
const WA_QR_KEY = `wajs:${env.WA_CLIENT_ID}:qr`;
const WA_OWNER_LOCK_KEY = `wajs:${env.WA_CLIENT_ID}:owner`;
const WA_OWNER_ID = `${os.hostname()}:${process.pid}`;
const OWNER_LOCK_TTL_SECONDS = 45;

// ─── Singleton state ────────────────────────────────────────────────────────

let _client: InstanceType<typeof Client> | null = null;

export type WajsStatus =
  | "BOOTING"        // This process is starting up (in-memory only, never persisted to Redis)
  | "INITIALISING"   // Puppeteer is launching / WhatsApp Web loading
  | "QR_REQUIRED"
  | "AUTHENTICATING"
  | "HYDRATING"
  | "SYNCING"
  | "CONNECTED"
  | "DISCONNECTED"
  | "FAILED"
  | "UNKNOWN";       // Redis miss or stale — state is genuinely unknown

/** Staleness threshold: if Redis state is older than this, treat as UNKNOWN */
const STATUS_STALE_MS = 3 * 60_000; // 3 minutes
const STATUS_TTL_SECONDS = Math.ceil(STATUS_STALE_MS / 1000) + 60;
const OWNER_LOCK_RETRY_MS = OWNER_LOCK_TTL_SECONDS * 1000 + 5000;
const INIT_WATCHDOG_MS = 2 * 60_000;

let _status: WajsStatus = "BOOTING"; // Process just started — not INITIALISING yet
let _connectedAt: Date | null = null;
let _lastDisconnectReason: string | null = null;
let _syncProgress = { total: 0, done: 0 };
let _reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const INITIAL_RECONNECT_DELAY_MS = 5000;
let _qrData: string | null = null;
/** Set to true during a deliberate logout to suppress the auto-reconnect loop */
let _preventReconnect = false;
/** Guards against concurrent logout() calls */
let _logoutInProgress = false;
let _ownsClient = false;
let _initPromise: Promise<void> | null = null;
let _ownerLockRefresh: NodeJS.Timeout | null = null;
let _heartbeatInterval: NodeJS.Timeout | null = null;
let _initRetryTimer: NodeJS.Timeout | null = null;
let _initWatchdog: NodeJS.Timeout | null = null;

import { normalizePhone } from "../utils/phone.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns the active Client instance.
 * Throws if the client is not initialised OR not yet in CONNECTED state.
 * This prevents sendMessage() being called during QR/AUTHENTICATING phases.
 */
export function getWajsClient(): InstanceType<typeof Client> {
  if (!_client || (_status !== "CONNECTED" && _status !== "SYNCING")) {
    throw new Error(
      `[WaJS] WhatsApp client not connected (status: ${_status}). Job will retry automatically.`
    );
  }
  return _client;
}

export function getWajsStatus(): WajsStatus {
  return _status;
}

export function getWajsQr(): string | null {
  return _qrData;
}

export function getWajsMetadata() {
  return {
    status: _status,
    connectedAt: _connectedAt,
    lastDisconnectReason: _lastDisconnectReason,
    syncProgress: _syncProgress
  };
}

export async function getWajsQrSnapshot(): Promise<string | null> {
  if (_qrData) return _qrData;
  return redisConnection.get(WA_QR_KEY);
}

export async function getWajsMetadataSnapshot() {
  // If this process owns the client, use in-memory state (authoritative)
  if (_client) return getWajsMetadata();

  // If in-memory is past BOOTING, it's meaningful — return it
  const local = getWajsMetadata();
  if (local.status !== "BOOTING") return local;

  // This process does not own the client — read from Redis cache
  const raw = await redisConnection.get(WA_STATUS_KEY);
  if (!raw) {
    console.warn("[WaJS][STATUS RESOLVE] Redis miss — status UNKNOWN", { key: WA_STATUS_KEY });
    return { ...local, status: "UNKNOWN" as WajsStatus };
  }

  try {
    const parsed = JSON.parse(raw) as ReturnType<typeof getWajsMetadata> & { heartbeatAt?: number };
    // Staleness check — if no heartbeat or heartbeat is stale, return UNKNOWN
    const heartbeatAt = parsed.heartbeatAt ?? 0;
    if (Date.now() - heartbeatAt > STATUS_STALE_MS) {
      console.warn("[WaJS][STATUS RESOLVE] Redis state is stale — treating as UNKNOWN", {
        heartbeatAt: new Date(heartbeatAt).toISOString(),
        age: `${Math.round((Date.now() - heartbeatAt) / 1000)}s`
      });
      return { ...local, status: "UNKNOWN" as WajsStatus };
    }
    console.log("[WaJS][STATUS RESOLVE] Resolved from Redis:", parsed.status);
    return parsed;
  } catch {
    return { ...local, status: "UNKNOWN" as WajsStatus };
  }
}

/**
 * Update the internal status and emit events.
 */
function updateStatus(newStatus: WajsStatus, metadata: any = {}) {
  const oldStatus = _status;
  _status = newStatus;
  
  if (oldStatus !== newStatus) {
    console.log(`[WaJS][STATE] ${oldStatus} -> ${newStatus}`);
  }

  if (newStatus === "CONNECTED") {
    _connectedAt = new Date();
    _reconnectAttempts = 0;
  }

  if (newStatus === "DISCONNECTED" || newStatus === "FAILED") {
    stopHeartbeat();
  } else if (newStatus !== "BOOTING" && newStatus !== "UNKNOWN") {
    startHeartbeat(); // Keep Redis fresh during QR/auth/ready transitions too
  }

  emitRealtime("wajs:status", { 
    status: _status, 
    ...metadata,
    connectedAt: _connectedAt,
    syncProgress: _syncProgress
  });

  persistStatus(metadata).catch((err) =>
    console.error("[WaJS][STATE] Failed to persist status:", err)
  );
}

async function persistStatus(metadata: Record<string, unknown> = {}) {
  // Do NOT persist BOOTING or UNKNOWN — those are transient/error states
  if (_status === "BOOTING" || _status === "UNKNOWN") return;

  await redisConnection.set(
    WA_STATUS_KEY,
    JSON.stringify({
      status: _status,
      ...metadata,
      connectedAt: _connectedAt?.toISOString() ?? null,
      lastDisconnectReason: _lastDisconnectReason,
      syncProgress: _syncProgress,
      owner: _ownsClient ? WA_OWNER_ID : undefined,
      heartbeatAt: Date.now(), // Staleness detection field
      updatedAt: new Date().toISOString()
    }),
    "EX",
    STATUS_TTL_SECONDS
  );
}

/** Kick off a heartbeat that refreshes the Redis state every 60s to prevent ghost-stale reads */
function startHeartbeat() {
  if (_heartbeatInterval) return;
  _heartbeatInterval = setInterval(() => {
    persistStatus().catch((err) =>
      console.error("[WaJS][HEARTBEAT] Failed to refresh state:", err)
    );
  }, 60_000);
  console.log("[WaJS] Status heartbeat started (60s interval)");
}

function stopHeartbeat() {
  if (_heartbeatInterval) {
    clearInterval(_heartbeatInterval);
    _heartbeatInterval = null;
  }
}

async function persistQr(qr: string | null) {
  if (qr) {
    await redisConnection.set(WA_QR_KEY, qr, "EX", 300);
  } else {
    await redisConnection.del(WA_QR_KEY);
  }
}

async function acquireOwnerLock(): Promise<boolean> {
  if (_ownsClient) return true;
  const acquired = await redisConnection.set(WA_OWNER_LOCK_KEY, WA_OWNER_ID, "EX", OWNER_LOCK_TTL_SECONDS, "NX");
  if (!acquired) {
    const owner = await redisConnection.get(WA_OWNER_LOCK_KEY);
    console.warn(`[WaJS] Another process owns WhatsApp (${owner ?? "unknown"}); retrying after owner lock TTL.`);
    scheduleInitRetry(OWNER_LOCK_RETRY_MS);
    return false;
  }

  _ownsClient = true;
  _ownerLockRefresh = setInterval(() => {
    redisConnection
      .expire(WA_OWNER_LOCK_KEY, OWNER_LOCK_TTL_SECONDS)
      .catch((err) => console.error("[WaJS] Failed to refresh owner lock:", err));
  }, 15_000);
  console.log(`[WaJS] Acquired WhatsApp owner lock as ${WA_OWNER_ID}`);
  return true;
}

function scheduleInitRetry(delayMs: number) {
  if (_initRetryTimer || _preventReconnect) return;
  _initRetryTimer = setTimeout(() => {
    _initRetryTimer = null;
    if (_preventReconnect || _client) return;
    initWhatsappWebjs().catch((err) =>
      console.error("[WaJS] Scheduled init retry failed:", err)
    );
  }, delayMs);
}

function startInitWatchdog() {
  stopInitWatchdog();
  _initWatchdog = setTimeout(async () => {
    if (!_client) return;
    if (!["INITIALISING", "AUTHENTICATING", "HYDRATING"].includes(_status)) return;

    console.warn(`[WaJS] Client stuck in ${_status}; destroying and reinitialising.`);
    try {
      await _client.destroy();
    } catch (err) {
      console.warn("[WaJS] destroy() during watchdog recovery failed:", err);
    }
    _client = null;
    updateStatus("DISCONNECTED", { reason: `stuck_${_status.toLowerCase()}` });
    await releaseOwnerLock().catch(() => undefined);
    scheduleInitRetry(INITIAL_RECONNECT_DELAY_MS);
  }, INIT_WATCHDOG_MS);
}

function stopInitWatchdog() {
  if (_initWatchdog) {
    clearTimeout(_initWatchdog);
    _initWatchdog = null;
  }
}

async function releaseOwnerLock() {
  if (_ownerLockRefresh) {
    clearInterval(_ownerLockRefresh);
    _ownerLockRefresh = null;
  }
  if (!_ownsClient) return;
  const owner = await redisConnection.get(WA_OWNER_LOCK_KEY);
  if (owner === WA_OWNER_ID) {
    await redisConnection.del(WA_OWNER_LOCK_KEY);
  }
  _ownsClient = false;
}

function getSessionDir(sessionPath: string) {
  return path.join(sessionPath, `session-${env.WA_CLIENT_ID}`);
}

async function cleanupStaleBrowserLocks(sessionPath: string) {
  const lockFiles = [
    path.join(getSessionDir(sessionPath), "SingletonLock"),
    path.join(getSessionDir(sessionPath), "SingletonCookie"),
    path.join(getSessionDir(sessionPath), "SingletonSocket")
  ];

  for (const file of lockFiles) {
    try {
      await fs.rm(file, { force: true });
      console.warn(`[WaJS] Removed stale Chromium lock file: ${file}`);
    } catch {
      // best-effort only
    }
  }
}

/**
 * Resolves when the client is CONNECTED.
 * Throws if it times out or transitions to a terminal failure state.
 */
export async function waitForWhatsAppReady(timeoutMs = 60000): Promise<void> {
  if (_status === "CONNECTED" || _status === "SYNCING") return;

  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (_status === "CONNECTED" || _status === "SYNCING") {
        resolve();
        return;
      }
      if (_status === "FAILED") {
        reject(new Error("WhatsApp client failed to initialize"));
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Timeout waiting for WhatsApp connection (current status: ${_status})`));
        return;
      }
      setTimeout(check, 500);
    };
    check();
  });
}

/** Gracefully shut down the client to prevent zombie browser processes. */
export async function destroyWajsClient(): Promise<void> {
  _preventReconnect = true;
  stopHeartbeat();
  stopInitWatchdog();
  if (_initRetryTimer) {
    clearTimeout(_initRetryTimer);
    _initRetryTimer = null;
  }
  if (_client) {
    try {
      console.log("[WaJS] Destroying client for shutdown...");
      await _client.destroy();
    } catch (err) {
      console.error("[WaJS] Failed to destroy client:", err);
    }
    _client = null;
    _status = "DISCONNECTED";
  }
  _qrData = null;
  await persistQr(null).catch(() => undefined);
  await releaseOwnerLock().catch((err) => console.error("[WaJS] Failed to release owner lock:", err));
  await persistStatus().catch(() => undefined);
}

/**
 * Logout the currently connected WhatsApp account.
 *
 * Flow:
 *  1. Guard against concurrent calls
 *  2. Set _preventReconnect to block the disconnected-handler auto-reconnect
 *  3. client.logout() — revokes the session on the phone
 *  4. client.destroy() — kills the puppeteer browser
 *  5. Delete the LocalAuth session directory so no stale session persists
 *  6. Emit wajs:logout + wajs:status (DISCONNECTED)
 *  7. Reset _preventReconnect, then call initWhatsappWebjs() to show fresh QR
 */
export async function logoutWhatsApp(): Promise<void> {
  if (_logoutInProgress) {
    console.warn("[WaJS] Logout already in progress — ignoring duplicate call");
    return;
  }
  _logoutInProgress = true;
  _preventReconnect = true; // Block auto-reconnect during cleanup

  const sessionPath = path.resolve(__dirname, "../..", env.WA_SESSION_PATH);
  const sessionDir = getSessionDir(sessionPath);

  try {
    // Step 1: Revoke session on the connected phone (best-effort)
    if (_client) {
      try {
        console.log("[WaJS] Logging out of WhatsApp...");
        await _client.logout();
      } catch (err) {
        // logout() can throw if the connection is already stale — that's fine
        console.warn("[WaJS] client.logout() threw (ignored):", err);
      }
    }

    // Step 2: Kill the puppeteer browser
    if (_client) {
      try {
        await _client.destroy();
      } catch (err) {
        console.warn("[WaJS] client.destroy() threw (ignored):", err);
      }
    }

    // Step 3: Clear internal state
    _client = null;
    _qrData = null;
    _status = "DISCONNECTED";
    await persistQr(null).catch(() => undefined);

    // Step 4: Delete the session directory so the next init shows a fresh QR
    try {
      await fs.rm(sessionDir, { recursive: true, force: true });
      console.log(`[WaJS] Session directory deleted: ${sessionDir}`);
    } catch (err) {
      console.warn("[WaJS] Could not delete session directory:", err);
    }

    // Step 5: Notify all connected frontends
    emitRealtime("wajs:logout", { at: new Date().toISOString() });
    emitRealtime("wajs:status", { status: _status });
    await persistStatus();

    console.log("[WaJS] ✅ Logout complete — re-initialising for fresh QR in 1s…");

    // Step 6: Re-initialise after a short delay so the socket events land first
    setTimeout(async () => {
      _preventReconnect = false; // Allow normal reconnect behaviour again
      _logoutInProgress = false;
      await initWhatsappWebjs().catch((err) =>
        console.error("[WaJS] Re-init after logout failed:", err)
      );
    }, 1000);

  } catch (err) {
    // Unexpected error — always clean up the lock
    console.error("[WaJS] Unexpected error during logout:", err);
    _preventReconnect = false;
    _logoutInProgress = false;
    throw err;
  }
}

/** Bootstrap the client. Must be called after Socket.IO is ready. */
export async function initWhatsappWebjs(): Promise<void> {
  if (_initPromise) return _initPromise;
  if (_client) {
    console.log("[WaJS] Client already initialised — skipping.");
    return;
  }

  _initPromise = initialiseOwnedClient().finally(() => {
    _initPromise = null;
  });
  return _initPromise;
}

async function initialiseOwnedClient(): Promise<void> {
  if (!(await acquireOwnerLock())) return;

  const sessionPath = path.resolve(__dirname, "../..", env.WA_SESSION_PATH);
  await cleanupStaleBrowserLocks(sessionPath);

  updateStatus("INITIALISING");
  startInitWatchdog();
  _client = new Client({
    authStrategy: new LocalAuth({
      clientId: env.WA_CLIENT_ID,
      dataPath: sessionPath
    }),
    puppeteer: {
      headless: env.WA_HEADLESS !== "false",
      protocolTimeout: 120000,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--single-process",
        "--disable-gpu"
      ]
    }
  });

  // ── QR ──────────────────────────────────────────────────────────────────
  _client.on("qr", (qr: string) => {
    _qrData = qr;
    console.log("\n[WaJS] Scan the QR code below with WhatsApp:\n");
    qrcode.generate(qr, { small: true });
    persistQr(qr).catch((err) => console.error("[WaJS] Failed to persist QR:", err));
    emitRealtime("wajs:qr", { qr });
    updateStatus("QR_REQUIRED");
  });

  // ── Authenticating ───────────────────────────────────────────────────────
  _client.on("authenticated", () => {
    _qrData = null;
    persistQr(null).catch(() => undefined);
    console.log("[WaJS] Authenticated — loading session…");
    updateStatus("AUTHENTICATING");
  });

  // ── Ready ────────────────────────────────────────────────────────────────
  _client.on("ready", async () => {
    stopInitWatchdog();
    updateStatus("HYDRATING");
    console.log("[WaJS] Client is ready. Waiting for hydration…");

    // Phase 1: Hydration / Initial Sync
    try {
      updateStatus("CONNECTED");
      console.log("[WaJS] Client is CONNECTED. Dispatching background sync job...");

      const { syncQueue } = await import("../queues/jobs.js");
      await syncQueue.add("auto-sync", {}, { delay: 15000 }); // Delay 15s to let WhatsApp Web stabilize
      console.log("[WaJS] Phase 1 chat sync complete. Client CONNECTED ✅");
    } catch (err) {
      console.error("[WaJS] Hydration/Sync failed:", err);
      // We still transition to CONNECTED to unblock outbound, but with a warning
      updateStatus("CONNECTED", { warning: "Sync partial" });
    }
  });

  // ── Auth failure ─────────────────────────────────────────────────────────
  _client.on("auth_failure", (msg: string) => {
    stopInitWatchdog();
    _lastDisconnectReason = msg;
    updateStatus("FAILED", { error: msg });
    console.error("[WaJS] Auth failure:", msg);
    audit("system", "whatsapp.auth_failure", "WhatsApp", env.WA_CLIENT_ID, { msg });
    _client = null;
    releaseOwnerLock().catch(() => undefined);
  });

  // ── Disconnected ─────────────────────────────────────────────────────────
  _client.on("disconnected", (reason: string) => {
    stopInitWatchdog();
    _lastDisconnectReason = reason;
    updateStatus("DISCONNECTED", { reason });
    console.warn("[WaJS] Disconnected:", reason);
    audit("system", "whatsapp.disconnect", "WhatsApp", env.WA_CLIENT_ID, { reason });

    if (_preventReconnect) {
      console.log("[WaJS] Reconnect suppressed (logout in progress).");
      return;
    }

    if (_reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error(`[WaJS] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Stopping.`);
      updateStatus("FAILED", { error: "Max reconnect attempts reached" });
      return;
    }

    _reconnectAttempts++;
    const delay = Math.min(INITIAL_RECONNECT_DELAY_MS * Math.pow(2, _reconnectAttempts - 1), 60000);
    
    console.log(`[WaJS] Attempting reconnect ${_reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms…`);
    
    setTimeout(async () => {
      if (_preventReconnect) return;
      try { await _client?.destroy(); } catch { /* best-effort */ }
      _client = null;
      await releaseOwnerLock().catch(() => undefined);
      await initWhatsappWebjs();
    }, delay);
  });

  // ── Incoming message ─────────────────────────────────────────────────────
  _client.on("message", async (msg: any) => {
    try {
      console.log(`[WaJS DEBUG] Raw inbound message: from=${msg.from}, fromMe=${msg.fromMe}, isGroupMsg=${msg.isGroupMsg}, body="${msg.body?.substring(0, 30)}"`);
      // ── Loop prevention (MANDATORY) ────────────────────────────────────
      // 1. Outbound messages sent by this client must never re-enter CRM.
      if (msg.fromMe) return;
      // 2. Block Group chats, Newsletters (Channels), and Status updates.
      if (msg.isGroupMsg) return;
      if (typeof msg.from === "string") {
        if (msg.from.endsWith("@g.us")) return;
        if (msg.from.endsWith("@newsletter")) return;
        if (msg.from === "status@broadcast") return;
      }

      let phone = normalizePhone(msg.from as string);
      const text: string = msg.body ?? "";
      const waMessageId: string = msg.id?._serialized ?? msg.id?.id ?? crypto.randomUUID();

      // Attempt to enrich with contact name and real phone number (if hidden by @lid)
      let name: string | undefined;
      try {
        const contact = await msg.getContact();
        name = contact?.pushname || contact?.name || undefined;
        
        // If WhatsApp hid the number behind an @lid, the Contact object might still have the real number!
        if (contact?.number) {
          phone = normalizePhone(contact.number);
        }
      } catch (err: any) {
        const errMsg = String(err?.message || err);

        if (
          errMsg.includes("detached Frame") ||
          errMsg.includes("Execution context was destroyed")
        ) {
          console.warn(
            `[WaJS] Frame reloaded while fetching contact for message ${waMessageId}`
          );
        } else {
          console.warn(`[WaJS] getContact failed for ${waMessageId}:`, err);
        }
        // Non-critical — continue without name
      }

      console.log(`[WaJS] ← inbound ${phone}: ${text.slice(0, 80)}`);

      // Push into existing BullMQ inbound pipeline.
      // Payload matches InboundJob exactly — processInboundMessage() unchanged.
      await inboundQueue.add("whatsapp-inbound", {
        waMessageId,
        phone,
        name,
        text,
        timestamp: new Date().toISOString()
      }, {
        jobId: waMessageId, // Idempotency key: BullMQ drops duplicate jobs with same ID
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 5,
        backoff: { type: "exponential", delay: 1000 }
      });

      console.log(`[WaJS] ✓ queued inbound job for ${phone} (msg: ${waMessageId})`);
    } catch (err) {
      console.error("[WaJS] Failed to process incoming message:", err);
    }
  });

  // ── Initialise ───────────────────────────────────────────────────────────
  try {
    console.log("[WaJS] Initialising client…");
    await _client.initialize();
  } catch (err) {
    console.error("[WaJS] Client.initialize() threw:", err);
    if (String((err as Error).message ?? err).includes("already running")) {
      await cleanupStaleBrowserLocks(sessionPath);
    }
    stopInitWatchdog();
    try { await _client?.destroy(); } catch { /* best-effort */ }
    _client = null;
    updateStatus("DISCONNECTED", { reason: "initialize_failed" });
    await releaseOwnerLock().catch(() => undefined);
    scheduleInitRetry(INITIAL_RECONNECT_DELAY_MS);
  }
}
