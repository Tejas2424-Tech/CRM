import type { Server as SocketServer } from "socket.io";
import { redisConnection } from "../queues/connection.js";

let io: SocketServer | undefined;
let subscribed = false;
const REALTIME_CHANNEL = "crm:realtime";

export function setRealtime(server: SocketServer) {
  io = server;
  subscribeRealtimeBridge().catch((err) => {
    console.error("[Socket][Bridge] Failed to subscribe to Redis realtime bridge:", err);
  });
}

export function emitRealtime(event: string, payload: unknown) {
  if (io) {
    console.log(`[Socket] emit ${event}`);
    io.emit(event, payload);
    return;
  }

  if (process.env.NODE_ENV === "test") return;

  redisConnection
    .publish(REALTIME_CHANNEL, JSON.stringify({ event, payload }))
    .catch((err) => console.error(`[Socket][Bridge] publish failed for ${event}:`, err));
}

async function subscribeRealtimeBridge() {
  if (subscribed || process.env.NODE_ENV === "test") return;
  subscribed = true;

  const subscriber = redisConnection.duplicate();
  subscriber.on("message", (_channel, raw) => {
    try {
      const message = JSON.parse(raw) as { event?: string; payload?: unknown };
      if (!message.event) return;
      console.log(`[Socket][Bridge] relay ${message.event}`);
      io?.emit(message.event, message.payload);
    } catch (err) {
      console.error("[Socket][Bridge] Invalid realtime payload:", err);
    }
  });
  subscriber.on("error", (err) => console.error("[Socket][Bridge] subscriber error:", err));
  await subscriber.subscribe(REALTIME_CHANNEL);
}
