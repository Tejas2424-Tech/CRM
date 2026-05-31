import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/auth.js";
import { User } from "../models/User.js";
import { audit } from "../services/audit.js";
import { serializeUser } from "../services/serializers.js";

export const usersRouter = Router();

usersRouter.use(requireAuth);

usersRouter.get("/", requireRole("admin", "manager"), async (_req, res) => {
  const users = await User.find().sort({ role: 1, name: 1 });
  res.json(users.map(serializeUser));
});

usersRouter.post("/", requireRole("admin"), async (req, res) => {
  const schema = z.object({
    name: z.string().min(2),
    email: z.email(),
    role: z.enum(["admin", "manager", "agent"]),
    capacity: z.number().min(1).default(30)
  });
  const body = schema.parse(req.body);
  const user = await User.create({ ...body, active: true });
  await audit(req.user!.id, "user.create", "User", user._id.toString(), undefined, serializeUser(user));
  res.status(201).json(serializeUser(user));
});

usersRouter.patch("/:id", requireRole("admin"), async (req, res) => {
  const schema = z.object({
    name: z.string().min(2).optional(),
    role: z.enum(["admin", "manager", "agent"]).optional(),
    active: z.boolean().optional(),
    capacity: z.number().min(1).optional()
  });
  const patch = schema.parse(req.body);
  const before = await User.findById(req.params.id);
  if (!before) return res.status(404).json({ error: "User not found" });

  const user = await User.findByIdAndUpdate(req.params.id, patch, { new: true });
  if (!user) return res.status(404).json({ error: "User not found" });

  // Emit targeted security events for high-sensitivity changes.
  if (patch.role && patch.role !== before.role) {
    await audit(req.user!.id, "user.role_change", "User", user._id.toString(),
      { role: before.role }, { role: user.role });
  }
  if (patch.active === false && before.active) {
    await audit(req.user!.id, "user.deactivate", "User", user._id.toString());
  }

  res.json(serializeUser(user));
});

usersRouter.delete("/:id", requireRole("admin"), async (req, res) => {
  const before = await User.findById(req.params.id);
  if (!before) return res.status(404).json({ error: "User not found" });

  await User.findByIdAndDelete(req.params.id);
  await audit(req.user!.id, "user.delete", "User", before._id.toString(), serializeUser(before), undefined);

  res.json({ success: true });
});
