import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });
dotenv.config();

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
