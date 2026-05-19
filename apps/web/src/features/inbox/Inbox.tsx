import type { AgentDTO, LeadDTO, LeadStatus, MessageDTO, NoteDTO, TaskDTO } from "@crm/shared";
import { Check, Search, Send } from "lucide-react";
import { Empty, LeadAvatar, LeadNameBlock, MessageBubble, SectionTitle, agentName, formatPhone, stageLabels, windowText } from "../../components";
import { stages } from "../../utils";

interface FilterState {
  search: string;
  status: string;
  tag: string;
  assignedTo: string;
  unread: string;
}

interface Props {
  waStatus: string;
  leads: LeadDTO[];
  selectedLead?: LeadDTO;
  selectedLeadId?: string;
  messages: MessageDTO[];
  notes: NoteDTO[];
  tasks: TaskDTO[];
  agents: AgentDTO[];
  filters: FilterState;
  reply: string;
  noteBody: string;
  taskForm: { title: string; dueAt: string; assignedTo: string };
  setFilters: (f: FilterState) => void;
  setSelectedLeadId: (id: string) => void;
  setReply: (text: string) => void;
  setNoteBody: (text: string) => void;
  setTaskForm: (form: { title: string; dueAt: string; assignedTo: string }) => void;
  updateLead: (lead: LeadDTO, patch: Partial<LeadDTO>) => void;
  sendReply: () => void;
  createNote: () => void;
  createTask: () => void;
}

export function Inbox(props: Props) {
  const lead = props.selectedLead;

  return (
    <div className="inbox-grid">
      {/* ── Lead list ────────────────────────────────────────────────────── */}
      <aside className="lead-panel">
        <div className="panel-tools">
          <div className="search-box">
            <Search size={16} />
            <input
              placeholder="Search name, phone, email"
              value={props.filters.search}
              onChange={(e) => props.setFilters({ ...props.filters, search: e.target.value })}
            />
          </div>
          <div className="filter-row">
            <button className={`filter-chip ${!props.filters.unread ? "active" : ""}`} onClick={() => props.setFilters({ ...props.filters, unread: "" })}>All</button>
            <button className={`filter-chip ${props.filters.unread ? "active" : ""}`} onClick={() => props.setFilters({ ...props.filters, unread: "true" })}>Unread</button>
            <select className="input" value={props.filters.status} onChange={(e) => props.setFilters({ ...props.filters, status: e.target.value })}>
              <option value="">Any stage</option>
              {stages.map((s) => <option key={s} value={s}>{stageLabels[s]}</option>)}
            </select>
          </div>
        </div>
        <div className="lead-list">
          {props.leads.map((item) => (
            <button key={item.id} className={`lead-row ${item.id === props.selectedLeadId ? "active" : ""}`} onClick={() => props.setSelectedLeadId(item.id)}>
              <LeadAvatar lead={item} size={36} />
              <span className="lead-main">
                <LeadNameBlock lead={item} />
                <em>{stageLabels[item.status]} {item.tags.slice(0, 2).map((t) => `#${t}`).join(" ")}</em>
              </span>
              {!!item.unreadCount && <b className="unread">{item.unreadCount}</b>}
            </button>
          ))}
        </div>
      </aside>

      {/* ── Chat panel ───────────────────────────────────────────────────── */}
      <section className="chat-panel">
        {lead ? (
          <>
            <header className="chat-header">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <LeadAvatar lead={lead} size={40} />
                <div>
                  <h2 style={{ fontSize: 16, margin: 0, fontWeight: 700 }}>
                    {lead.displayName !== lead.phone ? lead.displayName : formatPhone(lead.phone)}
                  </h2>
                  <p style={{ margin: "2px 0 0", color: "#697567", fontSize: 13 }}>
                    {lead.displayName !== lead.phone ? `${formatPhone(lead.phone)} · ` : ""}
                    {lead.pushName ? `~${lead.pushName} · ` : ""}
                    {windowText(lead)}
                  </p>
                </div>
              </div>
              <select className="input h-10" value={lead.assignedTo ?? ""} onChange={(e) => props.updateLead(lead, { assignedTo: e.target.value })}>
                <option value="">Unassigned</option>
                {props.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </header>

            <div className="messages">
              {props.messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)}
              {!props.messages.length && <Empty text="No messages in this conversation yet." />}
            </div>

            <footer className="composer" style={{ flexWrap: "wrap" }}>
              {props.waStatus !== "CONNECTED" && (
                <div style={{ width: "100%", padding: "4px 10px", color: props.waStatus === "FAILED" ? "#ef4444" : "#d97706", fontSize: 12, background: props.waStatus === "FAILED" ? "#fee2e2" : "#fef3c7", borderRadius: 4, marginBottom: 8, display: "flex", alignItems: "center" }}>
                  ⚠️ WhatsApp is {({ HYDRATING: "hydrating", SYNCING: "syncing history", AUTHENTICATING: "authenticating", INITIALISING: "initialising", DISCONNECTED: "reconnecting", FAILED: "failed" } as Record<string, string>)[props.waStatus] ?? "unavailable"}. Messages will be gated until connected.
                </div>
              )}
              <input
                className="input"
                placeholder={props.waStatus === "CONNECTED" ? "Reply from CRM" : `WhatsApp ${props.waStatus.toLowerCase()}…`}
                value={props.reply}
                onChange={(e) => props.setReply(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && props.waStatus === "CONNECTED" && props.sendReply()}
              />
              <button className="primary-button" onClick={props.sendReply} disabled={props.waStatus !== "CONNECTED"}>
                <Send size={16} /> Send
              </button>
            </footer>
          </>
        ) : <Empty text="Select a lead to open the WhatsApp conversation." />}
      </section>

      {/* ── Detail panel ─────────────────────────────────────────────────── */}
      <aside className="detail-panel">
        {lead ? (
          <>
            <SectionTitle title="Lead Details" />
            <label>Name<input className="input" value={lead.name ?? ""} onChange={(e) => props.updateLead(lead, { name: e.target.value })} /></label>
            <label>Email<input className="input" value={lead.email ?? ""} onChange={(e) => props.updateLead(lead, { email: e.target.value })} /></label>
            <label>Stage
              <select className="input" value={lead.status} onChange={(e) => props.updateLead(lead, { status: e.target.value as LeadStatus })}>
                {stages.map((s) => <option key={s} value={s}>{stageLabels[s]}</option>)}
              </select>
            </label>
            <label>Tags<input className="input" value={lead.tags.join(", ")} onChange={(e) => props.updateLead(lead, { tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })} /></label>
            <div className="quick-actions">
              <button onClick={() => props.updateLead(lead, { status: "won" })}><Check size={15} /> Won</button>
              <button onClick={() => props.updateLead(lead, { status: "lost" })}>Lost</button>
            </div>

            <SectionTitle title="Private Notes" />
            <div className="stacked-input">
              <textarea className="input" value={props.noteBody} onChange={(e) => props.setNoteBody(e.target.value)} placeholder="Add internal note" />
              <button className="secondary-button" onClick={props.createNote}>Add note</button>
            </div>
            <div className="timeline">
              {props.notes.map((note) => <p key={note.id}>{note.body}<small>{new Date(note.createdAt).toLocaleString()}</small></p>)}
            </div>

            <SectionTitle title="Follow-up" />
            <input className="input" placeholder="Task title" value={props.taskForm.title} onChange={(e) => props.setTaskForm({ ...props.taskForm, title: e.target.value })} />
            <input className="input" type="datetime-local" value={props.taskForm.dueAt} onChange={(e) => props.setTaskForm({ ...props.taskForm, dueAt: e.target.value })} />
            <button className="secondary-button" onClick={props.createTask}>Set reminder</button>
            <div className="timeline">
              {props.tasks.map((task) => <p key={task.id}>{task.title}<small>{new Date(task.dueAt).toLocaleString()} - {task.status}</small></p>)}
            </div>
          </>
        ) : <Empty text="Lead details appear here." />}
      </aside>
    </div>
  );
}
