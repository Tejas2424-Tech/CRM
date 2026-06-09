
import type { AgentDTO, AuthUser, CampaignDTO, CampaignRecipientDTO, CsvPreviewResponse, FollowupEnrollmentDTO, FollowupPlanDTO, LeadDTO, MessageDTO, NoteDTO, TaskDTO } from "@crm/shared";

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
    // Only set JSON content-type for non-FormData bodies (FormData sets its own boundary header)
    ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
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
    const translated: Record<string, string> = { ...filters };
    if (translated.status) { translated.stage = translated.status; delete translated.status; }
    const params = new URLSearchParams(Object.entries(translated).filter(([, value]) => value));
    return requestJson<LeadDTO[]>(`/api/leads?${params}`, token);
  },
  createLead: (token: string, body: Pick<LeadDTO, "phone"> & Partial<LeadDTO>) =>
    requestJson<LeadDTO>("/api/leads", token, { method: "POST", body: JSON.stringify(body) }),
  updateLead: (token: string, id: string, body: Partial<LeadDTO>) =>
    requestJson<LeadDTO>(`/api/leads/${id}`, token, { method: "PATCH", body: JSON.stringify(body) }),
  messages: (token: string, leadId: string) => requestJson<MessageDTO[]>(`/api/messages/${leadId}`, token),
  sendMessage: (token: string, leadId: string, text: string) =>
    requestJson<{ success: boolean; message: MessageDTO }>("/api/messages/send", token, { method: "POST", body: JSON.stringify({ leadId, text }) }),
  retryMessage: (token: string, messageId: string) =>
    requestJson<{ success: boolean; message: MessageDTO }>(`/api/messages/${messageId}/retry`, token, { method: "POST" }),
  notes: (token: string, leadId: string) => requestJson<NoteDTO[]>(`/api/leads/${leadId}/notes`, token),
  createNote: (token: string, leadId: string, body: string) =>
    requestJson<NoteDTO>(`/api/leads/${leadId}/notes`, token, { method: "POST", body: JSON.stringify({ body }) }),
  tasks: (token: string, status = "") => requestJson<TaskDTO[]>(`/api/tasks${status ? `?status=${status}` : ""}`, token),
  leadTasks: (token: string, leadId: string) => requestJson<TaskDTO[]>(`/api/leads/${leadId}/tasks`, token),
  createTask: (token: string, leadId: string, body: { title: string; description?: string; dueAt: string; assignedTo?: string }) =>
    requestJson<TaskDTO>(`/api/leads/${leadId}/tasks`, token, { method: "POST", body: JSON.stringify(body) }),
  updateTask: (token: string, id: string, body: Partial<TaskDTO>) =>
    requestJson<TaskDTO>(`/api/tasks/${id}`, token, { method: "PATCH", body: JSON.stringify(body) }),
  users: (token: string) => requestJson<AgentDTO[]>("/api/users", token),
  createUser: (token: string, body: { name: string; email: string; role: AgentDTO["role"]; capacity: number }) =>
    requestJson<AgentDTO>("/api/users", token, { method: "POST", body: JSON.stringify(body) }),
  updateUser: (token: string, id: string, body: { name?: string; role?: AgentDTO["role"]; active?: boolean; capacity?: number }) =>
    requestJson<AgentDTO>(`/api/users/${id}`, token, { method: "PATCH", body: JSON.stringify(body) }),
  deleteUser: (token: string, id: string) =>
    requestJson<{ success: boolean }>(`/api/users/${id}`, token, { method: "DELETE" }),
  analytics: (token: string) => requestJson<{
    leadCount: number;
    optedInLeads: number;
    inboundMessages: number;
    outboundMessages: number;
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
    requestJson<{ message: string }>("/api/admin/reset-crm", token, { method: "POST" }),

  // ─── Follow-up Plans ────────────────────────────────────────────────────────
  followupPlans: (token: string) =>
    requestJson<FollowupPlanDTO[]>("/api/followup-plans", token),

  createFollowupPlan: (
    token: string,
    body: Omit<FollowupPlanDTO, "id" | "createdBy" | "createdAt" | "updatedAt">
  ) =>
    requestJson<FollowupPlanDTO>("/api/followup-plans", token, {
      method: "POST",
      body: JSON.stringify(body)
    }),

  updateFollowupPlan: (token: string, id: string, body: Partial<FollowupPlanDTO>) =>
    requestJson<FollowupPlanDTO>(`/api/followup-plans/${id}`, token, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),

  deleteFollowupPlan: (token: string, id: string) =>
    requestJson<{ success: boolean }>(`/api/followup-plans/${id}`, token, { method: "DELETE" }),

  // ─── Enrollments ────────────────────────────────────────────────────────────
  getEnrollmentForLead: (token: string, leadId: string) =>
    requestJson<FollowupEnrollmentDTO | null>(
      `/api/followup-plans/enrollments/lead/${leadId}`,
      token
    ),

  enrollLead: (token: string, leadId: string, planId: string) =>
    requestJson<FollowupEnrollmentDTO>("/api/followup-plans/enrollments", token, {
      method: "POST",
      body: JSON.stringify({ leadId, planId })
    }),

  stopLeadEnrollment: (token: string, leadId: string) =>
    requestJson<{ success: boolean }>(
      `/api/followup-plans/enrollments/lead/${leadId}/stop`,
      token,
      { method: "POST" }
    ),

  // ─── Campaigns ──────────────────────────────────────────────────────────────
  campaigns: (token: string, params?: Record<string, string>) => {
    const qs = params ? `?${new URLSearchParams(Object.entries(params).filter(([, v]) => !!v))}` : "";
    return requestJson<CampaignDTO[]>(`/api/campaigns${qs}`, token);
  },
  getCampaign: (token: string, id: string) =>
    requestJson<CampaignDTO>(`/api/campaigns/${id}`, token),
  createCampaign: (token: string, body: object) =>
    requestJson<CampaignDTO>("/api/campaigns", token, { method: "POST", body: JSON.stringify(body) }),
  updateCampaign: (token: string, id: string, body: Partial<CampaignDTO>) =>
    requestJson<CampaignDTO>(`/api/campaigns/${id}`, token, { method: "PATCH", body: JSON.stringify(body) }),
  deleteCampaign: (token: string, id: string) =>
    requestJson<{ success: boolean }>(`/api/campaigns/${id}`, token, { method: "DELETE" }),
  launchCampaign: (token: string, id: string) =>
    requestJson<CampaignDTO>(`/api/campaigns/${id}/launch`, token, { method: "POST" }),
  pauseCampaign: (token: string, id: string) =>
    requestJson<CampaignDTO>(`/api/campaigns/${id}/pause`, token, { method: "POST" }),
  cancelCampaign: (token: string, id: string) =>
    requestJson<CampaignDTO>(`/api/campaigns/${id}/cancel`, token, { method: "POST" }),
  campaignRecipients: (token: string, id: string, params?: Record<string, string>) => {
    const qs = params ? `?${new URLSearchParams(params)}` : "";
    return requestJson<{ recipients: CampaignRecipientDTO[]; total: number }>(
      `/api/campaigns/${id}/recipients${qs}`,
      token
    );
  },
  csvPreview: (token: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return requestJson<CsvPreviewResponse>("/api/campaigns/csv-preview", token, {
      method: "POST",
      body: form
    });
  },
};
