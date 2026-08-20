import crypto from "node:crypto";
import type {
  NormalizedWhatsAppEvent,
  WhatsAppConnectionState,
  WhatsAppConnectionStatus,
  WhatsAppDownloadedMedia,
  WhatsAppMediaInput,
  WhatsAppMessageKey,
  WhatsAppProvider,
  WhatsAppQrCode,
  WhatsAppSendResult,
  WhatsAppContactInput,
  WhatsAppQuotedContext,
} from "./whatsapp.js";
import { normalizeWhatsAppText } from "./whatsapp.js";

export type EvolutionConfig = {
  baseUrl: string;
  apiKey: string;
  instanceName: string;
  webhookUrl: string;
  webhookSecret: string;
  requestTimeoutMs?: number;
  qrTtlSeconds?: number;
};

const webhookEvents = [
  "QRCODE_UPDATED", "CONNECTION_UPDATE", "MESSAGES_UPSERT", "MESSAGES_UPDATE", "MESSAGES_DELETE", "SEND_MESSAGE", "SEND_MESSAGE_UPDATE", "PRESENCE_UPDATE",
] as const;

export class EvolutionWhatsAppProvider implements WhatsAppProvider {
  private failures = 0;
  private circuitOpenedAt = 0;
  private lastEventAt: string | null = null;
  private lastConnectionAt: string | null = null;
  private currentQr: WhatsAppQrCode | null = null;

  constructor(private readonly config: EvolutionConfig) {}

  async getConnectionStatus(): Promise<WhatsAppConnectionStatus> {
    try {
      const data = await this.request(`/instance/connectionState/${encodeURIComponent(this.config.instanceName)}`, {}, true);
      const state = normalizeConnectionState(valueAt(data, "instance.state") ?? valueAt(data, "state"));
      let number = stringAt(data, ["instance.ownerJid", "instance.number", "ownerJid", "number"])?.replace(/@.+$/, "") ?? null;
      if (state === "open" && !number) {
        const details = await this.request(`/instance/fetchInstances?instanceName=${encodeURIComponent(this.config.instanceName)}`, {}, true);
        number = stringAt(details, ["items.0.ownerJid", "items.0.number", "instance.ownerJid", "instance.number", "ownerJid", "number"])?.replace(/@.+$/, "") ?? null;
      }
      if (state === "open") this.lastConnectionAt ??= new Date().toISOString();
      return this.status(state, number);
    } catch (error) {
      if (error instanceof IntegrationError && error.status === 404) return this.status("not_created", null);
      return this.status("unavailable", null);
    }
  }

  async createInstance(): Promise<WhatsAppConnectionStatus> {
    const existing = await this.getConnectionStatus();
    if (existing.state !== "not_created" && existing.state !== "unavailable") return existing;
    try {
      await this.request("/instance/create", { method: "POST", body: JSON.stringify({ instanceName: this.config.instanceName, integration: "WHATSAPP-BAILEYS", qrcode: true, groupsIgnore: true, readStatus: false, syncFullHistory: false }) }, true);
    } catch (error) {
      if (!(error instanceof IntegrationError) || !/instance|instância/i.test(error.message) || !/already|exist|defined|used|403/i.test(error.message)) throw error;
    }
    await this.configureWebhook();
    return this.status("close", null);
  }

  async deleteInstance(): Promise<void> {
    await this.request(`/instance/delete/${encodeURIComponent(this.config.instanceName)}`, { method: "DELETE" }, true);
  }

  async connect(): Promise<WhatsAppQrCode> {
    const status = await this.getConnectionStatus();
    if (status.state === "not_created") {
      throw new IntegrationError(`A instância ${this.config.instanceName} não existe; criação automática está desabilitada.`, 409);
    }
    if (status.state === "open") {
      return { code: null, pairingCode: null, expiresAt: null, status: "open", count: null };
    }
    await this.configureWebhook();
    const qr = this.qrFrom(await this.request(`/instance/connect/${encodeURIComponent(this.config.instanceName)}`, {}, true));
    this.currentQr = qr;
    return qr;
  }

  async getQrCode(): Promise<WhatsAppQrCode> {
    const status = await this.getConnectionStatus();
    if (status.state !== "connecting") {
      this.currentQr = null;
      return { code: null, pairingCode: null, expiresAt: null, status: status.state, count: null };
    }
    if (this.currentQr?.code && this.currentQr.expiresAt && Date.parse(this.currentQr.expiresAt) > Date.now()) return this.currentQr;
    const qr = this.qrFrom(await this.request(`/instance/connect/${encodeURIComponent(this.config.instanceName)}`, {}, true));
    this.currentQr = qr;
    return qr;
  }

  async logout(): Promise<void> {
    await this.request(`/instance/logout/${encodeURIComponent(this.config.instanceName)}`, { method: "DELETE" }, true);
  }

  async restart(): Promise<WhatsAppConnectionStatus> {
    await this.request(`/instance/restart/${encodeURIComponent(this.config.instanceName)}`, { method: "POST" }, true);
    return this.getConnectionStatus();
  }

  async configureWebhook(): Promise<void> {
    await this.request(`/webhook/set/${encodeURIComponent(this.config.instanceName)}`, {
      method: "POST",
      body: JSON.stringify({ webhook: { enabled: true, url: this.config.webhookUrl, headers: { "x-webhook-secret": this.config.webhookSecret }, byEvents: false, base64: false, events: webhookEvents } }),
    }, true);
  }

  async sendText(phone: string, text: string, idempotencyKey: string): Promise<WhatsAppSendResult> {
    const normalizedText = normalizeWhatsAppText(text);
    const raw = await this.request(`/message/sendText/${encodeURIComponent(this.config.instanceName)}`, { method: "POST", headers: { "x-idempotency-key": idempotencyKey }, body: JSON.stringify({ number: phone, text: normalizedText, delay: 0, linkPreview: false }) }, false);
    return sendResult(raw);
  }

  sendImage(input: WhatsAppMediaInput) { return this.sendMedia("image", input); }
  sendVideo(input: WhatsAppMediaInput) { return this.sendMedia("video", input); }
  sendDocument(input: WhatsAppMediaInput) { return this.sendMedia("document", input); }
  async sendContact(input: WhatsAppContactInput): Promise<WhatsAppSendResult> {
    const raw = await this.request(`/message/sendContact/${encodeURIComponent(this.config.instanceName)}`, { method: "POST", headers: { "x-idempotency-key": input.idempotencyKey }, body: JSON.stringify({ number: input.phone, contact: [{ fullName: input.contactName, wuid: input.contactPhone, phoneNumber: input.contactPhone }] }) }, false);
    return sendResult(raw);
  }

  async sendAudio(input: WhatsAppMediaInput): Promise<WhatsAppSendResult> {
    const raw = await this.request(`/message/sendWhatsAppAudio/${encodeURIComponent(this.config.instanceName)}`, { method: "POST", headers: { "x-idempotency-key": input.idempotencyKey }, body: JSON.stringify({ number: input.phone, audio: input.mediaUrl, delay: 1000 }) }, false);
    return sendResult(raw);
  }

  async sendPresence(phone: string, presence: "unavailable" | "available" | "composing" | "recording" | "paused", delayMs = 1200): Promise<void> {
    await this.request(`/chat/sendPresence/${encodeURIComponent(this.config.instanceName)}`, { method: "POST", body: JSON.stringify({ number: phone, presence, delay: Math.max(0, Math.min(delayMs, 10_000)) }) }, true);
  }

  async presenceSubscribe(phone: string): Promise<void> {
    // Evolution's supported chat endpoint performs Baileys presenceSubscribe before publishing the update.
    await this.request(`/chat/sendPresence/${encodeURIComponent(this.config.instanceName)}`, { method: "POST", body: JSON.stringify({ number: phone, presence: "available", delay: 0 }) }, true);
  }

  async markAsRead(messages: WhatsAppMessageKey[]): Promise<void> {
    if (!messages.length) return;
    await this.request(`/chat/markMessageAsRead/${encodeURIComponent(this.config.instanceName)}`, { method: "POST", body: JSON.stringify({ readMessages: messages }) }, true);
  }

  async downloadMedia(message: Record<string, unknown>): Promise<WhatsAppDownloadedMedia> {
    const data = await this.request(`/chat/getBase64FromMediaMessage/${encodeURIComponent(this.config.instanceName)}`, { method: "POST", body: JSON.stringify({ message, convertToMp4: false }) }, true);
    const encoded = stringAt(data, ["base64", "data.base64"]);
    if (!encoded) throw new IntegrationError("Evolution não retornou a mídia solicitada.", 502);
    const clean = encoded.replace(/^data:[^;]+;base64,/, "");
    const bytes = Uint8Array.from(Buffer.from(clean, "base64"));
    if (!bytes.length || bytes.length > 25 * 1024 * 1024) throw new IntegrationError("Mídia vazia ou acima do limite de 25 MB.", 413);
    return { bytes, mimeType: stringAt(data, ["mimetype", "mimeType", "data.mimetype"]) ?? "application/octet-stream", fileName: stringAt(data, ["fileName", "data.fileName"]) };
  }

  validateWebhook(headers: Record<string, string | string[] | undefined>): boolean {
    const received = headerValue(headers, "x-webhook-secret");
    const expected = this.config.webhookSecret;
    if (!received || received.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
  }

  normalizeEvent(payload: Record<string, unknown>): NormalizedWhatsAppEvent {
    const raw = sanitizeWebhookPayload(payload);
    const sourceEvent = String(payload.event ?? payload.type ?? "unknown").trim().toUpperCase().replace(/[.\s-]+/g, "_");
    const data = record(payload.data);
    const key = record(data.key);
    const message = record(data.message);
    const primaryRemoteJid = stringAt({ key, data }, ["key.remoteJid", "data.remoteJid", "data.key.remoteJid", "data.id", "data.jid"]);
    const alternateRemoteJid = stringAt({ key, data, payload }, ["key.remoteJidAlt", "key.senderPn", "data.remoteJidAlt", "data.senderPn", "data.key.remoteJidAlt", "data.key.senderPn", "payload.senderPn"]);
    const remoteJid = primaryRemoteJid?.endsWith("@lid") && alternateRemoteJid ? phoneJid(alternateRemoteJid) : primaryRemoteJid;
    const externalMessageId = stringAt({ key, data, payload }, ["key.id", "data.id", "payload.id"]);
    const fromMe = Boolean(key.fromMe ?? data.fromMe);
    const ignored = ignoreReason(remoteJid, fromMe, sourceEvent);
    const messageType = detectMessageType(message, data);
    const text = extractText(message, data);
    const quotedContext = extractQuotedContext(message, data);
    const status = deliveryStatus(data.status ?? record(data.update).status ?? payload.status);
    const eventType = normalizeEventType(sourceEvent, status, fromMe);
    const phone = remoteJid?.replace(/@.+$/, "").replace(/\D/g, "") || null;
    const relevant = !ignored && eventType !== "ignored" && (eventType !== "message.received" || Boolean(text || messageType !== "unknown"));
    const event: NormalizedWhatsAppEvent = {
      eventId: externalMessageId ? `${sourceEvent}:${externalMessageId}` : crypto.createHash("sha256").update(JSON.stringify(raw)).digest("hex"),
      eventType: relevant ? eventType : "ignored",
      sourceEvent, instanceName: String(payload.instance ?? data.instance ?? this.config.instanceName), occurredAt: eventTime(data), relevant,
      ignoreReason: relevant ? null : ignored ?? "evento_sem_conteudo_relevante", externalMessageId: externalMessageId ?? null,
      phone, remoteJid: remoteJid ?? null, fromMe, pushName: stringAt(data, ["pushName", "notifyName"]), text, quotedContext,
      messageType, status, connectionState: sourceEvent.includes("CONNECTION") ? normalizeConnectionState(data.state ?? data.connection) : null,
      qrCode: sourceEvent.includes("QRCODE") ? stringAt(data, ["base64", "qrcode.base64", "code"]) : null, raw,
    };
    this.lastEventAt = event.occurredAt;
    if (event.connectionState === "open") this.lastConnectionAt = event.occurredAt;
    return event;
  }

  private async sendMedia(mediatype: "image" | "video" | "document", input: WhatsAppMediaInput): Promise<WhatsAppSendResult> {
    const raw = await this.request(`/message/sendMedia/${encodeURIComponent(this.config.instanceName)}`, { method: "POST", headers: { "x-idempotency-key": input.idempotencyKey }, body: JSON.stringify({ number: input.phone, mediatype, mimetype: input.mimeType, media: input.mediaUrl, fileName: input.fileName, caption: input.caption ?? "" }) }, false);
    return sendResult(raw);
  }

  private async request(path: string, init: RequestInit, retrySafe: boolean): Promise<Record<string, unknown>> {
    if (this.circuitOpenedAt && Date.now() - this.circuitOpenedAt < 30_000) throw new IntegrationError("Circuit breaker da Evolution está aberto.", 503, undefined, true);
    const attempts = retrySafe ? 3 : 1;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(new DOMException("Evolution request timeout", "TimeoutError")), this.config.requestTimeoutMs ?? 15_000);
        let response: Response;
        try {
          response = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}${path}`, {
          ...init,
          headers: { "content-type": "application/json", apikey: this.config.apiKey, ...(init.headers ?? {}) },
          signal: controller.signal,
          });
        } finally { clearTimeout(timeout); }
        const text = await response.text();
        let body: Record<string, unknown> = {};
        try {
          const parsed = text ? JSON.parse(text) : {};
          body = Array.isArray(parsed) ? { items: parsed } : record(parsed);
        } catch { body = {}; }
        if (!response.ok) {
          const nested = valueAt(body, "response.message");
          const nestedMessage = Array.isArray(nested) ? nested.map(String).join(" ") : typeof nested === "string" ? nested : "";
          const detail = [stringAt(body, ["message"]), nestedMessage, stringAt(body, ["error"])].filter(Boolean).join(" | ");
          throw new IntegrationError(detail ? `${detail} (HTTP ${response.status})` : (text && !text.trimStart().startsWith("<") ? `${text.slice(0, 300)} (HTTP ${response.status})` : `Evolution respondeu ${response.status}.`), response.status, sanitizeWebhookPayload(body), recoverableStatus(response.status));
        }
        this.failures = 0; this.circuitOpenedAt = 0; return body;
      } catch (error) {
        lastError = error;
        const recoverable = isRecoverable(error);
        this.failures += 1;
        if (this.failures >= 5) this.circuitOpenedAt = Date.now();
        if (!retrySafe || !recoverable || attempt === attempts) break;
        await sleep(Math.round(250 * 2 ** (attempt - 1) * (0.8 + Math.random() * 0.4)));
      }
    }
    if (lastError instanceof IntegrationError) throw lastError;
    throw new IntegrationError("Evolution indisponível ou excedeu o timeout.", 503, undefined, true);
  }

  private status(state: WhatsAppConnectionState, number: string | null): WhatsAppConnectionStatus {
    return { instanceName: this.config.instanceName, state, number, lastConnectionAt: this.lastConnectionAt, lastEventAt: this.lastEventAt, available: state !== "unavailable" && !this.circuitOpenedAt, circuit: this.circuitOpenedAt ? (Date.now() - this.circuitOpenedAt >= 30_000 ? "half_open" : "open") : "closed", simulation: false };
  }

  private qrFrom(data: Record<string, unknown>): WhatsAppQrCode {
    const ttl = this.config.qrTtlSeconds ?? 45;
    return {
      code: normalizeQr(stringAt(data, ["base64", "qrcode.base64", "instance.qrcode.base64", "code"])),
      pairingCode: stringAt(data, ["pairingCode", "qrcode.pairingCode", "instance.qrcode.pairingCode"]),
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
      status: "connecting",
      count: numberAt(data, ["count", "qrcode.count", "instance.qrcode.count"]),
    };
  }
}

export class IntegrationError extends Error {
  public readonly statusCode: number;
  constructor(message: string, public readonly status: number, public readonly details?: unknown, public readonly recoverable = false) {
    super(message);
    this.statusCode = status;
  }
}

function sendResult(raw: Record<string, unknown>): WhatsAppSendResult { return { externalMessageId: stringAt(raw, ["key.id", "id", "messageId"]) ?? crypto.randomUUID(), status: "sent", raw: sanitizeWebhookPayload(raw) }; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function valueAt(data: unknown, path: string): unknown {
  return path.split(".").reduce((current: unknown, key) => {
    if (Array.isArray(current)) return current[Number(key)];
    return record(current)[key];
  }, data);
}
function stringAt(data: unknown, paths: string[]): string | null { for (const path of paths) { const value = valueAt(data, path); if (typeof value === "string" && value) return value; } return null; }
function phoneJid(value: string) { const digits = value.replace(/@.+$/, "").replace(/\D/g, ""); return digits ? `${digits}@s.whatsapp.net` : value; }
function numberAt(data: unknown, paths: string[]): number | null { for (const path of paths) { const value = valueAt(data, path); const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN; if (Number.isFinite(parsed)) return parsed; } return null; }
function normalizeConnectionState(value: unknown): WhatsAppConnectionState { const state = String(value ?? "").toLowerCase(); return state === "open" ? "open" : state === "connecting" ? "connecting" : state === "close" || state === "closed" ? "close" : state === "not_created" ? "not_created" : "unavailable"; }
function normalizeQr(value: string | null) {
  if (!value) return null;
  if (/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value)) return value;
  if (value.length > 300 && /^[a-z0-9+/=]+$/i.test(value)) return `data:image/png;base64,${value}`;
  return null;
}
function headerValue(headers: Record<string, string | string[] | undefined>, name: string) { const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name); const value = entry?.[1]; return Array.isArray(value) ? value[0] : value; }
function deliveryStatus(value: unknown): "sent" | "delivered" | "read" | "failed" | null { const status = String(value ?? "").toLowerCase(); if (status === "4" || status.includes("read")) return "read"; if (status === "3" || status.includes("deliver")) return "delivered"; if (status.includes("fail") || status.includes("error")) return "failed"; if (status === "2" || status.includes("sent") || status.includes("server_ack")) return "sent"; return null; }
function normalizeEventType(source: string, status: ReturnType<typeof deliveryStatus>, fromMe: boolean): NormalizedWhatsAppEvent["eventType"] { if (source.includes("QRCODE")) return "qr.updated"; if (source.includes("CONNECTION")) return "connection.updated"; if (source.includes("PRESENCE")) return "presence.updated"; if (source.includes("DELETE")) return "message.deleted"; if (source.includes("MESSAGES_UPSERT") && !fromMe) return "message.received"; if (status === "read") return "message.read"; if (status === "delivered") return "message.delivered"; if (status === "failed") return "message.failed"; if (source.includes("UPDATE")) return "message.updated"; if (source.includes("SEND_MESSAGE") || fromMe) return "message.sent"; return "ignored"; }
function ignoreReason(remoteJid: string | null, fromMe: boolean, event: string) { if (event.includes("MESSAGES_UPSERT") && fromMe) return "mensagem_do_proprio_sistema"; if (!remoteJid && event.includes("MESSAGE")) return "contato_ausente"; if (remoteJid?.endsWith("@g.us")) return "grupo"; if (remoteJid === "status@broadcast") return "status"; if (remoteJid?.includes("newsletter")) return "newsletter"; if (remoteJid && !remoteJid.endsWith("@s.whatsapp.net") && event.includes("MESSAGE")) return "jid_invalido"; return null; }
function detectMessageType(message: Record<string, unknown>, data: Record<string, unknown>): NormalizedWhatsAppEvent["messageType"] { const type = String(data.messageType ?? Object.keys(message)[0] ?? "").toLowerCase(); if (type.includes("image")) return "image"; if (type.includes("video")) return "video"; if (type.includes("audio")) return "audio"; if (type.includes("document")) return "document"; if (type.includes("conversation") || type.includes("text")) return "text"; return "unknown"; }
function extractText(message: Record<string, unknown>, data: Record<string, unknown>) { return stringAt({ message, data }, ["message.conversation", "message.extendedTextMessage.text", "message.imageMessage.caption", "message.videoMessage.caption", "message.documentMessage.caption", "data.body", "data.text"]); }
function extractQuotedContext(message: Record<string, unknown>, data: Record<string, unknown>): WhatsAppQuotedContext | null {
  const nestedContext = record(valueAt(message, "extendedTextMessage.contextInfo"));
  const context = Object.keys(nestedContext).length ? nestedContext : record(data.contextInfo ?? message.contextInfo);
  const quotedMessage = record(context.quotedMessage);
  if (!Object.keys(quotedMessage).length && !context.stanzaId && !context.participant) return null;
  const quotedKey = record(quotedMessage.key);
  const fromMeValue = quotedKey.fromMe ?? context.fromMe;
  return {
    stanzaId: typeof context.stanzaId === "string" ? context.stanzaId : null,
    participant: typeof context.participant === "string" ? context.participant : null,
    fromMe: typeof fromMeValue === "boolean" ? fromMeValue : null,
    text: stringAt({ message: quotedMessage }, ["message.conversation", "message.extendedTextMessage.text", "message.imageMessage.caption", "message.videoMessage.caption", "message.documentMessage.caption"]),
  };
}
function eventTime(data: Record<string, unknown>) { const value = data.messageTimestamp ?? data.timestamp; const numeric = Number(value); return Number.isFinite(numeric) && numeric > 0 ? new Date(numeric < 1e12 ? numeric * 1000 : numeric).toISOString() : new Date().toISOString(); }
function recoverableStatus(status: number) { return status === 408 || status === 425 || status === 429 || status >= 500; }
function isRecoverable(error: unknown) { return error instanceof IntegrationError ? error.recoverable : error instanceof TypeError || (error instanceof DOMException && error.name === "TimeoutError"); }
function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

export function sanitizeWebhookPayload(input: unknown, depth = 0): any {
  if (depth > 10) return "[depth-limit]";
  if (typeof input === "string") return input.length > 16_000 ? `${input.slice(0, 16_000)}[truncated]` : input;
  if (Array.isArray(input)) return input.slice(0, 100).map((item) => sanitizeWebhookPayload(item, depth + 1));
  if (!input || typeof input !== "object") return input;
  return Object.fromEntries(Object.entries(input as Record<string, unknown>).filter(([key]) => !/(apikey|authorization|token|secret|password)/i.test(key)).map(([key, value]) => [key, sanitizeWebhookPayload(value, depth + 1)]));
}
