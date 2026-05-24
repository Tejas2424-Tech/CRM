import type { AgentDTO, TaskDTO } from "@crm/shared";
import type { Session } from "../../api";
import { Metric, SectionTitle } from "../../components";
import { initials } from "../../utils";

import { useCrm } from "../../context/CrmContext";

export function ProfilePage() {
  const { auth: { currentAgent: user, session }, tasks: { tasks } } = useCrm();
  if (!session) return null;
  return (
    <div className="page-grid">
      <section className="panel">
        <SectionTitle title="Profile" />
        <div className="profile-card">
          <span className="avatar large">{initials(user?.name || session.user.name)}</span>
          <h2>{user?.name || session.user.name}</h2>
          <p>{user?.email}</p>
          <span className="chip">{session.user.role}</span>
        </div>
      </section>
      <section className="panel">
        <SectionTitle title="My Work" />
        <Metric label="Open tasks" value={tasks.filter((t) => t.assignedTo === session.user.id && t.status === "pending").length} />
        <Metric label="Capacity" value={user?.capacity ?? 0} />
      </section>
    </div>
  );
}
