import type { AgentDTO, LeadDTO, LeadStatus } from "@crm/shared";
import { LeadAvatar, agentName, formatPhone, stageLabels } from "../../components";
import { stages } from "../../utils";

import { useCrm } from "../../context/CrmContext";

interface Props {
  openLead: (id: string) => void;
}

export function Pipeline({ openLead }: Props) {
  const { leads: { leads, updateLead }, auth: { agents } } = useCrm();
  return (
    <div className="pipeline">
      {stages.map((stage) => (
        <section className="pipeline-column" key={stage}>
          <h2>{stageLabels[stage]} <span>{leads.filter((l) => l.status === stage).length}</span></h2>
          {leads.filter((l) => l.status === stage).map((lead) => (
            <article className="pipeline-card" key={lead.id} onClick={() => openLead(lead.id)}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <LeadAvatar lead={lead} size={28} />
                <strong>{lead.displayName !== lead.phone ? lead.displayName : formatPhone(lead.phone)}</strong>
              </div>
              {lead.displayName !== lead.phone && <small>{formatPhone(lead.phone)}</small>}
              <div>{lead.tags.map((tag) => <span className="chip" key={tag}>{tag}</span>)}</div>
              <select
                className="input"
                value={lead.status}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => updateLead(lead, { status: e.target.value as LeadStatus })}
              >
                {stages.map((s) => <option key={s} value={s}>{stageLabels[s]}</option>)}
              </select>
              <small>{agentName(agents, lead.assignedTo)}</small>
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}
