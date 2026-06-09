import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// override: true ensures the .env file always wins over stale shell-level variables.
// This matters in dev when tsx watch restarts the child process and inherits
// an old WA_CLIENT_MODE (or similar) from the parent shell.
// In production the real system environment is loaded first anyway, and any
// .env file present is still applied via the second call.
dotenv.config({ path: path.resolve(__dirname, "../../../../.env"), override: true });
dotenv.config({ override: true });

const isProduction = process.env.NODE_ENV === "production";

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  API_PORT: z.coerce.number().default(4000),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),

  // In production these must be explicit — no defaults that silently work.
  MONGODB_URI: isProduction
    ? z.string().min(1, "MONGODB_URI is required in production")
    : z.string().default("mongodb://127.0.0.1:27017/messaging-crm"),

  REDIS_URL: isProduction
    ? z.string().min(1, "REDIS_URL is required in production")
    : z.string().default("redis://127.0.0.1:6379"),

  // Insecure default is allowed in dev only. Production hard-fails without it.
  JWT_SECRET: isProduction
    ? z.string().min(32, "JWT_SECRET must be at least 32 characters in production")
    : z.string().default("dev-super-secret-change-me"),

  // Legacy flag (kept for backward compat)
  MOCK_WHATSAPP: z.string().default("true"),

  // Adapter selector: "mock" | "meta" | "webjs"
  WA_CLIENT_MODE: z.enum(["mock", "meta", "webjs"]).default("mock"),

  // Meta Cloud API (used when WA_CLIENT_MODE=meta)
  WA_ACCESS_TOKEN: z.string().optional(),
  WA_PHONE_NUMBER_ID: z.string().optional(),
  WA_API_VERSION: z.string().default("v23.0"),
  WA_VERIFY_TOKEN: z.string().default("crm_verify_2026"),

  // whatsapp-web.js (used when WA_CLIENT_MODE=webjs)
  WA_CLIENT_ID: z.string().default("crm-main"),
  WA_SESSION_PATH: z.string().default("./src/sessions"),
  WA_HEADLESS: z.string().default("true"),

  // History sync: delay (ms) after "ready" before Phase 1 sync starts.
  // Allows WhatsApp Web to hydrate chats before we query them.
  WHATSAPP_HISTORY_SYNC_DELAY_MS: z.coerce.number().default(30_000),

  // Rate limiting (requests per window per IP)
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().default(120)
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("[Config] Invalid environment variables:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
