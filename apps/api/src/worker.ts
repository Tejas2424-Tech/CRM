import { Worker } from "bullmq";
import { connectDatabase } from "./config/db.js";
import { env } from "./config/env.js";
import { redisConnection, publisher, createRedisConnection } from "./queues/connection.js";
import type { CampaignRecipientJob, InboundJob, LostLeadsJob, OutboundJob, StatusJob, SyncJob } from "./queues/jobs.js";
import { lostLeadsQueue, syncQueue } from "./queues/jobs.js";
import { runAutomation } from "./services/automation.js";
import { processInboundMessage } from "./services/inbound.js";
import { recomputeLostLeads } from "./services/leadClassifier.service.js";
import { sendCampaignRecipient, sendOutboundMessage, updateMessageStatus } from "./services/outbound.js";
import {
  destroyWajsClient,
  getWajsClient,
  initWhatsappWebjs,
  logoutWhatsApp
} from "./services/whatsappWebjs.service.js";
import { syncAllChats } from "./services/chatSync.service.js";

await connectDatabase();

// Fresh dedicated connection for WhatsApp command subscription.
// Must never execute regular Redis commands after .subscribe() is called —
// Redis enforces subscribe-mode exclusivity and will throw on any other command.
// createRedisConnection() gives it its own socket + built-in error handler.
const commandSubscriber = createRedisConnection();

if (env.WA_CLIENT_MODE === "webjs") {
  await initWhatsappWebjs().catch((err) => {
    console.error("[Worker][WaJS] Failed to initialise WhatsApp:", err);
  });

  await commandSubscriber.subscribe("wajs:commands");
  commandSubscriber.on("message", async (_channel, raw) => {
    try {
      const command = JSON.parse(raw) as { action?: string };
      console.log(`[Worker][WaJS] command received: ${command.action}`);
      if (command.action === "logout") {
        await logoutWhatsApp();
      } else if (command.action === "sync") {
        await syncQueue.add("manual-sync", {});
      }
    } catch (err) {
      console.error("[Worker][WaJS] command failed:", err);
    }
  });
}

const workers = [
  new Worker<InboundJob>("process-inbound-message", (job) => processInboundMessage(job.data), { connection: createRedisConnection() }),
  new Worker<OutboundJob>("send-outbound-message", (job) => {
    console.log(`[Worker] [Step 2] send-outbound-message started. Attempt: ${job.attemptsMade}`);
    return sendOutboundMessage(job.data.messageId, job.attemptsMade);
  }, { connection: createRedisConnection() }),
  new Worker<CampaignRecipientJob>("send-campaign-recipient", (job) => sendCampaignRecipient(job.data.campaignId, job.data.recipientId), { connection: createRedisConnection() }),
  new Worker<StatusJob>("simulate-message-status", (job) => updateMessageStatus(job.data), { connection: createRedisConnection() }),
  new Worker<InboundJob>("run-automation", (job) => runAutomation(job.data), { connection: createRedisConnection() }),
  new Worker<SyncJob>("whatsapp-sync", async () => {
    const client = getWajsClient();
    await syncAllChats(client as any);
  }, { connection: createRedisConnection(), concurrency: 1 }),
  new Worker<LostLeadsJob>("recompute-lost-leads", async () => {
    await recomputeLostLeads();
  }, { connection: createRedisConnection() })
];

// Schedule the daily lost-leads scan (idempotent — BullMQ deduplicates by repeat key)
lostLeadsQueue.add("daily-lost-check", {}, {
  repeat: { pattern: "0 2 * * *" } // 2 AM daily
}).catch((err) => console.error("[Worker][LostLeads] Failed to schedule repeatable job:", err));

for (const worker of workers) {
  worker.on("active", (job) => {
    console.log(`[Worker] Job ${job.queueName}/${job.id} active`);
  });
  worker.on("completed", (job) => {
    console.log(`[Worker] Job ${job.queueName}/${job.id} completed`);
  });
  worker.on("failed", (job, err) => {
    const isConnErr = err.message.includes("WhatsApp client not connected") || 
                      err.message.includes("Timeout waiting for WhatsApp connection");
    
    if (isConnErr) {
      console.warn(`[Worker] Job ${job?.queueName}/${job?.id} delayed: ${err.message}`);
    } else {
      console.error(`[Worker] Job ${job?.queueName}/${job?.id} FAILED:`, err);
    }
  });
}

console.log("CRM workers running");

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Worker] ${signal} received. Closing workers and WhatsApp client...`);
  await Promise.allSettled(workers.map((worker) => worker.close()));
  await lostLeadsQueue.close().catch(() => undefined);
  await commandSubscriber.quit().catch(() => undefined);
  if (env.WA_CLIENT_MODE === "webjs") {
    await destroyWajsClient();
  }
  await publisher.quit().catch(() => undefined);
  await redisConnection.quit().catch(() => undefined);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
