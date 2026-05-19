import type { CampaignStatus, MessageStatus } from "@crm/shared";
import { Schema, model, Types } from "mongoose";

export interface CampaignDocument {
  name: string;
  templateId: Types.ObjectId;
  audienceQuery: Record<string, unknown>;
  scheduledAt?: Date;
  status: CampaignStatus;
  createdBy: string;
}

export interface CampaignRecipientDocument {
  campaignId: Types.ObjectId;
  leadId: Types.ObjectId;
  status: MessageStatus;
  waMessageId?: string;
  error?: string;
}

const campaignSchema = new Schema<CampaignDocument>(
  {
    name: { type: String, required: true },
    templateId: { type: Schema.Types.ObjectId, ref: "Template", required: true },
    audienceQuery: { type: Schema.Types.Mixed, default: {} },
    scheduledAt: Date,
    status: { type: String, enum: ["draft", "scheduled", "running", "completed", "failed"], default: "draft" },
    createdBy: { type: String, required: true }
  },
  { timestamps: true }
);

const campaignRecipientSchema = new Schema<CampaignRecipientDocument>(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: "Campaign", required: true, index: true },
    leadId: { type: Schema.Types.ObjectId, ref: "Lead", required: true, index: true },
    status: { type: String, enum: ["queued", "sent", "delivered", "read", "failed"], default: "queued" },
    waMessageId: String,
    error: String
  },
  { timestamps: true }
);

campaignRecipientSchema.index({ campaignId: 1, leadId: 1 }, { unique: true });

export const Campaign = model<CampaignDocument>("Campaign", campaignSchema);
export const CampaignRecipient = model<CampaignRecipientDocument>("CampaignRecipient", campaignRecipientSchema);
