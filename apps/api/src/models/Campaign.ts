import type { CampaignAudienceSource, CampaignStatus, CampaignType } from "@crm/shared";
import { Schema, model } from "mongoose";

export interface CampaignDocument {
  name: string;
  description?: string;
  type: CampaignType;
  status: CampaignStatus;
  audienceSource: CampaignAudienceSource;
  filters?: {
    stage?: string;
    tags?: string[];
    assignedTo?: string;
    source?: string;
  };
  recipientCount: number;
  messageBody: string;
  sendAt?: Date;
  timezone: string;
  messagesPerMinute: number;
  progress: {
    total: number;
    sent: number;
    delivered: number;
    read: number;
    replied: number;
    failed: number;
    skipped: number;
  };
  createdBy: string;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const campaignSchema = new Schema<CampaignDocument>(
  {
    name: { type: String, required: true, maxlength: 150 },
    description: { type: String },
    type: {
      type: String,
      enum: ["promotional", "marketing", "follow-up", "announcement", "custom"],
      required: true
    },
    status: {
      type: String,
      enum: ["draft", "scheduled", "running", "paused", "completed", "failed", "cancelled"],
      default: "draft",
      index: true
    },
    audienceSource: {
      type: String,
      enum: ["crm_filters", "csv"],
      required: true
    },
    filters: {
      stage: { type: String },
      tags: { type: [String] },
      assignedTo: { type: String },
      source: { type: String }
    },
    recipientCount: { type: Number, default: 0 },
    messageBody: { type: String, required: true },
    sendAt: { type: Date },
    timezone: { type: String, default: "UTC" },
    messagesPerMinute: { type: Number, default: 10, min: 1, max: 60 },
    progress: {
      total:     { type: Number, default: 0 },
      sent:      { type: Number, default: 0 },
      delivered: { type: Number, default: 0 },
      read:      { type: Number, default: 0 },
      replied:   { type: Number, default: 0 },
      failed:    { type: Number, default: 0 },
      skipped:   { type: Number, default: 0 }
    },
    createdBy:   { type: String, required: true, index: true },
    startedAt:   { type: Date },
    completedAt: { type: Date }
  },
  { timestamps: true }
);

campaignSchema.index({ status: 1, createdAt: -1 });
campaignSchema.index({ createdBy: 1, status: 1 });

export const Campaign = model<CampaignDocument>("Campaign", campaignSchema);
