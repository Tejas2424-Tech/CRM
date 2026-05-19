import type { AgentDTO, CampaignDTO, LeadDTO, MessageDTO, NoteDTO, TaskDTO, TemplateDTO } from "@crm/shared";
import {
  BarChart3, Bell, CircleUserRound, KanbanSquare,
  LayoutDashboard, ListChecks, MessageSquare, RefreshCw,
  Settings, ShieldCheck, Tags, Users, Wifi
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, type Session } from "./api";
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

// ─────────────────────────────────────────────────────────────────────────────

type SyncState = { status: "idle" | "syncing" | "done"; done: number; total: number };
type View = "dashboard" | "inbox" | "pipeline" | "leads" | "tasks" | "templates" | "analytics" | "team" | "settings" | "profile";
type FilterState = { search: string; status: string; tag: string; assignedTo: string; unread: string };

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
  const [waStatus, setWaStatus] = useState<string>("INITIALISING");
  const [waMetadata, setWaMetadata] = useState<{ connectedAt?: string; lastDisconnectReason?: string; syncProgress?: { total: number; done: number } }>({});
  const [waQr, setWaQr] = useState<string | null>(null);
  const [waLogoutLoading, setWaLogoutLoading] = useState(false);
  const [crmResetState, setCrmResetState] = useState<string>("idle");
  const [error, setError] = useState<string>();

  const selectedLead = leads.find((l) => l.id === selectedLeadId);
  const visibleAgents = useMemo(() => agents.filter((a) => a.role === "agent" && a.active), [agents]);
  const currentAgent = agents.find((a) => a.id === session?.user.id);
  const canManage = session?.user.role === "admin" || session?.user.role === "manager";
  const canAdmin = session?.user.role === "admin";

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  useEffect(() => {
    api.devUsers()
      .then((users) => { setAgents(users); return api.login("admin@local.crm"); })
      .then((s) => {
        setSession(s);
        api.whatsappStatus(s.token).then((r) => {
          setWaStatus(r.status);
          setWaMetadata({
            connectedAt: r.connectedAt,
            lastDisconnectReason: r.lastDisconnectReason,
            syncProgress: r.syncProgress
          });
          if (r.syncProgress && r.syncProgress.total > 0) {
            setSyncState({ status: "syncing", ...r.syncProgress });
          }
        }).catch(() => undefined);
        api.whatsappQr(s.token).then((r) => setWaQr(r.qr)).catch(() => undefined);
      })
      .catch((err) => setError(err.message));
  }, []);

  // ── Data loading ──────────────────────────────────────────────────────────
  const loadLeads = () => {
    if (!session) return;
    api.leads(session.token, filters)
      .then((items) => {
        setLeads(items);
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
    api.messages(session.token, selectedLeadId).then(setMessages).catch((err) => setError(err.message));
    api.notes(session.token, selectedLeadId).then(setNotes).catch(() => setNotes([]));
    api.leadTasks(session.token, selectedLeadId).then((items) => {
      setTasks((all) => [...items, ...all.filter((t) => t.leadId !== selectedLeadId)]);
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
        setSelectedLeadId((cur) => { if (msg.leadId === cur) setMessages((items) => [...items.filter((i) => i.id !== msg.id), msg]); return cur; });
        loadLeads();
      }
    },
    { event: "message.status_updated", handler: (message) => setMessages((items) => items.map((i) => i.id === (message as MessageDTO).id ? message as MessageDTO : i)) },
    { event: "task:new", handler: (task) => setTasks((all) => [task as TaskDTO, ...all.filter((i) => i.id !== (task as TaskDTO).id)]) },
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
    const sent = await api.sendMessage(session.token, selectedLead.id, reply.trim());
    setMessages((items) => [...items, sent.message]);
    setReply("");
    updateLead(selectedLead, { unreadCount: 0 });
  };

  const createNote = async () => {
    if (!session || !selectedLead || !noteBody.trim()) return;
    const note = await api.createNote(session.token, selectedLead.id, noteBody.trim());
    setNotes((items) => [note, ...items]);
    setNoteBody("");
  };

  const createTask = async () => {
    if (!session || !selectedLead || !taskForm.title || !taskForm.dueAt) return;
    const task = await api.createTask(session.token, selectedLead.id, {
      title: taskForm.title,
      dueAt: new Date(taskForm.dueAt).toISOString(),
      assignedTo: taskForm.assignedTo || selectedLead.assignedTo
    });
    setTasks((items) => [task, ...items]);
    setTaskForm({ title: "", dueAt: "", assignedTo: "" });
  };

  const createLead = async () => {
    if (!session || !leadForm.phone) return;
    const lead = await api.createLead(session.token, { ...leadForm, status: "new", tags: [], source: "manual" });
    setLeads((items) => [lead, ...items]);
    setSelectedLeadId(lead.id);
    setLeadForm({ name: "", phone: "", email: "" });
    setView("inbox");
  };

  const createUser = async () => {
    if (!session || !canAdmin || !userForm.name || !userForm.email) return;
    const user = await api.createUser(session.token, userForm);
    setAgents((items) => [...items, user]);
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
        <div className="login-card"><MessageSquare /><strong>WhatsApp CRM</strong><span>Connecting workspace…</span></div>
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
              if (agent) api.login(agent.email ?? "admin@local.crm").then(setSession);
            }}>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name} - {a.role}</option>)}
            </select>
          </div>
        </header>

        {view === "dashboard" && <Dashboard leads={leads} tasks={tasks} agents={agents} analytics={analytics} setView={(v) => setView(v as View)} />}
        {view === "inbox" && (
          <Inbox
            waStatus={waStatus} leads={leads} selectedLead={selectedLead} selectedLeadId={selectedLeadId}
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
