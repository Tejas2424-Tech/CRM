import type { MessageDirection, MessageStatus, MessageType } from "@crm/shared";
import { Schema, model, Types } from "mongoose";

export interface MessageDocument {
  leadId: Types.ObjectId;
  direction: MessageDirection;
  type: MessageType;
  content?: string;
  templateId?: Types.ObjectId;
  status: MessageStatus;
  waMessageId?: string;
  /** WhatsApp chat ID, e.g. 919876543210@c.us — useful for multi-session later */
  chatId?: string;
  /** True if the message was sent by us (outbound via WhatsApp Web) */
  fromMe: boolean;
  timestamp: Date;
}

const messageSchema = new Schema<MessageDocument>(
  {
    leadId: { type: Schema.Types.ObjectId, ref: "Lead", required: true, index: true },
    direction: { type: String, enum: ["in", "out"], required: true },
    type: { type: String, enum: ["text", "image", "video", "document", "audio", "template", "media"], required: true },
    content: String,
    templateId: { type: Schema.Types.ObjectId, ref: "Template" },
    status: { type: String, enum: ["queued", "retrying", "sent", "delivered", "read", "failed", "waiting_connection"], default: "queued" },
    // Unique sparse index — primary dedup key for old chat import
    waMessageId: { type: String, unique: true, sparse: true },
    chatId: { type: String, index: true },
    fromMe: { type: Boolean, default: false },
    timestamp: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

messageSchema.index({ leadId: 1, timestamp: -1 });
messageSchema.index({ chatId: 1, timestamp: -1 });
messageSchema.index({ content: "text" });

export const Message = model<MessageDocument>("Message", messageSchema);
