import { Router } from "express";
import { requireAuth, requireRole } from "../auth/auth.js";
import { getWajsClient } from "../services/whatsappWebjs.service.js";

export const debugRouter = Router();

debugRouter.use(requireAuth);
debugRouter.use(requireRole("admin"));

debugRouter.get("/dump", async (req, res) => {
  try {
    const client = getWajsClient();
    const chats = await client.getChats();
    for (const c of chats) {
      if (c.id._serialized.includes("@lid")) {
         try {
           const contact = await c.getContact();
           return res.json({
             chatId: c.id._serialized,
             contact: contact
           });
         } catch (err: any) {
           const errMsg = String(err?.message || err);
           if (errMsg.includes("detached Frame") || errMsg.includes("Execution context was destroyed")) {
             console.warn(`[Debug] Frame reloaded while fetching ${c.id._serialized}`);
             continue;
           }
           throw err;
         }
      }
    }
    res.json({ error: "no lid chats found" });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
