/**
 * whatsapp.routes.ts
 *
 * Endpoints for WhatsApp Web session management and outbound messaging.
 *
 * GET  /api/whatsapp/status  — current connection state
 * GET  /api/whatsapp/qr      — latest QR payload (for dashboard display)
 * POST /api/whatsapp/send    — queue an outbound message to a lead
 * POST /api/whatsapp/sync    — manually trigger Phase 1 contact + chat sync
 */

import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/auth.js";
import { Lead } from "../models/Lead.js";
import { Message } from "../models/Message.js";
import { outboundQueue } from "../queues/jobs.js";
import { emitRealtime } from "../config/realtime.js";
import { serializeMessage } from "../services/serializers.js";
import { env } from "../config/env.js";
import {
  getWajsStatus,
  getWajsQr,
  getWajsClient,
  getWajsMetadata,
  logoutWhatsApp
} from "../services/whatsappWebjs.service.js";
import { syncAllChats } from "../services/chatSync.service.js";

export const whatsappRouter = Router();

// ─── Auth guard ───────────────────────────────────────────────────────────────
whatsappRouter.use(requireAuth);

// ─── GET /api/whatsapp/status ─────────────────────────────────────────────────
whatsappRouter.get("/status", (_req, res) => {
  if (env.WA_CLIENT_MODE !== "webjs") {
    return res.json({ mode: env.WA_CLIENT_MODE, status: "NOT_APPLICABLE" });
  }
  const metadata = getWajsMetadata();
  return res.json({ mode: "webjs", ...metadata });
});

// ─── GET /api/whatsapp/qr ─────────────────────────────────────────────────────
whatsappRouter.get("/qr", (_req, res) => {
  if (env.WA_CLIENT_MODE !== "webjs") {
    return res.status(400).json({ error: "whatsapp-web.js mode not active" });
  }
  const qr = getWajsQr();
  if (!qr) {
    return res.status(404).json({ error: "No QR available — session may already be active" });
  }
  return res.json({ qr });
});

// ─── POST /api/whatsapp/send ──────────────────────────────────────────────────
/**
 * Body: { leadId: string, message: string }
 * Queues an outbound text message via BullMQ → worker → WaJsAdapter.sendTextMessage()
 */
whatsappRouter.post("/send", async (req, res) => {
  const schema = z.object({
    leadId: z.string().min(1),
    message: z.string().min(1)
  });

  const body = schema.parse(req.body);
  const lead = await Lead.findById(body.leadId);
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  const msg = await Message.create({
    leadId: lead._id,
    direction: "out",
    type: "text",
    content: body.message,
    status: "queued",
    fromMe: true,
    timestamp: new Date()
  });

  await outboundQueue.add("whatsapp-send", { messageId: msg._id.toString() });
  emitRealtime("message:new", serializeMessage(msg));

  return res.json({ success: true, message: serializeMessage(msg) });
});

// ─── POST /api/whatsapp/sync ──────────────────────────────────────────────────
/**
 * Manually trigger a full contact + chat sync.
 * Useful after re-authentication or when the agent wants to pull fresh history.
 * The sync runs in the background — a 202 Accepted is returned immediately.
 * Progress is streamed to the dashboard via Socket.IO events:
 *   sync:started  → { at }
 *   sync:progress → { total, done }
 *   sync:complete → { total, done, errors, at }
 *   sync:error    → { error }
 */
whatsappRouter.post("/sync", async (_req, res) => {
  if (env.WA_CLIENT_MODE !== "webjs") {
    return res.status(400).json({ error: "Sync only available in webjs mode" });
  }

  if (getWajsStatus() !== "CONNECTED") {
    return res.status(409).json({
      error: "WhatsApp client not connected",
      status: getWajsStatus()
    });
  }

  try {
    const client = getWajsClient();
    // Fire-and-forget — sync runs async, progress is pushed via Socket.IO
    syncAllChats(client as any).catch((err) =>
      console.error("[API] Manual syncAllChats failed:", err)
    );
    return res.status(202).json({ message: "Sync started — watch sync:progress events" });
  } catch (err: any) {
    return res.status(503).json({ error: err.message });
  }
});

// ─── POST /api/whatsapp/logout ────────────────────────────────────────────────
/**
 * Logout the currently connected WhatsApp account.
 *
 * Flow (async, non-blocking):
 *   1. client.logout()  — revoke session on phone
 *   2. client.destroy() — kill puppeteer
 *   3. Delete LocalAuth session directory
 *   4. Emit wajs:logout → wajs:status(DISCONNECTED)
 *   5. Re-initialise client → emits wajs:qr for next scan
 *
 * Frontend watches Socket.IO for state transitions; this endpoint
 * returns 202 immediately so the HTTP call never hangs.
 */
whatsappRouter.post("/logout", async (_req, res) => {
  if (env.WA_CLIENT_MODE !== "webjs") {
    return res.status(400).json({ error: "Logout only available in webjs mode" });
  }

  // Allow logout even if status is DISCONNECTED (cleans up stale sessions)
  const currentStatus = getWajsStatus();
  if (currentStatus === "INITIALISING") {
    return res.status(409).json({
      error: "Client is still initialising — please wait",
      status: currentStatus
    });
  }

  // Fire-and-forget — the async flow emits Socket.IO events as it progresses
  logoutWhatsApp().catch((err) =>
    console.error("[API] logoutWhatsApp failed:", err)
  );

  return res.status(202).json({
    message: "Logout initiated — watch wajs:logout and wajs:qr socket events"
  });
});
