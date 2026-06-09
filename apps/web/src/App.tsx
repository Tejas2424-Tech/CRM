import React, { useState } from "react";
import {
  BarChart3,
  Bell,
  CircleUserRound,
  KanbanSquare,
  LayoutDashboard,
  ListChecks,
  Megaphone,
  MessageSquare,
  RefreshCw,
  Repeat,
  Settings,
  ShieldCheck,
  Users,
  Wifi,
} from "lucide-react";
import { useCrm } from "./context/CrmContext";

// ── Feature views ─────────────────────────────────────────────────────────────
import { Dashboard } from "./features/dashboard/Dashboard";
import { Inbox } from "./features/inbox/Inbox";
import { Pipeline } from "./features/pipeline/Pipeline";
import { LeadsPage } from "./features/leads/LeadsPage";
import { TasksPage } from "./features/tasks/TasksPage";
import { FollowupPlansPage } from "./features/followup/FollowupPlansPage";
import { AnalyticsPage } from "./features/analytics/AnalyticsPage";
import { TeamPage } from "./features/team/TeamPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import { ProfilePage } from "./features/profile/ProfilePage";
import { BulkCampaignsPage } from "./features/campaigns/BulkCampaignsPage";

// ─────────────────────────────────────────────────────────────────────────────

type View =
  | "dashboard"
  | "inbox"
  | "pipeline"
  | "leads"
  | "tasks"
  | "followup-plans"
  | "analytics"
  | "campaigns"
  | "team"
  | "settings"
  | "profile";

const navItems: Array<{ view: View; label: string; icon: React.ReactNode; manager?: boolean; admin?: boolean }> = [
  { view: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={18} /> },
  { view: "inbox", label: "Inbox", icon: <MessageSquare size={18} /> },
  { view: "pipeline", label: "Pipeline", icon: <KanbanSquare size={18} /> },
  { view: "leads", label: "Leads", icon: <Users size={18} /> },
  { view: "tasks", label: "Tasks", icon: <ListChecks size={18} /> },
  { view: "followup-plans", label: "Follow-up Plans", icon: <Repeat size={18} />, manager: true },
  { view: "analytics", label: "Analytics", icon: <BarChart3 size={18} />, manager: true },
  { view: "campaigns", label: "Campaigns", icon: <Megaphone size={18} />, manager: true },
  { view: "team", label: "Team", icon: <ShieldCheck size={18} />, manager: true },
  { view: "settings", label: "Settings", icon: <Settings size={18} />, admin: true },
  { view: "profile", label: "Profile", icon: <CircleUserRound size={18} /> },
];

function titleFor(view: View) {
  return (
    {
      dashboard: "Dashboard",
      inbox: "Shared Inbox",
      pipeline: "Pipeline",
      leads: "Contacts",
      tasks: "Follow-ups",
      "followup-plans": "Follow-up Plans",
      analytics: "Analytics",
      campaigns: "Bulk Campaigns",
      team: "Team",
      settings: "Settings",
      profile: "Profile",
    } as Record<View, string>
  )[view];
}

function subtitleFor(view: View) {
  return (
    {
      dashboard: "Today at a glance",
      inbox: "Three-panel WhatsApp workspace",
      pipeline: "Move leads through the sales flow",
      leads: "Search, create, and export leads",
      tasks: "Never miss a follow-up",
      "followup-plans": "Automate outreach sequences for new leads",
      analytics: "Team performance and conversion signals",
      campaigns: "Send targeted messages to contact segments",
      team: "Users, roles, capacity, and assignments",
      settings: "Business, WhatsApp, rules, and security",
      profile: "Your account and workload",
    } as Record<View, string>
  )[view];
}

// ─────────────────────────────────────────────────────────────────────────────

export function App() {
  const crm = useCrm();
  const { auth, leads, whatsapp, globalError, setGlobalError } = crm;
  const [view, setView] = useState<View>("dashboard");

  if (!auth.session) {
    return (
      <main className="login-screen">
        <div className="login-card">
          <MessageSquare />
          <strong>WhatsApp CRM</strong>
          <span>{auth.authLoading ? "Loading users..." : "Choose a dev user to continue"}</span>
          <div style={{ display: "grid", gap: 8, width: "100%", marginTop: 14 }}>
            {auth.agents.map((agent) => (
              <button
                key={agent.id}
                className="primary-button"
                disabled={auth.authLoading}
                onClick={() => auth.loginAs(agent.email ?? "admin@local.crm")}
              >
                {agent.name} - {agent.role}
              </button>
            ))}
          </div>
        </div>
      </main>
    );
  }

  const allowedNav = navItems.filter((item) => (!item.manager || auth.canManage) && (!item.admin || auth.canAdmin));

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <MessageSquare size={20} />
          <span>WhatsApp CRM</span>
        </div>
        <nav>
          {allowedNav.map((item) => (
            <button
              key={item.view}
              className={`nav-item ${view === item.view ? "active" : ""}`}
              onClick={() => setView(item.view)}
            >
              {item.icon}
              <span>{item.label}</span>
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
            <button className="icon-button" title="Refresh" onClick={leads.loadLeads}>
              <RefreshCw size={16} />
            </button>
            <button className="icon-button" title="Notifications">
              <Bell size={16} />
            </button>
            <button
              className="icon-button"
              aria-disabled={!whatsapp.canSyncWhatsapp}
              title={
                whatsapp.syncState.status === "syncing"
                  ? `Syncing… ${whatsapp.syncState.done}/${whatsapp.syncState.total}`
                  : !whatsapp.canSyncWhatsapp
                  ? "Connect WhatsApp before syncing chats"
                  : "Sync WhatsApp chats"
              }
              onClick={whatsapp.handleSyncWhatsapp}
              style={{
                color:
                  whatsapp.syncState.status === "syncing"
                    ? "#25d366"
                    : whatsapp.syncState.status === "done"
                    ? "#4caf50"
                    : undefined,
                cursor: whatsapp.canSyncWhatsapp ? "pointer" : "not-allowed",
                opacity: whatsapp.canSyncWhatsapp ? 1 : 0.55,
              }}
            >
              <Wifi size={16} />
              {whatsapp.syncState.status === "syncing" && (
                <span style={{ fontSize: 10, marginLeft: 2 }}>
                  {whatsapp.syncState.done}/{whatsapp.syncState.total}
                </span>
              )}
            </button>
            <select
              className="input h-10"
              value={auth.session.user.id}
              onChange={(e) => {
                const agent = auth.agents.find((a) => a.id === e.target.value);
                if (agent) auth.loginAs(agent.email ?? "admin@local.crm");
              }}
            >
              {auth.agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} - {a.role}
                </option>
              ))}
            </select>
          </div>
        </header>

        {view === "dashboard" && <Dashboard setView={(v) => setView(v as View)} />}
        {view === "inbox" && <Inbox />}
        {view === "pipeline" && <Pipeline openLead={(id) => { crm.leads.setSelectedLeadId(id); setView("inbox"); }} />}
        {view === "leads" && <LeadsPage openLead={(id) => { crm.leads.setSelectedLeadId(id); setView("inbox"); }} />}
        {view === "tasks" && <TasksPage openLead={(id) => { crm.leads.setSelectedLeadId(id); setView("inbox"); }} />}
        {view === "followup-plans" && <FollowupPlansPage />}
        {view === "analytics" && <AnalyticsPage />}
        {view === "campaigns" && <BulkCampaignsPage />}
        {view === "team" && <TeamPage />}
        {view === "settings" && <SettingsPage />}
        {view === "profile" && <ProfilePage />}
      </section>

      {globalError && (
        <button className="error-toast" onClick={() => setGlobalError(undefined)}>
          {globalError}
        </button>
      )}
    </main>
  );
}
