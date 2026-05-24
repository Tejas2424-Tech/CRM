import type { LeadStatus } from "@crm/shared";
import { emitRealtime } from "../config/realtime.js";
import { Lead } from "../models/Lead.js";
import { redisConnection } from "../queues/connection.js";
import { serializeLead } from "./serializers.js";

export type ClassificationEvent =
  | { type: "inbound_message"; text?: string }
  | { type: "outbound_message"; text?: string }
  | { type: "task_completed" };

const INTENT_KEYWORDS = [
  "price", "cost", "rate", "how much",
  "details", "info", "send", "brochure",
  "interested", "yes", "ok", "sure", "okay"
];

const GENERIC_REPLIES = new Set(["ok", "yes", "👍", "hmm", "okay", "sure"]);

function isIntentMessage(text: string): boolean {
  const lower = text.toLowerCase().trim();
  if (INTENT_KEYWORDS.some((kw) => lower.includes(kw))) return true;
  const wordCount = lower.split(/\s+/).filter(Boolean).length;
  return wordCount > 5 && !GENERIC_REPLIES.has(lower);
}

function nextStage(current: LeadStatus, event: ClassificationEvent): LeadStatus | null {
  const stage: LeadStatus = current ?? "new";

  if (event.type === "outbound_message" || event.type === "inbound_message") {
    if (stage === "new") return "contacted";
    if (stage === "contacted" && event.text && isIntentMessage(event.text)) return "interested";
    return null;
  }

  if (event.type === "task_completed") {
    if (stage === "interested") return "won";
    return null;
  }

  return null;
}

export async function classifyLead(leadId: string, event: ClassificationEvent): Promise<void> {
  const lockKey = `lead:classify:lock:${leadId}`;
  const lockValue = `${process.pid}:${Date.now()}`;
  let lockAcquired = false;

  try {
    try {
      const result = await redisConnection.set(lockKey, lockValue, "EX", 10, "NX");
      lockAcquired = result === "OK";
      if (!lockAcquired) return;
    } catch {
      // Redis unavailable — fail open, continue without lock
    }

    const lead = await Lead.findById(leadId);
    if (!lead) return;

    const current = (lead.stage ?? "new") as LeadStatus;
    const desired = nextStage(current, event);
    if (!desired || desired === current) return;

    const previous = current;
    lead.stage = desired;
    await lead.save();

    emitRealtime("lead:update", serializeLead(lead));
    console.log(`[Classifier] ${leadId}: ${previous} → ${desired} (${event.type})`);
  } catch (err) {
    console.warn("[Classifier] classifyLead error:", err);
  } finally {
    if (lockAcquired) {
      try {
        const owner = await redisConnection.get(lockKey);
        if (owner === lockValue) await redisConnection.del(lockKey);
      } catch {
        // ignore lock-release failures
      }
    }
  }
}

export async function recomputeLostLeads(): Promise<void> {
  try {
    const thresholdDays = parseInt(process.env.LOST_THRESHOLD_DAYS ?? "14", 10);
    const cutoff = new Date(Date.now() - thresholdDays * 24 * 60 * 60 * 1000);

    const leads = await Lead.find({
      stage: { $nin: ["won", "lost"] },
      lastActivity: { $lt: cutoff }
    });

    for (const lead of leads) {
      lead.stage = "lost";
      await lead.save();
      emitRealtime("lead:update", serializeLead(lead));
    }

    console.log(`[LostLeads] Marked ${leads.length} leads as LOST (threshold: ${thresholdDays} days)`);
  } catch (err) {
    console.warn("[LostLeads] recomputeLostLeads error:", err);
  }
}
