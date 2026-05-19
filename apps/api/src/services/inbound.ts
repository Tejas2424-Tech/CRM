import { emitRealtime } from "../config/realtime.js";
import { Conversation } from "../models/Conversation.js";
import { Lead } from "../models/Lead.js";
import { Message } from "../models/Message.js";
import { ProcessedEvent } from "../models/ProcessedEvent.js";
import { automationQueue } from "../queues/jobs.js";
import { isOptOutMessage } from "./compliance.js";
import { serializeLead, serializeMessage } from "./serializers.js";

export async function processInboundMessage(job: {
  waMessageId: string;
  phone: string;
  name?: string;
  text: string;
  timestamp?: string;
}) {
  const inserted = await ProcessedEvent.updateOne(
    { key: job.waMessageId },
    { $setOnInsert: { key: job.waMessageId, type: "whatsapp.inbound", processedAt: new Date() } },
    { upsert: true }
  );

  if (inserted.upsertedCount === 0) return { duplicate: true };

  const timestamp = job.timestamp ? new Date(job.timestamp) : new Date();
  const windowExpiresAt = new Date(timestamp.getTime() + 24 * 60 * 60 * 1000);
  const optedOut = isOptOutMessage(job.text);
  const lead = await Lead.findOneAndUpdate(
    { phone: job.phone },
    {
      $set: {
        ...(job.name ? { name: job.name } : {}),
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

  const message = await Message.create({
    leadId: lead._id,
    direction: "in",
    type: "text",
    content: job.text,
    status: "read",
    waMessageId: job.waMessageId,
    timestamp
  });

  await Conversation.updateOne(
    { leadId: lead._id },
    { $set: { lastMessage: job.text } },
    { upsert: true }
  );

  lead.unreadCount = (lead.unreadCount ?? 0) + 1;
  await lead.save();

  emitRealtime("lead:update", serializeLead(lead));
  emitRealtime("message:new", serializeMessage(message));

  if (!optedOut) {
    await automationQueue.add("welcome-followup", job, { delay: 1000 });
  }

  return { lead, message };
}
