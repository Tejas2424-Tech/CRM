import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/auth.js";
import { Campaign, CampaignRecipient } from "../models/Campaign.js";
import { Template } from "../models/Template.js";
import { audit } from "../services/audit.js";
import { enqueueCampaign } from "../services/campaigns.js";
import { serializeCampaign } from "../services/serializers.js";
import { emitRealtime } from "../config/realtime.js";

export const campaignsRouter = Router();

campaignsRouter.use(requireAuth);

campaignsRouter.post("/", requireRole("admin", "manager"), async (req, res) => {
  const schema = z.object({
    name: z.string().min(2),
    templateId: z.string(),
    audienceQuery: z.record(z.string(), z.unknown()).default({}),
    scheduledAt: z.string().datetime().optional()
  });
  const body = schema.parse(req.body);
  const template = await Template.findById(body.templateId);
  if (!template?.approved) return res.status(400).json({ error: "Only approved templates can be used for campaigns" });

  const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : undefined;
  const campaign = await Campaign.create({
    name: body.name,
    templateId: template._id,
    audienceQuery: body.audienceQuery,
    scheduledAt,
    status: scheduledAt && scheduledAt > new Date() ? "scheduled" : "running",
    createdBy: req.user!.id
  });
  await enqueueCampaign(campaign._id.toString(), scheduledAt ? Math.max(0, scheduledAt.getTime() - Date.now()) : 0);
  await audit(req.user!.id, "campaign.create", "Campaign", campaign._id.toString(), undefined, serializeCampaign(campaign));
  emitRealtime("campaign.updated", serializeCampaign(campaign));
  res.status(201).json(serializeCampaign(campaign));
});

campaignsRouter.get("/:id/stats", requireRole("admin", "manager"), async (req, res) => {
  const recipients = await CampaignRecipient.aggregate([
    { $match: { campaignId: new Types.ObjectId(String(req.params.id)) } },
    { $group: { _id: "$status", count: { $sum: 1 } } }
  ]);
  const stats = { queued: 0, sent: 0, delivered: 0, read: 0, failed: 0 };
  for (const row of recipients) stats[row._id as keyof typeof stats] = row.count;
  res.json(stats);
});

campaignsRouter.get("/", requireRole("admin", "manager"), async (_req, res) => {
  const campaigns = await Campaign.find().sort({ createdAt: -1 }).limit(100);
  res.json(campaigns.map(serializeCampaign));
});
