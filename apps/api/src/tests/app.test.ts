import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { env } from "../config/env.js";
import { User } from "../models/User.js";
import { Lead } from "../models/Lead.js";
import { Message } from "../models/Message.js";
import { Task } from "../models/Task.js";
import { Template } from "../models/Template.js";
import { processInboundMessage } from "../services/inbound.js";
import { runAutomation } from "../services/automation.js";
import { syncChatMessages, type WajsChat, type WajsMessage } from "../services/chatSync.service.js";
import { seedDefaults } from "../seed.js";

vi.mock("../queues/jobs.js", () => ({
  inboundQueue: { add: vi.fn() },
  outboundQueue: { add: vi.fn() },
  statusQueue: { add: vi.fn() },
  automationQueue: { add: vi.fn() }
}));

let mongoProcess: ChildProcess;
let mongoDir: string;
const app = createApp();

async function getFreePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") resolve(address.port);
        else reject(new Error("Could not allocate test port"));
      });
    });
  });
}

beforeAll(async () => {
  const port = await getFreePort();
  mongoDir = await mkdtemp(join(tmpdir(), "crm-mongo-"));
  mongoProcess = spawn("mongod", ["--dbpath", mongoDir, "--port", String(port), "--quiet"], {
    stdio: "ignore"
  });

  const uri = `mongodb://127.0.0.1:${port}/messaging-crm-test`;
  let connected = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await mongoose.connect(uri);
      connected = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (!connected) throw new Error("Could not start local mongod for tests");
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  mongoProcess?.kill();
  if (mongoDir) await rm(mongoDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

beforeEach(async () => {
  await mongoose.connection.db?.dropDatabase();
  await seedDefaults();
});

function token(role: "admin" | "manager" | "agent" = "admin", id = "user-1") {
  return jwt.sign({ id, name: "Test User", role }, env.JWT_SECRET);
}

describe("Messaging CRM API", () => {
  // ── Original regression suite ───────────────────────────────────────────────

  it("creates a lead and message from inbound webhook processing", async () => {
    await processInboundMessage({ waMessageId: "wa-1", phone: "15551234567", name: "Riya", text: "Hi" });
    expect(await Lead.countDocuments()).toBe(1);
    expect(await Message.countDocuments()).toBe(1);
    const lead = await Lead.findOne({ phone: "15551234567" });
    expect(lead?.lastActivity).toBeInstanceOf(Date);
  });

  it("does not duplicate inbound messages with the same wa message id", async () => {
    await processInboundMessage({ waMessageId: "wa-1", phone: "15551234567", text: "Hi" });
    await processInboundMessage({ waMessageId: "wa-1", phone: "15551234567", text: "Hi again" });
    expect(await Lead.countDocuments()).toBe(1);
    expect(await Message.countDocuments()).toBe(1);
  });

  it("queues outbound messages from the send API", async () => {
    const lead = await Lead.create({ phone: "15551234567", consent: { optedIn: true }, lastActivity: new Date() });
    const res = await request(app)
      .post("/api/messages/send")
      .set("Authorization", `Bearer ${token("agent")}`)
      .send({ leadId: lead._id.toString(), text: "Hello" });
    expect(res.status).toBe(200);
    expect(res.body.message.status).toBe("queued");
  });

  it("returns the newest lead messages in chronological order when limited", async () => {
    const lead = await Lead.create({ phone: "15551234567", consent: { optedIn: true }, lastActivity: new Date() });
    const base = new Date("2026-01-01T00:00:00.000Z").getTime();
    const messages = Array.from({ length: 520 }, (_, index) => ({
      leadId: lead._id,
      direction: "in" as const,
      type: "text" as const,
      content: `msg-${String(index).padStart(3, "0")}`,
      status: "read" as const,
      fromMe: false,
      timestamp: new Date(base + index * 1000)
    }));
    await Message.insertMany(messages);

    const res = await request(app)
      .get(`/api/messages/${lead._id.toString()}?limit=500`)
      .set("Authorization", `Bearer ${token("admin")}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(500);
    expect(res.body[0].text).toBe("msg-020");
    expect(res.body[499].text).toBe("msg-519");
    expect(new Date(res.body[0].timestamp).getTime()).toBeLessThan(new Date(res.body[499].timestamp).getTime());
  });

  it("syncs more than 100 WhatsApp history messages for a chat", async () => {
    const lead = await Lead.create({ phone: "15551234567", consent: { optedIn: true }, lastActivity: new Date() });
    const rawMessages: WajsMessage[] = Array.from({ length: 125 }, (_, index) => ({
      id: { _serialized: `wa-sync-${index}` },
      from: "15551234567@c.us",
      to: "me@c.us",
      body: `history-${index}`,
      type: "chat",
      timestamp: 1_767_225_600 + index,
      fromMe: false
    }));
    const chat = {
      id: { _serialized: "15551234567@c.us" },
      fetchMessages: vi.fn().mockResolvedValue(rawMessages)
    } as unknown as WajsChat;

    const saved = await syncChatMessages({} as any, chat, { _id: lead._id, phone: lead.phone });

    expect(chat.fetchMessages).toHaveBeenCalledWith({ limit: Infinity });
    expect(saved).toHaveLength(125);
    expect(await Message.countDocuments({ leadId: lead._id })).toBe(125);
  });

  it("records opt out keywords and blocks future template sends", async () => {
    await processInboundMessage({ waMessageId: "wa-stop", phone: "15551234567", text: "STOP" });
    const lead = await Lead.findOne({ phone: "15551234567" });
    expect(lead?.consent.optedIn).toBe(false);
    const template = await Template.findOne({ name: "welcome_offer" });
    const res = await request(app)
      .post("/api/messages/send")
      .set("Authorization", `Bearer ${token("manager")}`)
      .send({ leadId: lead!._id.toString(), templateId: template!._id.toString() });
    expect(res.status).toBe(400);
  });

  it("returns seeded dev users", async () => {
    const res = await request(app).get("/auth/dev-users");
    expect(res.status).toBe(200);
    expect(await User.countDocuments()).toBe(3);
  });

  it("returns 400 validation errors for invalid lead email updates", async () => {
    const lead = await Lead.create({ phone: "15551234567", consent: { optedIn: true }, lastActivity: new Date() });
    const res = await request(app)
      .patch(`/api/leads/${lead._id}`)
      .set("Authorization", `Bearer ${token("agent")}`)
      .send({ email: "not-an-email" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
    expect(res.body.details[0].message).toBe("Invalid email address");
  });

  // ── Bug fix: Task dueDate → dueAt ──────────────────────────────────────────

  it("creates a task using dueAt (canonical field)", async () => {
    const lead = await Lead.create({ phone: "15551234567", consent: { optedIn: true }, lastActivity: new Date() });
    const dueAt = new Date(Date.now() + 86_400_000).toISOString();
    const res = await request(app)
      .post(`/api/leads/${lead._id}/tasks`)
      .set("Authorization", `Bearer ${token("agent")}`)
      .send({ title: "Follow up", dueAt });
    expect(res.status).toBe(201);
    expect(res.body.dueAt).toBe(dueAt);

    const saved = await Task.findOne({ leadId: lead._id });
    expect(saved?.dueAt).toBeInstanceOf(Date);
  });

  it("creates a task using legacy dueDate alias and maps to dueAt in response", async () => {
    const lead = await Lead.create({ phone: "15559876543", consent: { optedIn: true }, lastActivity: new Date() });
    const dueDate = new Date(Date.now() + 86_400_000).toISOString();
    const res = await request(app)
      .post(`/api/leads/${lead._id}/tasks`)
      .set("Authorization", `Bearer ${token("agent")}`)
      .send({ title: "Old client task", dueDate });
    expect(res.status).toBe(201);
    // Response DTO must always use dueAt regardless of input field name
    expect(res.body.dueAt).toBe(dueDate);
  });

  it("returns tasks sorted by dueAt ascending", async () => {
    const lead = await Lead.create({ phone: "15550001111", consent: { optedIn: true }, lastActivity: new Date() });
    const later = new Date(Date.now() + 172_800_000);
    const sooner = new Date(Date.now() + 86_400_000);
    await Task.create({ leadId: lead._id, title: "Later", dueAt: later, status: "pending", reminderSent: false });
    await Task.create({ leadId: lead._id, title: "Sooner", dueAt: sooner, status: "pending", reminderSent: false });
    const res = await request(app)
      .get("/api/tasks")
      .set("Authorization", `Bearer ${token("admin")}`);
    expect(res.status).toBe(200);
    expect(res.body[0].title).toBe("Sooner");
  });

  // ── Bug fix: automation deduplication ──────────────────────────────────────

  it("sends welcome automation exactly once for repeated inbound events", async () => {
    const job = { waMessageId: "wa-auto-1", phone: "15550002222", text: "Hello" };
    await processInboundMessage(job);
    const lead = await Lead.findOne({ phone: job.phone });
    expect(lead).toBeTruthy();

    // Simulate running automation twice (queue retry scenario)
    await runAutomation(job);
    await runAutomation(job);

    // Only one outbound welcome message should exist
    const welcomeMessages = await Message.find({ leadId: lead!._id, direction: "out" });
    expect(welcomeMessages).toHaveLength(1);
    expect(welcomeMessages[0].content).toMatch(/Thanks for reaching out/i);
  });

  it("does not send welcome automation to opted-out lead", async () => {
    const job = { waMessageId: "wa-stop-2", phone: "15550003333", text: "STOP" };
    await processInboundMessage(job);
    await runAutomation(job);
    const lead = await Lead.findOne({ phone: job.phone });
    const outbound = await Message.find({ leadId: lead!._id, direction: "out" });
    expect(outbound).toHaveLength(0);
  });

  // ── Bug fix: webhook pipeline ──────────────────────────────────────────────

  it("POST /webhook/whatsapp enqueues valid flat payloads and returns queued:true", async () => {
    const res = await request(app)
      .post("/webhook/whatsapp")
      .send({
        waMessageId: "wa-wh-001",
        phone: "15551112222",
        name: "Test User",
        text: "Hello from webhook"
      });
    expect(res.status).toBe(200);
    expect(res.body.queued).toBe(true);
    expect(res.body.waMessageId).toBe("wa-wh-001");
  });

  it("POST /webhook/whatsapp rejects payloads missing required fields", async () => {
    const res = await request(app)
      .post("/webhook/whatsapp")
      .send({ phone: "15551112222" }); // missing waMessageId and text
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid payload");
  });

  it("GET /webhook/ accepts valid Meta hub.verify_token challenge", async () => {
    const res = await request(app)
      .get("/webhook/")
      .query({
        "hub.mode": "subscribe",
        "hub.verify_token": env.WA_VERIFY_TOKEN,
        "hub.challenge": "test-challenge-123"
      });
    expect(res.status).toBe(200);
    expect(res.text).toBe("test-challenge-123");
  });

  it("GET /webhook/ rejects invalid verify_token", async () => {
    const res = await request(app)
      .get("/webhook/")
      .query({
        "hub.mode": "subscribe",
        "hub.verify_token": "wrong-token",
        "hub.challenge": "abc"
      });
    expect(res.status).toBe(403);
  });
});
