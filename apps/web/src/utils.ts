import type { AgentDTO, LeadDTO, LeadStatus, MessageDTO } from "@crm/shared";

export const stages: LeadStatus[] = ["new", "contacted", "interested", "followup", "won", "lost"];

export const stageLabels: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  interested: "Interested",
  followup: "Follow-up",
  won: "Won",
  lost: "Lost"
};

export function initials(value: string) {
  return value.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}

export function agentName(agents: AgentDTO[], id?: string) {
  return agents.find((a) => a.id === id)?.name ?? "Unassigned";
}

export function leadName(leads: LeadDTO[], id: string) {
  const lead = leads.find((l) => l.id === id);
  return lead?.name || formatPhone(lead?.phone) || "Lead";
}

export function formatPhone(phone?: string) {
  if (!phone) return "";
  const cleaned = phone.replace(/[^\d+]/g, "");
  if (!cleaned.startsWith("+")) return cleaned;
  if (cleaned.startsWith("+1")) return `+1 ${cleaned.slice(2)}`;
  if (cleaned.startsWith("+91")) return `+91 ${cleaned.slice(3)}`;
  if (cleaned.startsWith("+44")) return `+44 ${cleaned.slice(3)}`;
  if (cleaned.startsWith("+62")) return `+62 ${cleaned.slice(3)}`;
  return `${cleaned.slice(0, 4)} ${cleaned.slice(4)}`;
}

export function percent(value: number, total: number) {
  return Math.round((value / total) * 100);
}

export function windowText(lead: LeadDTO) {
  if (!lead.windowExpiresAt) return "No active 24h window";
  const expires = new Date(lead.windowExpiresAt);
  return expires > new Date()
    ? `Reply window open until ${expires.toLocaleTimeString()}`
    : "Window closed - use template";
}

export function messageIdentity(message: MessageDTO) {
  return message.id || message.waMessageId || [
    message.leadId,
    message.direction,
    message.timestamp,
    message.text ?? message.type
  ].join(":");
}

export function messageRenderKey(message: MessageDTO, index: number) {
  return `${messageIdentity(message)}:${index}`;
}

/**
 * Merge messages without duplicating optimistic/API/socket copies.
 * Later arrays win so status updates replace queued placeholders.
 */
export function mergeUniqueMessages(existing: MessageDTO[], incoming: MessageDTO[]): MessageDTO[] {
  const map = new Map<string, MessageDTO>();
  const add = (msg: MessageDTO, source: "existing" | "incoming") => {
    const key = messageIdentity(msg);
    if (!key) {
      console.warn("[Messages] Dropping message without stable identity", { source, msg });
      return;
    }
    map.set(key, msg);
  };

  existing.forEach((msg) => add(msg, "existing"));
  incoming.forEach((msg) => add(msg, "incoming"));

  return Array.from(map.values()).sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}

export function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of items) map.set(item.id, item);
  return Array.from(map.values());
}
