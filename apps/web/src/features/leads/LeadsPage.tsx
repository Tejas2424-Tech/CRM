import type { AgentDTO, LeadDTO } from "@crm/shared";
import { Plus } from "lucide-react";
import { LeadAvatar, SectionTitle, agentName, formatPhone, stageLabels } from "../../components";

import { useCrm } from "../../context/CrmContext";

interface Props {
  openLead: (id: string) => void;
}

export function LeadsPage({ openLead }: Props) {
  const { leads: { leads, leadForm: form, setLeadForm: setForm, createLead }, auth: { agents, canManage } } = useCrm();
  return (
    <div className="page-grid">
      <section className="panel span-3">
        <SectionTitle title="Contacts and Leads" />
        {canManage && (
          <div className="form-row">
            <input className="input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="input" placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <input className="input" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <button className="primary-button" onClick={createLead}><Plus size={16} /> Lead</button>
          </div>
        )}
        <div className="data-table">
          {leads.map((lead) => (
            <button key={lead.id} onClick={() => openLead(lead.id)}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <LeadAvatar lead={lead} size={24} />
                {lead.displayName !== lead.phone ? lead.displayName : formatPhone(lead.phone)}
              </span>
              <span>{formatPhone(lead.phone)}</span>
              <span>{stageLabels[lead.status]}</span>
              <span>{agentName(agents, lead.assignedTo)}</span>
              <span>{lead.lastActivity ? new Date(lead.lastActivity).toLocaleDateString() : ""}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
