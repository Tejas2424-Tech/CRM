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
       console.log("LID Chat ID:", c.id._serialized);
       console.log("contact.number:", contact.number);
       console.log("contact fields:", Object.keys(contact));
       console.log("contact id:", contact.id);
       break;
    }
  }
  process.exit(0);
});
client.initialize();
