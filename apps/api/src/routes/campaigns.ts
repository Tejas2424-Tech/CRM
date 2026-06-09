import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/auth.js";
import { Campaign } from "../models/Campaign.js";
import {
  cancelCampaign,
  createCampaign,
  getCampaignRecipients,
  launchCampaign,
  parseCsv,
  pauseCampaign
} from "../services/campaigns.js";
import { serializeCampaign } from "../services/serializers.js";

export const campaignsRouter = Router();
campaignsRouter.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

const createCampaignSchema = z.object({
  name:              z.string().min(1).max(150),
  description:       z.string().optional(),
  type:              z.enum(["promotional", "marketing", "follow-up", "announcement", "custom"]),
  audienceSource:    z.enum(["crm_filters", "csv"]),
  filters:           z.object({
    stage:      z.string().optional(),
    tags:       z.array(z.string()).optional(),
    assignedTo: z.string().optional(),
    source:     z.string().optional()
  }).optional(),
  messageBody:       z.string().min(1).max(4096),
  sendAt:            z.string().datetime().optional(),
  timezone:          z.string().default("UTC"),
  messagesPerMinute: z.number().int().min(1).max(60).default(10),
  csvRows:           z.array(
    z.object({ phone: z.string(), name: z.string().optional() }).catchall(z.string())
  ).optional()
});

// ─── List campaigns ───────────────────────────────────────────────────────────

campaignsRouter.get("/", async (req, res) => {
  const { status, page = "1", limit = "20" } = req.query as Record<string, string>;
  const query: Record<string, unknown> = {};
  if (status) query.status = status;

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));

  const campaigns = await Campaign.find(query)
    .sort({ createdAt: -1 })
    .skip((pageNum - 1) * limitNum)
    .limit(limitNum);

  res.json(campaigns.map(serializeCampaign));
});

// ─── Create campaign ──────────────────────────────────────────────────────────

campaignsRouter.post("/", requireRole("admin", "manager"), async (req, res) => {
  const body = createCampaignSchema.parse(req.body);

  const csvRows = body.csvRows?.map((r) => {
    const { phone, name, ...rest } = r;
    return {
      phone,
      name: name || undefined,
      customVars: rest as Record<string, string>
    };
  });

  const campaign = await createCampaign({
    name: body.name,
    description: body.description,
    type: body.type,
    audienceSource: body.audienceSource,
    filters: body.filters,
    messageBody: body.messageBody,
    sendAt: body.sendAt ? new Date(body.sendAt) : undefined,
    timezone: body.timezone,
    messagesPerMinute: body.messagesPerMinute,
    csvRows,
    createdBy: req.user!.id
  });

  res.status(201).json(serializeCampaign(campaign));
});

// ─── CSV preview ──────────────────────────────────────────────────────────────

campaignsRouter.post(
  "/csv-preview",
  requireRole("admin", "manager"),
  upload.single("file"),
  (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }
    const { valid, invalid } = parseCsv(req.file.buffer);
    const flatValid = valid.map(({ phone, name, customVars }) => ({
      phone,
      ...(name ? { name } : {}),
      ...customVars,
    }));
    res.json({ valid: flatValid, invalid, total: flatValid.length + invalid.length });
  }
);

// ─── Get single campaign ──────────────────────────────────────────────────────

campaignsRouter.get("/:id", async (req, res) => {
  const campaign = await Campaign.findById(req.params.id);
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  res.json(serializeCampaign(campaign));
});

// ─── Update campaign (draft only) ────────────────────────────────────────────

campaignsRouter.patch("/:id", requireRole("admin", "manager"), async (req, res) => {
  const campaign = await Campaign.findById(req.params.id);
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  if (campaign.status !== "draft") {
    res.status(409).json({ error: "Can only edit campaigns in draft status" });
    return;
  }

  const patchSchema = z.object({
    name:              z.string().min(1).max(150).optional(),
    description:       z.string().optional(),
    type:              z.enum(["promotional", "marketing", "follow-up", "announcement", "custom"]).optional(),
    messageBody:       z.string().min(1).max(4096).optional(),
    sendAt:            z.string().datetime().nullable().optional(),
    timezone:          z.string().optional(),
    messagesPerMinute: z.number().int().min(1).max(60).optional(),
    filters:           z.object({
      stage:      z.string().optional(),
      tags:       z.array(z.string()).optional(),
      assignedTo: z.string().optional(),
      source:     z.string().optional()
    }).optional()
  });

  const updates = patchSchema.parse(req.body);
  Object.assign(campaign, updates);
  if (updates.sendAt === null) campaign.sendAt = undefined;
  else if (updates.sendAt) campaign.sendAt = new Date(updates.sendAt);
  await campaign.save();

  res.json(serializeCampaign(campaign));
});

// ─── Delete campaign ──────────────────────────────────────────────────────────

campaignsRouter.delete("/:id", requireRole("admin", "manager"), async (req, res) => {
  const campaign = await Campaign.findById(req.params.id);
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  if (!["draft", "cancelled"].includes(campaign.status)) {
    res.status(409).json({ error: "Can only delete draft or cancelled campaigns" });
    return;
  }
  await campaign.deleteOne();
  res.json({ success: true });
});

// ─── Launch campaign ──────────────────────────────────────────────────────────

campaignsRouter.post("/:id/launch", requireRole("admin", "manager"), async (req, res) => {
  const id = req.params.id as string;
  const campaign = await launchCampaign(id, req.user!.id);
  res.json(serializeCampaign(campaign));
});

// ─── Pause campaign ───────────────────────────────────────────────────────────

campaignsRouter.post("/:id/pause", requireRole("admin", "manager"), async (req, res) => {
  const id = req.params.id as string;
  const campaign = await pauseCampaign(id, req.user!.id);
  res.json(serializeCampaign(campaign));
});

// ─── Cancel campaign ──────────────────────────────────────────────────────────

campaignsRouter.post("/:id/cancel", requireRole("admin", "manager"), async (req, res) => {
  const id = req.params.id as string;
  const campaign = await cancelCampaign(id, req.user!.id);
  res.json(serializeCampaign(campaign));
});

// ─── Get campaign recipients ──────────────────────────────────────────────────

campaignsRouter.get("/:id/recipients", async (req, res) => {
  const campaign = await Campaign.findById(req.params.id);
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  const { status, page = "1", limit = "50" } = req.query as Record<string, string>;
  const result = await getCampaignRecipients(
    req.params.id,
    status,
    parseInt(page),
    parseInt(limit)
  );
  res.json(result);
});
