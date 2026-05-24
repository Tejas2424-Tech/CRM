import { useMemo } from "react";
import { Empty, LeadLine, Metric, SectionTitle, SkeletonLine, SkeletonMetric, StageMeter, TaskLine } from "../../components";
import { percent, stageLabels, stages } from "../../utils";
import { useCrm } from "../../context/CrmContext";

type View = string;

interface Props {
  setView: (view: View) => void;
}

export function Dashboard({ setView }: Props) {
  const { leads: { leads, isLeadsLoading: isLoading }, tasks: { tasks }, auth: { agents, canManage: canViewAnalytics }, analytics: { analytics, isAnalyticsLoading } } = useCrm();
  // ── Memoised derived values — never recalculate on unrelated re-renders ──
  const openTasks   = useMemo(() => tasks.filter((t) => t.status === "pending"), [tasks]);
  const unreadCount = useMemo(() => leads.reduce((s, l) => s + l.unreadCount, 0), [leads]);
  const wonCount    = useMemo(() => leads.filter((l) => l.status === "won").length, [leads]);
  const convRate    = useMemo(() => `${percent(wonCount, Math.max(leads.length, 1))}%`, [wonCount, leads.length]);
  const stageCounts = useMemo(
    () => Object.fromEntries(stages.map((s) => [s, leads.filter((l) => l.status === s).length])),
    [leads]
  );

  return (
    <div className="page-grid">
      {/* ── KPI row ───────────────────────────────────────────────────────── */}
      <div className="metrics">
        {isLoading ? (
          [0, 1, 2, 3].map((i) => <SkeletonMetric key={i} />)
        ) : (
          <>
            <Metric label="Total leads"        value={leads.length} />
            <Metric label="Unread chats"       value={unreadCount} />
            <Metric label="Pending follow-ups" value={openTasks.length} />
            <Metric label="Conversion rate"    value={convRate} />
          </>
        )}
      </div>

      {/* ── Activity list ─────────────────────────────────────────────────── */}
      <section className="panel span-2">
        <SectionTitle title="Today" action="Open inbox" onClick={() => setView("inbox")} />
        <div className="activity-list">
          {isLoading
            ? [0, 1, 2, 3, 4, 5].map((i) => <SkeletonLine key={i} />)
            : leads.length
              ? leads.slice(0, 6).map((lead) => <LeadLine key={lead.id} lead={lead} agents={agents} />)
              : <Empty text="No WhatsApp leads yet. Send a webhook event to create the first conversation." />
          }
        </div>
      </section>

      {/* ── Pipeline breakdown ────────────────────────────────────────────── */}
      <section className="panel">
        <SectionTitle title="Pipeline" />
        <div className="stage-stack">
          {stages.map((stage) => (
            <StageMeter
              key={stage}
              label={stageLabels[stage]}
              count={stageCounts[stage] ?? 0}
              total={leads.length}
            />
          ))}
        </div>
      </section>

      {/* ── Follow-ups ────────────────────────────────────────────────────── */}
      <section className="panel span-2">
        <SectionTitle title="Follow-ups" action="View tasks" onClick={() => setView("tasks")} />
        {isLoading
          ? [0, 1, 2].map((i) => <SkeletonLine key={i} />)
          : openTasks.length
            ? openTasks.slice(0, 6).map((task) => <TaskLine key={task.id} task={task} leads={leads} agents={agents} />)
            : <Empty text="No pending reminders." />
        }
      </section>

      {/* ── Message Health — visible to managers/admins only ──────────────── */}
      {canViewAnalytics && (
        <section className="panel">
          <SectionTitle title="Message Health" />
          <div className="mini-stats">
            {isAnalyticsLoading
              ? [0, 1].map((i) => <SkeletonMetric key={i} />)
              : <>
                  <Metric label="Inbound"  value={analytics?.inboundMessages  ?? 0} />
                  <Metric label="Outbound" value={analytics?.outboundMessages ?? 0} />
                </>
            }
          </div>
        </section>
      )}
    </div>
  );
}
