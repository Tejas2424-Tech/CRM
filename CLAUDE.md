# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start everything (API + worker + web) in parallel
npm run dev

# Start individually
npm run dev:api     # API server (port 4000)
npm run worker      # BullMQ worker process
npm run dev:web     # Vite dev server (port 5173)

# Tests (API only — requires local mongod in PATH)
npm test

# TypeScript type-check (no emit)
npm run lint                              # all workspaces
cd apps/api && npx tsc --noEmit          # API only
cd apps/web && npx tsc --noEmit -p tsconfig.app.json  # Web only
```

The API and worker run with `tsx watch` — TypeScript source is executed directly, no compile step needed for development. The `dist/` folder is stale and not used in dev.

## Architecture

**Two runtime processes:**
- **API process** (`src/server.ts`): Express + Socket.IO. When `WA_CLIENT_MODE=webjs`, also hosts the WaJS client singleton and the `whatsapp-sync` + `send-outbound-message` BullMQ workers — these must live here because they call `getWajsClient()`.
- **Worker process** (`src/worker.ts`): All other BullMQ workers — inbound messages, automation, follow-up steps, campaign recipients, lost-lead classification.

**Data stores:** MongoDB (Mongoose 8) + Redis (BullMQ queues + pub/sub for WaJS commands).

**WhatsApp adapter:** Selected by `WA_CLIENT_MODE` env var — `mock` (default, no real WhatsApp), `webjs` (whatsapp-web.js browser session), or `meta` (Meta Cloud API). The adapter is in `apps/api/src/adapters/whatsapp.ts`.

**Frontend:** React 19 + Vite + Tailwind CSS v4. No external state library — `CrmContext` (`src/context/CrmContext.tsx`) composes all feature hooks and passes them down. Feature hooks (`useLeads`, `useInbox`, `useSocket`, etc.) are in `src/hooks/`.

**Shared types:** `packages/shared/src/index.ts` exports all DTOs and enums used by both API and web.

## Key Patterns

**BullMQ jobs:** All queues defined in `src/queues/jobs.ts`. Default options: `attempts: 3`, `backoff: { type: "exponential", delay: 5000 }`. Campaign jobs use staggered delays (`floor(60000/messagesPerMinute) * i`) rather than a queue-level rate limiter.

**Idempotency:** `ProcessedEvent` model (keyed by `campaign:recipient:<id>` or similar) acts as a mutex — `findOneAndUpdate` with `$setOnInsert` / `$set` guards against duplicate job execution on retries.

**Real-time events:** `emitRealtime(event, payload)` from `src/config/realtime.js` broadcasts via Socket.IO to all connected clients.

**Serialization:** All API responses go through `src/services/serializers.ts` — never return raw Mongoose documents.

**Auth:** `requireAuth` (validates JWT cookie/header) and `requireRole(...roles)` middleware in `src/auth/auth.ts`, applied per-router.

## Environment

`.env` file lives at the **repo root** (loaded by `apps/api` via `dotenv` with `override: true`). Key variables:

| Variable | Default (dev) | Notes |
|---|---|---|
| `WA_CLIENT_MODE` | `mock` | `mock` \| `webjs` \| `meta` |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/messaging-crm` | Required in prod |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Required in prod |
| `JWT_SECRET` | `dev-super-secret-change-me` | Min 32 chars in prod |
| `API_PORT` | `4000` | |

## Tests

Tests live in `apps/api/src/tests/app.test.ts` and run with Vitest. They spawn a real `mongod` process (must be in `PATH`) and use Supertest for HTTP assertions. BullMQ queues are mocked via `vi.mock("../queues/jobs.js")`.
