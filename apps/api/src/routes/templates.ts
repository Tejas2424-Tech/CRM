import { Router } from "express";
import { requireAuth } from "../auth/auth.js";
import { Template } from "../models/Template.js";
import { serializeTemplate } from "../services/serializers.js";

export const templatesRouter = Router();

templatesRouter.use(requireAuth);

templatesRouter.get("/", async (_req, res) => {
  const templates = await Template.find({ approved: true }).sort({ name: 1 });
  res.json(templates.map(serializeTemplate));
});
