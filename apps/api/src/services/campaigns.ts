import { parse } from "csv-parse/sync";
import type { HydratedDocument } from "mongoose";
import { emitRealtime } from "../config/realtime.js";
import { Campaign } from "../models/Campaign.js";
import type { CampaignDocument } from "../models/Campaign.js";
import { CampaignRecipient } from "../models/CampaignRecipient.js";
import type { CampaignRecipientDocument } from "../models/CampaignRecipient.js";
import { Lead } from "../models/Lead.js";
import { Message } from "../models/Message.js";
import { ProcessedEvent } from "../models/ProcessedEvent.js";
import type { CampaignRecipientJob } from "../queues/jobs.js";
import { campaignQueue, outboundQueue } from "../queues/jobs.js";
import { normalizePhone } from "../utils/phone.js";
import { audit } from "./audit.js";
import { serializeCampaign, serializeCampaignRecipient } from "./serializers.js";

// ─── CSV parsing ──────────────────────────────────────────────────────────────

export interface ParsedCsvRow {
  phone: string;
  name?: string;
  customVars: Record<string, string>;
}

export function parseCsv(buffer: Buffer): {
  valid: ParsedCsvRow[];
  invalid: Array<{ row: number; phone: string; reason: string }>;
} {
  const rows: Record<string, string>[] = parse(buffer, {
    columns: (header: string[]) => header.map((h) => h.toLowerCase().trim()),
    skip_empty_lines: true,
    trim: true
  });

  const valid: ParsedCsvRow[] = [];
  const invalid: Array<{ row: number; phone: string; reason: string }> = [];
  const seen = new Map<string, number>();

  rows.forEach((row, idx) => {
    const rawPhone = row["phone"] ?? row["mobile"] ?? row["number"] ?? "";
    const normalized = normalizePhone(rawPhone);
    if (!normalized) {
      invalid.push({ row: idx + 2, phone: rawPhone, reason: "Invalid or missing phone number" });
      return;
    }
    const { phone: _p, name: _n, mobile: _m, number: _num, ...rest } = row;
    const customVars: Record<string, string> = {};
    for (const [k, v] of Object.entries(rest)) {
      if (v) customVars[k] = v;
    }
    seen.set(normalized, idx);
    valid.push({ phone: normalized, name: row["name"]?.trim() || undefined, customVars });
  });

  // Dedup: keep last-write-wins by rebuilding from seen map
  const deduped = Array.from(seen.keys()).map((phone) => valid.find((v) => v.phone === phone)!);
  return { valid: deduped, invalid };
}

// ─── Variable interpolation ───────────────────────────────────────────────────

function interpolate(
  template: string,
  vars: { name?: string; phone: string; tags?: string[]; customVars?: Record<string, string> }
): string {
  const company =
    vars.tags?.find((t) => t.startsWith("company:"))?.slice(8).trim() ??
    vars.customVars?.["company"] ??
    "";
  let result = template
    .replace(/\{\{name\}\}/gi, vars.name ?? vars.phone)
    .replace(/\{\{phone\}\}/gi, vars.phone)
    .replace(/\{\{company\}\}/gi, company);

  if (vars.customVars) {
    for (const [key, value] of Object.entries(vars.customVars)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "gi"), value);
    }
  }
  return result;
}

// ─── createCampaign ───────────────────────────────────────────────────────────

export interface CreateCampaignInput {
  name: string;
  description?: string;
  type: CampaignDocument["type"];
  audienceSource: "crm_filters" | "csv";
  filters?: CampaignDocument["filters"];
  messageBody: string;
  sendAt?: Date;
  timezone?: string;
  messagesPerMinute?: number;
  csvRows?: ParsedCsvRow[];
  createdBy: string;
}

export async function createCampaign(
  input: CreateCampaignInput
): Promise<HydratedDocument<CampaignDocument>> {
  let recipientCount = 0;

  const campaign = await Campaign.create({
    name: input.name,
    description: input.description,
    type: input.type,
    status: input.sendAt ? "scheduled" : "draft",
    audienceSource: input.audienceSource,
    filters: input.filters,
    messageBody: input.messageBody,
    sendAt: input.sendAt,
    timezone: input.timezone ?? "UTC",
    messagesPerMinute: input.messagesPerMinute ?? 10,
    createdBy: input.createdBy,
    recipientCount: 0
  });

  if (input.audienceSource === "csv" && input.csvRows?.length) {
    await dropLegacyCampaignLeadIndex();
    const docs = input.csvRows.map((row) => ({
      campaignId: campaign._id,
      phone: row.phone,
      name: row.name,
      customVars: Object.keys(row.customVars).length ? row.customVars : undefined,
      status: "pending" as const
    }));
    const settled = await Promise.allSettled(docs.map((doc) => CampaignRecipient.create(doc)));
    settled.forEach((r, i) => {
      if (r.status === "rejected" && (r.reason as any)?.code !== 11000) {
        console.error(`[Campaign] recipient insert failed (${docs[i].phone}):`, (r.reason as any)?.message);
      }
    });
    recipientCount = await CampaignRecipient.countDocuments({ campaignId: campaign._id });
  } else if (input.audienceSource === "crm_filters") {
    const query = buildLeadQuery(input.filters);
    recipientCount = await Lead.countDocuments({ ...query, "consent.optedIn": true });
  }

  campaign.recipientCount = recipientCount;
  await campaign.save();

  await audit(input.createdBy, "campaign.created", "Campaign", campaign._id.toString(), undefined, {
    name: input.name,
    type: input.type,
    recipientCount
  });

  return campaign;
}

// ─── launchCampaign ───────────────────────────────────────────────────────────

export async function launchCampaign(
  campaignId: string,
  actorId: string
): Promise<HydratedDocument<CampaignDocument>> {
  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);
  if (campaign.status === "running") return campaign;
  if (!["draft", "scheduled", "paused"].includes(campaign.status)) {
    throw new Error(`Cannot launch campaign in status "${campaign.status}"`);
  }

  const previousStatus = campaign.status;
  campaign.status = "running";
  campaign.startedAt = new Date();
  await campaign.save();

  if (campaign.audienceSource === "crm_filters") {
    const query = buildLeadQuery(campaign.filters);
    const leads = await Lead.find({ ...query, "consent.optedIn": true }, { _id: 1, phone: 1, name: 1, tags: 1 });
    if (leads.length) {
      const docs = leads.map((l) => ({
        campaignId: campaign._id,
        leadId: l._id,
        phone: l.phone,
        name: l.name,
        status: "pending" as const
      }));
      const settled = await Promise.allSettled(docs.map((doc) => CampaignRecipient.create(doc)));
      settled.forEach((r, i) => {
        if (r.status === "rejected" && (r.reason as any)?.code !== 11000) {
          console.error(`[Campaign] recipient insert failed (${docs[i].phone}):`, (r.reason as any)?.message);
        }
      });
    }
  }

  const recipients = await CampaignRecipient.find(
    { campaignId: campaign._id, status: "pending" },
    { _id: 1 }
  ).lean();

  if (recipients.length === 0) {
    campaign.status = "completed";
    campaign.completedAt = new Date();
    campaign.progress.total = 0;
    await campaign.save();
    emitRealtime("campaign:completed", serializeCampaign(campaign));
    return campaign;
  }

  // For fresh launches: persist total before queuing so checkFinalization always sees
  // the correct denominator (job 0 has delay=0 and may process before the loop finishes).
  // For resumed campaigns: preserve the original total — resetting it to the remaining
  // pending count would cause immediate finalization when sent > remaining.
  if (previousStatus !== "paused") {
    await Campaign.findByIdAndUpdate(campaign._id, {
      $set: { "progress.total": recipients.length, recipientCount: recipients.length }
    });
    campaign.progress.total = recipients.length;
    campaign.recipientCount = recipients.length;
  }

  const msPerMessage = Math.floor(60_000 / campaign.messagesPerMinute);
  for (let i = 0; i < recipients.length; i++) {
    await campaignQueue.add(
      "send-campaign-recipient",
      { campaignId: campaignId, recipientId: recipients[i]._id.toString() },
      { delay: msPerMessage * i }
    );
  }

  emitRealtime("campaign:started", serializeCampaign(campaign));
  await audit(actorId, "campaign.launch", "Campaign", campaignId, { status: "draft" }, { status: "running" });

  return campaign;
}

// ─── processCampaignRecipient ─────────────────────────────────────────────────

export async function processCampaignRecipient(data: CampaignRecipientJob): Promise<void> {
  const { campaignId, recipientId } = data;
  const idempotencyKey = `campaign:recipient:${recipientId}`;

  const existing = await ProcessedEvent.findOneAndUpdate(
    { key: idempotencyKey },
    {
      $setOnInsert: {
        key: idempotencyKey,
        type: "campaign.recipient",
        status: "processing",
        processedAt: new Date()
      }
    },
    { upsert: true, new: false }
  );

  if (existing?.status === "completed") {
    console.log(`[Campaign] Recipient ${recipientId} already processed — skipping`);
    return;
  }

  // Track how many times this job has previously failed so we only mark the
  // recipient "failed" (and count it against progress) on the final BullMQ attempt.
  const prevRetries: number = (existing?.retries as number | undefined) ?? 0;

  try {
    const recipient = await CampaignRecipient.findById(recipientId);
    if (!recipient || recipient.status !== "pending") {
      await ProcessedEvent.updateOne({ key: idempotencyKey }, { $set: { status: "completed" } });
      const campaign = await Campaign.findById(campaignId);
      if (campaign) await checkFinalization(campaign);
      return;
    }

    const campaign = await Campaign.findById(campaignId);
    if (!campaign || campaign.status !== "running") {
      await CampaignRecipient.findByIdAndUpdate(recipientId, { $set: { status: "skipped" } });
      await Campaign.findByIdAndUpdate(campaignId, { $inc: { "progress.skipped": 1 } });
      await ProcessedEvent.updateOne({ key: idempotencyKey }, { $set: { status: "completed" } });
      return;
    }

    let leadId = recipient.leadId;
    let leadName = recipient.name;
    let leadTags: string[] = [];

    if (recipient.leadId) {
      const lead = await Lead.findById(recipient.leadId);
      if (!lead || !lead.consent.optedIn) {
        await CampaignRecipient.findByIdAndUpdate(recipientId, { $set: { status: "opted_out", processedAt: new Date() } });
        const updated = await Campaign.findByIdAndUpdate(
          campaignId,
          { $inc: { "progress.skipped": 1 } },
          { new: true }
        );
        if (updated) await checkFinalization(updated);
        await ProcessedEvent.updateOne({ key: idempotencyKey }, { $set: { status: "completed" } });
        return;
      }
      leadName = lead.name ?? recipient.name;
      leadTags = lead.tags ?? [];
    } else {
      // CSV recipient without a CRM lead — upsert a minimal Lead
      const upserted = await Lead.findOneAndUpdate(
        { phone: recipient.phone },
        {
          $setOnInsert: {
            phone: recipient.phone,
            source: "campaign",
            stage: "new",
            tags: [],
            "consent.optedIn": true,
            "consent.source": "campaign",
            lastActivity: new Date()
          }
        },
        { upsert: true, new: true }
      );
      leadId = upserted._id;
      leadName = upserted.name ?? recipient.name;
      leadTags = upserted.tags ?? [];
      await CampaignRecipient.findByIdAndUpdate(recipientId, { $set: { leadId: upserted._id } });
    }

    const body = interpolate(campaign.messageBody, {
      name: leadName,
      phone: recipient.phone,
      tags: leadTags,
      customVars: recipient.customVars as Record<string, string> | undefined
    });

    const message = await Message.create({
      leadId,
      direction: "out",
      type: "text",
      content: body,
      status: "queued",
      timestamp: new Date()
    });

    await outboundQueue.add("campaign-outbound", { messageId: message._id.toString() });

    await CampaignRecipient.findByIdAndUpdate(recipientId, {
      $set: {
        status: "sent",
        messageId: message._id,
        processedAt: new Date()
      }
    });

    const updatedCampaign = await Campaign.findByIdAndUpdate(
      campaignId,
      { $inc: { "progress.sent": 1 } },
      { new: true }
    );

    if (updatedCampaign) {
      emitRealtime("campaign:progress", {
        campaignId,
        progress: updatedCampaign.progress
      });
      await checkFinalization(updatedCampaign);
    }

    await ProcessedEvent.updateOne({ key: idempotencyKey }, { $set: { status: "completed" } });
  } catch (error: any) {
    // Only mark as permanently "failed" (and count against progress) on the last BullMQ
    // attempt. On earlier attempts leave status as "pending" so the retry can process
    // normally — otherwise the retry's `recipient.status !== "pending"` guard returns
    // early and the contact never receives a message.
    const CAMPAIGN_MAX_ATTEMPTS = 3; // must match campaignQueue defaultJobOptions.attempts
    if (prevRetries + 1 >= CAMPAIGN_MAX_ATTEMPTS) {
      await CampaignRecipient.findByIdAndUpdate(recipientId, {
        $set: { status: "failed", error: error.message, processedAt: new Date() }
      });
      const updatedCampaign = await Campaign.findByIdAndUpdate(
        campaignId,
        { $inc: { "progress.failed": 1 } },
        { new: true }
      );
      if (updatedCampaign) await checkFinalization(updatedCampaign);
    }
    await ProcessedEvent.updateOne(
      { key: idempotencyKey },
      { $set: { status: "failed", lastError: error.message }, $inc: { retries: 1 } }
    );
    throw error;
  }
}

// ─── finalizeCampaign (internal) ──────────────────────────────────────────────

async function checkFinalization(campaign: HydratedDocument<CampaignDocument>): Promise<void> {
  const [total, pending] = await Promise.all([
    CampaignRecipient.countDocuments({ campaignId: campaign._id }),
    CampaignRecipient.countDocuments({ campaignId: campaign._id, status: "pending" })
  ]);
  if (total > 0 && pending === 0) {
    await finalizeCampaign(campaign._id.toString());
  }
}

async function finalizeCampaign(campaignId: string): Promise<void> {
  const campaign = await Campaign.findOneAndUpdate(
    { _id: campaignId, status: "running" },
    { $set: { status: "completed", completedAt: new Date() } },
    { new: true }
  );
  if (!campaign) return; // another worker already finalized
  emitRealtime("campaign:completed", serializeCampaign(campaign));
  await audit("system", "campaign.completed", "Campaign", campaignId, { status: "running" }, { status: "completed" });
}

// ─── pauseCampaign ────────────────────────────────────────────────────────────

export async function pauseCampaign(
  campaignId: string,
  actorId: string
): Promise<HydratedDocument<CampaignDocument>> {
  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);
  if (campaign.status !== "running") throw new Error(`Campaign is not running`);

  campaign.status = "paused";
  await campaign.save();

  await drainCampaignJobs(campaignId);

  emitRealtime("campaign:paused", serializeCampaign(campaign));
  await audit(actorId, "campaign.paused", "Campaign", campaignId, { status: "running" }, { status: "paused" });
  return campaign;
}

// ─── cancelCampaign ───────────────────────────────────────────────────────────

export async function cancelCampaign(
  campaignId: string,
  actorId: string
): Promise<HydratedDocument<CampaignDocument>> {
  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);
  if (["completed", "cancelled"].includes(campaign.status)) {
    throw new Error(`Campaign is already ${campaign.status}`);
  }

  campaign.status = "cancelled";
  await campaign.save();

  await drainCampaignJobs(campaignId);
  await CampaignRecipient.updateMany(
    { campaignId: campaign._id, status: "pending" },
    { $set: { status: "skipped" } }
  );

  emitRealtime("campaign:cancelled", serializeCampaign(campaign));
  await audit(actorId, "campaign.cancelled", "Campaign", campaignId, undefined, { status: "cancelled" });
  return campaign;
}

// ─── updateRecipientStatus ────────────────────────────────────────────────────

export async function updateRecipientStatus(
  leadId: string,
  newStatus: "replied"
): Promise<void> {
  try {
    const recipient = await CampaignRecipient.findOneAndUpdate(
      {
        leadId,
        status: { $in: ["pending", "sent", "delivered", "read"] }
      },
      { $set: { status: newStatus, processedAt: new Date() } },
      { new: true }
    );
    if (!recipient) return;

    const updatedCampaign = await Campaign.findByIdAndUpdate(
      recipient.campaignId,
      { $inc: { "progress.replied": 1 } },
      { new: true }
    );
    if (updatedCampaign) {
      emitRealtime("campaign:progress", {
        campaignId: recipient.campaignId.toString(),
        progress: updatedCampaign.progress
      });
    }
  } catch (err) {
    console.warn("[Campaign] updateRecipientStatus failed:", err);
  }
}

// ─── checkScheduledCampaigns ──────────────────────────────────────────────────

export async function checkScheduledCampaigns(): Promise<void> {
  const due = await Campaign.find({
    status: "scheduled",
    sendAt: { $lte: new Date() }
  });
  for (const campaign of due) {
    launchCampaign(campaign._id.toString(), "system").catch((err) =>
      console.error(`[Campaign] Failed to auto-launch campaign ${campaign._id}:`, err)
    );
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildLeadQuery(filters?: CampaignDocument["filters"]): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  if (!filters) return query;
  if (filters.stage) query.stage = filters.stage;
  if (filters.assignedTo) query.assignedTo = filters.assignedTo;
  if (filters.source) query.source = filters.source;
  if (filters.tags?.length) query.tags = { $in: filters.tags };
  return query;
}

async function dropLegacyCampaignLeadIndex(): Promise<void> {
  const legacyIndexName = "campaignId_1_leadId_1";
  const indexes = await CampaignRecipient.collection.indexes();
  const legacyIndex = indexes.find(
    (index) =>
      index.name === legacyIndexName &&
      index.unique === true &&
      index.key?.campaignId === 1 &&
      index.key?.leadId === 1
  );

  if (!legacyIndex) return;

  try {
    await CampaignRecipient.collection.dropIndex(legacyIndexName);
  } catch (err: any) {
    if (err?.codeName !== "IndexNotFound" && err?.code !== 27) throw err;
  }
}

async function drainCampaignJobs(campaignId: string): Promise<void> {
  try {
    const jobs = await campaignQueue.getJobs(["waiting", "delayed"]);
    const toRemove = jobs.filter((j) => j.data.campaignId === campaignId);
    await Promise.allSettled(toRemove.map((j) => j.remove()));
    console.log(`[Campaign] Drained ${toRemove.length} queued jobs for campaign ${campaignId}`);
  } catch (err) {
    console.warn(`[Campaign] drainCampaignJobs failed for ${campaignId}:`, err);
  }
}

// ─── getCampaignRecipients ────────────────────────────────────────────────────

export async function getCampaignRecipients(
  campaignId: string,
  status?: string,
  page = 1,
  limit = 50
): Promise<{ recipients: ReturnType<typeof serializeCampaignRecipient>[]; total: number }> {
  const query: Record<string, unknown> = { campaignId };
  if (status) query.status = status;
  const [recipients, total] = await Promise.all([
    CampaignRecipient.find(query)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    CampaignRecipient.countDocuments(query)
  ]);
  return {
    recipients: recipients.map((r) => serializeCampaignRecipient(r as any)),
    total
  };
}
