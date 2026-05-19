import type { FilterQuery } from "mongoose";
import { Campaign, CampaignRecipient } from "../models/Campaign.js";
import { Lead, type LeadDocument } from "../models/Lead.js";
import { campaignQueue } from "../queues/jobs.js";

export function buildAudienceFilter(audienceQuery: Record<string, unknown>): FilterQuery<LeadDocument> {
  const filter: FilterQuery<LeadDocument> = { "consent.optedIn": true };
  if (typeof audienceQuery.status === "string" && audienceQuery.status) filter.status = audienceQuery.status;
  if (typeof audienceQuery.tag === "string" && audienceQuery.tag) filter.tags = audienceQuery.tag;
  if (typeof audienceQuery.source === "string" && audienceQuery.source) filter.source = audienceQuery.source;
  if (typeof audienceQuery.assignedTo === "string" && audienceQuery.assignedTo) filter.assignedTo = audienceQuery.assignedTo;
  return filter;
}

export async function enqueueCampaign(campaignId: string, delay = 0) {
  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw new Error("Campaign not found");

  const leads = await Lead.find(buildAudienceFilter(campaign.audienceQuery)).limit(5000);
  await Campaign.updateOne({ _id: campaignId }, { status: delay > 0 ? "scheduled" : "running" });

  for (const lead of leads) {
    const recipient = await CampaignRecipient.findOneAndUpdate(
      { campaignId: campaign._id, leadId: lead._id },
      { $setOnInsert: { campaignId: campaign._id, leadId: lead._id, status: "queued" } },
      { new: true, upsert: true }
    );
    await campaignQueue.add("campaign-recipient", { campaignId, recipientId: recipient._id.toString() }, { delay });
  }
}
