import type { AgentDTO, LeadDTO, TaskDTO } from "@crm/shared";
import { api } from "../../api";
import { Empty, LeadLine, Metric, SectionTitle, StageMeter, TaskLine } from "../../components";
import { percent, stageLabels, stages } from "../../utils";

type View = string;

interface Props {
  leads: LeadDTO[];
  tasks: TaskDTO[];
  agents: AgentDTO[];
  analytics?: Awaited<ReturnType<typeof api.analytics>>;
  setView: (view: View) => void;
}

export function Dashboard({ leads, tasks, agents, analytics, setView }: Props) {
  const openTasks = tasks.filter((t) => t.status === "pending");

  return (
    <div className="page-grid">
      <div className="metrics">
        <Metric label="Total leads" value={leads.length} />
        <Metric label="Unread chats" value={leads.reduce((sum, l) => sum + l.unreadCount, 0)} />
        <Metric label="Pending follow-ups" value={openTasks.length} />
        <Metric
          label="Conversion rate"
          value={`${percent(leads.filter((l) => l.status === "won").length, Math.max(leads.length, 1))}%`}
        />
      </div>

      <section className="panel span-2">
        <SectionTitle title="Today" action="Open inbox" onClick={() => setView("inbox")} />
        <div className="activity-list">
          {leads.slice(0, 6).map((lead) => <LeadLine key={lead.id} lead={lead} agents={agents} />)}
          {!leads.length && <Empty text="No WhatsApp leads yet. Send a webhook event to create the first conversation." />}
        </div>
      </section>

      <section className="panel">
        <SectionTitle title="Pipeline" />
        <div className="stage-stack">
          {stages.map((stage) => (
            <StageMeter
              key={stage}
              label={stageLabels[stage]}
              count={leads.filter((l) => l.status === stage).length}
              total={leads.length}
            />
          ))}
        </div>
      </section>

      <section className="panel span-2">
        <SectionTitle title="Follow-ups" action="View tasks" onClick={() => setView("tasks")} />
        {openTasks.slice(0, 6).map((task) => <TaskLine key={task.id} task={task} leads={leads} agents={agents} />)}
        {!openTasks.length && <Empty text="No pending reminders." />}
      </section>

      <section className="panel">
        <SectionTitle title="Message Health" />
        <div className="mini-stats">
          <Metric label="Inbound" value={analytics?.inboundMessages ?? 0} />
          <Metric label="Outbound" value={analytics?.outboundMessages ?? 0} />
        </div>
      </section>
    </div>
  );
}
