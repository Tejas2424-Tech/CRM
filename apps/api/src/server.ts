import http from "node:http";
import { Worker } from "bullmq";
import { Server } from "socket.io";
import { createApp } from "./app.js";
import { connectDatabase } from "./config/db.js";
import { env } from "./config/env.js";
import { setRealtime } from "./config/realtime.js";
import { seedDefaults } from "./seed.js";
import { createRedisConnection } from "./queues/connection.js";
import { syncAllChats } from "./services/chatSync.service.js";
import { syncQueue } from "./queues/jobs.js";
import type { SyncJob, OutboundJob } from "./queues/jobs.js";
import {
  destroyWajsClient,
  getWajsClient,
  initWhatsappWebjs,
  logoutWhatsApp,
} from "./services/whatsappWebjs.service.js";
import { sendOutboundMessage } from "./services/outbound.js";

await connectDatabase();
await seedDefaults();

const app = createApp();
const server = http.createServer(app);
const corsOrigin = env.NODE_ENV === "development" 
  ? [/^http:\/\/localhost:\d+$/, env.WEB_ORIGIN] 
  : env.WEB_ORIGIN;

const io = new Server(server, {
  cors: { origin: corsOrigin as any, credentials: true }
});
setRealtime(io);

// ── WhatsApp-web.js ──────────────────────────────────────────────────────────
// The WaJS client MUST live in the API process (same process as Socket.IO
// so it can emit realtime events). The worker process only *schedules* sync
// jobs; this process runs the actual processor so getWajsClient() is valid.

let syncWorker: Worker | null = null;
let outboundWorker: Worker | null = null;

if (env.WA_CLIENT_MODE === "webjs") {
  await initWhatsappWebjs().catch((err) => {
    console.error("[Server][WaJS] Failed to initialise WhatsApp:", err);
  });

  // ── Command subscriber (logout + manual sync) ──────────────────────────
  // Must run in the API process — the WaJS client lives here.
  const commandSubscriber = createRedisConnection();
  await commandSubscriber.subscribe("wajs:commands");
  commandSubscriber.on("message", async (_channel, raw) => {
    try {
      const command = JSON.parse(raw) as { action?: string };
      console.log(`[Server][WaJS] command received: ${command.action}`);
      if (command.action === "logout") {
        await logoutWhatsApp();
      } else if (command.action === "sync") {
        await syncQueue.add("manual-sync", { phase: 0 });
        console.log("[HistorySync] Manual sync job queued");
      }
    } catch (err) {
      console.error("[Server][WaJS] command handling failed:", err);
    }
  });

  // ── whatsapp-sync Worker (API process) ────────────────────────────────
  // Must stay here so getWajsClient() can reach the live _client singleton.
  syncWorker = new Worker<SyncJob>(
    "whatsapp-sync",
    async (job) => {
      const phase = job.data.phase ?? 0;
      console.log(`[HistorySync] Sync started (phase ${phase}, job ${job.id})`);
      try {
        const client = getWajsClient();
        await syncAllChats(client as any);
        console.log(`[HistorySync] Sync completed (phase ${phase})`);
      } catch (err) {
        console.error(`[HistorySync] Sync failed (phase ${phase}):`, err);
        throw err; // Let BullMQ handle retry/failure
      }
    },
    { connection: createRedisConnection(), concurrency: 1 }
  );

  syncWorker.on("active", (job) =>
    console.log(`[HistorySync] Job ${job.id} active (phase ${job.data.phase ?? 0})`)
  );
  syncWorker.on("completed", (job) =>
    console.log(`[HistorySync] Job ${job.id} completed (phase ${job.data.phase ?? 0})`)
  );
  syncWorker.on("failed", (job, err) =>
    console.error(`[HistorySync] Job ${job?.id} failed (phase ${job?.data?.phase ?? 0}):`, err.message)
  );

  // ── send-outbound-message Worker (API process) ──────────────────────────
  // Must stay here so getWajsClient() can reach the live _client singleton.
  outboundWorker = new Worker<OutboundJob>(
    "send-outbound-message",
    (job) => {
      console.log(`[Outbound] [Step 2] send-outbound-message started. Attempt: ${job.attemptsMade}`);
      return sendOutboundMessage(job.data.messageId, job.attemptsMade);
    },
    { connection: createRedisConnection(), concurrency: 4 }
  );

  outboundWorker.on("active",    (job) => console.log(`[Outbound] Job ${job.id} active`));
  outboundWorker.on("completed", (job) => console.log(`[Outbound] Job ${job.id} completed`));
  outboundWorker.on("failed",    (job, err) => console.error(`[Outbound] Job ${job?.id} FAILED:`, err.message));

  console.log("[Server] whatsapp-sync + outbound Workers registered in API process ✅");
}

server.listen(env.API_PORT, () => {
  console.log(`API listening on http://localhost:${env.API_PORT}`);
});

// ── Graceful Shutdown ────────────────────────────────────────────────────────
const shutdown = async () => {
  console.log("\n[API] Shutting down...");

  if (syncWorker) {
    await syncWorker.close().catch(() => undefined);
  }

  if (outboundWorker) {
    await outboundWorker.close().catch(() => undefined);
  }

  if (env.WA_CLIENT_MODE === "webjs") {
    await destroyWajsClient().catch(() => undefined);
  }

  server.close(() => {
    console.log("[API] Server closed");
    process.exit(0);
  });
  
  // Force exit if hanging
  setTimeout(() => process.exit(1), 5000);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

