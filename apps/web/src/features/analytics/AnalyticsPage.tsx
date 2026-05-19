import type { AgentDTO, LeadDTO } from "@crm/shared";
import { api } from "../../api";
import { Metric, SectionTitle, StageMeter } from "../../components";
import { stageLabels, stages } from "../../utils";

interface Props {
  leads: LeadDTO[];
  analytics?: Awaited<ReturnType<typeof api.analytics>>;
  agents: AgentDTO[];
}

export function AnalyticsPage({ leads, analytics, agents }: Props) {
  return (
    <div className="page-grid">
      <div className="metrics span-3">
        <Metric label="Total leads" value={analytics?.leadCount ?? leads.length} />
        <Metric label="Opted in" value={analytics?.optedInLeads ?? 0} />
        <Metric label="Inbound" value={analytics?.inboundMessages ?? 0} />
        <Metric label="Outbound" value={analytics?.outboundMessages ?? 0} />
      </div>
      <section className="panel span-2">
        <SectionTitle title="Agent Leaderboard" />
        {agents.filter((a) => a.role === "agent").map((agent) => (
          <StageMeter
            key={agent.id}
            label={agent.name}
            count={leads.filter((l) => l.assignedTo === agent.id).length}
            total={Math.max(leads.length, 1)}
          />
        ))}
      </section>
      <section className="panel">
        <SectionTitle title="Pipeline Funnel" />
        {stages.map((stage) => (
          <StageMeter
            key={stage}
            label={stageLabels[stage]}
            count={leads.filter((l) => l.status === stage).length}
            total={Math.max(leads.length, 1)}
          />
        ))}
      </section>
    </div>
  );
}
