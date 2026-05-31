import type { AgentDTO } from "@crm/shared";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { SectionTitle } from "../../components";
import { initials } from "../../utils";
import { useCrm } from "../../context/CrmContext";
import { api } from "../../api";

export function TeamPage() {
  const { auth, leads, setGlobalError } = useCrm();
  const [form, setForm] = useState({ name: "", email: "", role: "agent" as AgentDTO["role"], capacity: 30 });

  const createUser = async () => {
    if (!auth.session || !auth.canAdmin || !form.name || !form.email) return;
    try {
      const user = await api.createUser(auth.session.token, form);
      auth.setAgents((items) => {
        const map = new Map();
        [...items, user].forEach(i => map.set(i.id, i));
        return Array.from(map.values());
      });
      setForm({ name: "", email: "", role: "agent", capacity: 30 });
    } catch (err: any) {
      setGlobalError(err.message);
    }
  };

  const changeRole = async (agent: AgentDTO, role: AgentDTO["role"]) => {
    if (!auth.session || !auth.canAdmin || role === agent.role) return;
    try {
      const updated = await api.updateUser(auth.session.token, agent.id, { role });
      auth.setAgents((items) => items.map((i) => (i.id === updated.id ? updated : i)));
    } catch (err: any) {
      setGlobalError(err.message);
    }
  };

  const deleteUser = async (agent: AgentDTO) => {
    if (!auth.session || !auth.canAdmin) return;
    if (!window.confirm(`Are you sure you want to permanently delete user "${agent.name}"?`)) return;
    try {
      await api.deleteUser(auth.session.token, agent.id);
      auth.setAgents((items) => items.filter((i) => i.id !== agent.id));
    } catch (err: any) {
      setGlobalError(err.message);
    }
  };

  return (
    <div className="page-grid">
      <section className="panel span-3">
        <SectionTitle title="Team Management" />
        {auth.canAdmin && (
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
          {auth.agents.map((agent) => (
            <article className="team-card" key={agent.id}>
              <span className="avatar">{initials(agent.name)}</span>
              <strong>{agent.name}</strong>
              <small>{agent.email}</small>
              {auth.canAdmin ? (
                <select
                  className="input"
                  value={agent.role}
                  onChange={(e) => changeRole(agent, e.target.value as AgentDTO["role"])}
                >
                  <option value="agent">Agent</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </select>
              ) : (
                <span className="chip">{agent.role}</span>
              )}
              <p>{leads.leads.filter((l) => l.assignedTo === agent.id).length} assigned leads</p>
              {auth.canAdmin && (
                <button
                  className="icon-button"
                  style={{ color: "var(--danger, #dc2626)", marginTop: 8 }}
                  onClick={() => deleteUser(agent)}
                  title="Delete User"
                >
                  <Trash2 size={16} /> Delete
                </button>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
