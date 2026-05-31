/**
 * chatSync.service.ts
 *
 * Phase 1 — Contact + Chat Sync
 *
 * Responsibilities:
 *  - Fetch all WhatsApp chats after the client is ready
 *  - Resolve contact details (number, saved name, pushname, profile picture)
 *  - Fetch the latest N messages per chat and upsert them into MongoDB
 *  - Upsert Lead records with display metadata
 *  - Emit Socket.IO events so the dashboard refreshes automatically
 *
 * Design goals:
 *  - Crash-safe: every external call is wrapped in try/catch
 *  - Non-blocking: chats are processed with a small async delay between batches
 *  - Future-compatible: accepts a generic Client interface so multi-session,
 *    AI processing, and incremental sync can be layered on later without
 *    rewriting this service.
 */

import { emitRealtime } from "../config/realtime.js";
import { Conversation } from "../models/Conversation.js";
import { Lead } from "../models/Lead.js";
import { Message } from "../models/Message.js";
import { serializeLead, serializeMessage } from "./serializers.js";
import { redisConnection } from "../queues/connection.js";
import { normalizePhone } from "../utils/phone.js";

// ─── Config ──────────────────────────────────────────────────────────────────

/** Maximum messages fetched per chat on full sync. Capped to avoid multi-second blocks on heavy chats. */
const INITIAL_MSG_LIMIT = 100;
const debugMessageSync = process.env.MESSAGE_SYNC_DEBUG === "1";

/**
 * Milliseconds to wait between each chat so we don't hammer the WhatsApp Web
 * connection with hundreds of simultaneous requests.
 */
const INTER_CHAT_DELAY_MS = 50; // Small throttle to avoid hammering WA Web

// ─── Types ────────────────────────────────────────────────────────────────────

/** Minimal WhatsApp-web.js-compatible client interface.
 *  Accepting this instead of the concrete Client keeps us decoupled from the
 *  singleton and ready for multi-session/multi-adapter work. */
export interface IWajsClient {
  getChats(): Promise<WajsChat[]>;
  getState(): Promise<string>;
}

export interface WajsChat {
  id: { _serialized: string };
  name: string;
  isGroup: boolean;
  timestamp: number;
  unreadCount: number;
  lastMessage?: { body: string };
  getContact(): Promise<WajsContact>;
  fetchMessages(opts: { limit: number }): Promise<WajsMessage[]>;
}

export interface WajsContact {
  number: string;
  pushname?: string;
  name?: string;
  shortName?: string;
  isMyContact: boolean;
  getProfilePicUrl(): Promise<string | undefined>;
}

export interface WajsMessage {
  id: { _serialized: string };
  from: string;
  to: string;
  body: string;
  type: string;
  timestamp: number;
  fromMe: boolean;
  author?: string;
}

// ─── Normalise helpers ────────────────────────────────────────────────────────

/**
 * Build the display name from the richest available source.
 * Priority: saved contact name → WhatsApp pushname → phone number
 */
function resolveDisplayName(
  savedName: string | undefined,
  pushName: string | undefined,
  phone: string
): string {
  return savedName?.trim() || pushName?.trim() || phone;
}

/** Map a whatsapp-web.js message type string to our MessageType enum */
function mapMsgType(
  wajsType: string
): "text" | "image" | "video" | "document" | "audio" | "media" {
  const map: Record<string, "text" | "image" | "video" | "document" | "audio" | "media"> = {
    chat: "text",
    image: "image",
    video: "video",
    document: "document",
    audio: "audio",
    ptt: "audio",    // push-to-talk voice note
    sticker: "media",
  };
  return map[wajsType] ?? "media";
}

// ─── Core helpers ─────────────────────────────────────────────────────────────

/**
 * Fetch profile picture URL safely.
 * Returns null if unavailable — never throws.
 */
async function fetchProfilePic(contact: WajsContact): Promise<string | null> {
  try {
    const url = await contact.getProfilePicUrl();
    return url ?? null;
  } catch {
    return null;
  }
}

/**
 * Upsert a WhatsApp contact into the Lead collection.
 * Returns the updated Lead document.
 */
export async function syncContact(
  chatId: string,
  contact: WajsContact,
  overrides: { unreadCount?: number; lastMessageAt?: Date } = {}
) {
  const phone = contact.number ? normalizePhone(contact.number) : normalizePhone(chatId);
  const pushName = contact.pushname?.trim() || contact.shortName?.trim() || undefined;
  // Only use contact.name when it is a real saved name (not just the pushname echo)
  const savedName = contact.isMyContact
    ? (contact.name?.trim() || undefined)
    : undefined;
  const displayName = resolveDisplayName(savedName, pushName, phone);
  const profilePic = await fetchProfilePic(contact);

  const lead = await Lead.findOneAndUpdate(
    { phone },
    {
      $set: {
        chatId,
        pushName,
        ...(savedName ? { name: savedName } : {}),
        profilePic: profilePic ?? undefined,
        lastActivity: overrides.lastMessageAt ?? new Date(),
        unreadCount: overrides.unreadCount ?? 0,
      },
      $setOnInsert: {
        phone,
        source: "whatsapp",
        stage: "new",
        tags: [],
        "consent.source": "inbound",
        "consent.optedIn": true,
      },
    },
    { new: true, upsert: true }
  );

  console.log(`[ChatSync] contact synced: ${displayName} (${phone})`);
  return lead;
}

/**
 * Fetch messages for a single chat and upsert into MongoDB.
 * Skips duplicates via the unique waMessageId index — no explicit check needed.
 */
export async function syncChatMessages(
  client: IWajsClient,
  chat: WajsChat,
  lead: { _id: unknown; phone: string },
  opts: { messageLimit?: number } = {}
) {
  let rawMessages: WajsMessage[] = [];
  const msgLimit = opts.messageLimit ?? INITIAL_MSG_LIMIT;
  try {
    rawMessages = await chat.fetchMessages({ limit: msgLimit });
  } catch (err) {
    console.warn(`[ChatSync] fetchMessages failed for ${chat.id._serialized}:`, err);
    return [];
  }

  const saved: Array<{ id: string }> = [];
  let duplicateCount = 0;

  for (const raw of rawMessages) {
    const waMessageId = raw.id._serialized;
    const direction = raw.fromMe ? "out" : "in";
    const msgType = mapMsgType(raw.type);
    const timestamp = new Date(raw.timestamp * 1000);

    try {
      // insertOne with ignoring duplicate key error = safe upsert without fetching first
      const result = await Message.updateOne(
        { waMessageId },
        {
          $setOnInsert: {
            leadId: lead._id,
            chatId: chat.id._serialized,
            direction,
            type: msgType,
            content: raw.body || `[${raw.type}]`,
            status: raw.fromMe ? "sent" : "read",
            waMessageId,
            fromMe: raw.fromMe,
            timestamp,
          },
        },
        { upsert: true }
      );
      if (result.upsertedCount > 0) saved.push({ id: waMessageId });
      else duplicateCount++;
    } catch (err: any) {
      // E11000 = duplicate key — safe to ignore, message already exists
      if (err?.code !== 11000) {
        console.warn(`[ChatSync] Failed to upsert message ${waMessageId}:`, err);
      } else {
        duplicateCount++;
      }
    }
  }

  console.log(
    `[ChatSync] messages synced for ${lead.phone}: ${saved.length}/${rawMessages.length} new`
  );
  if (debugMessageSync) {
    console.log(
      `[MessageSync][ChatSync] chat=${chat.id._serialized} fetched=${rawMessages.length} stored=${saved.length} skipped=${duplicateCount} limit=${msgLimit}`
    );
  }
  return saved;
}

// ─── Main sync orchestrator ───────────────────────────────────────────────────

/**
 * Full initial sync.
 * Call this once after the whatsapp-web.js client fires the "ready" event.
 *
 * @param client - An IWajsClient instance (the whatsapp-web.js Client object)
 * @param opts.messageLimit - Override default per-chat message limit
 */
export async function syncAllChats(
  client: IWajsClient,
  opts: { messageLimit?: number } = {}
) {
  // Try to acquire distributed lock for 5 minutes
  const lock = await redisConnection.set("sync_lock:whatsapp", "locked", "EX", 300, "NX");
  if (!lock) {
    console.warn("[HistorySync] Sync aborted — another sync is currently running (lock active).");
    return;
  }

  const msgLimit = opts.messageLimit ?? INITIAL_MSG_LIMIT;
  console.log("[HistorySync] Sync started");
  emitRealtime("sync:started", { at: new Date().toISOString() });

  // We trust that if sync is called, the client is ready.
  // whatsapp-web.js getState() can sometimes return null or throw prematurely.

  let chats: WajsChat[] = [];
  try {
    chats = await client.getChats();
  } catch (err) {
    console.error("[HistorySync] getChats() failed — aborting sync:", err);
    emitRealtime("sync:error", { error: String(err) });
    await redisConnection.del("sync_lock:whatsapp");
    return;
  }

  console.log(`[HistorySync] Found ${chats.length} chats`);

  // Filter: private chats only for Phase 1 (skip groups & broadcasts)
  const privateChats = chats.filter(
    (chat) =>
      !chat.isGroup &&
      chat.id._serialized !== "status@broadcast" &&
      !chat.id._serialized.endsWith("@g.us") &&
      !chat.id._serialized.endsWith("@newsletter")
  );

  console.log(`[HistorySync] ${privateChats.length} private chats to sync`);
  emitRealtime("sync:progress", { total: privateChats.length, done: 0 });

  let done = 0;
  const errors: string[] = [];

  for (const chat of privateChats) {
    try {
      // ── 1. Resolve contact (Lightweight) ────────────────────────────────
      const contactId = chat.id?._serialized;

      // WhatsApp LID (@lid) is the new privacy-preserving identifier.
      // Most chats now use it. We import them using chat.name as the
      // display name and a "lid:<numericId>" phone key so they get a
      // stable, unique Lead record without requiring a real phone number.
      const isLid = contactId?.endsWith("@lid") ?? false;

      const cAny = chat as any;
      const pushName = cAny.pushname || cAny.formattedTitle || chat.name;

      // For @lid chats: use "lid:<numericId>" as the phone key.
      // For normal chats: use the number before the "@" suffix.
      const phoneKey = isLid
        ? `lid:${contactId!.split("@")[0]}`
        : (contactId ? contactId.split("@")[0] : "unknown");

      let waContact: any = null;
      try {
        waContact = await chat.getContact();
      } catch (e) {
        console.warn(`[ChatSync] Failed to get contact for ${contactId}`);
      }

      const contact: WajsContact = {
        number: phoneKey,
        pushname: waContact?.pushname || pushName,
        name: waContact?.name || chat.name,
        isMyContact: waContact?.isMyContact || false,
        getProfilePicUrl: async () => {
          if (!waContact) return undefined;
          try {
            return await waContact.getProfilePicUrl();
          } catch {
            return undefined;
          }
        }
      };

      const lastMessageAt = chat.timestamp ? new Date(chat.timestamp * 1000) : new Date();

      // ── 2. Upsert lead/contact ──────────────────────────────────────────
      const lead = await syncContact(contactId || "unknown", contact, {
        unreadCount: chat.unreadCount ?? 0,
        lastMessageAt,
      });

      // ── 3. Upsert conversation snippet ─────────────────────────────────
      const lastMsg = chat.lastMessage?.body || "";
      await Conversation.updateOne(
        { leadId: lead._id },
        { $set: { lastMessage: lastMsg || "[media]" } },
        { upsert: true }
      );
      console.log(`[HistorySync] Chat imported: ${chat.id._serialized} (${lead.phone})`);

      // ── 4. Fetch and persist historical messages ────────────────────────
      const msgOpts = { limit: msgLimit };
      let rawMessages: WajsMessage[] = [];
      try {
        rawMessages = await chat.fetchMessages(msgOpts);
      } catch (err) {
        console.warn(`[ChatSync] fetchMessages() failed for ${chat.id._serialized}:`, err);
      }

      let newMsgCount = 0;
      let duplicateCount = 0;
      for (const raw of rawMessages) {
        const waMessageId = raw.id._serialized;
        const direction = raw.fromMe ? "out" : "in";
        const msgType = mapMsgType(raw.type);
        const timestamp = new Date(raw.timestamp * 1000);

        try {
          const result = await Message.updateOne(
            { waMessageId },
            {
              $setOnInsert: {
                leadId: lead._id,
                chatId: chat.id._serialized,
                direction,
                type: msgType,
                content: raw.body || `[${raw.type}]`,
                status: raw.fromMe ? "sent" : "read",
                waMessageId,
                fromMe: raw.fromMe,
                timestamp,
              },
            },
            { upsert: true }
          );
          if (result.upsertedCount > 0) newMsgCount++;
          else duplicateCount++;
        } catch (err: any) {
          if (err?.code !== 11000) {
            console.warn(`[ChatSync] msg upsert error ${waMessageId}:`, err);
          } else {
            duplicateCount++;
          }
        }
      }

      console.log(
        `[HistorySync] Messages imported for ${lead.phone}: ${newMsgCount} new / ${rawMessages.length} fetched`
      );
      if (debugMessageSync) {
        console.log(
          `[MessageSync][ChatSync] chat=${chat.id._serialized} fetched=${rawMessages.length} stored=${newMsgCount} skipped=${duplicateCount} limit=${msgLimit}`
        );
      }

      // ── 5. Emit real-time updates ───────────────────────────────────────
      emitRealtime("lead:update", serializeLead(lead));
      emitRealtime("message:sync_complete", {
        chatId: chat.id._serialized,
        leadId: lead._id.toString(),
        newMessages: newMsgCount,
      });

      done++;
      emitRealtime("sync:progress", { total: privateChats.length, done });
    } catch (err) {
      const msg = `Chat ${chat.id._serialized}: ${String(err)}`;
      errors.push(msg);
      console.error(`[ChatSync] Unexpected error — ${msg}`);
    }

    // Throttle to avoid flooding WhatsApp Web
    await new Promise((resolve) => setTimeout(resolve, INTER_CHAT_DELAY_MS));
  }

  console.log(
    `[HistorySync] Sync complete — ${done}/${privateChats.length} chats, ${errors.length} errors`
  );

  await redisConnection.del("sync_lock:whatsapp");

  // Final document counts for verification
  try {
    const [convCount, msgCount] = await Promise.all([
      Conversation.countDocuments(),
      Message.countDocuments(),
    ]);
    console.log(`[HistorySync] DB totals — conversations: ${convCount}, messages: ${msgCount}`);
  } catch (err) {
    console.warn("[HistorySync] Could not fetch DB counts:", err);
  }

  emitRealtime("sync:complete", {
    total: privateChats.length,
    done,
    errors,
    at: new Date().toISOString(),
  });
}
