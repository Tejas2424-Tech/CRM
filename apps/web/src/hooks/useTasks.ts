import { useCallback, useEffect, useMemo, useState } from "react";
import type { TaskDTO } from "@crm/shared";
import { api, type Session } from "../api";
import { uniqueById } from "../utils";
import type { FilterState } from "./useLeads";

export function useTasks(session: Session | undefined, filters: FilterState, selectedLeadId: string | undefined) {
  const [tasks, setTasks] = useState<TaskDTO[]>([]);
  const [taskForm, setTaskForm] = useState({ title: "", dueAt: "", assignedTo: "" });
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!session) return;
    api
      .tasks(session.token)
      .then(setTasks)
      .catch(() => undefined);
  }, [session, filters]); // Re-fetch on global filters if needed, though tasks currently uses global state

  useEffect(() => {
    if (!session || !selectedLeadId) return;
    api
      .leadTasks(session.token, selectedLeadId)
      .then((items) => {
        setTasks((all) => uniqueById([...items, ...all.filter((t) => t.leadId !== selectedLeadId)]));
      })
      .catch(() => undefined);
  }, [session, selectedLeadId]);

  const createTask = useCallback(
    async (leadId: string | undefined, defaultAssignedTo: string | undefined) => {
      if (!session || !leadId || !taskForm.title || !taskForm.dueAt) return;
      try {
        const task = await api.createTask(session.token, leadId, {
          title: taskForm.title,
          dueAt: new Date(taskForm.dueAt).toISOString(),
          assignedTo: taskForm.assignedTo || defaultAssignedTo,
        });
        setTasks((items) => uniqueById([task, ...items]));
        setTaskForm({ title: "", dueAt: "", assignedTo: "" });
      } catch (err: any) {
        setError(err.message);
      }
    },
    [session, taskForm]
  );

  const completeTask = useCallback(
    async (task: TaskDTO) => {
      if (!session) return;
      try {
        const updated = await api.updateTask(session.token, task.id, { status: "done" });
        setTasks((items) => items.map((i) => (i.id === updated.id ? updated : i)));
      } catch (err: any) {
        setError(err.message);
      }
    },
    [session]
  );

  const socketEvents = useMemo(
    () => [
      {
        event: "task:new",
        handler: (task: any) =>
          setTasks((items) => {
            if (!items.find((i) => i.id === task.id)) return [task as TaskDTO, ...items];
            return items.map((i) => (i.id === task.id ? (task as TaskDTO) : i));
          }),
      },
    ],
    []
  );

  return {
    tasks,
    taskForm,
    setTaskForm,
    createTask,
    completeTask,
    socketEvents,
    error,
    setError,
  };
}
