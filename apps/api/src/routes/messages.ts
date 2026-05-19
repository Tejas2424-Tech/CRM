import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/auth.js";
import { Lead } from "../models/Lead.js";
import { Message } from "../models/Message.js";
import { outboundQueue } from "../queues/jobs.js";
import { audit } from "../services/audit.js";
import { serializeMessage } from "../services/serializers.js";
import { emitRealtime } from "../config/realtime.js";

export const messagesRouter = Router();

messagesRouter.use(requireAuth);

messagesRouter.get("/:leadId", async (req, res) => {
  const messages = await Message.find({ leadId: req.params.leadId }).sort({ timestamp: 1 }).limit(500);
  res.json(messages.map(serializeMessage));
});

messagesRouter.post("/send", async (req, res) => {
  console.log("[Outbound] [Step 1] Frontend send click received. Payload:", req.body);
  const schema = z.object({
    leadId: z.string(),
    text: z.string().min(1).optional(),
    templateId: z.string().optional()
  }).refine((body) => body.text || body.templateId, "text or templateId is required");
  const body = schema.parse(req.body);
  const lead = await Lead.findById(body.leadId);
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  if (body.templateId && !lead.consent.optedIn) return res.status(400).json({ error: "Lead has not opted in" });

  const message = await Message.create({
    leadId: lead._id,
    direction: "out",
    type: body.templateId ? "template" : "text",
    content: body.text,
    templateId: body.templateId,
    status: "queued",
    timestamp: new Date()
  });
  console.log(`[Outbound] [Step 3] Adding job to outboundQueue: agent-send for msg ${message._id}`);
  await outboundQueue.add("agent-send", { messageId: message._id.toString() });
  await audit(req.user!.id, "message.send", "Message", message._id.toString(), undefined, serializeMessage(message));
  emitRealtime("message:new", serializeMessage(message));
  res.json({ success: true, message: serializeMessage(message) });
});

messagesRouter.post("/send-direct", async (req, res) => {
  console.log("[Outbound] [Step 4] Direct Manual Send triggered. Payload:", req.body);
  const { chatId, text } = req.body;
  if (!chatId || !text) return res.status(400).json({ error: "chatId and text required" });
  try {
    const { getWajsClient } = await import("../services/whatsappWebjs.service.js");
    const client = getWajsClient();
    console.log(`[Outbound] [Step 4] Executing raw client.sendMessage to ${chatId}`);
    const msg = await client.sendMessage(chatId, text);
    res.json({ success: true, waMessageId: (msg as any).id?._serialized });
  } catch (err: any) {
    console.error("[Outbound] [Step 4] Direct Send Failed:", err);
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});
