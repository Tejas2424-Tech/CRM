import { Router } from "express";
import { z } from "zod";
import { whatsAppAdapter } from "../adapters/whatsapp.js";
import { inboundQueue } from "../queues/jobs.js";
import { env } from "../config/env.js";

export const webhookRouter = Router();

// ─── Meta Cloud API — GET challenge verification ──────────────────────────────
webhookRouter.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === env.WA_VERIFY_TOKEN) {
    console.log("[Webhook] Meta verification challenge accepted");
    res.status(200).send(challenge);
  } else {
    console.warn("[Webhook] Meta verification failed — token mismatch");
    res.sendStatus(403);
  }
});

// ─── Meta Cloud API — POST inbound messages ───────────────────────────────────
// Parses the Meta Cloud API payload format, normalises each message into the
// internal InboundJob shape, and enqueues them. ACKs immediately (200) so Meta
// does not retry. Dedup is handled downstream by ProcessedEvent.
webhookRouter.post("/", async (req, res) => {
  // Always ACK first — Meta requires 200 within 20 s or it retries.
  res.sendStatus(200);

  try {
    const messages = whatsAppAdapter.parseWebhook(req.body);
    if (!messages.length) return;

    console.log(`[Webhook] Meta: enqueuing ${messages.length} inbound message(s)`);
    await Promise.all(
      messages.map((msg) =>
        inboundQueue
          .add("meta-inbound", {
            waMessageId: msg.waMessageId,
            phone: msg.phone,
            name: msg.name,
            text: msg.text,
            timestamp: msg.timestamp
          })
          .then(() => {
            if (process.env.MESSAGE_SYNC_DEBUG === "1") {
              console.log(`[MessageSync][Webhook] queued source=meta waMessageId=${msg.waMessageId} phone=${msg.phone}`);
            }
          })
      )
    );
  } catch (err) {
    // Log but never re-throw — the 200 is already sent and we must not 500.
    console.error("[Webhook] Meta inbound processing error:", err);
  }
});

// ─── Simple / mock webhook — POST /webhook/whatsapp ──────────────────────────
// Accepts the flat test payload described in the README. Used for local
// development and integration tests. Safe to call repeatedly — ProcessedEvent
// deduplicates by waMessageId.
const flatInboundSchema = z.object({
  waMessageId: z.string().min(1),
  phone: z.string().min(4),
  name: z.string().optional(),
  text: z.string(),
  timestamp: z.string().optional()
});

webhookRouter.post("/whatsapp", async (req, res) => {
  const parsed = flatInboundSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.issues });
  }

  const { waMessageId, phone, name, text, timestamp } = parsed.data;
  console.log(`[Webhook] Mock inbound: ${phone} → "${text.slice(0, 60)}"`);

  await inboundQueue.add("mock-inbound", { waMessageId, phone, name, text, timestamp });
  if (process.env.MESSAGE_SYNC_DEBUG === "1") {
    console.log(`[MessageSync][Webhook] queued source=mock waMessageId=${waMessageId} phone=${phone}`);
  }
  res.json({ queued: true, waMessageId });
});

// ─── Outbound connectivity test ───────────────────────────────────────────────
webhookRouter.get("/test-meta", async (req, res) => {
  const phone = req.query.phone as string;
  if (!phone) return res.status(400).json({ error: "phone query param required" });

  try {
    const result = await whatsAppAdapter.sendTextMessage({
      phone,
      text: "Meta Connection Ready — Messaging CRM connectivity test successful."
    });
    res.json({ success: true, ...result });
  } catch (err: any) {
    console.error("[Webhook] Meta test error:", err);
    res.status(500).json({ error: err.message });
  }
});
