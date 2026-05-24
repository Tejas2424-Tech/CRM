import IORedis from "ioredis";
import { env } from "../config/env.js";

// ── General-purpose connection ────────────────────────────────────────────────
// Use for: SET, GET, DEL, distributed locks, and any non-pub/sub command.
// NEVER call .subscribe() / .psubscribe() on this — that puts it into subscribe
// mode and makes all subsequent general commands throw:
//   ERR Can't execute 'X': only (P|S)SUBSCRIBE / … are allowed in this context
export const redisConnection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});
redisConnection.on("error", (err) => {
  console.error("[Redis] General connection error:", err.message);
});

// ── Dedicated publisher ───────────────────────────────────────────────────────
// Use exclusively for PUBLISH commands (realtime bridge, worker→API relay).
// Keeping publish on its own connection ensures it can never accidentally enter
// subscribe mode, which would block all PUBLISH calls with the same error above.
export const publisher = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});
publisher.on("error", (err) => {
  console.error("[Redis] Publisher error:", err.message);
});

// ── BullMQ / subscriber connection factory ────────────────────────────────────
// Returns a fresh IORedis instance each time — BullMQ calls .duplicate()
// internally for blocking commands, so connections must never be pre-subscribed
// or shared between Queue / Worker instances.
// Also used to create dedicated subscriber connections (commandSubscriber,
// realtime bridge subscriber) — each gets its own fresh socket so subscribe
// mode on one connection never contaminates another.
export const createRedisConnection = () => {
  const conn = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
  });
  conn.on("error", (err) => {
    console.error("[Redis] BullMQ/subscriber connection error:", err.message);
  });
  return conn;
};
