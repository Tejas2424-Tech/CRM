import type { AgentDTO, CampaignDTO, LeadDTO, MessageDTO, NoteDTO, TaskDTO, TemplateDTO } from "@crm/shared";
import {
  BarChart3, Bell, CircleUserRound, KanbanSquare,
  LayoutDashboard, ListChecks, MessageSquare, RefreshCw,
  Settings, ShieldCheck, Tags, Users, Wifi
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, type Session } from "./api";
import { useSocket } from "./hooks/useSocket";

// ── Feature views ─────────────────────────────────────────────────────────────
import { Dashboard } from "./features/dashboard/Dashboard";
import { Inbox } from "./features/inbox/Inbox";
import { Pipeline } from "./features/pipeline/Pipeline";
import { LeadsPage } from "./features/leads/LeadsPage";
import { TasksPage } from "./features/tasks/TasksPage";
import { TemplatesPage } from "./features/templates/TemplatesPage";
import { AnalyticsPage } from "./features/analytics/AnalyticsPage";
import { TeamPage } from "./features/team/TeamPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import { ProfilePage } from "./features/profile/ProfilePage";
import { mergeUniqueMessages, uniqueById } from "./utils";

// ─────────────────────────────────────────────────────────────────────────────

type SyncState = { status: "idle" | "syncing" | "done"; done: number; total: number };
type View = "dashboard" | "inbox" | "pipeline" | "leads" | "tasks" | "templates" | "analytics" | "team" | "settings" | "profile";
type FilterState = { search: string; status: string; tag: string; assignedTo: string; unread: string };

const DEV_USERS_CACHE_KEY = "crm:dev-users";
const SESSION_CACHE_KEY = "crm:session";
const AUTH_429_UNTIL_KEY = "crm:auth-429-until";

type AuthCache = {
  devUsers?: AgentDTO[];
  devUsersRequest?: Promise<AgentDTO[]>;
};

function authCache(): AuthCache {
  const root = globalThis as typeof globalThis & { __crmAuthCache?: AuthCache };
  root.__crmAuthCache ??= {};
  return root.__crmAuthCache;
}

function readJsonCache<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

function writeJsonCache(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be disabled; auth still works through in-memory state.
  }
}

function authRetryBlocked() {
  const retryAt = Number(sessionStorage.getItem(AUTH_429_UNTIL_KEY) ?? 0);
  return Number.isFinite(retryAt) && retryAt > Date.now();
}

function rememberAuth429() {
  sessionStorage.setItem(AUTH_429_UNTIL_KEY, String(Date.now() + 60_000));
}

function loadDevUsersOnce() {
  const cache = authCache();
  if (cache.devUsers) return Promise.resolve(cache.devUsers);

  const stored = readJsonCache<AgentDTO[]>(DEV_USERS_CACHE_KEY);
  if (stored?.length) {
    cache.devUsers = stored;
    return Promise.resolve(stored);
  }

  if (authRetryBlocked()) {
    return Promise.reject(new Error("Auth rate limit is cooling down. Please wait a minute, then refresh."));
  }

  if (!cache.devUsersRequest) {
    cache.devUsersRequest = api.devUsers().then((users) => {
      cache.devUsers = users;
      writeJsonCache(DEV_USERS_CACHE_KEY, users);
      sessionStorage.removeItem(AUTH_429_UNTIL_KEY);
      return users;
    }).catch((err) => {
      if (err instanceof ApiError && err.status === 429) rememberAuth429();
      throw err;
    }).finally(() => {
      cache.devUsersRequest = undefined;
    });
  }
  return cache.devUsersRequest;
}

const navItems: Array<{ view: View; label: string; icon: React.ReactNode; manager?: boolean; admin?: boolean }> = [
  { view: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={18} /> },
  { view: "inbox", label: "Inbox", icon: <MessageSquare size={18} /> },
  { view: "pipeline", label: "Pipeline", icon: <KanbanSquare size={18} /> },
  { view: "leads", label: "Leads", icon: <Users size={18} /> },
  { view: "tasks", label: "Tasks", icon: <ListChecks size={18} /> },
  { view: "templates", label: "Templates", icon: <Tags size={18} />, manager: true },
  { view: "analytics", label: "Analytics", icon: <BarChart3 size={18} />, manager: true },
  { view: "team", label: "Team", icon: <ShieldCheck size={18} />, manager: true },
  { view: "settings", label: "Settings", icon: <Settings size={18} />, admin: true },
  { view: "profile", label: "Profile", icon: <CircleUserRound size={18} /> }
];

function titleFor(view: View) {
  return ({ dashboard: "Dashboard", inbox: "Shared Inbox", pipeline: "Pipeline", leads: "Contacts", tasks: "Follow-ups", templates: "Templates", analytics: "Analytics", team: "Team", settings: "Settings", profile: "Profile" } as Record<View, string>)[view];
}

function subtitleFor(view: View) {
  return ({ dashboard: "Today at a glance", inbox: "Three-panel WhatsApp workspace", pipeline: "Move leads through the sales flow", leads: "Search, create, and export leads", tasks: "Never miss a follow-up", templates: "Approved WhatsApp message templates", analytics: "Team performance and conversion signals", team: "Users, roles, capacity, and assignments", settings: "Business, WhatsApp, rules, and security", profile: "Your account and workload" } as Record<View, string>)[view];
}

// ─────────────────────────────────────────────────────────────────────────────

export function App() {
  const [session, setSession] = useState<Session>();
  const [agents, setAgents] = useState<AgentDTO[]>([]);
  const [leads, setLeads] = useState<LeadDTO[]>([]);
  const [messages, setMessages] = useState<MessageDTO[]>([]);
  const [notes, setNotes] = useState<NoteDTO[]>([]);
  const [tasks, setTasks] = useState<TaskDTO[]>([]);
  const [templates, setTemplates] = useState<TemplateDTO[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignDTO[]>([]);
  const [analytics, setAnalytics] = useState<Awaited<ReturnType<typeof api.analytics>>>();
  const [selectedLeadId, setSelectedLeadId] = useState<string>();
  const [view, setView] = useState<View>("dashboard");
  const [filters, setFilters] = useState<FilterState>({ search: "", status: "", tag: "", assignedTo: "", unread: "" });
  const [reply, setReply] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [taskForm, setTaskForm] = useState({ title: "", dueAt: "", assignedTo: "" });
  const [leadForm, setLeadForm] = useState({ name: "", phone: "", email: "" });
  const [syncState, setSyncState] = useState<SyncState>({ status: "idle", done: 0, total: 0 });
  const [userForm, setUserForm] = useState({ name: "", email: "", role: "agent" as AgentDTO["role"], capacity: 30 });
  const [waStatus, setWaStatus] = useState<string>("UNKNOWN"); // Start UNKNOWN until first status poll
  const [waMetadata, setWaMetadata] = useState<{ connectedAt?: string; lastDisconnectReason?: string; syncProgress?: { total: number; done: number } }>({});
  const [waQr, setWaQr] = useState<string | null>(null);
  const [waLogoutLoading, setWaLogoutLoading] = useState(false);
  const [crmResetState, setCrmResetState] = useState<string>("idle");
  const [error, setError] = useState<string>();
  const [authLoading, setAuthLoading] = useState(false);
  const bootstrappedRef = useRef(false);
  const loginInFlightRef = useRef<string | null>(null);

  const selectedLead = leads.find((l) => l.id === selectedLeadId);
  const visibleAgents = useMemo(() => agents.filter((a) => a.role === "agent" && a.active), [agents]);
  const currentAgent = agents.find((a) => a.id === session?.user.id);
  const canManage = session?.user.role === "admin" || session?.user.role === "manager";
  const canAdmin = session?.user.role === "admin";

  /**
   * UI state mapping layer — frontend MUST NOT use raw backend WajsStatus directly.
   * Maps system states to 3 semantic levels the UI can safely act on:
   *   "ready"   → CONNECTED: full send enabled
   *   "busy"    → transitional states (INITIALISING, AUTHENTICATING, etc.): show banner, allow queueing
   *   "offline" → DISCONNECTED / FAILED: show error banner, still allow queueing (BullMQ holds it)
   *   "unknown" → UNKNOWN / BOOTING / missing: show soft banner, allow queueing
   */
  const waUiStatus = useMemo((): "ready" | "busy" | "offline" | "unknown" => {
    switch (waStatus) {
      case "CONNECTED":                                                                          return "ready";
      case "INITIALISING": case "AUTHENTICATING": case "HYDRATING": case "SYNCING":             return "busy";
      case "DISCONNECTED": case "FAILED":                                                        return "offline";
      default:                                                                                   return "unknown";
    }
  }, [waStatus]);

  const refreshWhatsappStatus = useCallback((token: string) => {
    api.whatsappStatus(token).then((r) => {
      setWaStatus(r.status);
      setWaMetadata({
        connectedAt: r.connectedAt,
        lastDisconnectReason: r.lastDisconnectReason,
        syncProgress: r.syncProgress
      });
      if (r.syncProgress && r.syncProgress.total > 0) {
        setSyncState({ status: "syncing", ...r.syncProgress });
      }
      if (r.status === "QR_REQUIRED") {
        api.whatsappQr(token).then((qr) => setWaQr(qr.qr)).catch(() => undefined);
      }
    }).catch(() => undefined);
  }, []);

  const loginAs = useCallback(async (email: string) => {
    if (authRetryBlocked()) {
      setError("Auth rate limit is cooling down. Please wait a minute, then try again.");
      return;
    }
    const targetAgent = agents.find((agent) => agent.email === email);
    if (loginInFlightRef.current === email || targetAgent?.id === session?.user.id) return;
    loginInFlightRef.current = email;
    setAuthLoading(true);
    setError(undefined);
    try {
      const nextSession = await api.login(email);
      setSession(nextSession);
      writeJsonCache(SESSION_CACHE_KEY, nextSession);
      sessionStorage.removeItem(AUTH_429_UNTIL_KEY);
      refreshWhatsappStatus(nextSession.token);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 429) rememberAuth429();
      setError((err as Error).message);
    } finally {
      loginInFlightRef.current = null;
      setAuthLoading(false);
    }
  }, [agents, refreshWhatsappStatus, session?.user.id]);

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        setAuthLoading(true);
        const storedSession = readJsonCache<Session>(SESSION_CACHE_KEY);
        if (storedSession) {
          setSession(storedSession);
          refreshWhatsappStatus(storedSession.token);
        }

        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("API timeout: Could not load users. Is the backend running?")), 10000)
        );

        const users = await Promise.race([loadDevUsersOnce(), timeoutPromise]);

        if (!cancelled) setAgents(uniqueById(users));
      } catch (err: any) {
        if (!cancelled) {
          console.error("[Bootstrap] Failed:", err);
          setError(err.message || "Failed to load dashboard data");
        }
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    };

    bootstrap();

    return () => {
      cancelled = true;
    };
  }, []);

  // ── Data loading ──────────────────────────────────────────────────────────
  const loadLeads = () => {
    if (!session) return;
    api.leads(session.token, filters)
      .then((items) => {
        setLeads(uniqueById(items));
        setSelectedLeadId((cur) => cur ?? items[0]?.id);
      })
      .catch((err) => setError(err.message));
  };

  const loadWorkspace = () => {
    if (!session) return;
    loadLeads();
    api.tasks(session.token).then(setTasks).catch(() => undefined);
    api.templates(session.token).then(setTemplates).catch(() => undefined);
    if (canManage) {
      api.users(session.token).then(setAgents).catch(() => undefined);
      api.campaigns(session.token).then(setCampaigns).catch(() => undefined);
      api.analytics(session.token).then(setAnalytics).catch(() => undefined);
    }
  };

  useEffect(loadWorkspace, [session, filters.search, filters.status, filters.tag, filters.assignedTo, filters.unread]);

  useEffect(() => {
    if (!session || !selectedLeadId) return;
    const leadId = selectedLeadId;
    // Always reset messages when switching leads, then populate from API
    setMessages([]);
    api.messages(session.token, leadId)
      .then((fetched) => {
        setMessages((current) =>
          mergeUniqueMessages(fetched, current.filter((msg) => msg.leadId === leadId))
        );
      })
      .catch((err) => setError(err.message));
    api.notes(session.token, leadId).then((items) => setNotes(uniqueById(items))).catch(() => setNotes([]));
    api.leadTasks(session.token, leadId).then((items) => {
      setTasks((all) => uniqueById([...items, ...all.filter((t) => t.leadId !== leadId)]));
    }).catch(() => undefined);
  }, [session, selectedLeadId]);

  // ── Socket.IO ─────────────────────────────────────────────────────────────
  useSocket(!!session, [
    { event: "lead:new", handler: (lead) => setLeads((items) => [lead as LeadDTO, ...items.filter((i) => i.id !== (lead as LeadDTO).id)]) },
    { event: "lead:update", handler: (lead) => { if (!lead) return; setLeads((items) => [lead as LeadDTO, ...items.filter((i) => i.id !== (lead as LeadDTO).id)]); } },
    { event: "contact:updated", handler: (lead) => { if (!lead) return; setLeads((items) => { const l = lead as LeadDTO; return items.some((i) => i.id === l.id) ? items.map((i) => i.id === l.id ? l : i) : [l, ...items]; }); } },
    {
      event: "message:new", handler: (message) => {
        const msg = message as MessageDTO;
        // Safely merge the new message into state — deduplicated, sorted
        setSelectedLeadId((cur) => {
          if (msg.leadId === cur) {
            setMessages((items) => mergeUniqueMessages(items, [msg]));
          }
          return cur;
        });
        loadLeads();
      }
    },
    {
      event: "message.status_updated", handler: (message) => {
        const updated = message as MessageDTO;
        // Merge the updated message — it will replace the existing one by id
        setMessages((items) => mergeUniqueMessages(items, [updated]));
      }
    },
    { event: "task:new", handler: (task) => setTasks((all) => uniqueById([task as TaskDTO, ...all.filter((i) => i.id !== (task as TaskDTO).id)])) },
    { event: "campaign.updated", handler: () => loadWorkspace() },
    { event: "sync:started", handler: () => setSyncState({ status: "syncing", done: 0, total: 0 }) },
    { event: "sync:progress", handler: (p) => setSyncState({ status: "syncing", ...(p as { total: number; done: number }) }) },
    { event: "sync:complete", handler: (p) => { setSyncState({ status: "done", ...(p as { total: number; done: number }) }); loadLeads(); } },
    {
      event: "wajs:status",
      handler: (p: any) => {
        setWaStatus(p.status);
        setWaMetadata({
          connectedAt: p.connectedAt,
          lastDisconnectReason: p.lastDisconnectReason,
          syncProgress: p.syncProgress
        });
        if (p.syncProgress && p.syncProgress.total > 0) {
          setSyncState({ status: "syncing", ...p.syncProgress });
        }
        if (p.status === "CONNECTED" || p.status === "DISCONNECTED" || p.status === "FAILED") setWaQr(null);
      }
    },
    { event: "wajs:qr", handler: (p) => { setWaQr((p as { qr: string }).qr); setWaStatus("QR_REQUIRED"); setWaLogoutLoading(false); } },
    { event: "wajs:logout", handler: () => { setWaStatus("DISCONNECTED"); setWaQr(null); setWaMetadata({}); } },
    {
      event: "crm:reset", handler: (p) => {
        const ev = p as { phase: string; error?: string };
        if (ev.phase === "complete") window.location.reload();
        else if (ev.phase === "error") { setCrmResetState("idle"); setError(ev.error ?? "Failed to reset CRM"); }
        else setCrmResetState(ev.phase);
      }
    }
  ]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const updateLead = async (lead: LeadDTO, patch: Partial<LeadDTO>) => {
    if (!session) return;
    const updated = await api.updateLead(session.token, lead.id, patch);
    setLeads((items) => items.map((i) => i.id === updated.id ? updated : i));
  };

  const sendReply = async () => {
    if (!session || !selectedLead || !reply.trim()) return;
    const text = reply.trim();
    setReply(""); // Clear immediately for snappy UX
    try {
      const sent = await api.sendMessage(session.token, selectedLead.id, text);
      // Merge into state — the server's message wins (has the real ID/waMessageId)
      // The socket's message:new will also arrive; mergeUniqueMessages handles that gracefully
      setMessages((items) => mergeUniqueMessages(items, [sent.message]));
      updateLead(selectedLead, { unreadCount: 0 });
    } catch (err: any) {
      setError(err.message ?? "Failed to send message");
      setReply(text); // Restore reply on failure
    }
  };

  const createNote = async () => {
    if (!session || !selectedLead || !noteBody.trim()) return;
    const note = await api.createNote(session.token, selectedLead.id, noteBody.trim());
    setNotes((items) => uniqueById([note, ...items]));
    setNoteBody("");
  };

  const createTask = async () => {
    if (!session || !selectedLead || !taskForm.title || !taskForm.dueAt) return;
    const task = await api.createTask(session.token, selectedLead.id, {
      title: taskForm.title,
      dueAt: new Date(taskForm.dueAt).toISOString(),
      assignedTo: taskForm.assignedTo || selectedLead.assignedTo
    });
    setTasks((items) => uniqueById([task, ...items]));
    setTaskForm({ title: "", dueAt: "", assignedTo: "" });
  };

  const createLead = async () => {
    if (!session || !leadForm.phone) return;
    const lead = await api.createLead(session.token, { ...leadForm, status: "new", tags: [], source: "manual" });
    setLeads((items) => uniqueById([lead, ...items]));
    setSelectedLeadId(lead.id);
    setLeadForm({ name: "", phone: "", email: "" });
    setView("inbox");
  };

  const createUser = async () => {
    if (!session || !canAdmin || !userForm.name || !userForm.email) return;
    const user = await api.createUser(session.token, userForm);
    setAgents((items) => uniqueById([...items, user]));
    setUserForm({ name: "", email: "", role: "agent", capacity: 30 });
  };

  const completeTask = async (task: TaskDTO) => {
    if (!session) return;
    const updated = await api.updateTask(session.token, task.id, { status: "done" });
    setTasks((items) => items.map((i) => i.id === updated.id ? updated : i));
  };

  const handleWaLogout = async () => {
    if (!session || waLogoutLoading) return;
    setWaLogoutLoading(true);
    try { await api.logoutWhatsApp(session.token); }
    catch (err: unknown) { setError((err as Error).message); setWaLogoutLoading(false); }
  };

  const handleResetCrm = async () => {
    if (!session || crmResetState !== "idle") return;
    if (!window.confirm("DANGER: This will permanently delete ALL chats, contacts, messages, and WhatsApp sessions. The CRM will return to a clean state. Are you sure?")) return;
    setCrmResetState("starting");
    try { await api.resetCrm(session.token); }
    catch (err: unknown) { setError((err as Error).message); setCrmResetState("idle"); }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const allowedNav = navItems.filter((item) => (!item.manager || canManage) && (!item.admin || canAdmin));

  if (!session) {
    return (
      <main className="login-screen">
        <div className="login-card">
          <MessageSquare />
          <strong>WhatsApp CRM</strong>
          <span>{authLoading ? "Loading users..." : "Choose a dev user to continue"}</span>
          <div style={{ display: "grid", gap: 8, width: "100%", marginTop: 14 }}>
            {agents.map((agent) => (
              <button
                key={agent.id}
                className="primary-button"
                disabled={authLoading}
                onClick={() => loginAs(agent.email ?? "admin@local.crm")}
              >
                {agent.name} - {agent.role}
              </button>
            ))}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><MessageSquare size={20} /><span>WhatsApp CRM</span></div>
        <nav>
          {allowedNav.map((item) => (
            <button key={item.view} className={`nav-item ${view === item.view ? "active" : ""}`} onClick={() => setView(item.view)}>
              {item.icon}<span>{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>{titleFor(view)}</h1>
            <p>{subtitleFor(view)}</p>
          </div>
          <div className="top-actions">
            <button className="icon-button" title="Refresh" onClick={loadWorkspace}><RefreshCw size={16} /></button>
            <button className="icon-button" title="Notifications"><Bell size={16} /></button>
            <button
              className="icon-button"
              title={syncState.status === "syncing" ? `Syncing… ${syncState.done}/${syncState.total}` : "Sync WhatsApp chats"}
              onClick={() => api.triggerSync(session.token).catch(() => undefined)}
              style={{ color: syncState.status === "syncing" ? "#25d366" : syncState.status === "done" ? "#4caf50" : undefined }}
            >
              <Wifi size={16} />
              {syncState.status === "syncing" && <span style={{ fontSize: 10, marginLeft: 2 }}>{syncState.done}/{syncState.total}</span>}
            </button>
            <select className="input h-10" value={session.user.id} onChange={(e) => {
              const agent = agents.find((a) => a.id === e.target.value);
              if (agent) loginAs(agent.email ?? "admin@local.crm");
            }}>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name} - {a.role}</option>)}
            </select>
          </div>
        </header>

        {view === "dashboard" && <Dashboard leads={leads} tasks={tasks} agents={agents} analytics={analytics} setView={(v) => setView(v as View)} />}
        {view === "inbox" && (
          <Inbox
            waStatus={waUiStatus} leads={leads} selectedLead={selectedLead} selectedLeadId={selectedLeadId}
            messages={messages} notes={notes} tasks={tasks.filter((t) => t.leadId === selectedLeadId)}
            agents={visibleAgents} filters={filters} reply={reply} noteBody={noteBody} taskForm={taskForm}
            setFilters={setFilters} setSelectedLeadId={setSelectedLeadId} setReply={setReply}
            setNoteBody={setNoteBody} setTaskForm={setTaskForm} updateLead={updateLead}
            sendReply={sendReply} createNote={createNote} createTask={createTask}
          />
        )}
        {view === "pipeline" && <Pipeline leads={leads} agents={agents} updateLead={updateLead} openLead={(id) => { setSelectedLeadId(id); setView("inbox"); }} />}
        {view === "leads" && <LeadsPage leads={leads} agents={agents} form={leadForm} setForm={setLeadForm} createLead={createLead} openLead={(id) => { setSelectedLeadId(id); setView("inbox"); }} canManage={canManage} />}
        {view === "tasks" && <TasksPage tasks={tasks} leads={leads} agents={agents} completeTask={completeTask} openLead={(id) => { setSelectedLeadId(id); setView("inbox"); }} />}
        {view === "templates" && <TemplatesPage templates={templates} campaigns={campaigns} />}
        {view === "analytics" && <AnalyticsPage leads={leads} analytics={analytics} agents={agents} />}
        {view === "team" && <TeamPage agents={agents} leads={leads} form={userForm} setForm={setUserForm} createUser={createUser} canAdmin={canAdmin} />}
        {view === "settings" && <SettingsPage waStatus={waStatus} waMetadata={waMetadata} waQr={waQr} waLogoutLoading={waLogoutLoading} crmResetState={crmResetState} onLogout={handleWaLogout} onSync={() => api.triggerSync(session.token).catch(() => undefined)} onResetCrm={handleResetCrm} canAdmin={canAdmin} />}
        {view === "profile" && <ProfilePage user={currentAgent} session={session} tasks={tasks} />}
      </section>

      {error && <button className="error-toast" onClick={() => setError(undefined)}>{error}</button>}
    </main>
  );
}
