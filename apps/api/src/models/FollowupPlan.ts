import { Schema, model } from "mongoose";

export interface FollowupStep {
  label: string;
  enabled: boolean;
  messageBody: string;
  delayHours: number;
}

export interface FollowupPlanDocument {
  name: string;
  welcomeMessage: string;
  steps: FollowupStep[];
  isDefault: boolean;
  assignTo?: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const stepSchema = new Schema<FollowupStep>(
  {
    label: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    messageBody: { type: String, required: true },
    delayHours: { type: Number, required: true, min: 1 }
  },
  { _id: false }
);

const followupPlanSchema = new Schema<FollowupPlanDocument>(
  {
    name: { type: String, required: true, unique: true, trim: true },
    welcomeMessage: { type: String, required: true },
    steps: { type: [stepSchema], default: [] },
    isDefault: { type: Boolean, default: false, index: true },
    assignTo: { type: String },
    createdBy: { type: String, required: true }
  },
  { timestamps: true }
);

export const FollowupPlan = model<FollowupPlanDocument>("FollowupPlan", followupPlanSchema);
