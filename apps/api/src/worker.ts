import { Worker } from "bullmq";
import { connectDatabase } from "./config/db.js";
import { redisConnection } from "./queues/connection.js";
import type { CampaignRecipientJob, InboundJob, OutboundJob, StatusJob } from "./queues/jobs.js";
import { runAutomation } from "./services/automation.js";
import { processInboundMessage } from "./services/inbound.js";
import { sendCampaignRecipient, sendOutboundMessage, updateMessageStatus } from "./services/outbound.js";

await connectDatabase();

const workers = [
  new Worker<InboundJob>("process-inbound-message", (job) => processInboundMessage(job.data), { connection: redisConnection }),
  new Worker<OutboundJob>("send-outbound-message", (job) => {
    console.log(`[Worker] [Step 2] send-outbound-message started. Attempt: ${job.attemptsMade}`);
    return sendOutboundMessage(job.data.messageId, job.attemptsMade);
  }, { connection: redisConnection }),
  new Worker<CampaignRecipientJob>("send-campaign-recipient", (job) => sendCampaignRecipient(job.data.campaignId, job.data.recipientId), { connection: redisConnection }),
  new Worker<StatusJob>("simulate-message-status", (job) => updateMessageStatus(job.data), { connection: redisConnection }),
  new Worker<InboundJob>("run-automation", (job) => runAutomation(job.data), { connection: redisConnection })
];

for (const worker of workers) {
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
