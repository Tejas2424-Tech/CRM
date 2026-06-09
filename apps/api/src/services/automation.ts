import { Lead } from "../models/Lead.js";
import { Message } from "../models/Message.js";
import { ProcessedEvent } from "../models/ProcessedEvent.js";
import { outboundQueue } from "../queues/jobs.js";
import type { InboundJob } from "../queues/jobs.js";
import { FollowupPlan } from "../models/FollowupPlan.js";
import { enroll, hasActiveEnrollment } from "./followup.js";

const WELCOME_CONTENT = "Thanks for reaching out. An agent will follow up shortly.";

export async function runAutomation(job: InboundJob) {
  const lead = await Lead.findOne({ phone: job.phone });
  if (!lead?.consent.optedIn) return;
  if (!job.isNewLead) return;

  const automationKey = `automation:${job.waMessageId}`;
  const prevEvent = await ProcessedEvent.findOneAndUpdate(
    { key: automationKey },
    { $setOnInsert: { key: automationKey, type: "automation.welcome", status: "processing", processedAt: new Date() } },
    { upsert: true, new: false }
  );
  if (prevEvent) {
    console.log(`[Automation] Duplicate automation job for ${job.waMessageId} — skipping`);
    return;
  }

  try {
    const defaultPlan = await FollowupPlan.findOne({ isDefault: true });
    if (defaultPlan) {
      console.log(`[Automation] Enrolling new lead ${lead._id} in default plan ${defaultPlan._id}`);
      await enroll(lead._id.toString(), defaultPlan._id.toString(), "system").catch((err) =>
        console.warn("[Automation] Auto-enroll failed:", err)
      );
      await ProcessedEvent.updateOne({ key: automationKey }, { $set: { status: "completed" } });
      return;
    }

    // Legacy path: no default plan configured. Skip if a plan enrollment is
    // already active (manually created between inbound arrival and this job firing).
    if (await hasActiveEnrollment(lead._id.toString())) {
      await ProcessedEvent.updateOne({ key: automationKey }, { $set: { status: "completed" } });
      return;
    }

    // Guard against duplicates on queue retries
    const hasWelcome = await Message.exists({ leadId: lead._id, direction: "out", content: WELCOME_CONTENT });
    if (hasWelcome) {
      await ProcessedEvent.updateOne({ key: automationKey }, { $set: { status: "completed" } });
      return;
    }

    const message = await Message.create({
      leadId: lead._id,
      direction: "out",
      type: "text",
      content: WELCOME_CONTENT,
      status: "queued",
      timestamp: new Date()
    });
    await outboundQueue.add("automation-welcome", { messageId: message._id.toString() });
    await ProcessedEvent.updateOne({ key: automationKey }, { $set: { status: "completed" } });
  } catch (err: any) {
    await ProcessedEvent.updateOne(
      { key: automationKey },
      { $set: { status: "failed", lastError: err.message }, $inc: { retries: 1 } }
    );
    throw err;
  }
}
