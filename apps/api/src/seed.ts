import { seedDevUsers } from "./auth/auth.js";
import { Lead } from "./models/Lead.js";
import { Task } from "./models/Task.js";
import { Template } from "./models/Template.js";
import { mergeLeads } from "./services/leadMerge.service.js";

export async function seedDefaults() {
  await seedDevUsers();

  // One-time migration: rename dueDate → dueAt on existing Task documents.
  // $set with aggregation pipeline reads the old field; $unset removes it.
  // Safe to re-run — documents that already have dueAt are untouched.
  await Task.updateMany(
    { dueDate: { $exists: true }, dueAt: { $exists: false } },
    [{ $set: { dueAt: "$dueDate" } }, { $unset: "dueDate" }]
  );
  await Lead.updateMany({ stage: "qualified" }, { stage: "interested" });
  await Lead.updateMany({ stage: "nurturing" }, { stage: "followup" });
  await Lead.updateMany({ stage: "customer" }, { stage: "won" });
  await Lead.updateMany({ stage: "closed" }, { stage: "lost" });
  const templates = [
    {
      name: "welcome_offer",
      category: "marketing",
      language: "en_US",
      body: "Hi {{name}}, thanks for your interest. We can help you get started today.",
      variables: ["name"],
      approved: true
    },
    {
      name: "follow_up_24h",
      category: "utility",
      language: "en_US",
      body: "Just checking in. Would you like to continue the conversation?",
      variables: [],
      approved: true
    }
  ];

  for (const template of templates) {
    await Template.updateOne({ name: template.name }, { $setOnInsert: template }, { upsert: true });
  }

  // One-time migration: merge existing lid: leads into their real-phone counterparts.
  // Matching is done by chatId — both the lid: lead and the real-phone lead receive the
  // same @lid chatId (the lid: lead from chatSync, the real-phone lead from the inbound
  // message handler which sets chatId = msg.from).
  //
  // ProcessedEvent idempotency ensures each pair is merged exactly once across restarts.
  // Leads with no chatId or no real-phone counterpart are skipped and logged for review;
  // they will be reconciled automatically when the contact next sends a message.
  await migrateLidLeads();
}

async function migrateLidLeads(): Promise<void> {
  let matchable = 0;
  let merged = 0;
  let skipped = 0;

  try {
    const lidLeads = await Lead.find({ phone: /^lid:/ }).lean();
    if (lidLeads.length === 0) return;

    console.log(`[Migration][LidLeads] Found ${lidLeads.length} lid: lead(s) to evaluate`);

    for (const lidLead of lidLeads) {
      if (!lidLead.chatId) {
        console.warn(`[Migration][LidLeads] ${lidLead._id} (${lidLead.phone}) has no chatId — skipping (manual review needed)`);
        skipped++;
        continue;
      }

      const realLead = await Lead.findOne({
        chatId: lidLead.chatId,
        phone: { $not: /^lid:/ }
      });

      if (!realLead) {
        // No real-phone counterpart yet — will be reconciled on next inbound message.
        skipped++;
        continue;
      }

      matchable++;
      try {
        await mergeLeads(realLead._id.toString(), lidLead._id.toString(), "migration");
        merged++;
      } catch (err) {
        console.error(
          `[Migration][LidLeads] Failed to merge ${lidLead._id} → ${realLead._id}:`, err
        );
      }
    }

    console.log(
      `[Migration][LidLeads] Done — merged: ${merged}/${matchable}, skipped (no match): ${skipped}`
    );
  } catch (err) {
    // Never block startup for a migration failure.
    console.error("[Migration][LidLeads] Unexpected error during migration:", err);
  }
}
