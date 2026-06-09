import type { FollowupPlanDTO, FollowupStepDTO } from "@crm/shared";
import { Edit3, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Empty, SectionTitle } from "../../components";
import { useCrm } from "../../context/CrmContext";

// ─── Types ───────────────────────────────────────────────────────────────────

interface StepFormState {
  label: string;
  enabled: boolean;
  messageBody: string;
  delayHours: number;
}

interface PlanFormState {
  name: string;
  welcomeMessage: string;
  isDefault: boolean;
  assignTo: string;
  steps: StepFormState[];
}

const emptyForm = (): PlanFormState => ({
  name: "",
  welcomeMessage: "",
  isDefault: false,
  assignTo: "",
  steps: [
    { label: "follow_up_1", enabled: true, messageBody: "", delayHours: 24 },
    { label: "follow_up_2", enabled: true, messageBody: "", delayHours: 24 },
    { label: "follow_up_3", enabled: true, messageBody: "", delayHours: 24 }
  ]
});

// ─── PlanForm ─────────────────────────────────────────────────────────────────

function PlanForm({
  initial,
  agents,
  onSave,
  onCancel,
  isSaving
}: {
  initial: PlanFormState;
  agents: Array<{ id: string; name: string }>;
  onSave: (form: PlanFormState) => Promise<void>;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [form, setForm] = useState<PlanFormState>(initial);

  const setStep = (index: number, patch: Partial<StepFormState>) => {
    setForm((f) => {
      const steps = [...f.steps];
      steps[index] = { ...steps[index], ...patch };
      return { ...f, steps };
    });
  };

  const varHint = (
    <small style={{ display: "block", color: "#697567", marginBottom: 4 }}>
      Variables: {"{{name}}"}, {"{{phone}}"}, {"{{company}}"}
    </small>
  );

  return (
    <div
      style={{
        border: "1px solid var(--border, #e2e8f0)",
        borderRadius: 8,
        padding: 16,
        marginBottom: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12
      }}
    >
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>Plan Name</span>
        <input
          className="input"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="e.g. Standard Follow-up"
        />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>Welcome Message</span>
        {varHint}
        <textarea
          className="input"
          style={{ minHeight: 80, resize: "vertical" }}
          value={form.welcomeMessage}
          onChange={(e) => setForm((f) => ({ ...f, welcomeMessage: e.target.value }))}
          placeholder="Hi {{name}}, thanks for reaching out! We'll be in touch shortly."
        />
      </label>

      {form.steps.map((step, i) => (
        <div
          key={step.label}
          style={{
            border: "1px solid var(--border, #e2e8f0)",
            borderRadius: 6,
            padding: 12,
            background: step.enabled ? "transparent" : "#f8fafc"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <input
              type="checkbox"
              id={`step-${i}-enabled`}
              checked={step.enabled}
              onChange={(e) => setStep(i, { enabled: e.target.checked })}
            />
            <label
              htmlFor={`step-${i}-enabled`}
              style={{ fontWeight: 600, cursor: "pointer", fontSize: 13 }}
            >
              Follow-up #{i + 1}
            </label>
          </div>

          {step.enabled && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
                <span>Delay (hours after previous message)</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={720}
                  value={step.delayHours}
                  onChange={(e) =>
                    setStep(i, { delayHours: parseInt(e.target.value, 10) || 24 })
                  }
                  style={{ width: 120 }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
                <span>Message Body</span>
                {varHint}
                <textarea
                  className="input"
                  style={{ minHeight: 64, resize: "vertical" }}
                  value={step.messageBody}
                  onChange={(e) => setStep(i, { messageBody: e.target.value })}
                  placeholder={`Hi {{name}}, just following up — do you have any questions?`}
                />
              </label>
            </div>
          )}
        </div>
      ))}

      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
        <input
          type="checkbox"
          checked={form.isDefault}
          onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))}
        />
        <span>Set as default plan (auto-enrolls new leads)</span>
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
        <span>Assign to Agent on Reply (optional)</span>
        <select
          className="input"
          value={form.assignTo}
          onChange={(e) => setForm((f) => ({ ...f, assignTo: e.target.value }))}
        >
          <option value="">No auto-assignment</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          className="primary-button"
          disabled={isSaving || !form.name.trim() || !form.welcomeMessage.trim()}
          onClick={() => onSave(form)}
        >
          {isSaving ? "Saving…" : "Save Plan"}
        </button>
        <button className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── PlanCard ─────────────────────────────────────────────────────────────────

function PlanCard({
  plan,
  onEdit,
  onDelete,
  onSetDefault
}: {
  plan: FollowupPlanDTO;
  onEdit: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--border, #e2e8f0)",
        borderLeft: plan.isDefault ? "4px solid #25d366" : "1px solid var(--border, #e2e8f0)",
        borderRadius: 8,
        padding: 14,
        marginBottom: 12
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 8
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <strong style={{ fontSize: 15 }}>{plan.name}</strong>
          {plan.isDefault && (
            <span
              style={{
                fontSize: 11,
                background: "#dcfce7",
                color: "#166534",
                borderRadius: 4,
                padding: "1px 6px",
                fontWeight: 600
              }}
            >
              DEFAULT
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {!plan.isDefault && (
            <button
              className="secondary-button"
              style={{ fontSize: 11, padding: "2px 8px" }}
              onClick={onSetDefault}
            >
              Set Default
            </button>
          )}
          <button
            className="secondary-button"
            style={{ padding: "4px 8px" }}
            onClick={onEdit}
            title="Edit plan"
          >
            <Edit3 size={14} />
          </button>
          <button
            className="secondary-button"
            style={{ padding: "4px 8px", color: "#ef4444" }}
            onClick={onDelete}
            title="Delete plan"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <p style={{ fontSize: 13, color: "#697567", margin: "0 0 10px" }}>
        <strong>Welcome:</strong>{" "}
        {plan.welcomeMessage.length > 90
          ? `${plan.welcomeMessage.slice(0, 90)}…`
          : plan.welcomeMessage}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {plan.steps.map((step, i) =>
          step.enabled ? (
            <div
              key={step.label}
              style={{
                fontSize: 12,
                padding: "4px 8px",
                borderRadius: 4,
                background: "#f1f5f9",
                display: "flex",
                justifyContent: "space-between"
              }}
            >
              <span style={{ fontWeight: 500 }}>
                Follow-up #{i + 1} — after {step.delayHours}h
              </span>
              <span
                style={{
                  color: "#697567",
                  maxWidth: 220,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                }}
              >
                {step.messageBody.slice(0, 60)}
                {step.messageBody.length > 60 ? "…" : ""}
              </span>
            </div>
          ) : (
            <div
              key={step.label}
              style={{ fontSize: 12, padding: "4px 8px", color: "#9ca3af" }}
            >
              Follow-up #{i + 1} — disabled
            </div>
          )
        )}
        {plan.steps.length === 0 && (
          <p style={{ fontSize: 12, color: "#9ca3af", margin: 0 }}>No follow-up steps configured.</p>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function FollowupPlansPage() {
  const { followupPlans, auth } = useCrm();
  const { plans, isLoading, error, setError, createPlan, updatePlan, deletePlan } = followupPlans;

  const [showForm, setShowForm] = useState(false);
  const [editingPlan, setEditingPlan] = useState<FollowupPlanDTO | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async (form: PlanFormState) => {
    setIsSaving(true);
    try {
      const payload = {
        name: form.name,
        welcomeMessage: form.welcomeMessage,
        steps: form.steps.map(
          (s): FollowupStepDTO => ({
            label: s.label,
            enabled: s.enabled,
            messageBody: s.messageBody,
            delayHours: s.delayHours
          })
        ),
        isDefault: form.isDefault,
        assignTo: form.assignTo || undefined
      };

      if (editingPlan) {
        await updatePlan(editingPlan.id, payload);
      } else {
        await createPlan(payload);
      }
      setShowForm(false);
      setEditingPlan(null);
    } catch {
      // error already surfaced via hook
    } finally {
      setIsSaving(false);
    }
  };

  const handleEdit = (plan: FollowupPlanDTO) => {
    setEditingPlan(plan);
    setShowForm(true);
  };

  const handleDelete = async (plan: FollowupPlanDTO) => {
    if (!window.confirm(`Delete plan "${plan.name}"? This cannot be undone.`)) return;
    await deletePlan(plan.id);
  };

  const handleSetDefault = async (plan: FollowupPlanDTO) => {
    await updatePlan(plan.id, { isDefault: true });
  };

  const initialForm: PlanFormState = editingPlan
    ? {
        name: editingPlan.name,
        welcomeMessage: editingPlan.welcomeMessage,
        isDefault: editingPlan.isDefault,
        assignTo: editingPlan.assignTo ?? "",
        steps:
          editingPlan.steps.length > 0
            ? editingPlan.steps.map((s) => ({ ...s }))
            : emptyForm().steps
      }
    : emptyForm();

  return (
    <div className="page-grid">
      <section className="panel span-3">
        <SectionTitle
          title="Follow-up Plans"
          action={auth.canManage && !showForm ? "New Plan" : undefined}
          onClick={() => {
            setEditingPlan(null);
            setShowForm(true);
          }}
        />

        {error && (
          <div
            style={{
              background: "#fee2e2",
              color: "#991b1b",
              borderRadius: 6,
              padding: "8px 12px",
              marginBottom: 12,
              fontSize: 13,
              cursor: "pointer"
            }}
            onClick={() => setError(undefined)}
          >
            {error}
          </div>
        )}

        {showForm && (
          <PlanForm
            initial={initialForm}
            agents={auth.agents}
            onSave={handleSave}
            onCancel={() => {
              setShowForm(false);
              setEditingPlan(null);
            }}
            isSaving={isSaving}
          />
        )}

        {isLoading ? (
          <p style={{ color: "#697567", padding: 16 }}>Loading plans…</p>
        ) : plans.length === 0 && !showForm ? (
          <Empty text="No follow-up plans yet. Create one to automate your outreach." />
        ) : (
          plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              onEdit={() => handleEdit(plan)}
              onDelete={() => handleDelete(plan)}
              onSetDefault={() => handleSetDefault(plan)}
            />
          ))
        )}

        <div
          style={{
            marginTop: 20,
            padding: 14,
            background: "#f8fafc",
            borderRadius: 8,
            fontSize: 13,
            color: "#697567"
          }}
        >
          <strong style={{ color: "#374151" }}>How it works:</strong>
          <ul style={{ margin: "6px 0 0 16px", lineHeight: 1.7 }}>
            <li>Mark a plan as <strong>Default</strong> to auto-enroll every new lead.</li>
            <li>When a lead replies, follow-ups stop instantly and the lead moves to <strong>Interested</strong>.</li>
            <li>If the lead doesn't reply after all follow-ups, they move to <strong>Lost</strong>.</li>
            <li>Use <strong>{"{{name}}"}</strong>, <strong>{"{{phone}}"}</strong>, <strong>{"{{company}}"}</strong> in messages.</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
