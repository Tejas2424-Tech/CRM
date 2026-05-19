import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/auth.js";
import { Task } from "../models/Task.js";
import { serializeTask } from "../services/serializers.js";

export const tasksRouter = Router();

tasksRouter.use(requireAuth);

tasksRouter.get("/", async (req, res) => {
  const filter: Record<string, unknown> = {};
  if (req.user?.role === "agent") filter.assignedTo = req.user.id;
  if (typeof req.query.status === "string" && req.query.status) filter.status = req.query.status;
  const tasks = await Task.find(filter).sort({ dueAt: 1 }).limit(200);
  res.json(tasks.map(serializeTask));
});

tasksRouter.patch("/:id", async (req, res) => {
  // Accept both dueAt (canonical) and dueDate (legacy alias) so old clients
  // don't break during a rolling deployment.
  const schema = z.object({
    status: z.enum(["pending", "done", "missed"]).optional(),
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    dueAt: z.iso.datetime().optional(),
    dueDate: z.iso.datetime().optional(), // backward-compat alias
    assignedTo: z.string().optional()
  });
  const body = schema.parse(req.body);
  const canonicalDue = body.dueAt ?? body.dueDate;
  const update: Record<string, unknown> = {
    ...(body.status !== undefined && { status: body.status }),
    ...(body.title !== undefined && { title: body.title }),
    ...(body.description !== undefined && { description: body.description }),
    ...(body.assignedTo !== undefined && { assignedTo: body.assignedTo }),
    ...(canonicalDue && { dueAt: new Date(canonicalDue) })
  };
  const task = await Task.findByIdAndUpdate(req.params.id, update, { new: true });
  if (!task) return res.status(404).json({ error: "Task not found" });
  res.json(serializeTask(task));
});
