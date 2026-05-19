import { Router } from "express";
import { requireAuth } from "../auth/auth.js";
import { Conversation } from "../models/Conversation.js";

export const conversationsRouter = Router();

conversationsRouter.use(requireAuth);

conversationsRouter.get("/", async (req, res) => {
  const conversations = await Conversation.find()
    .populate("leadId")
    .sort({ updatedAt: -1 })
    .limit(100);
  res.json(conversations);
});
