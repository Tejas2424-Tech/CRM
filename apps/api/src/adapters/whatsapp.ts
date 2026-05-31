import type { WhatsAppWebhookMessage } from "@crm/shared";
import { env } from "../config/env.js";
import { getWajsClient } from "../services/whatsappWebjs.service.js";

export interface SendTextPayload {
  phone: string;
  chatId?: string;
  text: string;
}

export interface SendTemplatePayload {
  phone: string;
  chatId?: string;
  templateName: string;
  language: string;
  variables?: Record<string, string>;
}

export interface WhatsAppAdapter {
  sendTextMessage(payload: SendTextPayload): Promise<{ waMessageId: string }>;
  sendTemplateMessage(payload: SendTemplatePayload): Promise<{ waMessageId: string }>;
  parseWebhook(payload: unknown): WhatsAppWebhookMessage[];
}

export class MockWhatsAppAdapter implements WhatsAppAdapter {
  async sendTextMessage(_payload: SendTextPayload): Promise<{ waMessageId: string }> {
    return { waMessageId: `mock_${crypto.randomUUID()}` };
  }

  async sendTemplateMessage(_payload: SendTemplatePayload): Promise<{ waMessageId: string }> {
    return { waMessageId: `mock_tpl_${crypto.randomUUID()}` };
  }

  parseWebhook(payload: unknown): WhatsAppWebhookMessage[] {
    const body = payload as any;
    const parsed: WhatsAppWebhookMessage[] = [];

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        for (const message of value?.messages ?? []) {
          const contact = value?.contacts?.find((item: any) => item.wa_id === message.from);
          
          let text = message.text?.body || "";
          if (!text && message.interactive?.button_reply?.title) {
            text = message.interactive.button_reply.title;
          } else if (!text && message.button?.text) {
            text = message.button.text;
          }

          parsed.push({
            waMessageId: message.id,
            phone: message.from,
            name: contact?.profile?.name,
            text,
            timestamp: message.timestamp ? new Date(Number(message.timestamp) * 1000).toISOString() : undefined
          });
        }
      }
    }
    return parsed;
  }
}

export class MetaWhatsAppAdapter extends MockWhatsAppAdapter {
  private get baseUrl() {
    return `https://graph.facebook.com/${env.WA_API_VERSION}/${env.WA_PHONE_NUMBER_ID}/messages`;
  }

  async sendTextMessage(payload: SendTextPayload): Promise<{ waMessageId: string }> {
    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.WA_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: payload.phone,
        type: "text",
        text: { body: payload.text }
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(`Meta API error: ${JSON.stringify(data)}`);
    return { waMessageId: data.messages[0].id };
  }

  async sendTemplateMessage(payload: SendTemplatePayload): Promise<{ waMessageId: string }> {
    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.WA_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: payload.phone,
        type: "template",
        template: {
          name: payload.templateName,
          language: { code: payload.language }
        }
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(`Meta API error: ${JSON.stringify(data)}`);
    return { waMessageId: data.messages[0].id };
  }
}

// ─── whatsapp-web.js Adapter ─────────────────────────────────────────────────

/**
 * WaJsAdapter — routes outbound messages through the whatsapp-web.js
 * singleton client (see services/whatsappWebjs.service.ts).
 *
 * Template messages are not natively supported by whatsapp-web.js
 * (it uses the unofficial Web protocol, not the BSP API), so they
 * are sent as plain-text fallbacks.
 */
export class WaJsAdapter implements WhatsAppAdapter {
  async sendTextMessage(payload: SendTextPayload): Promise<{ waMessageId: string }> {
    const client = getWajsClient();
    try {
      const state = await client.getState();
      console.log(`[WaJsAdapter] [Step 6] Current WA State before send: ${state}`);
    } catch (err) {
      console.warn(`[WaJsAdapter] Could not fetch state before send:`, err);
    }
    
    let chatId = payload.chatId;
    if (!chatId) {
      const numberStr = payload.phone.replace(/^\+/, "");
      try {
        const numberId = await client.getNumberId(numberStr);
        chatId = numberId ? numberId._serialized : `${numberStr}@c.us`;
      } catch (err) {
        chatId = `${numberStr}@c.us`;
      }
    }
    console.log(`[WaJsAdapter] [Step 3] Sending to chatId: ${chatId} (type: ${typeof chatId})`);
    
    try {
      console.log(`[WaJsAdapter] [Step 8] Executing client.sendMessage...`);
      const msg = await client.sendMessage(chatId, payload.text);
      const waMessageId: string = (msg as any).id?._serialized ?? (msg as any).id?.id ?? `wjs_${crypto.randomUUID()}`;
      console.log(`[WaJsAdapter] [Step 9] Send success, waMessageId: ${waMessageId}`);
      return { waMessageId };
    } catch (err: any) {
      // [Step 7] Capture Actual sendMessage Errors
      console.error("[WaJsAdapter] [Step 7] client.sendMessage FAILED:");
      console.error("  - Error:", err.message);
      console.error("  - Stack:", err.stack);
      console.error("  - Target chatId:", chatId);
      throw err;
    }
  }

  async sendTemplateMessage(payload: SendTemplatePayload): Promise<{ waMessageId: string }> {
    // whatsapp-web.js has no BSP template support — send as plain text
    const fallbackText = `[${payload.templateName}]`;
    return this.sendTextMessage({ phone: payload.phone, chatId: payload.chatId, text: fallbackText });
  }

  // Not used in webjs mode — inbound comes via event listener, not webhook
  parseWebhook(_payload: unknown): WhatsAppWebhookMessage[] {
    return [];
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────
//
// Priority: WA_CLIENT_MODE (new) → MOCK_WHATSAPP (legacy fallback)

function createAdapter(): WhatsAppAdapter {
  if (env.WA_CLIENT_MODE === "webjs") return new WaJsAdapter();
  if (env.WA_CLIENT_MODE === "meta")  return new MetaWhatsAppAdapter();
  if (env.WA_CLIENT_MODE === "mock")  return new MockWhatsAppAdapter();
  // Legacy: respect old MOCK_WHATSAPP flag
  return env.MOCK_WHATSAPP === "true"
    ? new MockWhatsAppAdapter()
    : new MetaWhatsAppAdapter();
}

export const whatsAppAdapter: WhatsAppAdapter = createAdapter();
