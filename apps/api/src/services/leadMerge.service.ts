/**
 * leadMerge.service.ts
 *
 * Merges two Lead records into one, migrating all child data without loss.
 *
 * Designed to resolve duplicates created by WhatsApp's @lid privacy-preserving
 * identifier system, where the same contact can appear as both a "lid:<id>" lead
 * and a "+<phone>" lead.
 *
 * Safety guarantees:
 *  - Redis lock prevents concurrent merges of the same pair
 *  - ProcessedEvent idempotency prevents the same merge from running twice
 *  - Child updateMany operations are idempotent (re-pointing an already-pointed leadId is a no-op)
 *  - The secondary lead is deleted only AFTER all child records are migrated
 *  - Conversation unique-constraint conflicts are handled explicitly
 */

import { Types } from "mongoose";
import { emitRealtime } from "../config/realtime.js";
import { Conversation } from "../models/Conversation.js";
import { Lead } from "../models/Lead.js";
import { Message } from "../models/Message.js";
import { Note } from "../models/Note.js";
import { ProcessedEvent } from "../models/ProcessedEvent.js";
import { Task } from "../models/Task.js";
import { redisConnection } from "../queues/connection.js";
import { audit } from "./audit.js";
import { serializeLead } from "./serializers.js";

// Stage advancement order — higher index = more advanced stage
const STAGE_ORDER = ["new", "contacted", "interested", "followup", "won", "lost"] as const;
type Stage = (typeof STAGE_ORDER)[number];

function advancedStage(a: Stage, b: Stage): Stage {
  const ai = STAGE_ORDER.indexOf(a);
  const bi = STAGE_ORDER.indexOf(b);
  // "lost" is terminal but not an advancement — prefer whichever isn't "lost" if possible
  if (a === "lost" && b !== "lost") return b;
  if (b === "lost" && a !== "lost") return a;
  return ai >= bi ? a : b;
}

/**
 * Merge `secondaryId` into `primaryId`.
 *
 * Primary = the lead to keep (usually the real-phone lead, e.g. "+243202674167887").
 * Secondary = the lead to dissolve (usually the lid: lead, e.g. "lid:12345678901").
 *
 * All messages, tasks, notes, and conversations owned by the secondary lead are
 * re-pointed to the primary. The secondary lead document is then deleted. An audit
 * entry records the operation.
 */
export async function mergeLeads(
  primaryId: string,
  secondaryId: string,
  actorId: string
): Promise<void> {
  if (primaryId === secondaryId) return;

  // ── Idempotency gate ────────────────────────────────────────────────────────
  // Use sorted IDs so "merge(A,B)" and "merge(B,A)" share the same dedup key.
  const dedupeKey = `lead:merge:${[primaryId, secondaryId].sort().join(":")}`;
  const existing = await ProcessedEvent.findOneAndUpdate(
    { key: dedupeKey },
    {
      $setOnInsert: {
        key: dedupeKey,
        type: "lead.merge",
        status: "processing",
        processedAt: new Date()
      }
    },
    { upsert: true, new: false }
  );

  if (existing) {
    if (existing.status === "completed") {
      console.log(`[LeadMerge] ${dedupeKey} already completed — skipping`);
      return;
    }
    // "processing" from a previous crash — allow retry
  }

  // ── Redis lock (prevents concurrent merge of the same pair) ────────────────
  const lockKey = `lead:merge:lock:${[primaryId, secondaryId].sort().join(":")}`;
  const lockValue = `${process.pid}:${Date.now()}`;
  let lockAcquired = false;

  try {
    try {
      const result = await redisConnection.set(lockKey, lockValue, "EX", 60, "NX");
      lockAcquired = result === "OK";
      if (!lockAcquired) {
        console.warn(`[LeadMerge] Lock held by another process for ${dedupeKey} — skipping`);
        return;
      }
    } catch {
      // Redis unavailable — proceed without lock (best-effort)
    }

    // ── Load both leads ───────────────────────────────────────────────────────
    const [primary, secondary] = await Promise.all([
      Lead.findById(primaryId),
      Lead.findById(secondaryId)
    ]);

    if (!primary) {
      console.warn(`[LeadMerge] Primary lead ${primaryId} not found — aborting`);
      return;
    }
    if (!secondary) {
      // Already deleted in a previous partial run — mark as completed and exit
      await ProcessedEvent.updateOne({ key: dedupeKey }, { $set: { status: "completed" } });
      return;
    }

    const beforeSnapshot = serializeLead(secondary);

    // ── Merge scalar fields onto primary ─────────────────────────────────────
    const mergedStage = advancedStage(
      (primary.stage ?? "new") as Stage,
      (secondary.stage ?? "new") as Stage
    );

    const mergedTags = [...new Set([...(primary.tags ?? []), ...(secondary.tags ?? [])])];

    // Conservative consent: if either lead has opted out, the merged lead is opted out.
    const optedIn = primary.consent.optedIn && secondary.consent.optedIn;
    const optedOutAt =
      !optedIn
        ? (primary.consent.optedOutAt && secondary.consent.optedOutAt
            ? new Date(Math.min(primary.consent.optedOutAt.getTime(), secondary.consent.optedOutAt.getTime()))
            : primary.consent.optedOutAt ?? secondary.consent.optedOutAt)
        : undefined;

    const mergedLastActivity = primary.lastActivity > secondary.lastActivity
      ? primary.lastActivity
      : secondary.lastActivity;

    const mergedLastInboundAt =
      primary.lastInboundAt && secondary.lastInboundAt
        ? new Date(Math.max(primary.lastInboundAt.getTime(), secondary.lastInboundAt.getTime()))
        : primary.lastInboundAt ?? secondary.lastInboundAt;

    const mergedWindowExpiresAt =
      primary.windowExpiresAt && secondary.windowExpiresAt
        ? new Date(Math.max(primary.windowExpiresAt.getTime(), secondary.windowExpiresAt.getTime()))
        : primary.windowExpiresAt ?? secondary.windowExpiresAt;

    // Prefer @lid chatId when available — it is the current WhatsApp identifier for outbound sends.
    const mergedChatId =
      secondary.chatId?.endsWith("@lid") ? secondary.chatId
      : primary.chatId?.endsWith("@lid") ? primary.chatId
      : primary.chatId ?? secondary.chatId;

    await Lead.findByIdAndUpdate(primaryId, {
      $set: {
        stage: mergedStage,
        tags: mergedTags,
        "consent.optedIn": optedIn,
        ...(optedOutAt ? { "consent.optedOutAt": optedOutAt } : {}),
        lastActivity: mergedLastActivity,
        ...(mergedLastInboundAt ? { lastInboundAt: mergedLastInboundAt } : {}),
        ...(mergedWindowExpiresAt ? { windowExpiresAt: mergedWindowExpiresAt } : {}),
        ...(mergedChatId ? { chatId: mergedChatId } : {}),
        // Fill in any missing enrichment fields from secondary
        ...(!primary.name && secondary.name ? { name: secondary.name } : {}),
        ...(!primary.email && secondary.email ? { email: secondary.email } : {}),
        ...(!primary.pushName && (secondary as any).pushName ? { pushName: (secondary as any).pushName } : {}),
        ...(!primary.profilePic && (secondary as any).profilePic ? { profilePic: (secondary as any).profilePic } : {}),
        unreadCount: (primary.unreadCount ?? 0) + (secondary.unreadCount ?? 0),
        ...(!primary.assignedTo && secondary.assignedTo ? { assignedTo: secondary.assignedTo } : {}),
      }
    });

    // ── Migrate child records ─────────────────────────────────────────────────

    // 1. Messages — simple bulk re-point (no unique constraint on leadId)
    await Message.updateMany(
      { leadId: secondary._id },
      { $set: { leadId: new Types.ObjectId(primaryId) } }
    );

    // 2. Tasks — simple bulk re-point
    await Task.updateMany(
      { leadId: secondary._id },
      { $set: { leadId: new Types.ObjectId(primaryId) } }
    );

    // 3. Notes — simple bulk re-point
    await Note.updateMany(
      { leadId: secondary._id },
      { $set: { leadId: new Types.ObjectId(primaryId) } }
    );

    // 4. Conversation — unique constraint on leadId
    //    If primary already has a conversation, delete secondary's.
    //    If primary has none, re-point secondary's to primary.
    const primaryConv = await Conversation.findOne({ leadId: new Types.ObjectId(primaryId) });
    const secondaryConv = await Conversation.findOne({ leadId: secondary._id });

    if (secondaryConv) {
      if (primaryConv) {
        // Both exist: keep primary's (it holds the most recent lastMessage for the primary lead),
        // delete secondary's to avoid a unique-constraint violation.
        await Conversation.deleteOne({ _id: secondaryConv._id });
      } else {
        // Primary has no conversation: re-point secondary's to primary.
        await Conversation.updateOne(
          { _id: secondaryConv._id },
          { $set: { leadId: new Types.ObjectId(primaryId) } }
        );
      }
    }

    // ── Delete secondary lead ────────────────────────────────────────────────
    await Lead.findByIdAndDelete(secondaryId);

    // ── Mark merge as completed ──────────────────────────────────────────────
    await ProcessedEvent.updateOne({ key: dedupeKey }, { $set: { status: "completed" } });

    // ── Emit realtime update for primary lead ────────────────────────────────
    const updatedPrimary = await Lead.findById(primaryId);
    if (updatedPrimary) {
      emitRealtime("lead:update", serializeLead(updatedPrimary));
    }

    // ── Audit ────────────────────────────────────────────────────────────────
    await audit(
      actorId,
      "lead.merge",
      "Lead",
      primaryId,
      { mergedFrom: secondaryId, secondaryPhone: secondary.phone, ...beforeSnapshot },
      updatedPrimary ? serializeLead(updatedPrimary) : undefined
    );

    console.log(
      `[LeadMerge] ✅ Merged ${secondary.phone} (${secondaryId}) → ${primary.phone} (${primaryId})`
    );

  } catch (err) {
    await ProcessedEvent.updateOne(
      { key: dedupeKey },
      { $set: { status: "failed", lastError: String(err) }, $inc: { retries: 1 } }
    ).catch(() => undefined);
    throw err;
  } finally {
    if (lockAcquired) {
      try {
        const owner = await redisConnection.get(lockKey);
        if (owner === lockValue) await redisConnection.del(lockKey);
      } catch {
        // ignore lock-release failures
      }
    }
  }
}

/**
 * Check if a real-phone Lead has a matching lid: sibling (same chatId) and merge them.
 * Called fire-and-forget after each successful inbound message processing.
 */
export async function reconcileLidSibling(
  realLeadId: string,
  chatId: string | undefined
): Promise<void> {
  if (!chatId || !chatId.endsWith("@lid")) return;

  const lidLead = await Lead.findOne({ chatId, phone: /^lid:/ });
  if (!lidLead) return;

  console.log(
    `[LeadMerge] Reconciling lid: sibling ${lidLead._id} (${lidLead.phone}) → ${realLeadId}`
  );
  await mergeLeads(realLeadId, lidLead._id.toString(), "system");
}
