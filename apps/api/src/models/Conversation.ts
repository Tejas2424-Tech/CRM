import { Schema, model, Types } from "mongoose";

export interface ConversationDocument {
  leadId: Types.ObjectId;
  lastMessage: string;
  updatedAt: Date;
}

const conversationSchema = new Schema<ConversationDocument>(
  {
    leadId: { type: Schema.Types.ObjectId, ref: "Lead", required: true, unique: true, index: true },
    lastMessage: { type: String, required: true }
  },
  { timestamps: true }
);

export const Conversation = model<ConversationDocument>("Conversation", conversationSchema);
