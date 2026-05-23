import IORedis from "ioredis";
import { env } from "../config/env.js";

export const redisConnection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null
});

redisConnection.on("error", (err) => {
  console.error("[IORedis] redisConnection error:", err);
});

export const createRedisConnection = () => {
  const conn = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null
  });
  conn.on("error", (err) => {
    console.error("[IORedis] created connection error:", err);
  });
  return conn;
};
