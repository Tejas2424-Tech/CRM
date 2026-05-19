import { Router } from "express";
import { getWajsClient } from "../services/whatsappWebjs.service.js";

export const debugRouter = Router();

debugRouter.get("/dump", async (req, res) => {
  try {
    const client = getWajsClient();
    const chats = await client.getChats();
    for (const c of chats) {
      if (c.id._serialized.includes("@lid")) {
         const contact = await c.getContact();
         return res.json({
           chatId: c.id._serialized,
           contact: contact
         });
      }
    }
    res.json({ error: "no lid chats found" });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
