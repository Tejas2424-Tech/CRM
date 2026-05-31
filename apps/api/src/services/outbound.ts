import { emitRealtime } from "../config/realtime.js";
import { CampaignRecipient } from "../models/Campaign.js";
import { Conversation } from "../models/Conversation.js";
import { Lead } from "../models/Lead.js";
import { Message } from "../models/Message.js";
import { Template } from "../models/Template.js";
import { statusQueue } from "../queues/jobs.js";
import { whatsAppAdapter } from "../adapters/whatsapp.js";
import { classifyLead } from "./leadClassifier.service.js";
import { serializeMessage } from "./serializers.js";
import { waitForWhatsAppReady, getWajsMetadataSnapshot } from "./whatsappWebjs.service.js";

function isRetryableError(err: any): boolean {
  const msg = err.message || "";
  // Transitional states in WaJS
  if (msg.includes("WhatsApp client not connected")) return true;
  if (msg.includes("Timeout waiting for WhatsApp connection")) return true;
  // Common network/transient errors
  if (msg.includes("ECONNRESET") || msg.includes("ETIMEDOUT") || msg.includes("fetch failed")) return true;
  return false;
}

export async function sendOutboundMessage(messageId: string, attemptsMade: number = 0) {
  console.log(`[Outbound] [Step 1] Worker job received for messageId: ${messageId} (Attempt: ${attemptsMade})`);
  const message = await Message.findById(messageId);
  if (!message) {
    console.warn(`[Outbound] Orphaned job discarded: Message ${messageId} no longer exists in DB.`);
    return;
  }

  const lead = await Lead.findById(message.leadId);
  if (!lead) {
    console.warn(`[Outbound] Orphaned job discarded: Lead not found for message ${messageId}.`);
    return;
  }

  // ── Connection Gating ──────────────────────────────────────────────────────
  // IMPORTANT: this job runs in the worker process — the live WaJS client singleton
  // lives in the API process. We MUST read status from Redis (via getWajsMetadataSnapshot)
  // rather than the in-memory _status which is always BOOTING in this process.
  try {
    const snapshot = await getWajsMetadataSnapshot();
    const status = snapshot.status;
    if (status !== "CONNECTED" && status !== "SYNCING") {
      console.log(`[Outbound] WhatsApp status is ${status}. Waiting for readiness…`);
      message.status = "waiting_connection";
      await message.save();
      emitRealtime("message.status_updated", serializeMessage(message));
      
      // Wait for up to 30 seconds (polls Redis via getWajsMetadataSnapshot)
      await waitForWhatsAppReady(30000);
    }
  } catch (err: any) {
    console.warn(`[Outbound] Readiness gate failed: ${err.message}`);
    // If it's a transitional state, we'll let it throw and retry via BullMQ
    if (isRetryableError(err)) {
      throw err; 
    }
    // Otherwise, mark as failed if it's a terminal state like FAILED
    message.status = "failed";
    await message.save();
    emitRealtime("message.status_updated", serializeMessage(message));
    throw err;
  }

  try {
    if (message.type === "text") {
      console.log(`[Outbound] [Step 1] Adapter selected: Text (lead.chatId: ${lead.chatId})`);
      const result = await whatsAppAdapter.sendTextMessage({ phone: lead.phone, chatId: lead.chatId, text: message.content ?? "" });
      message.waMessageId = result.waMessageId;
    } else {
      const template = message.templateId ? await Template.findById(message.templateId) : undefined;
      if (!template?.approved) throw new Error("Template is missing or not approved");
      const result = await whatsAppAdapter.sendTemplateMessage({
        phone: lead.phone,
        chatId: lead.chatId,
        templateName: template.name,
        language: template.language
      });
      message.waMessageId = result.waMessageId;
    }

    // [Step 8] Verify MongoDB Outbound Persistence
    message.status = "sent";
    message.fromMe = true;
    await message.save();
    console.log(`[Outbound] [Step 8] Message ${messageId} saved to MongoDB with fromMe = true`);

    await Conversation.updateOne(
      { leadId: lead._id },
      { $set: { lastMessage: message.content || `[${message.type}]` } },
      { upsert: true }
    );
    lead.lastActivity = new Date();
    lead.unreadCount = 0;
    await lead.save();
    classifyLead(lead._id.toString(), { type: "outbound_message", text: message.content ?? undefined }).catch(console.warn);
    emitRealtime("message.status_updated", serializeMessage(message));

    await statusQueue.add("delivered", { messageId, waMessageId: message.waMessageId, status: "delivered" }, { delay: 800 });
    await statusQueue.add("read", { messageId, waMessageId: message.waMessageId, status: "read" }, { delay: 1800 });
  } catch (err: any) {
    // [Step 2] Handle retry status for UI
    const retryable = isRetryableError(err);
    
    if (retryable && attemptsMade < 9) {
      message.status = "retrying";
      await message.save();
      emitRealtime("message.status_updated", serializeMessage(message));
      console.log(`[Outbound] Message ${messageId} failed (retryable), marked as RETRYING. Error: ${err.message}`);
    } else {
      message.status = "failed";
      await message.save();
      emitRealtime("message.status_updated", serializeMessage(message));
      console.error(`[Outbound] Message ${messageId} failed ${retryable ? "after all retries" : "permanently"}. Error: ${err.message}`);
    }
    throw err;
  }
}

export async function sendCampaignRecipient(campaignId: string, recipientId: string) {
  const recipient = await CampaignRecipient.findById(recipientId);
  if (!recipient) {
    console.warn(`[Outbound] Orphaned job discarded: Campaign recipient ${recipientId} no longer exists.`);
    return;
  }
  const lead = await Lead.findById(recipient.leadId);
  if (!lead) {
    console.warn(`[Outbound] Orphaned job discarded: Lead not found for recipient ${recipientId}.`);
    return;
  }

  if (!lead.consent.optedIn) {
    recipient.status = "failed";
    recipient.error = "Lead has not opted in";
    await recipient.save();
    return;
  }

  const campaign = await import("../models/Campaign.js").then((m) => m.Campaign.findById(campaignId));
  if (!campaign) throw new Error("Campaign not found");
  const template = await Template.findById(campaign.templateId);
  if (!template?.approved) throw new Error("Template is missing or not approved");

  const result = await whatsAppAdapter.sendTemplateMessage({
    phone: lead.phone,
    templateName: template.name,
    language: template.language
  });

  recipient.status = "sent";
  recipient.waMessageId = result.waMessageId;
  await recipient.save();

  let message;
  try {
    await Message.updateOne(
      { waMessageId: result.waMessageId },
      {
        $setOnInsert: {
          leadId: lead._id,
          direction: "out",
          type: "template",
          templateId: template._id,
          content: template.body,
          status: "sent",
          waMessageId: result.waMessageId,
          timestamp: new Date()
        }
      },
      { upsert: true }
    );
    message = await Message.findOne({ waMessageId: result.waMessageId });
  } catch (err: any) {
    if (err?.code !== 11000) throw err;
    message = await Message.findOne({ waMessageId: result.waMessageId });
  }
  
  if (!message) throw new Error("Failed to insert campaign message silently");

  await Conversation.updateOne(
    { leadId: lead._id },
    { $set: { lastMessage: message.content || `[${message.type}]` } },
    { upsert: true }
  );

  emitRealtime("message:new", serializeMessage(message));
  emitRealtime("campaign.updated", { id: campaignId });

  await statusQueue.add("campaign-delivered", { recipientId, messageId: message._id.toString(), waMessageId: result.waMessageId, status: "delivered" }, { delay: 800 });
  await statusQueue.add("campaign-read", { recipientId, messageId: message._id.toString(), waMessageId: result.waMessageId, status: "read" }, { delay: 1800 });
}

export async function updateMessageStatus(payload: {
  messageId?: string;
  recipientId?: string;
  status: "sent" | "delivered" | "read";
}) {
  if (payload.messageId) {
    const message = await Message.findByIdAndUpdate(payload.messageId, { status: payload.status }, { new: true });
    if (message) emitRealtime("message.status_updated", serializeMessage(message));
  }
  if (payload.recipientId) {
    await CampaignRecipient.findByIdAndUpdate(payload.recipientId, { status: payload.status });
  }
}
