import { Schema, model } from "mongoose";

export interface ProcessedEventDocument {
  key: string;
  type: string;
  status: "processing" | "completed" | "failed";
  retries: number;
  lastError?: string;
  processedAt: Date;
}

const processedEventSchema = new Schema<ProcessedEventDocument>({
  key: { type: String, required: true, unique: true },
  type: { type: String, required: true },
  status: { type: String, enum: ["processing", "completed", "failed"], default: "processing" },
  retries: { type: Number, default: 0 },
  lastError: { type: String },
  processedAt: { type: Date, default: Date.now }
});

export const ProcessedEvent = model<ProcessedEventDocument>("ProcessedEvent", processedEventSchema);
