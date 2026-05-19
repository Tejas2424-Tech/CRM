import { AuditLog } from "../models/AuditLog.js";

/**
 * Write an immutable audit record to MongoDB and emit a structured log line.
 * The log line lets ops teams grep the process stdout for security events
 * without needing DB access.
 *
 * Security events use a dedicated "security.*" action prefix so they can be
 * filtered separately from general CRM activity:
 *   auth.login.success | auth.login.failed
 *   user.role_change   | user.deactivate
 *   lead.delete        | campaign.launch
 *   whatsapp.disconnect
 */
export async function audit(
  actorId: string,
  action: string,
  entity: string,
  entityId: string,
  before?: unknown,
  after?: unknown
): Promise<void> {
  const at = new Date().toISOString();

  // Structured console log — survives even if MongoDB write fails.
  console.log(JSON.stringify({ t: at, level: "audit", actor: actorId, action, entity, entityId }));

  // Best-effort DB write — never throw from audit; it must not block the
  // calling request or mask the original error.
  AuditLog.create({ actorId, action, entity, entityId, before, after }).catch((err) => {
    console.error(JSON.stringify({ t: at, level: "error", msg: "audit write failed", action, err: String(err) }));
  });
}
