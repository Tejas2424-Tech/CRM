import { Schema, model, Types } from "mongoose";

export type EnrollmentStatus = "active" | "stopped" | "completed";
export type StepStatus = "pending" | "sent" | "skipped";

export interface EnrollmentStep {
  stepIndex: number;
  label: string;
  scheduledAt: Date;
  sentAt?: Date;
  status: StepStatus;
  messageId?: string;
}

export interface FollowupEnrollmentDocument {
  leadId: Types.ObjectId;
  planId: Types.ObjectId;
  status: EnrollmentStatus;
  enrolledAt: Date;
  stoppedAt?: Date;
  completedAt?: Date;
  scheduledJobIds: string[];
  steps: EnrollmentStep[];
  createdAt: Date;
  updatedAt: Date;
}

const enrollmentStepSchema = new Schema<EnrollmentStep>(
  {
    stepIndex: { type: Number, required: true },
    label: { type: String, required: true },
    scheduledAt: { type: Date, required: true },
    sentAt: { type: Date },
    status: {
      type: String,
      enum: ["pending", "sent", "skipped"],
      default: "pending"
    },
    messageId: { type: String }
  },
  { _id: false }
);

const followupEnrollmentSchema = new Schema<FollowupEnrollmentDocument>(
  {
    leadId: { type: Schema.Types.ObjectId, ref: "Lead", required: true, index: true },
    planId: { type: Schema.Types.ObjectId, ref: "FollowupPlan", required: true },
    status: {
      type: String,
      enum: ["active", "stopped", "completed"],
      default: "active",
      index: true
    },
    enrolledAt: { type: Date, default: Date.now },
    stoppedAt: { type: Date },
    completedAt: { type: Date },
    scheduledJobIds: { type: [String], default: [] },
    steps: { type: [enrollmentStepSchema], default: [] }
  },
  { timestamps: true }
);

followupEnrollmentSchema.index({ leadId: 1, status: 1, enrolledAt: -1 });
followupEnrollmentSchema.index(
  { leadId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "active" },
    name: "unique_active_enrollment_per_lead"
  }
);

export const FollowupEnrollment = model<FollowupEnrollmentDocument>(
  "FollowupEnrollment",
  followupEnrollmentSchema
);
