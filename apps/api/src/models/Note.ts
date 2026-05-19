import { Schema, model, Types } from "mongoose";

export interface NoteDocument {
  leadId: Types.ObjectId;
  userId: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}

const noteSchema = new Schema<NoteDocument>(
  {
    leadId: { type: Schema.Types.ObjectId, ref: "Lead", required: true, index: true },
    userId: { type: String, required: true, index: true },
    body: { type: String, required: true }
  },
  { timestamps: true }
);

export const Note = model<NoteDocument>("Note", noteSchema);
