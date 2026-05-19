import { Schema, model } from "mongoose";

export interface TemplateDocument {
  name: string;
  category: string;
  language: string;
  body: string;
  variables: string[];
  approved: boolean;
}

const templateSchema = new Schema<TemplateDocument>(
  {
    name: { type: String, required: true, unique: true },
    category: { type: String, default: "marketing" },
    language: { type: String, default: "en_US" },
    body: { type: String, required: true },
    variables: { type: [String], default: [] },
    approved: { type: Boolean, default: true }
  },
  { timestamps: true }
);

export const Template = model<TemplateDocument>("Template", templateSchema);
