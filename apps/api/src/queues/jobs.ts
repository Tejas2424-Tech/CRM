import { Queue } from "bullmq";
import { createRedisConnection } from "./connection.js";

export type InboundJob = {
  waMessageId: string;
  phone: string;
  chatId?: string;
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

export type SyncJob = {
  /** Which progressive-sync phase triggered this job (1 = T+30s, 2 = T+2min, 3 = T+5min) */
  phase?: number;
};

const defaultOpts = { attempts: 5, backoff: { type: "exponential", delay: 2000 }, removeOnComplete: true, removeOnFail: false };

export const inboundQueue = new Queue<InboundJob>("process-inbound-message", { connection: createRedisConnection(), defaultJobOptions: defaultOpts });
export const outboundQueue = new Queue<OutboundJob>("send-outbound-message", { 
  connection: createRedisConnection(),
  defaultJobOptions: defaultOpts
});
export const campaignQueue = new Queue<CampaignRecipientJob>("send-campaign-recipient", { 
  connection: createRedisConnection(),
  defaultJobOptions: defaultOpts
});
export const statusQueue = new Queue<StatusJob>("simulate-message-status", { connection: createRedisConnection(), defaultJobOptions: defaultOpts });
export const automationQueue = new Queue<InboundJob>("run-automation", { connection: createRedisConnection(), defaultJobOptions: defaultOpts });
export const syncQueue = new Queue<SyncJob>("whatsapp-sync", { connection: createRedisConnection(), defaultJobOptions: { ...defaultOpts, attempts: 1 } });

export type LostLeadsJob = Record<string, never>;

export const lostLeadsQueue = new Queue<LostLeadsJob>("recompute-lost-leads", {
  connection: createRedisConnection(),
  defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: false }
});
