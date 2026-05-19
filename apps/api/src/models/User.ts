import type { AgentRole } from "@crm/shared";
import { Schema, model } from "mongoose";

export interface UserDocument {
  name: string;
  email: string;
  password?: string;
  role: AgentRole;
  active: boolean;
  capacity: number;
}

const userSchema = new Schema<UserDocument>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, index: true },
    password: { type: String, select: false },
    role: { type: String, enum: ["admin", "manager", "agent"], required: true },
    active: { type: Boolean, default: true },
    capacity: { type: Number, default: 25 }
  },
  { timestamps: true }
);

export const User = model<UserDocument>("User", userSchema);
