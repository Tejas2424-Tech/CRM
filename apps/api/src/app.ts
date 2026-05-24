import cors from "cors";
import express from "express";
import { ZodError } from "zod";
import { env } from "./config/env.js";
import { apiRateLimit, authRateLimit, requestId, securityHeaders } from "./middleware/security.js";
import { routes } from "./routes/index.js";

export function createApp() {
  const app = express();

  // ── Security headers (helmet) ───────────────────────────────────────────────
  app.use(securityHeaders);

  // ── Request tracing ─────────────────────────────────────────────────────────
  app.use(requestId);

  // ── Structured request logger ───────────────────────────────────────────────
  app.use((req, _res, next) => {
    if (env.NODE_ENV !== "test") {
      console.log(JSON.stringify({
        t: new Date().toISOString(),
        method: req.method,
        url: req.url,
        reqId: req.requestId
      }));
    }
    next();
  });

  // ── CORS ────────────────────────────────────────────────────────────────────
  const corsOrigin = env.NODE_ENV === "development"
    ? [/^http:\/\/localhost:\d+$/, env.WEB_ORIGIN]
    : env.WEB_ORIGIN;

  app.use(cors({ origin: corsOrigin as string | RegExp | (string | RegExp)[], credentials: true }));

  // ── Body parsing ─────────────────────────────────────────────────────────────
  app.use(express.json({ limit: "2mb" }));

  // ── Rate limiting ────────────────────────────────────────────────────────────
  // Tighter limit on credential-bearing auth routes; standard limit elsewhere.
  // /auth/dev-users is a public list endpoint (no credentials) so it uses the
  // standard limiter — applying the tight auth limit causes 429s during dev HMR.
  app.use("/auth/dev-users", apiRateLimit);
  app.use("/auth", authRateLimit);
  app.use("/api", apiRateLimit);

  // ── Application routes ───────────────────────────────────────────────────────
  app.use(routes);

  // ── Centralized error handler ────────────────────────────────────────────────
  // Must be the last middleware (four-argument signature tells Express it's an
  // error handler). Zod validation errors (status 400) are surfaced cleanly;
  // unexpected 500s are logged and their stacks hidden in production.
  app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const isValidationError = err instanceof ZodError;
    const status: number = isValidationError ? 400 : err.status ?? err.statusCode ?? 500;
    const message: string = isValidationError ? "Validation failed" : err.message ?? "Internal Server Error";

    if (status >= 500 && env.NODE_ENV !== "test") {
      console.error(JSON.stringify({
        t: new Date().toISOString(),
        level: "error",
        reqId: req.requestId,
        msg: message,
        stack: err.stack
      }));
    }

    res.status(status).json({
      error: message,
      ...(isValidationError && { details: err.issues }),
      ...(env.NODE_ENV === "development" && { stack: err.stack })
    });
  });

  return app;
}
