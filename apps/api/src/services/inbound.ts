import { emitRealtime } from "../config/realtime.js";
import { Conversation } from "../models/Conversation.js";
import { Lead } from "../models/Lead.js";
import { Message } from "../models/Message.js";
import { ProcessedEvent } from "../models/ProcessedEvent.js";
import { automationQueue } from "../queues/jobs.js";
import { isOptOutMessage } from "./compliance.js";
import { stopEnrollment } from "./followup.js";
import { updateRecipientStatus } from "./campaigns.js";
import { classifyLead } from "./leadClassifier.service.js";
import { reconcileLidSibling } from "./leadMerge.service.js";
import { serializeLead, serializeMessage } from "./serializers.js";

const debugMessageSync = process.env.MESSAGE_SYNC_DEBUG === "1";

export async function processInboundMessage(job: {
  waMessageId: string;
  phone: string;
  chatId?: string;
  name?: string;
  text: string;
  timestamp?: string;
}) {
  const previousEvent = await ProcessedEvent.findOneAndUpdate(
    { key: job.waMessageId },
    { $setOnInsert: { key: job.waMessageId, type: "whatsapp.inbound", status: "processing", processedAt: new Date() } },
    { upsert: true, new: false }
  );

  if (previousEvent) {
    console.log(`[Dedupe] Message ${job.waMessageId} skipped (already processed)`);
    return { duplicate: true };
  }

  try {
    const timestamp = job.timestamp ? new Date(job.timestamp) : new Date();
    const windowExpiresAt = new Date(timestamp.getTime() + 24 * 60 * 60 * 1000);
    const optedOut = isOptOutMessage(job.text);
    const lead = await Lead.findOneAndUpdate(
      { phone: job.phone },
      {
        $set: {
          ...(job.name ? { name: job.name } : {}),
          ...(job.chatId ? { chatId: job.chatId } : {}),
          lastActivity: timestamp,
          lastInboundAt: timestamp,
          windowExpiresAt,
          ...(optedOut ? { "consent.optedIn": false, "consent.optedOutAt": timestamp } : {})
        },
        $setOnInsert: {
          phone: job.phone,
          source: "whatsapp",
          stage: "new",
          tags: [],
          "consent.source": "inbound"
        }
      },
      { new: true, upsert: true }
    );

    const isNewLead = (Date.now() - lead.createdAt.getTime()) < 10_000;

    let message;
    try {
      const result = await Message.updateOne(
        { waMessageId: job.waMessageId },
        {
          $setOnInsert: {
            leadId: lead._id,
            direction: "in",
            type: "text",
            content: job.text,
            status: "read",
            waMessageId: job.waMessageId,
            timestamp
          }
        },
        { upsert: true }
      );
      if (debugMessageSync) {
        console.log(
          `[MessageSync][Inbound] waMessageId=${job.waMessageId} lead=${lead._id.toString()} upserted=${result.upsertedCount}`
        );
      }
      message = await Message.findOne({ waMessageId: job.waMessageId });
    } catch (err: any) {
      if (err?.code !== 11000) throw err;
      message = await Message.findOne({ waMessageId: job.waMessageId });
    }

    if (!message) throw new Error("Message insertion failed silently");

    await Conversation.updateOne(
      { leadId: lead._id },
      { $set: { lastMessage: job.text } },
      { upsert: true }
    );

    await Lead.updateOne({ _id: lead._id }, { $inc: { unreadCount: 1 } });
    lead.unreadCount = (lead.unreadCount ?? 0) + 1; // keep local copy in sync for serializeLead

    emitRealtime("lead:update", serializeLead(lead));
    emitRealtime("message:new", serializeMessage(message));
    classifyLead(lead._id.toString(), { type: "inbound_message", text: job.text }).catch(console.warn);

    // Human handoff: cancel all pending follow-up jobs instantly on any reply.
    // Fire-and-forget — never blocks inbound processing.
    stopEnrollment(lead._id.toString(), "system", "reply").catch((err) =>
      console.warn("[Inbound] stopEnrollment failed:", err)
    );

    // Campaign reply tracking: mark recipient as replied in any running campaign.
    // Fire-and-forget — never blocks inbound processing.
    updateRecipientStatus(lead._id.toString(), "replied").catch((err) =>
      console.warn("[Inbound] campaign updateRecipientStatus failed:", err)
    );

    // If this is a real-phone lead and the inbound came from an @lid chat, check for a
    // matching lid: sibling lead and merge them. Fire-and-forget — never blocks inbound.
    if (!lead.phone.startsWith("lid:") && job.chatId?.endsWith("@lid")) {
      reconcileLidSibling(lead._id.toString(), job.chatId).catch(console.warn);
    }

    if (!optedOut) {
      await automationQueue.add("welcome-followup", { ...job, isNewLead }, { delay: 1000 });
    }

    await ProcessedEvent.updateOne({ key: job.waMessageId }, { $set: { status: "completed" } });

    return { lead, message };
  } catch (error: any) {
    await ProcessedEvent.updateOne(
      { key: job.waMessageId },
      { $set: { status: "failed", lastError: error.message }, $inc: { retries: 1 } }
    );
    throw error;
  }
}
