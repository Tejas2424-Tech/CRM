import { seedDevUsers } from "./auth/auth.js";
import { Lead } from "./models/Lead.js";
import { Task } from "./models/Task.js";
import { Template } from "./models/Template.js";

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
}
