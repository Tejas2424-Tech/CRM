import type { AgentDTO, LeadDTO, LeadStatus, MessageDTO, NoteDTO, TaskDTO } from "@crm/shared";
import { Check, Search, Send } from "lucide-react";
import { useEffect, useState } from "react";
import type { KeyboardEvent } from "react";
import { Empty, LeadAvatar, LeadNameBlock, MessageBubble, SectionTitle, agentName, formatPhone, stageLabels, windowText } from "../../components";
import { mergeUniqueMessages, messageRenderKey, stages, uniqueById } from "../../utils";

import { useCrm } from "../../context/CrmContext";

const emailPattern = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;

export function Inbox() {
  const { auth, leads, inbox, tasks, whatsapp } = useCrm();
  const selectedLead = leads.leads.find(l => l.id === leads.selectedLeadId);
  const [draftLead, setDraftLead] = useState({ name: "", email: "", tags: "" });
  const [emailError, setEmailError] = useState<string>();
  
  const props = {
    waStatus: whatsapp.waUiStatus,
    leads: leads.leads,
    selectedLead,
    selectedLeadId: leads.selectedLeadId,
    messages: inbox.messages,
    notes: inbox.notes,
    tasks: tasks.tasks.filter(t => t.leadId === leads.selectedLeadId),
    agents: auth.agents,
    filters: leads.filters,
    reply: inbox.reply,
    noteBody: inbox.noteBody,
    taskForm: tasks.taskForm,
    setFilters: leads.setFilters,
    setSelectedLeadId: leads.setSelectedLeadId,
    setReply: inbox.setReply,
    setNoteBody: inbox.setNoteBody,
    setTaskForm: tasks.setTaskForm,
    updateLead: leads.updateLead,
    sendReply: inbox.sendReply,
    createNote: inbox.createNote,
    createTask: () => tasks.createTask(leads.selectedLeadId, selectedLead?.assignedTo),
  };
  const lead = props.selectedLead;

  useEffect(() => {
    setDraftLead({
      name: lead?.name ?? "",
      email: lead?.email ?? "",
      tags: lead?.tags.join(", ") ?? "",
    });
    setEmailError(undefined);
  }, [lead?.id, lead?.name, lead?.email, lead?.tags]);

  const saveDraftField = (field: "name" | "email" | "tags") => {
    if (!lead) return;

    if (field === "email") {
      const email = draftLead.email.trim();
      if (email && !emailPattern.test(email)) {
        setEmailError("Enter a valid email address or leave it blank.");
        return;
      }
      setEmailError(undefined);
      if ((lead.email ?? "") !== email) props.updateLead(lead, { email });
      return;
    }

    if (field === "name") {
      const name = draftLead.name.trim();
      if ((lead.name ?? "") !== name) props.updateLead(lead, { name });
      return;
    }

    const tags = draftLead.tags.split(",").map((t) => t.trim()).filter(Boolean);
    if (lead.tags.join(",") !== tags.join(",")) props.updateLead(lead, { tags });
  };

  const blurOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.currentTarget.blur();
  };

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
          {uniqueById(props.leads).map((item) => (
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
              {(() => {
                // Final defensive dedup in render — ensures React never sees duplicate keys
                // even during transient state between optimistic update and server confirmation
                const deduped = mergeUniqueMessages([], props.messages);
                return deduped.length
                  ? deduped.map((msg, index) => <MessageBubble key={messageRenderKey(msg, index)} message={msg} />)
                  : <Empty text="No messages in this conversation yet." />;
              })()}
            </div>

            <footer className="composer" style={{ flexWrap: "wrap" }}>
              {props.waStatus !== "ready" && (
                <div style={{
                  width: "100%", padding: "4px 10px", fontSize: 12, borderRadius: 4, marginBottom: 8,
                  display: "flex", alignItems: "center",
                  color: props.waStatus === "offline" ? "#ef4444" : "#d97706",
                  background: props.waStatus === "offline" ? "#fee2e2" : "#fef3c7"
                }}>
                  {props.waStatus === "busy" && "⏳ WhatsApp is connecting — messages will be queued automatically."}
                  {props.waStatus === "offline" && "⚠️ WhatsApp is disconnected — messages will be queued and retried when reconnected."}
                  {props.waStatus === "unknown" && "ℹ️ WhatsApp status unknown — messages will be queued automatically."}
                </div>
              )}
              <input
                className="input"
                placeholder={props.waStatus === "ready" ? "Reply from CRM" : "Message will be queued until connected…"}
                value={props.reply}
                onChange={(e) => props.setReply(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && props.sendReply()}
              />
              <button className="primary-button" onClick={props.sendReply}>
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
            <label>Name<input className="input" value={draftLead.name} onChange={(e) => setDraftLead((draft) => ({ ...draft, name: e.target.value }))} onBlur={() => saveDraftField("name")} onKeyDown={blurOnEnter} /></label>
            <label>Email
              <input className="input" value={draftLead.email} onChange={(e) => { setDraftLead((draft) => ({ ...draft, email: e.target.value })); setEmailError(undefined); }} onBlur={() => saveDraftField("email")} onKeyDown={blurOnEnter} />
              {emailError && <span className="field-error">{emailError}</span>}
            </label>
            <label>Stage
              <select className="input" value={lead.status} onChange={(e) => props.updateLead(lead, { status: e.target.value as LeadStatus })}>
                {stages.map((s) => <option key={s} value={s}>{stageLabels[s]}</option>)}
              </select>
            </label>
            <label>Tags<input className="input" value={draftLead.tags} onChange={(e) => setDraftLead((draft) => ({ ...draft, tags: e.target.value }))} onBlur={() => saveDraftField("tags")} onKeyDown={blurOnEnter} /></label>
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
              {uniqueById(props.notes).map((note) => <p key={note.id}>{note.body}<small>{new Date(note.createdAt).toLocaleString()}</small></p>)}
            </div>

            <SectionTitle title="Follow-up" />
            <input className="input" placeholder="Task title" value={props.taskForm.title} onChange={(e) => props.setTaskForm({ ...props.taskForm, title: e.target.value })} />
            <input className="input" type="datetime-local" value={props.taskForm.dueAt} onChange={(e) => props.setTaskForm({ ...props.taskForm, dueAt: e.target.value })} />
            <button className="secondary-button" onClick={props.createTask}>Set reminder</button>
            <div className="timeline">
              {uniqueById(props.tasks).map((task) => <p key={task.id}>{task.title}<small>{new Date(task.dueAt).toLocaleString()} - {task.status}</small></p>)}
            </div>
          </>
        ) : <Empty text="Lead details appear here." />}
      </aside>
    </div>
  );
}
