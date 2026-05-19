const { Client, LocalAuth } = require("whatsapp-web.js");
const client = new Client({
  authStrategy: new LocalAuth({ clientId: "crm-main", dataPath: "./apps/api/src/sessions" }),
  puppeteer: { headless: true }
});
client.on("ready", async () => {
  const chats = await client.getChats();
  for (const c of chats) {
    if (c.id._serialized.includes("@lid")) {
       const contact = await c.getContact();
       const raw = await client.pupPage.evaluate(async (lid) => {
          const wid = window.Store.WidFactory.createWid(lid);
          const c = window.Store.Contact.get(wid);
          return c ? c.toJSON() : null;
       }, c.id._serialized);
       console.log("Raw Store.Contact:", JSON.stringify(raw, null, 2));
       break;
    }
  }
  process.exit(0);
});
client.initialize();
