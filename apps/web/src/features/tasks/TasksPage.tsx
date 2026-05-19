import type { AgentDTO, LeadDTO, TaskDTO } from "@crm/shared";
import { Clock3 } from "lucide-react";
import { SectionTitle, agentName } from "../../components";
import { leadName } from "../../utils";

interface Props {
  tasks: TaskDTO[];
  leads: LeadDTO[];
  agents: AgentDTO[];
  completeTask: (task: TaskDTO) => void;
  openLead: (id: string) => void;
}

export function TasksPage({ tasks, leads, agents, completeTask, openLead }: Props) {
  return (
    <div className="page-grid">
      <section className="panel span-3">
        <SectionTitle title="Follow-up Engine" />
        {tasks.map((task) => (
          <div className="task-row" key={task.id}>
            <Clock3 size={16} />
            <button onClick={() => openLead(task.leadId)}>{leadName(leads, task.leadId)}</button>
            <strong>{task.title}</strong>
            <span>{new Date(task.dueAt).toLocaleString()}</span>
            <span>{agentName(agents, task.assignedTo)}</span>
            <span className={`status ${task.status}`}>{task.status}</span>
            {task.status === "pending" && (
              <button className="secondary-button" onClick={() => completeTask(task)}>Done</button>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
