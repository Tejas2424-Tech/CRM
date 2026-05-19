import { Schema, model } from "mongoose";

export interface ProcessedEventDocument {
  key: string;
  type: string;
  processedAt: Date;
}

const processedEventSchema = new Schema<ProcessedEventDocument>({
  key: { type: String, required: true, unique: true },
  type: { type: String, required: true },
  processedAt: { type: Date, default: Date.now }
});

export const ProcessedEvent = model<ProcessedEventDocument>("ProcessedEvent", processedEventSchema);
