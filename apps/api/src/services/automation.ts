import { Lead } from "../models/Lead.js";
import { Message } from "../models/Message.js";
import { outboundQueue } from "../queues/jobs.js";
import type { InboundJob } from "../queues/jobs.js";

const WELCOME_CONTENT = "Thanks for reaching out. An agent will follow up shortly.";

export async function runAutomation(job: InboundJob) {
  const lead = await Lead.findOne({ phone: job.phone });
  if (!lead?.consent.optedIn) return;

  // Guard against duplicates on queue retries: check the `content` field
  // (the actual MongoDB field). The DTO exposes this as `text` but that is a
  // serializer alias only — it does not exist in the database.
  const hasWelcome = await Message.exists({
    leadId: lead._id,
    direction: "out",
    content: WELCOME_CONTENT
  });
  if (hasWelcome) return;

  const message = await Message.create({
    leadId: lead._id,
    direction: "out",
    type: "text",
    content: WELCOME_CONTENT,
    status: "queued",
    timestamp: new Date()
  });

  await outboundQueue.add("automation-welcome", { messageId: message._id.toString() });
}
