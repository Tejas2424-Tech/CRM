import { Worker } from "bullmq";
import { connectDatabase } from "./config/db.js";
import { redisConnection, publisher, createRedisConnection } from "./queues/connection.js";
import type { CampaignRecipientJob, FollowupStepJob, InboundJob, LostLeadsJob, StatusJob } from "./queues/jobs.js";
import { campaignQueue, followupQueue, lostLeadsQueue } from "./queues/jobs.js";
import { runAutomation } from "./services/automation.js";
import { processFollowupStep } from "./services/followup.js";
import { processInboundMessage } from "./services/inbound.js";
import { recomputeLostLeads } from "./services/leadClassifier.service.js";
import { checkScheduledCampaigns, processCampaignRecipient } from "./services/campaigns.js";
import { updateMessageStatus } from "./services/outbound.js";

await connectDatabase();

// Note: WhatsApp client (WaJS) and whatsapp-sync Worker now live in the API process
// (server.ts) so that getWajsClient() can access the live _client singleton.
// This worker process handles all other BullMQ queues.


// Note: send-outbound-message Worker lives in server.ts (API process)
// so getWajsClient() can reach the live _client singleton.
const workers = [
  new Worker<InboundJob>("process-inbound-message", (job) => processInboundMessage(job.data), { connection: createRedisConnection() }),
  new Worker<StatusJob>("simulate-message-status", (job) => updateMessageStatus(job.data), { connection: createRedisConnection() }),
  new Worker<InboundJob>("run-automation", (job) => runAutomation(job.data), { connection: createRedisConnection() }),
  new Worker<LostLeadsJob>("recompute-lost-leads", async () => {
    await recomputeLostLeads();
  }, { connection: createRedisConnection() }),
  new Worker<FollowupStepJob>("followup-steps", (job) => processFollowupStep(job.data), {
    connection: createRedisConnection(),
    concurrency: 5
  }),
  new Worker<CampaignRecipientJob>(
    "process-campaign-recipient",
    async (job) => {
      if (job.name === "check-scheduled") return checkScheduledCampaigns();
      return processCampaignRecipient(job.data);
    },
    { connection: createRedisConnection(), concurrency: 5 }
  )
];

// Schedule the daily lost-leads scan (idempotent — BullMQ deduplicates by repeat key)
lostLeadsQueue.add("daily-lost-check", {}, {
  repeat: { pattern: "0 2 * * *" } // 2 AM daily
}).catch((err) => console.error("[Worker][LostLeads] Failed to schedule repeatable job:", err));

// Schedule the per-minute check for campaigns with sendAt in the past
campaignQueue.add("check-scheduled", {} as CampaignRecipientJob, {
  repeat: { pattern: "* * * * *" },
  jobId: "scheduled-campaign-check"
}).catch((err) => console.error("[Worker][Campaign] Failed to schedule repeatable job:", err));

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
  console.log(`[Worker] ${signal} received. Closing workers...`);
  await Promise.allSettled(workers.map((worker) => worker.close()));
  await lostLeadsQueue.close().catch(() => undefined);
  await followupQueue.close().catch(() => undefined);
  await campaignQueue.close().catch(() => undefined);
  await publisher.quit().catch(() => undefined);
  await redisConnection.quit().catch(() => undefined);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
