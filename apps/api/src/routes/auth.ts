import { Router } from "express";
import bcrypt from "bcryptjs";
import { User } from "../models/User.js";
import { serializeUser } from "../services/serializers.js";
import { signUser, requireAuth } from "../auth/auth.js";
import { audit } from "../services/audit.js";

export const authRouter = Router();

authRouter.get("/dev-users", async (_req, res) => {
  const users = await User.find({ active: true }).sort({ role: 1 });
  res.json(users.map(serializeUser));
});

authRouter.post("/dev-login", async (req, res) => {
  const email = String(req.body.email ?? "admin@local.crm");
  const user = await User.findOne({ email, active: true });
  if (!user) return res.status(404).json({ error: "Dev user not found" });
  const payload = { id: user._id.toString(), name: user.name, role: user.role };
  res.json({ token: signUser(payload), user: payload });
});

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email, active: true }).select("+password");

  if (!user) {
    await audit("system", "auth.login.failed", "User", email, { reason: "user_not_found" });
    return res.status(401).json({ error: "Invalid credentials" });
  }

  if (user.password) {
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      await audit("system", "auth.login.failed", "User", user._id.toString(), { reason: "bad_password" });
      return res.status(401).json({ error: "Invalid credentials" });
    }
  } else {
    // Dev users have no password hash — allow passwordless login in non-production.
    if (password && password !== "password") {
      await audit("system", "auth.login.failed", "User", user._id.toString(), { reason: "bad_password" });
      return res.status(401).json({ error: "Invalid credentials" });
    }
  }

  const payload = { id: user._id.toString(), name: user.name, role: user.role };
  await audit(user._id.toString(), "auth.login.success", "User", user._id.toString());
  res.json({ token: signUser(payload), user: payload });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  res.json(req.user);
});
