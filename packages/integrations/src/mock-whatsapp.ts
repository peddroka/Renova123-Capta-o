import crypto from "node:crypto";
import type { NormalizedWhatsAppEvent, WhatsAppConnectionStatus, WhatsAppDownloadedMedia, WhatsAppMediaInput, WhatsAppMessageKey, WhatsAppProvider, WhatsAppQrCode, WhatsAppSendResult, WhatsAppContactInput } from "./whatsapp.js";
import { EvolutionWhatsAppProvider, sanitizeWebhookPayload, type EvolutionConfig } from "./evolution.js";

export class MockWhatsAppProvider implements WhatsAppProvider {
  private state: WhatsAppConnectionStatus["state"] = "not_created";
  private lastConnectionAt: string | null = null;
  private lastEventAt: string | null = null;
  private readonly normalizer: EvolutionWhatsAppProvider;
  readonly operations: Array<{ action: string; data?: unknown }> = [];

  constructor(private readonly config: Pick<EvolutionConfig, "instanceName" | "webhookSecret">) {
    this.normalizer = new EvolutionWhatsAppProvider({ baseUrl: "http://127.0.0.1:8080", apiKey: "mock", webhookUrl: "http://127.0.0.1/webhook", ...config });
  }
  async getConnectionStatus() { return this.status(); }
  async createInstance() { this.state = "close"; this.operations.push({ action: "createInstance" }); return this.status(); }
  async deleteInstance() { this.state = "not_created"; this.operations.push({ action: "deleteInstance" }); }
  async connect() { if (this.state === "not_created") await this.createInstance(); this.state = "connecting"; this.operations.push({ action: "connect" }); return this.qr(); }
  async getQrCode() { return this.state === "connecting" ? this.qr() : { code: null, pairingCode: null, expiresAt: null, status: this.state, count: null }; }
  async logout() { this.state = "close"; this.operations.push({ action: "logout" }); }
  async restart() { this.state = "open"; this.lastConnectionAt = new Date().toISOString(); this.operations.push({ action: "restart" }); return this.status(); }
  async configureWebhook() { this.operations.push({ action: "configureWebhook" }); }
  sendText(phone: string, text: string, idempotencyKey: string) { return this.sent("sendText", { phone, text, idempotencyKey }); }
  sendImage(input: WhatsAppMediaInput) { return this.sent("sendImage", input); }
  sendVideo(input: WhatsAppMediaInput) { return this.sent("sendVideo", input); }
  sendAudio(input: WhatsAppMediaInput) { return this.sent("sendAudio", input); }
  sendDocument(input: WhatsAppMediaInput) { return this.sent("sendDocument", input); }
  sendContact(input: WhatsAppContactInput) { return this.sent("sendContact", input); }
  async sendPresence(phone: string, presence: string, delayMs?: number) { this.operations.push({ action: "sendPresence", data: { phone, presence, delayMs } }); }
  async presenceSubscribe(phone: string) { this.operations.push({ action: "presenceSubscribe", data: { phone } }); }
  async markAsRead(messages: WhatsAppMessageKey[]) { this.operations.push({ action: "markAsRead", data: messages }); }
  async downloadMedia(message: Record<string, unknown>): Promise<WhatsAppDownloadedMedia> { this.operations.push({ action: "downloadMedia", data: sanitizeWebhookPayload(message) }); return { bytes: Uint8Array.from([79, 103, 103, 83]), mimeType: "audio/ogg", fileName: "audio-mock.ogg" }; }
  validateWebhook(headers: Record<string, string | string[] | undefined>) { const value = Object.entries(headers).find(([key]) => key.toLowerCase() === "x-webhook-secret")?.[1]; return (Array.isArray(value) ? value[0] : value) === this.config.webhookSecret; }
  normalizeEvent(payload: Record<string, unknown>): NormalizedWhatsAppEvent { const event = this.normalizer.normalizeEvent(payload); this.lastEventAt = event.occurredAt; return event; }
  simulateConnected(number = "5511999999999") { this.state = "open"; this.lastConnectionAt = new Date().toISOString(); this.operations.push({ action: "simulateConnected", data: { number } }); }
  private status(): WhatsAppConnectionStatus { return { instanceName: this.config.instanceName, state: this.state, number: this.state === "open" ? "5511999999999" : null, lastConnectionAt: this.lastConnectionAt, lastEventAt: this.lastEventAt, available: true, circuit: "closed", simulation: true }; }
  private qr(): WhatsAppQrCode { return { code: null, pairingCode: null, expiresAt: null, status: "connecting", count: 1 }; }
  private async sent(action: string, data: unknown): Promise<WhatsAppSendResult> { const id = `mock-${crypto.randomUUID()}`; this.operations.push({ action, data }); return { externalMessageId: id, status: "simulated", raw: { key: { id }, status: "SIMULATED" } }; }
}
