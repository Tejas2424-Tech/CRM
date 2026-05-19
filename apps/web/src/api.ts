
import type { AgentDTO, AuthUser, CampaignDTO, LeadDTO, MessageDTO, NoteDTO, TaskDTO, TemplateDTO } from "@crm/shared";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export interface Session {
  token: string;
  user: AuthUser;
}

async function requestJson<T>(path: string, token?: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers
    }
  });
  if (!res.ok) throw new Error((await res.json().catch(() => undefined))?.error ?? res.statusText);
  return res.json() as Promise<T>;
}

export const api = {
  apiUrl: API_URL,
  devUsers: () => requestJson<AgentDTO[]>("/auth/dev-users"),
  login: (email: string) => requestJson<Session>("/auth/dev-login", undefined, { method: "POST", body: JSON.stringify({ email }) }),
  leads: (token: string, filters: Record<string, string>) => {
    const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
    return requestJson<LeadDTO[]>(`/api/leads?${params}`, token);
  },
  createLead: (token: string, body: Pick<LeadDTO, "phone"> & Partial<LeadDTO>) =>
    requestJson<LeadDTO>("/api/leads", token, { method: "POST", body: JSON.stringify(body) }),
  updateLead: (token: string, id: string, body: Partial<LeadDTO>) =>
    requestJson<LeadDTO>(`/api/leads/${id}`, token, { method: "PATCH", body: JSON.stringify(body) }),
  messages: (token: string, leadId: string) => requestJson<MessageDTO[]>(`/api/messages/${leadId}`, token),
  sendMessage: (token: string, leadId: string, text: string) =>
    requestJson<{ success: boolean; message: MessageDTO }>("/api/messages/send", token, { method: "POST", body: JSON.stringify({ leadId, text }) }),
  notes: (token: string, leadId: string) => requestJson<NoteDTO[]>(`/api/leads/${leadId}/notes`, token),
  createNote: (token: string, leadId: string, body: string) =>
    requestJson<NoteDTO>(`/api/leads/${leadId}/notes`, token, { method: "POST", body: JSON.stringify({ body }) }),
  tasks: (token: string, status = "") => requestJson<TaskDTO[]>(`/api/tasks${status ? `?status=${status}` : ""}`, token),
  leadTasks: (token: string, leadId: string) => requestJson<TaskDTO[]>(`/api/leads/${leadId}/tasks`, token),
  createTask: (token: string, leadId: string, body: { title: string; description?: string; dueAt: string; assignedTo?: string }) =>
    requestJson<TaskDTO>(`/api/leads/${leadId}/tasks`, token, { method: "POST", body: JSON.stringify(body) }),
  updateTask: (token: string, id: string, body: Partial<TaskDTO>) =>
    requestJson<TaskDTO>(`/api/tasks/${id}`, token, { method: "PATCH", body: JSON.stringify(body) }),
  templates: (token: string) => requestJson<TemplateDTO[]>("/api/templates", token),
  users: (token: string) => requestJson<AgentDTO[]>("/api/users", token),
  createUser: (token: string, body: { name: string; email: string; role: AgentDTO["role"]; capacity: number }) =>
    requestJson<AgentDTO>("/api/users", token, { method: "POST", body: JSON.stringify(body) }),
  campaigns: (token: string) => requestJson<CampaignDTO[]>("/api/campaigns", token),
  createCampaign: (token: string, body: { name: string; templateId: string; audienceQuery: Record<string, string>; scheduledAt?: string }) =>
    requestJson<CampaignDTO>("/api/campaigns", token, { method: "POST", body: JSON.stringify(body) }),
  campaignStats: (token: string, id: string) => requestJson<Record<string, number>>(`/api/campaigns/${id}/stats`, token),
  analytics: (token: string) => requestJson<{
    leadCount: number;
    optedInLeads: number;
    inboundMessages: number;
    outboundMessages: number;
    delivery: Record<string, number>;
  }>("/api/analytics/summary", token),
  /** Phase 1: Trigger a full WhatsApp contact + chat sync (202 fire-and-forget) */
  triggerSync: (token: string) =>
    requestJson<{ message: string }>("/api/whatsapp/sync", token, { method: "POST" }),
  /** Poll current WhatsApp connection status */
  whatsappStatus: (token: string) =>
    requestJson<{ 
      mode: string; 
      status: string;
      connectedAt?: string;
      lastDisconnectReason?: string;
      syncProgress?: { total: number; done: number };
    }>("/api/whatsapp/status", token),
  /** Fetch current QR data (if client is in QR_REQUIRED state) */
  whatsappQr: (token: string) =>
    requestJson<{ qr: string }>("/api/whatsapp/qr", token),
  /** Logout the currently connected WhatsApp account (202 fire-and-forget).
   *  State transitions arrive via Socket.IO: wajs:logout → wajs:status → wajs:qr */
  logoutWhatsApp: (token: string) =>
    requestJson<{ message: string }>("/api/whatsapp/logout", token, { method: "POST" }),
  /**
   * DANGER: Full CRM reset — deletes all leads, messages, sessions, queues.
   * Admin only. Returns 202; progress arrives via Socket.IO crm:reset events.
   */
  resetCrm: (token: string) =>
    requestJson<{ message: string }>("/api/admin/reset-crm", token, { method: "POST" })
};
