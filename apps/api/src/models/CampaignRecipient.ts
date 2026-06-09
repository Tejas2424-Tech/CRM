import type { RecipientStatus } from "@crm/shared";
import { Schema, model, Types } from "mongoose";

export interface CampaignRecipientDocument {
  campaignId: Types.ObjectId;
  leadId?: Types.ObjectId;
  phone: string;
  name?: string;
  customVars?: Record<string, string>;
  messageId?: Types.ObjectId;
  status: RecipientStatus;
  error?: string;
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const campaignRecipientSchema = new Schema<CampaignRecipientDocument>(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: "Campaign", required: true, index: true },
    leadId:     { type: Schema.Types.ObjectId, ref: "Lead", sparse: true, index: true },
    phone:      { type: String, required: true },
    name:       { type: String },
    customVars: { type: Schema.Types.Mixed },
    messageId:  { type: Schema.Types.ObjectId, ref: "Message" },
    status: {
      type: String,
      enum: ["pending", "sent", "delivered", "read", "replied", "failed", "skipped", "opted_out"],
      default: "pending",
      index: true
    },
    error:       { type: String },
    processedAt: { type: Date }
  },
  { timestamps: true }
);

campaignRecipientSchema.index({ campaignId: 1, status: 1 });
campaignRecipientSchema.index(
  { campaignId: 1, phone: 1 },
  { unique: true, name: "unique_recipient_per_campaign" }
);
campaignRecipientSchema.index({ leadId: 1, status: 1 }, { sparse: true });

export const CampaignRecipient = model<CampaignRecipientDocument>(
  "CampaignRecipient",
  campaignRecipientSchema
);
