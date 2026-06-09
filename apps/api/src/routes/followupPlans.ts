import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/auth.js";
import { FollowupEnrollment } from "../models/FollowupEnrollment.js";
import { FollowupPlan } from "../models/FollowupPlan.js";
import { audit } from "../services/audit.js";
import { enroll, getEnrollmentForLead, stopEnrollment } from "../services/followup.js";
import { serializeEnrollment, serializeFollowupPlan } from "../services/serializers.js";

export const followupPlansRouter = Router();

followupPlansRouter.use(requireAuth);

// ─── Plans CRUD ───────────────────────────────────────────────────────────────

followupPlansRouter.get("/", async (_req, res) => {
  const plans = await FollowupPlan.find().sort({ isDefault: -1, name: 1 });
  res.json(plans.map(serializeFollowupPlan));
});

followupPlansRouter.post("/", requireRole("admin", "manager"), async (req, res) => {
  const stepSchema = z.object({
    label: z.string().min(1),
    enabled: z.boolean().default(true),
    messageBody: z.string().min(1),
    delayHours: z.number().int().min(1).max(720)
  });

  const schema = z.object({
    name: z.string().min(1).max(100),
    welcomeMessage: z.string().min(1),
    steps: z.array(stepSchema).max(2).default([]),
    isDefault: z.boolean().default(false),
    assignTo: z.string().optional()
  });

  const body = schema.parse(req.body);

  if (body.isDefault) {
    await FollowupPlan.updateMany({ isDefault: true }, { $set: { isDefault: false } });
  }

  const plan = await FollowupPlan.create({ ...body, createdBy: req.user!.id });

  await audit(
    req.user!.id,
    "followup.plan_created",
    "FollowupPlan",
    plan._id.toString(),
    undefined,
    serializeFollowupPlan(plan)
  );

  res.status(201).json(serializeFollowupPlan(plan));
});

followupPlansRouter.get("/:id", async (req, res) => {
  const plan = await FollowupPlan.findById(req.params.id);
  if (!plan) return res.status(404).json({ error: "Plan not found" });
  res.json(serializeFollowupPlan(plan));
});

followupPlansRouter.patch("/:id", requireRole("admin", "manager"), async (req, res) => {
  const stepSchema = z.object({
    label: z.string().min(1),
    enabled: z.boolean().default(true),
    messageBody: z.string().min(1),
    delayHours: z.number().int().min(1).max(720)
  });

  const schema = z.object({
    name: z.string().min(1).max(100).optional(),
    welcomeMessage: z.string().min(1).optional(),
    steps: z.array(stepSchema).max(2).optional(),
    isDefault: z.boolean().optional(),
    assignTo: z.string().nullable().optional()
  });

  const body = schema.parse(req.body);
  const before = await FollowupPlan.findById(req.params.id);
  if (!before) return res.status(404).json({ error: "Plan not found" });

  if (body.isDefault === true) {
    await FollowupPlan.updateMany(
      { _id: { $ne: req.params.id }, isDefault: true },
      { $set: { isDefault: false } }
    );
  }

  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.welcomeMessage !== undefined) update.welcomeMessage = body.welcomeMessage;
  if (body.steps !== undefined) update.steps = body.steps;
  if (body.isDefault !== undefined) update.isDefault = body.isDefault;
  if (body.assignTo !== undefined) update.assignTo = body.assignTo ?? undefined;

  const plan = await FollowupPlan.findByIdAndUpdate(
    req.params.id,
    { $set: update },
    { new: true }
  );
  if (!plan) return res.status(404).json({ error: "Plan not found" });

  await audit(
    req.user!.id,
    "followup.plan_updated",
    "FollowupPlan",
    plan._id.toString(),
    serializeFollowupPlan(before),
    serializeFollowupPlan(plan)
  );

  res.json(serializeFollowupPlan(plan));
});

followupPlansRouter.delete("/:id", requireRole("admin"), async (req, res) => {
  const planId = req.params.id as string;
  const plan = await FollowupPlan.findByIdAndDelete(planId);
  if (!plan) return res.status(404).json({ error: "Plan not found" });
  await audit(
    req.user!.id,
    "followup.plan_deleted",
    "FollowupPlan",
    planId,
    serializeFollowupPlan(plan),
    undefined
  );
  res.json({ success: true });
});

// ─── Enrollments ──────────────────────────────────────────────────────────────

followupPlansRouter.post("/enrollments", requireRole("admin", "manager"), async (req, res) => {
  const schema = z.object({
    leadId: z.string().min(1),
    planId: z.string().min(1)
  });
  const { leadId, planId } = schema.parse(req.body);
  try {
    const enrollment = await enroll(leadId, planId, req.user!.id);
    res.status(201).json(serializeEnrollment(enrollment as any));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

followupPlansRouter.get("/enrollments/lead/:leadId", async (req, res) => {
  const leadId = req.params.leadId as string;
  const enrollment = await getEnrollmentForLead(leadId);
  if (!enrollment) return res.json(null);
  res.json(serializeEnrollment(enrollment as any));
});

followupPlansRouter.post(
  "/enrollments/lead/:leadId/stop",
  requireRole("admin", "manager"),
  async (req, res) => {
    const leadId = req.params.leadId as string;
    try {
      await stopEnrollment(leadId, req.user!.id, "manual");
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

followupPlansRouter.get("/enrollments/lead/:leadId/history", async (req, res) => {
  const leadId = req.params.leadId as string;
  const enrollments = await FollowupEnrollment.find({ leadId })
    .sort({ enrolledAt: -1 })
    .limit(10);
  res.json(enrollments.map((e) => serializeEnrollment(e as any)));
});
