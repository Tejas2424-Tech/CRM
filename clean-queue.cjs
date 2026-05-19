const { Queue } = require("bullmq");
const IORedis = require("ioredis");

const connection = new IORedis("redis://localhost:6379", {
  maxRetriesPerRequest: null
});

const outboundQueue = new Queue("send-outbound-message", { connection });

(async () => {
  console.log("Cleaning send-outbound-message queue...");
  
  // Clean all failed jobs
  await outboundQueue.clean(0, 1000, 'failed');
  console.log("Failed jobs cleaned.");
  
  // Drain waiting jobs (optional, but good for backfill cleanup)
  await outboundQueue.drain();
  console.log("Waiting jobs drained.");

  await connection.quit();
  process.exit(0);
})();
