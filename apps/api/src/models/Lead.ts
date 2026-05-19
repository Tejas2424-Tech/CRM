import type { LeadStatus } from "@crm/shared";
import { Schema, model } from "mongoose";

export interface LeadDocument {
  phone: string;
  name?: string;
  email?: string;
  /** WhatsApp chat ID, e.g. 919876543210@c.us */
  chatId?: string;
  /** WhatsApp pushname (display name set on their phone) */
  pushName?: string;
  /** Profile picture URL from WhatsApp */
  profilePic?: string;
  stage: LeadStatus;
  tags: string[];
  assignedTo?: string;
  source: string;
  consent: {
    optedIn: boolean;
    optedOutAt?: Date;
    source?: string;
  };
  unreadCount: number;
  lastInboundAt?: Date;
  windowExpiresAt?: Date;
  lastActivity: Date;
  createdAt: Date;
  updatedAt: Date;
}

const leadSchema = new Schema<LeadDocument>(
  {
    phone: { type: String, required: true, unique: true, index: true },
    name: String,
    email: String,
    chatId: { type: String, sparse: true, index: true },
    pushName: String,
    profilePic: String,
    stage: {
      type: String,
      enum: ["new", "contacted", "interested", "followup", "won", "lost"],
      default: "new"
    },
    tags: { type: [String], default: [] },
    assignedTo: String,
    source: { type: String, default: "whatsapp" },
    consent: {
      optedIn: { type: Boolean, default: true },
      optedOutAt: Date,
      source: { type: String, default: "inbound" }
    },
    unreadCount: { type: Number, default: 0 },
    lastInboundAt: Date,
    windowExpiresAt: Date,
    lastActivity: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

leadSchema.index({ assignedTo: 1, stage: 1 });
leadSchema.index({ lastActivity: -1 });
leadSchema.index({ name: "text", phone: "text", email: "text" });

export const Lead = model<LeadDocument>("Lead", leadSchema);
