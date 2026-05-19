import mongoose from "mongoose";
import { Message } from "../models/Message.js";
import { getWajsMetadata } from "../services/whatsappWebjs.service.js";
import { connectDatabase } from "../config/db.js";

async function check() {
  try {
    await connectDatabase();
    const metadata = getWajsMetadata();
    console.log("WA_METADATA:", JSON.stringify(metadata, null, 2));

    const messages = await Message.find({ status: { $in: ["queued", "retrying", "waiting_connection"] } })
      .sort({ createdAt: -1 })
      .limit(10);
    
    console.log("PENDING_MESSAGES:", JSON.stringify(messages, null, 2));
  } catch (err) {
    console.error("CHECK_ERROR:", err);
  } finally {
    process.exit(0);
  }
}

check();
