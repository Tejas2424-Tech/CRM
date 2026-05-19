import { Router } from "express";
import { requireAuth, requireRole } from "../auth/auth.js";
import { CampaignRecipient } from "../models/Campaign.js";
import { Lead } from "../models/Lead.js";
import { Message } from "../models/Message.js";

export const analyticsRouter = Router();

analyticsRouter.use(requireAuth, requireRole("admin", "manager"));

analyticsRouter.get("/summary", async (_req, res) => {
  const [leadCount, optedInLeads, inboundMessages, outboundMessages, campaignStats] = await Promise.all([
    Lead.countDocuments(),
    Lead.countDocuments({ "consent.optedIn": true }),
    Message.countDocuments({ direction: "in" }),
    Message.countDocuments({ direction: "out" }),
    CampaignRecipient.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }])
  ]);
  const delivery = { queued: 0, sent: 0, delivered: 0, read: 0, failed: 0 };
  for (const row of campaignStats) delivery[row._id as keyof typeof delivery] = row.count;
  res.json({ leadCount, optedInLeads, inboundMessages, outboundMessages, delivery });
});
