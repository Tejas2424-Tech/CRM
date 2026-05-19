import type { AgentRole, AuthUser } from "@crm/shared";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { User } from "../models/User.js";

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signUser(user: AuthUser) {
  return jwt.sign(user, env.JWT_SECRET, { expiresIn: "12h" });
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) return res.status(401).json({ error: "Missing bearer token" });

  try {
    req.user = jwt.verify(token, env.JWT_SECRET) as AuthUser;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

export function requireRole(...roles: AgentRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    return next();
  };
}

export async function seedDevUsers() {
  const users = [
    { name: "Avery Admin", email: "admin@local.crm", role: "admin" as const, capacity: 100 },
    { name: "Maya Manager", email: "manager@local.crm", role: "manager" as const, capacity: 60 },
    { name: "Sam Agent", email: "agent@local.crm", role: "agent" as const, capacity: 30 }
  ];

  for (const user of users) {
    await User.updateOne({ email: user.email }, { $setOnInsert: { ...user, active: true } }, { upsert: true });
  }
}
