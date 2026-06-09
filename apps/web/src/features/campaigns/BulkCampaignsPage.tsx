import React, { useRef, useState } from "react";
import type { CampaignDTO, CampaignType, CsvPreviewRow } from "@crm/shared";
import { api } from "../../api";
import { Metric, SectionTitle, Empty } from "../../components";
import { useCrm } from "../../context/CrmContext";

// ─── Types ────────────────────────────────────────────────────────────────────

type WizardStep = 1 | 2 | 3;

interface WizardState {
  name: string;
  description: string;
  type: CampaignType;
  csvRows: CsvPreviewRow[];
  csvError: string;
  csvFileName: string;
  messageBody: string;
  sendNow: boolean;
  sendAt: string;
  timezone: string;
  messagesPerMinute: number;
}

const defaultWizard: WizardState = {
  name: "",
  description: "",
  type: "promotional",
  csvRows: [],
  csvError: "",
  csvFileName: "",
  messageBody: "",
  sendNow: true,
  sendAt: "",
  timezone: "UTC",
  messagesPerMinute: 10
};

const STEP_LABELS: Record<WizardStep, string> = {
  1: "Details & Audience",
  2: "Message",
  3: "Schedule & Review"
};

// ─── StatusBadge ─────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { bg: string; color: string }> = {
  draft:     { bg: "#f1f5f9", color: "#475569" },
  scheduled: { bg: "#dbeafe", color: "#1d4ed8" },
  running:   { bg: "#dcfce7", color: "#15803d" },
  paused:    { bg: "#fef9c3", color: "#92400e" },
  completed: { bg: "#d1fae5", color: "#065f46" },
  failed:    { bg: "#fee2e2", color: "#991b1b" },
  cancelled: { bg: "#f3f4f6", color: "#6b7280" }
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.draft;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      height: 22, padding: "0 8px", borderRadius: 999,
      fontSize: 11, fontWeight: 700,
      background: s.bg, color: s.color, textTransform: "capitalize"
    }}>
      {status}
    </span>
  );
}

// ─── TypePill ─────────────────────────────────────────────────────────────────

function TypePill({ type }: { type: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      height: 22, padding: "0 8px", borderRadius: 999,
      fontSize: 11, fontWeight: 700,
      background: "#f1f5f9", color: "#475569", textTransform: "capitalize"
    }}>
      {type}
    </span>
  );
}

// ─── ProgressBar ─────────────────────────────────────────────────────────────

function ProgressBar({ progress }: { progress: CampaignDTO["progress"] }) {
  const total = Math.max(progress.total, 1);
  const segments = [
    { key: "sent",      value: progress.sent,      color: "#1e6b57" },
    { key: "delivered", value: progress.delivered,  color: "#0d9488" },
    { key: "read",      value: progress.read,       color: "#7c3aed" },
    { key: "replied",   value: progress.replied,    color: "#15803d" },
    { key: "failed",    value: progress.failed,     color: "#dc2626" },
    { key: "skipped",   value: progress.skipped,    color: "#d1d5db" }
  ];
  return (
    <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", background: "#e5e7eb" }}>
      {segments.map((s) => (
        <div
          key={s.key}
          style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
          title={`${s.key}: ${s.value}`}
        />
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function BulkCampaignsPage() {
  const { campaigns: hook, auth } = useCrm();
  const { campaigns, isLoading, createCampaign, launchCampaign, pauseCampaign, cancelCampaign, deleteCampaign } = hook;

  const [showWizard, setShowWizard]           = useState(false);
  const [editingId, setEditingId]             = useState<string | null>(null);
  const [wizardStep, setWizardStep]           = useState<WizardStep>(1);
  const [wizard, setWizard]                   = useState<WizardState>(defaultWizard);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [recipients, setRecipients]           = useState<{ id: string; phone: string; name?: string; status: string }[]>([]);
  const [recipientsTotal, setRecipientsTotal] = useState(0);
  const [isSubmitting, setIsSubmitting]       = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const totalCampaigns     = campaigns.length;
  const activeCampaigns    = campaigns.filter((c) => c.status === "running").length;
  const scheduledCampaigns = campaigns.filter((c) => c.status === "scheduled").length;
  const completedCampaigns = campaigns.filter((c) => c.status === "completed").length;

  const selectedCampaign = campaigns.find((c) => c.id === selectedCampaignId);

  const set = (patch: Partial<WizardState>) => setWizard((prev) => ({ ...prev, ...patch }));

  const openWizard = (campaign?: CampaignDTO) => {
    if (campaign) {
      setEditingId(campaign.id);
      set({
        name: campaign.name,
        description: campaign.description ?? "",
        type: campaign.type,
        csvRows: [], csvError: "", csvFileName: "",
        messageBody: campaign.messageBody,
        sendNow: !campaign.sendAt,
        sendAt: campaign.sendAt?.slice(0, 16) ?? "",
        timezone: campaign.timezone,
        messagesPerMinute: campaign.messagesPerMinute
      });
    } else {
      setEditingId(null);
      setWizard(defaultWizard);
    }
    setWizardStep(1);
    setShowWizard(true);
  };

  const handleCsvFile = async (file: File) => {
    if (!auth.session) return;
    set({ csvFileName: file.name, csvError: "", csvRows: [] });
    try {
      const preview = await api.csvPreview(auth.session.token, file);
      set({
        csvRows: preview.valid,
        csvError: preview.invalid.length > 0 ? `${preview.invalid.length} invalid row(s) skipped` : ""
      });
    } catch (err: any) {
      set({ csvError: err.message, csvRows: [] });
    }
  };

  const handleSubmit = async () => {
    if (!auth.session || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name: wizard.name,
        description: wizard.description || undefined,
        type: wizard.type,
        audienceSource: "csv",
        messageBody: wizard.messageBody,
        sendAt: wizard.sendNow ? undefined : wizard.sendAt || undefined,
        timezone: wizard.timezone,
        messagesPerMinute: wizard.messagesPerMinute
      };
      body.csvRows = wizard.csvRows;
      const campaign = await createCampaign(body);
      if (campaign && wizard.sendNow) await launchCampaign(campaign.id);
      setShowWizard(false);
      setWizard(defaultWizard);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const loadRecipients = async (id: string) => {
    if (!auth.session) return;
    try {
      const result = await api.campaignRecipients(auth.session.token, id);
      setRecipients(result.recipients as any[]);
      setRecipientsTotal(result.total);
    } catch {
      setRecipients([]);
    }
  };

  const handleSelectCampaign = (id: string) => {
    setSelectedCampaignId(id);
    loadRecipients(id);
  };

  const insertVar = (v: string) => set({ messageBody: wizard.messageBody + v });

  const estimatedMinutes =
    wizard.messagesPerMinute > 0
      ? Math.ceil((wizard.csvRows.length || 1) / wizard.messagesPerMinute)
      : "–";

  // ─── Wizard ────────────────────────────────────────────────────────────────

  const renderWizard = () => (
    <div className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: 560 }}>

        {/* Step indicator */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            {([1, 2, 3] as WizardStep[]).map((s) => (
              <div
                key={s}
                style={{
                  flex: 1, height: 4, borderRadius: 2,
                  background: s <= wizardStep ? "#1e6b57" : "#e2e8f0"
                }}
              />
            ))}
          </div>
          <p style={{ margin: 0, fontSize: 12, color: "#697567" }}>
            Step {wizardStep} of 3 —{" "}
            <strong style={{ color: "#1f261f" }}>{STEP_LABELS[wizardStep]}</strong>
          </p>
        </div>

        {/* ── Step 1: Details & Audience ── */}
        {wizardStep === 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Campaign Name *</span>
              <input
                className="input"
                value={wizard.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="e.g. July Promo Blast"
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Description</span>
              <input
                className="input"
                value={wizard.description}
                onChange={(e) => set({ description: e.target.value })}
                placeholder="Optional"
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Campaign Type</span>
              <select
                className="input"
                value={wizard.type}
                onChange={(e) => set({ type: e.target.value as CampaignType })}
              >
                {["promotional", "marketing", "follow-up", "announcement", "custom"].map((t) => (
                  <option key={t} value={t}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </option>
                ))}
              </select>
            </label>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, background: "#f8fafc", borderRadius: 8, border: "1px solid #dce2d8" }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Upload CSV</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                style={{ display: "none" }}
                onChange={(e) => { if (e.target.files?.[0]) handleCsvFile(e.target.files[0]); }}
              />
              <button
                className="secondary-button"
                style={{ alignSelf: "flex-start" }}
                onClick={() => fileInputRef.current?.click()}
              >
                {wizard.csvFileName ? `📎 ${wizard.csvFileName}` : "Choose CSV file"}
              </button>
              {wizard.csvError && (
                <p style={{ margin: 0, fontSize: 12, color: "#92400e", background: "#fef3c7", padding: "4px 8px", borderRadius: 4 }}>
                  {wizard.csvError}
                </p>
              )}
              {wizard.csvRows.length > 0 && (
                <p style={{ margin: 0, fontSize: 12, color: "#15803d", background: "#dcfce7", padding: "4px 8px", borderRadius: 4 }}>
                  {wizard.csvRows.length} valid recipients loaded
                </p>
              )}
              <p style={{ margin: 0, fontSize: 11, color: "#697567" }}>
                Required column: <code>phone</code>. Optional: <code>name</code>, <code>company</code>, custom columns.
              </p>
            </div>
          </div>
        )}

        {/* ── Step 2: Message ── */}
        {wizardStep === 2 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Variables</span>
              <small style={{ display: "block", color: "#697567", marginBottom: 2 }}>
                Click to insert into message
              </small>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {["{{name}}", "{{phone}}", "{{company}}"].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => insertVar(v)}
                    style={{
                      padding: "3px 10px", borderRadius: 999,
                      border: "1px solid #1e6b57", background: "#eef6f0",
                      color: "#1e6b57", fontSize: 12, fontWeight: 600
                    }}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Message Body *</span>
              <textarea
                className="input"
                rows={7}
                value={wizard.messageBody}
                onChange={(e) => set({ messageBody: e.target.value })}
                placeholder="Hi {{name}}, we have a special offer for you…"
                maxLength={4096}
              />
              <span style={{ fontSize: 11, color: "#697567", textAlign: "right" }}>
                {wizard.messageBody.length} / 4096
              </span>
            </label>

            {wizard.messageBody && (
              <div style={{ background: "#f8fafc", border: "1px solid #dce2d8", borderRadius: 8, padding: 12 }}>
                <span style={{ display: "block", fontSize: 11, color: "#697567", fontWeight: 600, marginBottom: 6 }}>
                  Preview
                </span>
                <p style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap" }}>
                  {wizard.messageBody
                    .replace(/\{\{name\}\}/gi, "John Doe")
                    .replace(/\{\{phone\}\}/gi, "+91 98765 43210")
                    .replace(/\{\{company\}\}/gi, "Acme Corp")}
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Step 3: Schedule & Review ── */}
        {wizardStep === 3 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Send Time</span>
              <div style={{ display: "flex", gap: 8 }}>
                {([
                  { key: true,  label: "Send Now" },
                  { key: false, label: "Schedule Later" }
                ] as const).map(({ key, label }) => {
                  const active = wizard.sendNow === key;
                  return (
                    <button
                      key={String(key)}
                      type="button"
                      onClick={() => set({ sendNow: key })}
                      style={{
                        flex: 1, padding: "8px 12px", borderRadius: 8,
                        border: `2px solid ${active ? "#1e6b57" : "#e2e8f0"}`,
                        background: active ? "#eef6f0" : "#fff",
                        fontWeight: 600, fontSize: 13,
                        color: active ? "#1e6b57" : "#697567"
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {!wizard.sendNow && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 12, background: "#f8fafc", borderRadius: 8, border: "1px solid #dce2d8" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>Send At</span>
                  <input
                    type="datetime-local"
                    className="input"
                    value={wizard.sendAt}
                    onChange={(e) => set({ sendAt: e.target.value })}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>Timezone</span>
                  <select
                    className="input"
                    value={wizard.timezone}
                    onChange={(e) => set({ timezone: e.target.value })}
                  >
                    {["UTC", "Asia/Kolkata", "Asia/Dubai", "America/New_York", "America/Los_Angeles", "Europe/London", "Asia/Singapore", "Australia/Sydney"].map((tz) => (
                      <option key={tz} value={tz}>{tz}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Messages Per Minute (1–60)</span>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <input
                  type="range"
                  min={1}
                  max={60}
                  value={wizard.messagesPerMinute}
                  onChange={(e) => set({ messagesPerMinute: parseInt(e.target.value) })}
                  style={{ flex: 1, accentColor: "#1e6b57" }}
                />
                <strong style={{ minWidth: 48, textAlign: "right" }}>
                  {wizard.messagesPerMinute}/min
                </strong>
              </div>
            </label>

            <div style={{ background: "#f8fafc", border: "1px solid #dce2d8", borderRadius: 8, padding: 14 }}>
              <strong style={{ display: "block", fontSize: 13, marginBottom: 10 }}>Campaign Summary</strong>
              {([
                ["Name",     wizard.name],
                ["Type",     wizard.type],
                ["Audience", `${wizard.csvRows.length} CSV contacts`],
                ["Rate",     `${wizard.messagesPerMinute} msg/min`],
                ...(wizard.csvRows.length > 0
                  ? [["Est. duration", `~${estimatedMinutes} min`]]
                  : [])
              ] as [string, string][]).map(([k, v]) => (
                <div
                  key={k}
                  style={{
                    display: "flex", justifyContent: "space-between",
                    fontSize: 12, padding: "4px 0",
                    borderBottom: "1px solid #e2e8f0"
                  }}
                >
                  <span style={{ color: "#697567" }}>{k}</span>
                  <span style={{ fontWeight: 600, textTransform: "capitalize" }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Navigation */}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button
            className="secondary-button"
            onClick={() => { setShowWizard(false); setWizard(defaultWizard); }}
          >
            Cancel
          </button>
          {wizardStep > 1 && (
            <button
              className="secondary-button"
              onClick={() => setWizardStep((s) => (s - 1) as WizardStep)}
            >
              Back
            </button>
          )}
          <div style={{ flex: 1 }} />
          {wizardStep < 3 ? (
            <button
              className="primary-button"
              disabled={
                (wizardStep === 1 && (!wizard.name || wizard.csvRows.length === 0)) ||
                (wizardStep === 2 && !wizard.messageBody)
              }
              onClick={() => setWizardStep((s) => (s + 1) as WizardStep)}
            >
              Next →
            </button>
          ) : (
            <button
              className="primary-button"
              disabled={isSubmitting}
              onClick={handleSubmit}
            >
              {isSubmitting
                ? "Creating…"
                : editingId
                ? "Save Changes"
                : wizard.sendNow
                ? "Create & Send"
                : "Create Campaign"}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  // ─── Detail panel ─────────────────────────────────────────────────────────

  const renderDetailPanel = (c: CampaignDTO) => {
    const p = c.progress;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <div>
            <strong style={{ display: "block", fontSize: 15 }}>{c.name}</strong>
            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              <StatusBadge status={c.status} />
              <TypePill type={c.type} />
            </div>
          </div>
          <button
            className="secondary-button"
            style={{ fontSize: 12, padding: "2px 8px", minHeight: 28, flexShrink: 0 }}
            onClick={() => setSelectedCampaignId(null)}
          >
            Close
          </button>
        </div>

        {/* Progress */}
        <div style={{ background: "#f8fafc", border: "1px solid #dce2d8", borderRadius: 8, padding: 12 }}>
          <strong style={{ display: "block", fontSize: 13, marginBottom: 8 }}>Progress</strong>
          <ProgressBar progress={p} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginTop: 10 }}>
            {[
              { label: "Total",     value: p.total,     color: "#1f261f" },
              { label: "Sent",      value: p.sent,      color: "#1e6b57" },
              { label: "Delivered", value: p.delivered, color: "#0d9488" },
              { label: "Read",      value: p.read,      color: "#7c3aed" },
              { label: "Replied",   value: p.replied,   color: "#15803d" },
              { label: "Failed",    value: p.failed,    color: "#dc2626" },
              { label: "Skipped",   value: p.skipped,   color: "#9ca3af" }
            ].map((s) => (
              <div key={s.label} style={{ textAlign: "center" }}>
                <strong style={{ display: "block", fontSize: 18, color: s.color }}>{s.value}</strong>
                <span style={{ fontSize: 10, color: "#697567" }}>{s.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recipients */}
        {recipients.length > 0 ? (
          <div>
            <p style={{ margin: "0 0 8px", fontWeight: 600, fontSize: 13 }}>
              Recipients{" "}
              <span style={{ color: "#697567", fontWeight: 400 }}>({recipientsTotal})</span>
            </p>
            <div style={{ maxHeight: 200, overflowY: "auto", border: "1px solid #e1e7dd", borderRadius: 8, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e1e7dd" }}>
                    {["Phone", "Name", "Status"].map((h) => (
                      <th key={h} style={{ padding: "6px 10px", textAlign: "left", fontWeight: 600, color: "#697567", fontSize: 11 }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recipients.map((r) => (
                    <tr key={r.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "6px 10px" }}>{r.phone}</td>
                      <td style={{ padding: "6px 10px", color: "#697567" }}>{r.name ?? "–"}</td>
                      <td style={{ padding: "6px 10px" }}>
                        <StatusBadge status={r.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p style={{ fontSize: 12, color: "#697567", margin: 0 }}>No recipients loaded yet.</p>
        )}
      </div>
    );
  };

  // ─── Page layout ──────────────────────────────────────────────────────────

  return (
    <div className="page-grid">
      {showWizard && renderWizard()}

      {/* Overview metrics */}
      <section className="panel span-3">
        <div className="metrics">
          <Metric label="Total Campaigns" value={totalCampaigns} />
          <Metric label="Active" value={activeCampaigns} />
          <Metric label="Scheduled" value={scheduledCampaigns} />
          <Metric label="Completed" value={completedCampaigns} />
        </div>
      </section>

      {/* Campaign list */}
      <section className={`panel ${selectedCampaign ? "span-2" : "span-3"}`}>
        <SectionTitle
          title="Campaigns"
          action={auth.canManage ? "+ New Campaign" : undefined}
          onClick={() => openWizard()}
        />

        {isLoading ? (
          <p style={{ color: "#697567", fontSize: 13 }}>Loading…</p>
        ) : campaigns.length === 0 ? (
          <Empty text="No campaigns yet. Create your first campaign to get started." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
            {campaigns.map((c) => {
              const selected = selectedCampaignId === c.id;
              return (
                <div
                  key={c.id}
                  onClick={() => handleSelectCampaign(c.id)}
                  style={{
                    borderRadius: 8,
                    padding: "12px 14px",
                    cursor: "pointer",
                    border: selected ? "1px solid #1e6b57" : "1px solid #e1e7dd",
                    borderLeft: selected ? "4px solid #1e6b57" : "1px solid #e1e7dd",
                    background: selected ? "#eef6f0" : "#fff"
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ fontSize: 14, display: "block" }}>{c.name}</strong>
                      <div style={{ display: "flex", gap: 6, marginTop: 5, flexWrap: "wrap" }}>
                        <StatusBadge status={c.status} />
                        <TypePill type={c.type} />
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                      {auth.canManage && c.status === "draft" && (
                        <>
                          <button
                            className="primary-button"
                            style={{ padding: "2px 10px", fontSize: 12, minHeight: 28 }}
                            onClick={(e) => { e.stopPropagation(); launchCampaign(c.id); }}
                          >
                            Launch
                          </button>
                          <button
                            className="secondary-button"
                            style={{ padding: "2px 10px", fontSize: 12, minHeight: 28 }}
                            onClick={(e) => { e.stopPropagation(); openWizard(c); }}
                          >
                            Edit
                          </button>
                          <button
                            className="secondary-button"
                            style={{ padding: "2px 10px", fontSize: 12, minHeight: 28, color: "#dc2626" }}
                            onClick={(e) => { e.stopPropagation(); if (confirm("Delete this campaign?")) deleteCampaign(c.id); }}
                          >
                            Delete
                          </button>
                        </>
                      )}
                      {auth.canManage && c.status === "scheduled" && (
                        <button
                          className="secondary-button"
                          style={{ padding: "2px 10px", fontSize: 12, minHeight: 28 }}
                          onClick={(e) => { e.stopPropagation(); cancelCampaign(c.id); }}
                        >
                          Cancel
                        </button>
                      )}
                      {auth.canManage && c.status === "running" && (
                        <button
                          className="secondary-button"
                          style={{ padding: "2px 10px", fontSize: 12, minHeight: 28 }}
                          onClick={(e) => { e.stopPropagation(); pauseCampaign(c.id); }}
                        >
                          Pause
                        </button>
                      )}
                      {auth.canManage && c.status === "paused" && (
                        <button
                          className="primary-button"
                          style={{ padding: "2px 10px", fontSize: 12, minHeight: 28 }}
                          onClick={(e) => { e.stopPropagation(); launchCampaign(c.id); }}
                        >
                          Resume
                        </button>
                      )}
                    </div>
                  </div>

                  {c.progress.total > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <ProgressBar progress={c.progress} />
                      <span style={{ display: "block", fontSize: 11, color: "#697567", marginTop: 3 }}>
                        {c.progress.sent} / {c.progress.total} sent · {c.progress.replied} replied
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Detail panel */}
      {selectedCampaign && (
        <section className="panel">
          {renderDetailPanel(selectedCampaign)}
        </section>
      )}
    </div>
  );
}
