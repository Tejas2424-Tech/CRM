
import type { AgentDTO, AuthUser, CampaignDTO, LeadDTO, MessageDTO, NoteDTO, TaskDTO, TemplateDTO } from "@crm/shared";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const AUTH_REQUEST_TIMEOUT_MS = 10_000;

export interface Session {
  token: string;
  user: AuthUser;
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public details?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

type RequestOptions = {
  timeoutMs?: number;
};

async function requestJson<T>(path: string, token?: string, init?: RequestInit, options: RequestOptions = {}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const url = `${API_URL}${path}`;
  const startedAt = Date.now();
  const controller = new AbortController();
  let timedOut = false;
  const callerSignal = init?.signal;
  const abortFromCaller = () => controller.abort();
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort();
    } else {
      callerSignal.addEventListener("abort", abortFromCaller, { once: true });
    }
  }

  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init?.body ? { "Content-Type": "application/json" } : {}),
    ...(init?.headers as Record<string, string> | undefined)
  };

  try {
    const res = await fetch(url, {
      ...init,
      headers,
      signal: controller.signal
    });
    const elapsedMs = Date.now() - startedAt;
    if (import.meta.env.DEV) {
      console.debug(`[API] ${init?.method ?? "GET"} ${path} -> ${res.status} in ${elapsedMs}ms`);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => undefined) as { error?: string; details?: Array<{ message?: string; path?: Array<string | number> }> } | undefined;
      const firstDetail = Array.isArray(body?.details) ? body.details[0] : undefined;
      const detailMessage = firstDetail?.message;
      const message = body?.error
        ? detailMessage
          ? `${body.error}: ${detailMessage}`
          : body.error
        : res.statusText;
      throw new ApiError(message, res.status, body?.details);
    }
    return res.json() as Promise<T>;
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    if (timedOut || (err instanceof DOMException && err.name === "AbortError")) {
      console.warn(`[API] ${init?.method ?? "GET"} ${path} timed out after ${elapsedMs}ms`);
      throw new ApiError(`Request timed out after ${Math.round(timeoutMs / 1000)}s`, 408);
    }
    console.warn(`[API] ${init?.method ?? "GET"} ${path} failed after ${elapsedMs}ms`, err);
    throw err;
  } finally {
    clearTimeout(timeoutId);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}

export const api = {
  apiUrl: API_URL,
  devUsers: () => requestJson<AgentDTO[]>("/auth/dev-users", undefined, undefined, { timeoutMs: AUTH_REQUEST_TIMEOUT_MS }),
  login: (email: string) =>
    requestJson<Session>("/auth/dev-login", undefined, { method: "POST", body: JSON.stringify({ email }) }, { timeoutMs: AUTH_REQUEST_TIMEOUT_MS }),
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
  updateUser: (token: string, id: string, body: { name?: string; role?: AgentDTO["role"]; active?: boolean; capacity?: number }) =>
    requestJson<AgentDTO>(`/api/users/${id}`, token, { method: "PATCH", body: JSON.stringify(body) }),
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
