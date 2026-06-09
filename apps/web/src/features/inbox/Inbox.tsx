import type { AgentDTO, LeadDTO, LeadStatus, MessageDTO, NoteDTO, TaskDTO } from "@crm/shared";
import { Check, Search, Send } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Empty, LeadAvatar, LeadNameBlock, MessageBubble, SectionTitle, agentName, formatPhone, stageLabels, windowText } from "../../components";
import { mergeUniqueMessages, messageRenderKey, stages, uniqueById } from "../../utils";

import { useCrm } from "../../context/CrmContext";

// ─── EnrollmentPanel ─────────────────────────────────────────────────────────

function EnrollmentPanel({ leadId }: { leadId: string }) {
  const { followupPlans, auth } = useCrm();
  const { plans, enrollmentCache, loadEnrollmentForLead, enrollLead, stopLeadEnrollment } =
    followupPlans;

  const [isEnrolling, setIsEnrolling] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState("");

  const enrollment = enrollmentCache.get(leadId);

  useEffect(() => {
    if (!enrollmentCache.has(leadId)) {
      loadEnrollmentForLead(leadId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  if (enrollment === undefined) {
    return <p style={{ color: "#697567", fontSize: 13 }}>Loading…</p>;
  }

  const handleEnroll = async () => {
    if (!selectedPlanId) return;
    setIsEnrolling(true);
    try {
      await enrollLead(leadId, selectedPlanId);
      setSelectedPlanId("");
    } finally {
      setIsEnrolling(false);
    }
  };

  const handleStop = async () => {
    if (!window.confirm("Stop all pending follow-up messages for this lead?")) return;
    setIsStopping(true);
    try {
      await stopLeadEnrollment(leadId);
    } finally {
      setIsStopping(false);
    }
  };

  if (enrollment && enrollment.status === "active") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between"
          }}
        >
          <span
            style={{
              fontSize: 12,
              background: "#dcfce7",
              color: "#166534",
              borderRadius: 4,
              padding: "2px 8px",
              fontWeight: 600
            }}
          >
            Active
          </span>
          {auth.canManage && (
            <button
              className="secondary-button"
              style={{ fontSize: 11, padding: "2px 8px", color: "#ef4444" }}
              disabled={isStopping}
              onClick={handleStop}
            >
              {isStopping ? "Stopping…" : "Stop"}
            </button>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {enrollment.steps.map((step) => (
            <div
              key={step.stepIndex}
              style={{
                fontSize: 12,
                display: "flex",
                justifyContent: "space-between",
                padding: "3px 6px",
                borderRadius: 4,
                background:
                  step.status === "sent"
                    ? "#f0fdf4"
                    : step.status === "skipped"
                    ? "#f9fafb"
                    : "#fffbeb"
              }}
            >
              <span style={{ fontWeight: step.status === "pending" ? 600 : 400 }}>
                {step.label === "welcome" ? "Welcome" : `Follow-up #${step.stepIndex + 1}`}
              </span>
              <span style={{ color: "#697567" }}>
                {step.status === "sent"
                  ? `Sent ${new Date(step.sentAt!).toLocaleDateString()}`
                  : step.status === "pending"
                  ? `Due ${new Date(step.scheduledAt).toLocaleString()}`
                  : "Skipped"}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!auth.canManage) {
    return <p style={{ color: "#697567", fontSize: 13, margin: 0 }}>No active follow-up plan.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <p style={{ color: "#697567", fontSize: 13, margin: 0 }}>No active follow-up plan.</p>
      {plans.length > 0 && (
        <>
          <select
            className="input"
            value={selectedPlanId}
            onChange={(e) => setSelectedPlanId(e.target.value)}
          >
            <option value="">Select a plan…</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.isDefault ? " (default)" : ""}
              </option>
            ))}
          </select>
          <button
            className="secondary-button"
            disabled={!selectedPlanId || isEnrolling}
            onClick={handleEnroll}
          >
            {isEnrolling ? "Enrolling…" : "Start Follow-up Plan"}
          </button>
        </>
      )}
    </div>
  );
}

const emailPattern = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;

export function Inbox() {
  const { auth, leads, inbox, tasks, whatsapp } = useCrm();
  const selectedLead = leads.leads.find(l => l.id === leads.selectedLeadId);
  const [draftLead, setDraftLead] = useState({ name: "", email: "", tags: "" });
  const [emailError, setEmailError] = useState<string>();
  const messagesRef = useRef<HTMLDivElement>(null);
  
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

  useLayoutEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [leads.selectedLeadId, inbox.messages.length]);

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

            <div className="messages" ref={messagesRef}>
              {(() => {
                // Final defensive dedup in render — ensures React never sees duplicate keys
                // even during transient state between optimistic update and server confirmation
                const deduped = mergeUniqueMessages([], props.messages);
                return deduped.length
                  ? deduped.map((msg, index) => <MessageBubble key={messageRenderKey(msg, index)} message={msg} onRetry={inbox.retryMessage} />)
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

            <SectionTitle title="Follow-up Plan" />
            <EnrollmentPanel leadId={lead.id} />

            <SectionTitle title="Reminders" />
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
