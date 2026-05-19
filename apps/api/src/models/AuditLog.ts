import { Schema, model } from "mongoose";

export interface AuditLogDocument {
  actorId: string;
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ts: Date;
}

const auditLogSchema = new Schema<AuditLogDocument>({
  actorId: { type: String, required: true },
  action: { type: String, required: true },
  entity: { type: String, required: true },
  entityId: { type: String, required: true },
  before: Schema.Types.Mixed,
  after: Schema.Types.Mixed,
  ts: { type: Date, default: Date.now, immutable: true }
});

export const AuditLog = model<AuditLogDocument>("AuditLog", auditLogSchema);
