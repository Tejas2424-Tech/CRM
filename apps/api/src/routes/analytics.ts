import { Router } from "express";
import { requireAuth, requireRole } from "../auth/auth.js";
import { Lead } from "../models/Lead.js";
import { Message } from "../models/Message.js";

export const analyticsRouter = Router();

analyticsRouter.use(requireAuth, requireRole("admin", "manager"));

analyticsRouter.get("/summary", async (_req, res) => {
  const [leadCount, optedInLeads, inboundMessages, outboundMessages] = await Promise.all([
    Lead.countDocuments(),
    Lead.countDocuments({ "consent.optedIn": true }),
    Message.countDocuments({ direction: "in" }),
    Message.countDocuments({ direction: "out" }),
  ]);
  res.json({ leadCount, optedInLeads, inboundMessages, outboundMessages });
});
