import IORedis from "ioredis";
import { env } from "../config/env.js";

export const redisConnection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null
});
