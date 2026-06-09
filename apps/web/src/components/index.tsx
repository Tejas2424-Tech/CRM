import type { AgentDTO, LeadDTO, MessageDTO, TaskDTO } from "@crm/shared";
import { agentName, formatPhone, initials, leadName, stageLabels, windowText } from "../utils";

// ─── Primitives ───────────────────────────────────────────────────────────────

export function Metric({ label, value }: { label: string; value: number | string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

export function SectionTitle({ title, action, onClick }: { title: string; action?: string; onClick?: () => void }) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      {action && <button onClick={onClick}>{action}</button>}
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}

/** Animated placeholder matching a <Metric /> card */
export function SkeletonMetric() {
  return (
    <div className="metric">
      <span className="skeleton" style={{ width: "60%", height: 12, display: "block", borderRadius: 4 }} />
      <strong className="skeleton" style={{ width: "40%", height: 28, display: "block", marginTop: 8, borderRadius: 4 }} />
    </div>
  );
}

/** Animated placeholder matching a <LeadLine /> or <TaskLine /> row */
export function SkeletonLine() {
  return (
    <p className="timeline-item" style={{ display: "grid", gap: 6 }}>
      <span className="skeleton" style={{ width: "55%", height: 13, display: "block", borderRadius: 4 }} />
      <span className="skeleton" style={{ width: "75%", height: 11, display: "block", borderRadius: 4 }} />
    </p>
  );
}

export function StageMeter({ label, count, total }: { label: string; count: number; total: number }) {
  return (
    <div className="stage-meter">
      <div><span>{label}</span><b>{count}</b></div>
      <meter min={0} max={Math.max(total, 1)} value={count} />
    </div>
  );
}

// ─── Lead components ──────────────────────────────────────────────────────────

export function LeadAvatar({ lead, size = 32 }: { lead: LeadDTO; size?: number }) {
  const label = initials(lead.displayName || lead.name || lead.phone);
  if (lead.profilePic) {
    return (
      <img
        src={lead.profilePic}
        alt={label}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0, border: "2px solid var(--border, #333)" }}
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
      />
    );
  }
  return <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38, lineHeight: `${size}px` }}>{label}</span>;
}

export function LeadNameBlock({ lead }: { lead: LeadDTO }) {
  const isJustPhone = lead.displayName === lead.phone;
  return (
    <>
      <strong>{isJustPhone ? formatPhone(lead.phone) : lead.displayName}</strong>
      {!isJustPhone && <small>{formatPhone(lead.phone)}</small>}
    </>
  );
}

export function LeadLine({ lead, agents }: { lead: LeadDTO; agents: AgentDTO[] }) {
  return (
    <p className="timeline-item">
      <strong>{lead.displayName !== lead.phone ? lead.displayName : formatPhone(lead.phone)}</strong>
      <small>{stageLabels[lead.status]} - {agentName(agents, lead.assignedTo)}</small>
    </p>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────

export function MessageBubble({ message, onRetry }: { message: MessageDTO; onRetry?: (id: string) => void }) {
  const statusLabel = ({ queued: "SENDING...", retrying: "RETRYING...", sent: "SENT", delivered: "DELIVERED", read: "READ", failed: "FAILED" } as Record<string, string>)[message.status] ?? message.status;
  const statusColor = ({ queued: "#f39c12", retrying: "#e67e22", sent: "#2ecc71", delivered: "#3498db", read: "#9b59b6", failed: "#e74c3c" } as Record<string, string>)[message.status] ?? "#666";

  return (
    <div className={`bubble-row ${message.direction === "out" ? "out" : "in"}`}>
      <div className="bubble">
        <p>{message.text || message.type}</p>
        <small style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginTop: "4px" }}>
          <span>{new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          {message.direction === "out" && (
            <span style={{ color: statusColor, fontWeight: 700, fontSize: "0.65rem", letterSpacing: "0.025em" }}>
              {statusLabel.toUpperCase()}
            </span>
          )}
        </small>
        {message.status === "failed" && onRetry && (
          <button
            onClick={() => onRetry(message.id)}
            style={{
              marginTop: 4, padding: "2px 8px", fontSize: "0.65rem", fontWeight: 700,
              background: "transparent", color: "#e74c3c", border: "1px solid #e74c3c",
              borderRadius: 4, cursor: "pointer", display: "block"
            }}
          >
            ↺ Retry
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Task line ────────────────────────────────────────────────────────────────

export function TaskLine({ task, leads, agents }: { task: TaskDTO; leads: LeadDTO[]; agents: AgentDTO[] }) {
  return (
    <p className="timeline-item">
      <strong>{task.title}</strong>
      <small>{leadName(leads, task.leadId)} - {agentName(agents, task.assignedTo)} - {new Date(task.dueAt).toLocaleString()}</small>
    </p>
  );
}

// ─── Window text helper exposed for chat panel ────────────────────────────────
export { windowText, formatPhone, agentName, stageLabels };
