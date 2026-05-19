import type { TaskStatus } from "@crm/shared";
import { Schema, model, Types } from "mongoose";

export interface TaskDocument {
  leadId: Types.ObjectId;
  title: string;
  description?: string;
  assignedTo?: string;
  dueAt: Date;
  status: TaskStatus;
  reminderSent: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const taskSchema = new Schema<TaskDocument>(
  {
    leadId: { type: Schema.Types.ObjectId, ref: "Lead", required: true, index: true },
    title: { type: String, required: true },
    description: String,
    assignedTo: { type: String, index: true },
    dueAt: { type: Date, required: true, index: true },
    status: { type: String, enum: ["pending", "done", "missed"], default: "pending", index: true },
    reminderSent: { type: Boolean, default: false }
  },
  { timestamps: true }
);

taskSchema.index({ assignedTo: 1, dueAt: 1 });

export const Task = model<TaskDocument>("Task", taskSchema);
