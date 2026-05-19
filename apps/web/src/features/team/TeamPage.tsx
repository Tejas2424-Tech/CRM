import type { AgentDTO, LeadDTO } from "@crm/shared";
import { Plus } from "lucide-react";
import { SectionTitle } from "../../components";
import { initials } from "../../utils";

interface Props {
  agents: AgentDTO[];
  leads: LeadDTO[];
  form: { name: string; email: string; role: AgentDTO["role"]; capacity: number };
  setForm: (f: { name: string; email: string; role: AgentDTO["role"]; capacity: number }) => void;
  createUser: () => void;
  canAdmin: boolean;
}

export function TeamPage({ agents, leads, form, setForm, createUser, canAdmin }: Props) {
  return (
    <div className="page-grid">
      <section className="panel span-3">
        <SectionTitle title="Team Management" />
        {canAdmin && (
          <div className="form-row">
            <input className="input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="input" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as AgentDTO["role"] })}>
              <option value="agent">Agent</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </select>
            <button className="primary-button" onClick={createUser}><Plus size={16} /> User</button>
          </div>
        )}
        <div className="team-grid">
          {agents.map((agent) => (
            <article className="team-card" key={agent.id}>
              <span className="avatar">{initials(agent.name)}</span>
              <strong>{agent.name}</strong>
              <small>{agent.email}</small>
              <span className="chip">{agent.role}</span>
              <p>{leads.filter((l) => l.assignedTo === agent.id).length} assigned leads</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
