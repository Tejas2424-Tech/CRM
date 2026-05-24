import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { env } from "../config/env.js";

// ─── HTTP security headers ────────────────────────────────────────────────────
// helmet sets X-Content-Type-Options, X-Frame-Options, HSTS (in prod), etc.
export const securityHeaders = helmet({
  // Allow Socket.IO long-poll transport — it uses the same origin
  crossOriginResourcePolicy: { policy: "same-site" },
  contentSecurityPolicy: env.NODE_ENV === "production"
    ? undefined // use helmet defaults in prod
    : false     // disable CSP in dev so Vite HMR works
});

// ─── Rate limiting ────────────────────────────────────────────────────────────
// Shared store is in-memory (single process). For multi-instance deployments,
// swap the `store` option for a Redis-backed store (ioredis-rate-limit).
export const apiRateLimit = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests — please slow down" }
});

// Auth endpoints get a tighter window to slow credential-stuffing attacks.
export const authRateLimit = rateLimit({
  windowMs: 15 * 60_000, // 15 minutes
  max: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many login attempts — try again later" },
  handler: (req, res, _next, options) => {
    console.warn(JSON.stringify({
      t: new Date().toISOString(),
      level: "warn",
      msg: "Auth rate limit hit",
      ip: req.ip,
      url: req.url,
      reqId: req.requestId,
    }));
    res.status(options.statusCode).json(options.message);
  },
});

// ─── Request ID ───────────────────────────────────────────────────────────────
// Attaches a unique ID to every request for distributed tracing.
// Downstream code can read req.requestId; the value is also echoed in the
// response header so clients can correlate logs with support tickets.
declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

export function requestId(req: Request, res: Response, next: NextFunction) {
  req.requestId = (req.headers["x-request-id"] as string) || crypto.randomUUID();
  res.setHeader("x-request-id", req.requestId);
  next();
}

// ─── Async route wrapper ──────────────────────────────────────────────────────
// Express 5 propagates async errors automatically, but this explicit wrapper
// lets us use it in places that still need explicit catching (e.g. middleware).
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
