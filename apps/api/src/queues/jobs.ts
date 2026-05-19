import { Queue } from "bullmq";
import { redisConnection } from "./connection.js";

export type InboundJob = {
  waMessageId: string;
  phone: string;
  name?: string;
  text: string;
  timestamp?: string;
};

export type OutboundJob = {
  messageId: string;
};

export type CampaignRecipientJob = {
  campaignId: string;
  recipientId: string;
};

export type StatusJob = {
  messageId?: string;
  recipientId?: string;
  waMessageId: string;
  status: "sent" | "delivered" | "read";
};

export const inboundQueue = new Queue<InboundJob>("process-inbound-message", { connection: redisConnection });
export const outboundQueue = new Queue<OutboundJob>("send-outbound-message", { 
  connection: redisConnection,
  defaultJobOptions: { attempts: 10, backoff: { type: "exponential", delay: 5000 } }
});
export const campaignQueue = new Queue<CampaignRecipientJob>("send-campaign-recipient", { 
  connection: redisConnection,
  defaultJobOptions: { attempts: 10, backoff: { type: "exponential", delay: 5000 } }
});
export const statusQueue = new Queue<StatusJob>("simulate-message-status", { connection: redisConnection });
export const automationQueue = new Queue<InboundJob>("run-automation", { connection: redisConnection });
