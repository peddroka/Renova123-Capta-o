export type WhatsAppConnectionState = "not_created" | "close" | "connecting" | "open" | "unavailable";

export type WhatsAppConnectionStatus = {
  instanceName: string;
  state: WhatsAppConnectionState;
  number: string | null;
  lastConnectionAt: string | null;
  lastEventAt: string | null;
  available: boolean;
  circuit: "closed" | "open" | "half_open";
  simulation: boolean;
};

export type WhatsAppQrCode = {
  code: string | null;
  pairingCode: string | null;
  expiresAt: string | null;
  status: WhatsAppConnectionState;
  count: number | null;
};

export type WhatsAppSendResult = {
  externalMessageId: string;
  status: "queued" | "sent" | "simulated";
  raw: Record<string, unknown>;
};

export type WhatsAppMediaInput = {
  phone: string;
  mediaUrl: string;
  mimeType: string;
  fileName: string;
  caption?: string;
  idempotencyKey: string;
};
export type WhatsAppContactInput = { phone: string; contactName: string; contactPhone: string; idempotencyKey: string };

export type WhatsAppMessageKey = { id: string; remoteJid: string; fromMe: boolean; participant?: string };
export type WhatsAppDownloadedMedia = { bytes: Uint8Array; mimeType: string; fileName: string | null };
export type WhatsAppQuotedContext = {
  stanzaId: string | null;
  participant: string | null;
  fromMe: boolean | null;
  text: string | null;
};

export type NormalizedWhatsAppEventType =
  | "message.received"
  | "message.updated"
  | "message.sent"
  | "message.delivered"
  | "message.read"
  | "message.failed"
  | "message.deleted"
  | "connection.updated"
  | "presence.updated"
  | "qr.updated"
  | "ignored";

export type NormalizedWhatsAppEvent = {
  eventId: string;
  eventType: NormalizedWhatsAppEventType;
  sourceEvent: string;
  instanceName: string;
  occurredAt: string;
  relevant: boolean;
  ignoreReason: string | null;
  externalMessageId: string | null;
  phone: string | null;
  remoteJid: string | null;
  fromMe: boolean;
  pushName: string | null;
  text: string | null;
  quotedContext: WhatsAppQuotedContext | null;
  messageType: "text" | "image" | "video" | "audio" | "document" | "unknown";
  status: "sent" | "delivered" | "read" | "failed" | null;
  connectionState: WhatsAppConnectionState | null;
  qrCode: string | null;
  raw: Record<string, unknown>;
};

export interface WhatsAppProvider {
  getConnectionStatus(): Promise<WhatsAppConnectionStatus>;
  createInstance(): Promise<WhatsAppConnectionStatus>;
  deleteInstance(): Promise<void>;
  connect(): Promise<WhatsAppQrCode>;
  getQrCode(): Promise<WhatsAppQrCode>;
  logout(): Promise<void>;
  restart(): Promise<WhatsAppConnectionStatus>;
  configureWebhook(): Promise<void>;
  sendText(phone: string, text: string, idempotencyKey: string): Promise<WhatsAppSendResult>;
  sendImage(input: WhatsAppMediaInput): Promise<WhatsAppSendResult>;
  sendVideo(input: WhatsAppMediaInput): Promise<WhatsAppSendResult>;
  sendAudio(input: WhatsAppMediaInput): Promise<WhatsAppSendResult>;
  sendDocument(input: WhatsAppMediaInput): Promise<WhatsAppSendResult>;
  sendContact(input: WhatsAppContactInput): Promise<WhatsAppSendResult>;
  sendPresence(phone: string, presence: "unavailable" | "available" | "composing" | "recording" | "paused", delayMs?: number): Promise<void>;
  presenceSubscribe(phone: string): Promise<void>;
  markAsRead(messages: WhatsAppMessageKey[]): Promise<void>;
  downloadMedia(message: Record<string, unknown>): Promise<WhatsAppDownloadedMedia>;
  validateWebhook(headers: Record<string, string | string[] | undefined>): boolean;
  normalizeEvent(payload: Record<string, unknown>): NormalizedWhatsAppEvent;
}

/**
 * Normalizes text at the WhatsApp boundary without decoding arbitrary backslashes.
 * Only odd-parity JSON control/unicode escapes are interpreted; even-parity
 * sequences remain literal. The operation is idempotent and preserves Unicode.
 */
export function normalizeWhatsAppText(input: string) {
  const source = input.normalize("NFC").replace(/\r\n?/g, "\n");
  let output = "";
  let inInlineCode = false;
  let inFence = false;
  for (let index = 0; index < source.length;) {
    if (source.startsWith("```", index)) { inFence = !inFence; output += "```"; index += 3; continue; }
    if (!inFence && source[index] === "`") { inInlineCode = !inInlineCode; output += "`"; index += 1; continue; }
    if (source[index] !== "\\" || inFence || inInlineCode) { output += source[index]; index += 1; continue; }
    let end = index;
    while (source[end] === "\\") end += 1;
    const slashCount = end - index;
    const marker = source[end];
    if (slashCount % 2 === 0 || !marker) { output += "\\".repeat(slashCount); index = end; continue; }
    output += "\\".repeat(Math.floor(slashCount / 2));
    if (marker === "r" && source.slice(end + 1, end + 3) === "\\n") { output += "\n"; index = end + 3; continue; }
    if (marker === "n" || marker === "r") { output += "\n"; index = end + 1; continue; }
    if (marker === "t") { output += "\t"; index = end + 1; continue; }
    if (marker === "u") {
      const first = source.slice(end + 1, end + 5);
      if (/^[0-9a-f]{4}$/i.test(first)) {
        const high = Number.parseInt(first, 16);
        const following = source.slice(end + 5, end + 11);
        if (high >= 0xd800 && high <= 0xdbff && /^\\u[0-9a-f]{4}$/i.test(following)) {
          const low = Number.parseInt(following.slice(2), 16);
          if (low >= 0xdc00 && low <= 0xdfff) { output += String.fromCodePoint((high - 0xd800) * 0x400 + low - 0xdc00 + 0x10000); index = end + 11; continue; }
        }
        if (high < 0xd800 || high > 0xdfff) { output += String.fromCharCode(high); index = end + 5; continue; }
      }
    }
    output += "\\" + marker;
    index = end + 1;
  }
  return output.normalize("NFC");
}
