import type { HydratedDocument } from "mongoose";
import { emitRealtime } from "../config/realtime.js";
import { FollowupEnrollment } from "../models/FollowupEnrollment.js";
import type { EnrollmentStep, FollowupEnrollmentDocument } from "../models/FollowupEnrollment.js";
import { FollowupPlan } from "../models/FollowupPlan.js";
import { Lead } from "../models/Lead.js";
import { Message } from "../models/Message.js";
import { ProcessedEvent } from "../models/ProcessedEvent.js";
import { followupQueue, outboundQueue } from "../queues/jobs.js";
import { audit } from "./audit.js";
import { serializeLead } from "./serializers.js";

// ─── Variable interpolation ───────────────────────────────────────────────────

function interpolate(
  template: string,
  lead: { name?: string; phone: string; tags: string[] }
): string {
  const company =
    lead.tags.find((t) => t.startsWith("company:"))?.slice(8).trim() ?? "";
  return template
    .replace(/\{\{name\}\}/gi, lead.name ?? lead.phone)
    .replace(/\{\{phone\}\}/gi, lead.phone)
    .replace(/\{\{company\}\}/gi, company);
}

// ─── enroll ──────────────────────────────────────────────────────────────────

/**
 * Enroll a lead in a follow-up plan.
 * Idempotent: returns the existing enrollment if one is already active.
 */
export async function enroll(
  leadId: string,
  planId: string,
  actorId: string
): Promise<FollowupEnrollmentDocument> {
  const existing = await FollowupEnrollment.findOne({ leadId, status: "active" });
  if (existing) return existing;

  const [lead, plan] = await Promise.all([
    Lead.findById(leadId),
    FollowupPlan.findById(planId)
  ]);
  if (!lead) throw new Error(`Lead ${leadId} not found`);
  if (!plan) throw new Error(`FollowupPlan ${planId} not found`);
  if (!lead.consent.optedIn) throw new Error("Lead has not opted in");

  const now = new Date();
  const enabledSteps = plan.steps.filter((s) => s.enabled);

  const steps: EnrollmentStep[] = [
    { stepIndex: -1, label: "welcome", scheduledAt: now, status: "pending" }
  ];

  let cumulativeMs = 0;
  for (let i = 0; i < enabledSteps.length; i++) {
    cumulativeMs += enabledSteps[i].delayHours * 60 * 60 * 1000;
    steps.push({
      stepIndex: i,
      label: enabledSteps[i].label,
      scheduledAt: new Date(now.getTime() + cumulativeMs),
      status: "pending"
    });
  }

  let enrollment: HydratedDocument<FollowupEnrollmentDocument>;
  try {
    enrollment = await FollowupEnrollment.create({
      leadId,
      planId,
      status: "active",
      enrolledAt: now,
      steps,
      scheduledJobIds: []
    });
    console.log(`[Followup] Enrolled lead ${leadId} in plan ${planId} → enrollment ${enrollment._id}`);
  } catch (err: any) {
    if (err?.code === 11000) {
      const race = await FollowupEnrollment.findOne({ leadId, status: "active" });
      if (race) {
        console.log(`[Followup] Concurrent enroll() for lead ${leadId} — returning existing enrollment ${race._id}`);
        return race;
      }
    }
    throw err;
  }

  const jobIds: string[] = [];

  const welcomeJob = await followupQueue.add(
    "followup-step",
    { enrollmentId: enrollment._id.toString(), stepIndex: -1 },
    { delay: 1000, attempts: 3, backoff: { type: "exponential", delay: 5000 } }
  );
  jobIds.push(welcomeJob.id!);

  let stepDelay = 0;
  for (let i = 0; i < enabledSteps.length; i++) {
    stepDelay += enabledSteps[i].delayHours * 60 * 60 * 1000;
    const job = await followupQueue.add(
      "followup-step",
      { enrollmentId: enrollment._id.toString(), stepIndex: i },
      { delay: stepDelay + 1000, attempts: 3, backoff: { type: "exponential", delay: 5000 } }
    );
    jobIds.push(job.id!);
  }

  enrollment.scheduledJobIds = jobIds;
  await enrollment.save();

  if (lead.stage === "new" || lead.stage === "contacted") {
    await Lead.findByIdAndUpdate(leadId, { stage: "followup" });
    lead.stage = "followup" as typeof lead.stage;
    emitRealtime("lead:update", serializeLead(lead));
  }

  await audit(
    actorId,
    "followup.enrolled",
    "FollowupEnrollment",
    enrollment._id.toString(),
    undefined,
    { leadId, planId, steps: steps.length }
  );

  return enrollment;
}

// ─── stopEnrollment ──────────────────────────────────────────────────────────

/**
 * Cancel all pending follow-up jobs and mark enrollment stopped.
 * Called from inbound.ts on any customer reply (human handoff).
 */
export async function stopEnrollment(
  leadId: string,
  actorId: string,
  reason: "reply" | "manual" = "manual"
): Promise<void> {
  const enrollment = await FollowupEnrollment.findOneAndUpdate(
    { leadId, status: "active" },
    {
      $set: {
        status: "stopped",
        stoppedAt: new Date(),
        "steps.$[pending].status": "skipped"
      }
    },
    { arrayFilters: [{ "pending.status": "pending" }], new: true }
  );
  if (!enrollment) return;

  const plan = await FollowupPlan.findById(enrollment.planId);

  for (const jobId of enrollment.scheduledJobIds) {
    try {
      const job = await followupQueue.getJob(jobId);
      if (job) await job.remove();
    } catch (err) {
      console.warn(`[Followup] Could not remove job ${jobId}:`, (err as Error).message);
    }
  }

  if (reason === "reply") {
    const updateFields: Record<string, unknown> = { stage: "interested" };
    if (plan?.assignTo) updateFields.assignedTo = plan.assignTo;
    await Lead.findByIdAndUpdate(leadId, updateFields);
    const updated = await Lead.findById(leadId);
    if (updated) emitRealtime("lead:update", serializeLead(updated));
  }

  emitRealtime("followup:stopped", {
    leadId: leadId.toString(),
    enrollmentId: enrollment._id.toString()
  });

  await audit(
    actorId,
    "followup.stopped",
    "FollowupEnrollment",
    enrollment._id.toString(),
    { status: "active" },
    { status: "stopped", reason }
  );
}

// ─── processFollowupStep ──────────────────────────────────────────────────────

/**
 * Executed by the followupQueue worker for each scheduled step.
 * Idempotent via ProcessedEvent mutex.
 */
export async function processFollowupStep(data: {
  enrollmentId: string;
  stepIndex: number;
}): Promise<void> {
  const { enrollmentId, stepIndex } = data;
  const idempotencyKey = `followup:step:${enrollmentId}:${stepIndex}`;

  const existing = await ProcessedEvent.findOneAndUpdate(
    { key: idempotencyKey },
    {
      $setOnInsert: {
        key: idempotencyKey,
        type: "followup.step",
        status: "processing",
        processedAt: new Date()
      }
    },
    { upsert: true, new: false }
  );

  if (existing?.status === "completed") {
    console.log(`[Followup] Step ${stepIndex}/${enrollmentId} already completed — skipping`);
    return;
  }

  try {
    const enrollment = await FollowupEnrollment.findById(enrollmentId);
    if (!enrollment) {
      console.warn(`[Followup] Enrollment ${enrollmentId} not found`);
      await ProcessedEvent.updateOne({ key: idempotencyKey }, { $set: { status: "completed" } });
      return;
    }

    if (enrollment.status !== "active") {
      console.log(`[Followup] Enrollment ${enrollmentId} is ${enrollment.status} — skipping step ${stepIndex}`);
      await ProcessedEvent.updateOne({ key: idempotencyKey }, { $set: { status: "completed" } });
      return;
    }

    const stepRecord = enrollment.steps.find((s) => s.stepIndex === stepIndex);
    if (!stepRecord || stepRecord.status !== "pending") {
      console.log(`[Followup] Step ${stepIndex} already processed — skipping`);
      await ProcessedEvent.updateOne({ key: idempotencyKey }, { $set: { status: "completed" } });
      return;
    }

    const [lead, plan] = await Promise.all([
      Lead.findById(enrollment.leadId),
      FollowupPlan.findById(enrollment.planId)
    ]);

    if (!lead || !lead.consent.optedIn) {
      console.log(`[Followup] Lead ${enrollment.leadId} opted out — stopping enrollment`);
      await stopEnrollment(enrollment.leadId.toString(), "system", "manual");
      await ProcessedEvent.updateOne({ key: idempotencyKey }, { $set: { status: "completed" } });
      return;
    }

    if (!plan) {
      console.warn(`[Followup] Plan ${enrollment.planId} not found`);
      await ProcessedEvent.updateOne({ key: idempotencyKey }, { $set: { status: "completed" } });
      return;
    }

    let rawBody: string;
    if (stepIndex === -1) {
      rawBody = plan.welcomeMessage;
    } else {
      const enabledSteps = plan.steps.filter((s) => s.enabled);
      if (stepIndex >= enabledSteps.length) {
        console.warn(`[Followup] Step index ${stepIndex} out of bounds for plan ${plan._id}`);
        await ProcessedEvent.updateOne({ key: idempotencyKey }, { $set: { status: "completed" } });
        return;
      }
      rawBody = enabledSteps[stepIndex].messageBody;
    }

    const body = interpolate(rawBody, {
      name: lead.name,
      phone: lead.phone,
      tags: lead.tags
    });

    const message = await Message.create({
      leadId: lead._id,
      direction: "out",
      type: "text",
      content: body,
      status: "queued",
      timestamp: new Date()
    });

    await outboundQueue.add("followup-outbound", { messageId: message._id.toString() });

    stepRecord.status = "sent";
    stepRecord.sentAt = new Date();
    stepRecord.messageId = message._id.toString();

    const remainingPending = enrollment.steps.filter(
      (s) => s.stepIndex !== stepIndex && s.status === "pending"
    );

    if (remainingPending.length === 0) {
      enrollment.status = "completed";
      enrollment.completedAt = new Date();

      // Mark lead as lost if this was the last step and we completed naturally
      await Lead.findByIdAndUpdate(enrollment.leadId, { stage: "lost" });
      const updated = await Lead.findById(enrollment.leadId);
      if (updated) emitRealtime("lead:update", serializeLead(updated));
    }

    await enrollment.save();

    emitRealtime("followup:step_sent", {
      leadId: lead._id.toString(),
      enrollmentId,
      stepIndex,
      enrollmentStatus: enrollment.status
    });

    const auditAction = stepIndex === -1 ? "followup.welcome_sent" : "followup.step_sent";
    await audit("system", auditAction, "FollowupEnrollment", enrollmentId, undefined, {
      stepIndex,
      messageId: message._id.toString()
    });

    if (enrollment.status === "completed") {
      await audit("system", "followup.completed", "FollowupEnrollment", enrollmentId, undefined, {
        leadId: lead._id.toString()
      });
    }

    await ProcessedEvent.updateOne({ key: idempotencyKey }, { $set: { status: "completed" } });
  } catch (error: any) {
    await ProcessedEvent.updateOne(
      { key: idempotencyKey },
      { $set: { status: "failed", lastError: error.message }, $inc: { retries: 1 } }
    );
    throw error;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export async function hasActiveEnrollment(leadId: string): Promise<boolean> {
  return !!(await FollowupEnrollment.findOne({ leadId, status: "active" }));
}

export async function getEnrollmentForLead(
  leadId: string
): Promise<FollowupEnrollmentDocument | null> {
  return FollowupEnrollment.findOne({ leadId, status: "active" }).sort({ enrolledAt: -1 });
}
