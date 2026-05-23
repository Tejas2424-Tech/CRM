import http from "node:http";
import { Server } from "socket.io";
import { createApp } from "./app.js";
import { connectDatabase } from "./config/db.js";
import { env } from "./config/env.js";
import { setRealtime } from "./config/realtime.js";
import { seedDefaults } from "./seed.js";

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

// whatsapp-web.js is owned by the BullMQ worker process. The API process relays
// worker-published status/QR events to Socket.IO through the Redis realtime bridge.

server.listen(env.API_PORT, () => {
  console.log(`API listening on http://localhost:${env.API_PORT}`);
});

// ── Graceful Shutdown ────────────────────────────────────────────────────────
const shutdown = async () => {
  console.log("\n[API] Shutting down...");
  server.close(() => {
    console.log("[API] Server closed");
    process.exit(0);
  });
  
  // Force exit if hanging
  setTimeout(() => process.exit(1), 5000);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
