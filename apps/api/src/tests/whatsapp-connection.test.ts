import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { createApp } from "../app.js";
import { env } from "../config/env.js";
import { Lead } from "../models/Lead.js";
import { Message } from "../models/Message.js";
import * as waService from "../services/whatsappWebjs.service.js";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import mongoose from "mongoose";
import { afterAll, beforeAll } from "vitest";
import { seedDefaults } from "../seed.js";

// Mock the WA service functions
vi.mock("../services/whatsappWebjs.service.js", async () => {
  const actual = await vi.importActual("../services/whatsappWebjs.service.js") as any;
  return {
    ...actual,
    getWajsStatus: vi.fn(),
    getWajsMetadata: vi.fn(),
    waitForWhatsAppReady: vi.fn(),
  };
});

let mongoProcess: ChildProcess;
let mongoDir: string;
const app = createApp();

beforeAll(async () => {
  const port = 27029;
  mongoDir = await mkdtemp(join(tmpdir(), "crm-mongo-wa-"));
  mongoProcess = spawn("mongod", ["--dbpath", mongoDir, "--port", String(port), "--quiet"], {
    stdio: "ignore"
  });

  const uri = `mongodb://127.0.0.1:${port}/messaging-crm-test-wa`;
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
  if (mongoDir) await rm(mongoDir, { recursive: true, force: true });
});

function token(role = "admin") {
  return jwt.sign({ id: "user-1", name: "Test User", role }, env.JWT_SECRET);
}

describe("WhatsApp Connection & Gating", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await mongoose.connection.db?.dropDatabase();
    await seedDefaults();
  });

  it("GET /api/whatsapp/status returns enhanced metadata", async () => {
    const mockMetadata = {
      status: "SYNCING",
      connectedAt: null,
      lastDisconnectReason: null,
      syncProgress: { total: 100, done: 45 }
    };
    vi.mocked(waService.getWajsMetadata).mockReturnValue(mockMetadata);
    vi.mocked(waService.getWajsStatus).mockReturnValue("SYNCING");

    const res = await request(app)
      .get("/api/whatsapp/status")
      .set("Authorization", `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("SYNCING");
    expect(res.body.syncProgress.done).toBe(45);
  });

  it("POST /api/messages/send allows queuing during HYDRATING", async () => {
    vi.mocked(waService.getWajsStatus).mockReturnValue("HYDRATING");
    
    const lead = await Lead.create({ 
      phone: "15550009999", 
      consent: { optedIn: true }, 
      lastActivity: new Date() 
    });

    const res = await request(app)
      .post("/api/messages/send")
      .set("Authorization", `Bearer ${token()}`)
      .send({ leadId: lead._id.toString(), text: "Hello" });

    expect(res.status).toBe(200);
    expect(res.body.message.status).toBe("queued");
  });

  it("sendOutboundMessage waits for connection if HYDRATING", async () => {
    const { sendOutboundMessage } = await import("../services/outbound.js");
    
    vi.mocked(waService.getWajsStatus).mockReturnValue("HYDRATING");
    vi.mocked(waService.waitForWhatsAppReady).mockResolvedValue(undefined);

    const lead = await Lead.create({ 
        phone: "15550008888", 
        consent: { optedIn: true }, 
        lastActivity: new Date() 
      });

    const msg = await Message.create({
      leadId: lead._id,
      direction: "out",
      type: "text",
      content: "Wait for me",
      status: "queued",
      fromMe: true,
      timestamp: new Date()
    });

    // Mock adapter to return success
    const { whatsAppAdapter } = await import("../adapters/whatsapp.js");
    vi.spyOn(whatsAppAdapter, "sendTextMessage").mockResolvedValue({ waMessageId: "wa-ready-1" });

    await sendOutboundMessage(msg._id.toString(), 0);

    expect(waService.waitForWhatsAppReady).toHaveBeenCalledWith(30000);
    
    const updatedMsg = await Message.findById(msg._id);
    expect(updatedMsg?.status).toBe("sent");
  });

  it("sendOutboundMessage marks as waiting_connection before waiting", async () => {
    const { sendOutboundMessage } = await import("../services/outbound.js");
    
    vi.mocked(waService.getWajsStatus).mockReturnValue("HYDRATING");
    // Simulate a slow connection wait
    vi.mocked(waService.waitForWhatsAppReady).mockImplementation(async () => {
        const m = await Message.findOne({ content: "Check my status" });
        expect(m?.status).toBe("waiting_connection");
    });

    const lead = await Lead.create({ 
        phone: "15550007777", 
        consent: { optedIn: true }, 
        lastActivity: new Date() 
      });

    const msg = await Message.create({
      leadId: lead._id,
      direction: "out",
      type: "text",
      content: "Check my status",
      status: "queued",
      fromMe: true,
      timestamp: new Date()
    });

    const { whatsAppAdapter } = await import("../adapters/whatsapp.js");
    vi.spyOn(whatsAppAdapter, "sendTextMessage").mockResolvedValue({ waMessageId: "wa-check-1" });

    await sendOutboundMessage(msg._id.toString(), 0);
  });
});
