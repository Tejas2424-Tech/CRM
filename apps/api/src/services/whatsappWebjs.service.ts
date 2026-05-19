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
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../config/env.js";
import { emitRealtime } from "../config/realtime.js";
import { inboundQueue } from "../queues/jobs.js";
import { audit } from "./audit.js";
import { syncAllChats } from "./chatSync.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Singleton state ────────────────────────────────────────────────────────

let _client: InstanceType<typeof Client> | null = null;

export type WajsStatus =
  | "INITIALISING"
  | "QR_REQUIRED"
  | "AUTHENTICATING"
  | "HYDRATING"
  | "SYNCING"
  | "CONNECTED"
  | "DISCONNECTED"
  | "FAILED";

let _status: WajsStatus = "INITIALISING";
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert 919876543210@c.us  →  +919876543210 */
function normalisePhone(waId: string): string {
  const digits = waId.replace(/@c\.us$/, "").replace(/\D/g, "");
  return `+${digits}`;
}

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

  emitRealtime("wajs:status", { 
    status: _status, 
    ...metadata,
    connectedAt: _connectedAt,
    syncProgress: _syncProgress
  });
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
  const sessionDir = path.join(sessionPath, `session-${env.WA_CLIENT_ID}`);

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
  if (_client) {
    console.log("[WaJS] Client already initialised — skipping.");
    return;
  }

  const sessionPath = path.resolve(__dirname, "../..", env.WA_SESSION_PATH);

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
    emitRealtime("wajs:qr", { qr });
    updateStatus("QR_REQUIRED");
  });

  // ── Authenticating ───────────────────────────────────────────────────────
  _client.on("authenticated", () => {
    _qrData = null;
    console.log("[WaJS] Authenticated — loading session…");
    updateStatus("AUTHENTICATING");
  });

  // ── Ready ────────────────────────────────────────────────────────────────
  _client.on("ready", async () => {
    updateStatus("HYDRATING");
    console.log("[WaJS] Client is ready. Waiting for hydration…");

    // Phase 1: Hydration / Initial Sync
    try {
      updateStatus("SYNCING");
      
      // Hook into syncAllChats progress if possible, or just wrap it
      const originalEmit = emitRealtime;
      // Temporary override to capture progress
      (global as any).emitRealtime = (event: string, data: any) => {
        if (event === "sync:progress") {
          _syncProgress = { total: data.total, done: data.done };
          console.log(`[WaJS][SYNC] Progress: ${data.done}/${data.total} chats processed`);
          updateStatus("SYNCING");
        }
        originalEmit(event, data);
      };

      await syncAllChats(_client as any);
      
      delete (global as any).emitRealtime;
      
      updateStatus("CONNECTED");
      console.log("[WaJS] Phase 1 chat sync complete. Client CONNECTED ✅");
    } catch (err) {
      console.error("[WaJS] Hydration/Sync failed:", err);
      // We still transition to CONNECTED to unblock outbound, but with a warning
      updateStatus("CONNECTED", { warning: "Sync partial" });
    }
  });

  // ── Auth failure ─────────────────────────────────────────────────────────
  _client.on("auth_failure", (msg: string) => {
    _lastDisconnectReason = msg;
    updateStatus("FAILED", { error: msg });
    console.error("[WaJS] Auth failure:", msg);
    audit("system", "whatsapp.auth_failure", "WhatsApp", env.WA_CLIENT_ID, { msg });
    _client = null;
  });

  // ── Disconnected ─────────────────────────────────────────────────────────
  _client.on("disconnected", (reason: string) => {
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

      let phone = normalisePhone(msg.from as string);
      const text: string = msg.body ?? "";
      const waMessageId: string = msg.id?._serialized ?? msg.id?.id ?? crypto.randomUUID();

      // Attempt to enrich with contact name and real phone number (if hidden by @lid)
      let name: string | undefined;
      try {
        const contact = await msg.getContact();
        name = contact?.pushname || contact?.name || undefined;
        
        // If WhatsApp hid the number behind an @lid, the Contact object might still have the real number!
        if (contact?.number) {
          phone = `+${contact.number}`;
        }
      } catch {
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
      });

      console.log(`[WaJS] ✓ queued inbound job for ${phone}`);
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
    _status = "DISCONNECTED";
    emitRealtime("wajs:status", { status: _status });
  }
}
