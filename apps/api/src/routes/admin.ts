/**
 * admin.ts
 *
 * Danger-zone admin operations.
 *
 * POST /api/admin/reset-crm
 *   Completely wipes the CRM back to factory state:
 *     1. Stop WhatsApp reconnect loop
 *     2. Logout & destroy the WhatsApp client
 *     3. Delete LocalAuth session directory
 *     4. Purge all MongoDB messaging collections
 *     5. Drain all BullMQ queues
 *     6. Re-initialise WhatsApp → fresh QR
 *     7. Emit socket events throughout for live UI feedback
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import { requireAuth, requireRole } from "../auth/auth.js";
import { env } from "../config/env.js";
import { emitRealtime } from "../config/realtime.js";
import { AuditLog } from "../models/AuditLog.js";
import { Conversation } from "../models/Conversation.js";
import { Lead } from "../models/Lead.js";
import { Message } from "../models/Message.js";
import { Note } from "../models/Note.js";
import { ProcessedEvent } from "../models/ProcessedEvent.js";
import { Task } from "../models/Task.js";
import {
  automationQueue,
  inboundQueue,
  outboundQueue,
  statusQueue,
} from "../queues/jobs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const adminRouter = Router();

// ─── Auth guard: admin only ───────────────────────────────────────────────────
adminRouter.use(requireAuth);
adminRouter.use(requireRole("admin"));

/** Guard against concurrent reset calls */
let _resetInProgress = false;

// ─── POST /api/admin/reset-crm ────────────────────────────────────────────────
adminRouter.post("/reset-crm", async (req, res) => {
  if (_resetInProgress) {
    return res.status(409).json({ error: "Reset already in progress — please wait" });
  }

  if (env.WA_CLIENT_MODE !== "webjs") {
    return res.status(400).json({
      error: "Full reset only supported in webjs mode (WhatsApp Web.js)"
    });
  }

  _resetInProgress = true;
  console.log(`[Reset] CRM reset initiated by user ${req.user?.id}`);

  // Respond immediately — the reset runs async via Socket.IO progress events
  res.status(202).json({ message: "CRM reset started — watch crm:reset socket events" });

  // ── Run the full reset flow ─────────────────────────────────────────────────
  try {
    emitRealtime("crm:reset", { phase: "starting", at: new Date().toISOString() });

    // ── 1. WhatsApp logout ──────────────────────────────────────────────────
    emitRealtime("crm:reset", { phase: "whatsapp_logout" });
    try {
      const { logoutWhatsApp } = await import("../services/whatsappWebjs.service.js");
      await logoutWhatsApp();
      console.log("[Reset] WhatsApp logout complete");
    } catch (err) {
      // Non-fatal: continue reset even if WA logout fails
      console.warn("[Reset] WhatsApp logout failed (continuing):", err);
    }

    // Give logoutWhatsApp() 1.5s to emit its own events and start its re-init
    // timer — we'll cancel that by calling initWhatsappWebjs() ourselves below.
    await sleep(1500);

    // ── 2. Delete LocalAuth session directory ───────────────────────────────
    emitRealtime("crm:reset", { phase: "deleting_sessions" });
    const sessionPath = path.resolve(__dirname, "../../", env.WA_SESSION_PATH);
    try {
      await fs.rm(sessionPath, { recursive: true, force: true });
      console.log(`[Reset] Session directory deleted: ${sessionPath}`);
    } catch (err) {
      console.warn("[Reset] Could not delete session directory:", err);
    }

    // ── 3. Purge MongoDB collections ────────────────────────────────────────
    emitRealtime("crm:reset", { phase: "clearing_database" });
    const [
      msgResult, leadResult, convResult,
      noteResult, taskResult, eventResult, auditResult
    ] = await Promise.allSettled([
      Message.deleteMany({}),
      Lead.deleteMany({}),
      Conversation.deleteMany({}),
      Note.deleteMany({}),
      Task.deleteMany({}),
      ProcessedEvent.deleteMany({}),
      AuditLog.deleteMany({}),
    ]);

    const dbStats = {
      messages:       fulfilled(msgResult),
      leads:          fulfilled(leadResult),
      conversations:  fulfilled(convResult),
      notes:          fulfilled(noteResult),
      tasks:          fulfilled(taskResult),
      processedEvents: fulfilled(eventResult),
      auditLogs:      fulfilled(auditResult),
    };
    console.log("[Reset] MongoDB purge complete:", dbStats);

    // ── 4. Drain BullMQ queues ──────────────────────────────────────────────
    emitRealtime("crm:reset", { phase: "clearing_queues" });
    await Promise.allSettled([
      inboundQueue.obliterate({ force: true }),
      outboundQueue.obliterate({ force: true }),
      statusQueue.obliterate({ force: true }),
      automationQueue.obliterate({ force: true }),
    ]);
    console.log("[Reset] BullMQ queues drained");

    // ── 5. Re-initialise WhatsApp for fresh QR ──────────────────────────────
    emitRealtime("crm:reset", { phase: "reinitialising_whatsapp" });
    try {
      const { initWhatsappWebjs } = await import("../services/whatsappWebjs.service.js");
      await initWhatsappWebjs();
      console.log("[Reset] WhatsApp re-initialised — QR will be emitted shortly");
    } catch (err) {
      console.error("[Reset] WhatsApp re-init failed:", err);
    }

    // ── 6. Emit completion ──────────────────────────────────────────────────
    emitRealtime("crm:reset", {
      phase: "complete",
      at: new Date().toISOString(),
      stats: dbStats
    });
    console.log("[Reset] ✅ CRM reset complete");

  } catch (err) {
    console.error("[Reset] Fatal error during reset:", err);
    emitRealtime("crm:reset", { phase: "error", error: String(err) });
  } finally {
    _resetInProgress = false;
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Extract deletedCount from a settled Promise result, returns 0 on rejection */
function fulfilled(result: PromiseSettledResult<{ deletedCount?: number }>) {
  return result.status === "fulfilled" ? (result.value?.deletedCount ?? 0) : 0;
}
