import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/auth.js";
import { Lead } from "../models/Lead.js";
import { Message } from "../models/Message.js";
import { Note } from "../models/Note.js";
import { Task } from "../models/Task.js";
import { audit } from "../services/audit.js";
import { serializeLead, serializeNote, serializeTask } from "../services/serializers.js";
import { emitRealtime } from "../config/realtime.js";

export const leadsRouter = Router();

leadsRouter.use(requireAuth);

leadsRouter.get("/", async (req, res) => {
  const filter: Record<string, unknown> = {};
  for (const key of ["stage", "source", "assignedTo"] as const) {
    if (typeof req.query[key] === "string" && req.query[key]) filter[key] = req.query[key];
  }
  if (typeof req.query.tag === "string" && req.query.tag) filter.tags = req.query.tag;
  if (typeof req.query.search === "string" && req.query.search) filter.$text = { $search: req.query.search };
  if (req.query.unread === "true") filter.unreadCount = { $gt: 0 };
  if (typeof req.query.lastActivityAfter === "string") filter.lastActivity = { $gte: new Date(req.query.lastActivityAfter) };
  if (req.user?.role === "agent") filter.assignedTo = req.user.id;

  const leads = await Lead.find(filter).sort({ lastActivity: -1 }).limit(200);
  res.json(leads.map(serializeLead));
});

leadsRouter.post("/", requireRole("admin", "manager"), async (req, res) => {
  const schema = z.object({
    phone: z.string().min(4),
    name: z.string().optional(),
    email: z.email().optional(),
    stage: z.enum(["new", "contacted", "interested", "followup", "won", "lost"]).default("new"),
    tags: z.array(z.string()).default([]),
    assignedTo: z.string().optional(),
    source: z.string().default("manual")
  });
  const body = schema.parse(req.body);
  const lead = await Lead.create({ ...body, consent: { optedIn: true, source: "manual" }, lastActivity: new Date() });
  const dto = serializeLead(lead);
  await audit(req.user!.id, "lead.create", "Lead", lead._id.toString(), undefined, dto);
  emitRealtime("lead:update", dto);
  res.status(201).json(dto);
});

leadsRouter.get("/:id", async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  res.json(serializeLead(lead));
});

leadsRouter.patch("/:id", requireRole("admin", "manager", "agent"), async (req, res) => {
  const schema = z.object({
    name: z.string().optional(),
    email: z.email().optional().or(z.literal("")),
    stage: z.enum(["new", "contacted", "interested", "followup", "won", "lost"]).optional(),
    tags: z.array(z.string()).optional(),
    assignedTo: z.string().optional(),
    consent: z.object({ optedIn: z.boolean() }).optional(),
    unreadCount: z.number().optional()
  });
  const body = schema.parse(req.body);
  if (body.assignedTo && req.user?.role === "agent") return res.status(403).json({ error: "Agents cannot assign leads" });

  const before = await Lead.findById(req.params.id);
  if (!before) return res.status(404).json({ error: "Lead not found" });
  const update: Record<string, unknown> = { ...body };
  if (body.consent) update["consent.optedIn"] = body.consent.optedIn;
  delete update.consent;

  const lead = await Lead.findByIdAndUpdate(req.params.id, update, { new: true });
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  await audit(req.user!.id, "lead.update", "Lead", lead._id.toString(), serializeLead(before), serializeLead(lead));
  const dto = serializeLead(lead);
  emitRealtime("lead:update", dto);
  res.json(dto);
});

leadsRouter.delete("/:id", requireRole("admin", "manager"), async (req, res) => {
  const before = await Lead.findById(req.params.id);
  if (!before) return res.status(404).json({ error: "Lead not found" });
  const lead = await Lead.findByIdAndUpdate(req.params.id, { stage: "lost", tags: ["archived"] }, { new: true });
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  await audit(req.user!.id, "lead.delete", "Lead", lead._id.toString(), serializeLead(before), serializeLead(lead));
  res.json(serializeLead(lead));
});

leadsRouter.get("/:id/messages", async (req, res) => {
  const messages = await Message.find({ leadId: req.params.id }).sort({ timestamp: 1 }).limit(500);
  res.json(messages);
});

leadsRouter.get("/:id/notes", async (req, res) => {
  const notes = await Note.find({ leadId: req.params.id }).sort({ createdAt: -1 }).limit(100);
  res.json(notes.map(serializeNote));
});

leadsRouter.post("/:id/notes", async (req, res) => {
  const schema = z.object({ body: z.string().min(1) });
  const body = schema.parse(req.body);
  const note = await Note.create({ leadId: req.params.id, userId: req.user!.id, body: body.body });
  const dto = serializeNote(note);
  emitRealtime("lead:update", await Lead.findById(req.params.id).then((lead) => lead && serializeLead(lead)));
  res.status(201).json(dto);
});

leadsRouter.get("/:id/tasks", async (req, res) => {
  const tasks = await Task.find({ leadId: req.params.id }).sort({ dueDate: 1 }).limit(100);
  res.json(tasks.map(serializeTask));
});

leadsRouter.post("/:id/tasks", async (req, res) => {
  // Accept dueAt (canonical) and legacy dueDate alias so old clients keep working.
  const schema = z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    dueAt: z.iso.datetime().optional(),
    dueDate: z.iso.datetime().optional(), // backward-compat alias
    assignedTo: z.string().optional()
  }).refine((b) => b.dueAt || b.dueDate, { message: "dueAt is required" });
  const body = schema.parse(req.body);
  const canonicalDue = new Date((body.dueAt ?? body.dueDate)!);
  const task = await Task.create({
    leadId: req.params.id,
    title: body.title,
    description: body.description,
    assignedTo: body.assignedTo,
    dueAt: canonicalDue,
    status: "pending"
  });
  const dto = serializeTask(task);
  emitRealtime("task:new", dto);
  res.status(201).json(dto);
});

leadsRouter.get("/:id/activities", async (_req, res) => {
  res.json([]);
});
