import { afterEach, describe, expect, it, vi } from "vitest";
import { EvolutionWhatsAppProvider } from "./evolution.js";
import { normalizeWhatsAppText } from "./whatsapp.js";
import { MockWhatsAppProvider } from "./mock-whatsapp.js";

const config = { baseUrl: "http://evolution.test", apiKey: "server-only-key", instanceName: "renova123-francisco", webhookUrl: "https://api.test/webhooks/evolution", webhookSecret: "secret-with-at-least-16-chars" };
afterEach(() => vi.unstubAllGlobals());

describe("EvolutionWhatsAppProvider v2.3.7", () => {
  it("configura o webhook com o contrato exato e sem segredo na URL", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await new EvolutionWhatsAppProvider(config).configureWebhook();
    const [url, init] = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0]!;
    expect(url).toBe("http://evolution.test/webhook/set/renova123-francisco");
    expect(init.headers).toMatchObject({ apikey: "server-only-key" });
    const body = JSON.parse(String(init.body));
    expect(body.webhook).toMatchObject({ enabled: true, byEvents: false, base64: false, url: config.webhookUrl, headers: { "x-webhook-secret": config.webhookSecret } });
    expect(body.webhook.events).toContain("PRESENCE_UPDATE");
    expect(body.webhook).not.toHaveProperty("webhookByEvents");
  });

  it("normaliza inbound e ignora grupos, newsletters e mensagens próprias", () => {
    const provider = new EvolutionWhatsAppProvider(config);
    const inbound = provider.normalizeEvent({ event: "MESSAGES_UPSERT", instance: "renova123-francisco", data: { key: { id: "abc", remoteJid: "5511987654321@s.whatsapp.net", fromMe: false }, pushName: "Marina", message: { conversation: "Quero uma demonstração" }, messageTimestamp: 1_786_000_000 } });
    expect(inbound).toMatchObject({ eventId: "MESSAGES_UPSERT:abc", eventType: "message.received", phone: "5511987654321", text: "Quero uma demonstração", relevant: true });
    const lidInbound = provider.normalizeEvent({ event: "MESSAGES_UPSERT", data: { key: { id: "lid-1", remoteJid: "123456789@lid", remoteJidAlt: "558288543864@s.whatsapp.net", fromMe: false }, status: "DELIVERY_ACK", message: { conversation: "Pode sim" } } });
    expect(lidInbound).toMatchObject({ eventType: "message.received", phone: "558288543864", text: "Pode sim", relevant: true });
    const senderPnInbound = provider.normalizeEvent({ event: "MESSAGES_UPSERT", data: { key: { id: "lid-2", remoteJid: "987654321@lid", senderPn: "5511992468815@s.whatsapp.net", fromMe: false }, message: { conversation: "Sou eu" } } });
    expect(senderPnInbound).toMatchObject({ eventType: "message.received", phone: "5511992468815", text: "Sou eu", relevant: true });
    for (const remoteJid of ["551199@g.us", "status@broadcast", "123@newsletter"]) {
      expect(provider.normalizeEvent({ event: "MESSAGES_UPSERT", data: { key: { id: remoteJid, remoteJid, fromMe: false }, message: { conversation: "oi" } } }).eventType).toBe("ignored");
    }
    expect(provider.normalizeEvent({ event: "MESSAGES_UPSERT", data: { key: { id: "own", remoteJid: "5511987654321@s.whatsapp.net", fromMe: true }, message: { conversation: "oi" } } }).eventType).toBe("ignored");
  });
  it("mantém o corpo do reply separado da mensagem citada", () => {
    const event = new EvolutionWhatsAppProvider(config).normalizeEvent({
      event: "MESSAGES_UPSERT",
      data: {
        key: { id: "reply-1", remoteJid: "5511987654321@s.whatsapp.net", fromMe: false },
        message: { conversation: "Pode sim" },
        contextInfo: {
          stanzaId: "opener-1",
          participant: "5511000000000@s.whatsapp.net",
          quotedMessage: { conversation: "Peguei o contato pelo Instagram. Sou Francisco, da Renova123; posso te fazer uma pergunta rápida sobre a loja?" },
        },
      },
    });
    expect(event.text).toBe("Pode sim");
    expect(event.quotedContext).toMatchObject({ stanzaId: "opener-1", participant: "5511000000000@s.whatsapp.net", text: expect.stringContaining("Sou Francisco") });
    expect(event.text).not.toContain("Sou Francisco");
  });
  it("lê contextInfo do extendedTextMessage sem misturá-lo ao texto", () => {
    const event = new EvolutionWhatsAppProvider(config).normalizeEvent({
      event: "MESSAGES_UPSERT",
      data: {
        key: { id: "reply-raw", remoteJid: "5511987654321@s.whatsapp.net", fromMe: false },
        message: { extendedTextMessage: { text: "Pode sim", contextInfo: { stanzaId: "opener-raw", participant: "5511000000000@s.whatsapp.net", quotedMessage: { extendedTextMessage: { text: "Sou Francisco, da Renova123." } } } } },
      },
    });
    expect(event).toMatchObject({ text: "Pode sim", quotedContext: { stanzaId: "opener-raw", text: "Sou Francisco, da Renova123." } });
  });
  it("envia o WebMessageInfo diretamente ao download de mídia", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ base64: "YQ==", mimetype: "audio/ogg" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const message = { key: { id: "audio-real", remoteJid: "5511987654321@s.whatsapp.net" }, message: { audioMessage: { mimetype: "audio/ogg; codecs=opus" } }, messageType: "audioMessage" };
    await new EvolutionWhatsAppProvider(config).downloadMedia(message);
    const body = JSON.parse(String((fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0]![1].body));
    expect(body.message).toEqual(message);
    expect(body.message.data).toBeUndefined();
  });
  it("normaliza PRESENCE_UPDATE com o telefone do lead", () => {
    const event = new EvolutionWhatsAppProvider(config).normalizeEvent({ event: "PRESENCE_UPDATE", instance: config.instanceName, data: { id: "5511987654321@s.whatsapp.net", presences: { "5511987654321@s.whatsapp.net": { lastKnownPresence: "available" } } } });
    expect(event).toMatchObject({ eventType: "presence.updated", phone: "5511987654321", relevant: true });
  });

  it("não repete automaticamente POST de mensagem em erro recuperável", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "temporary" }), { status: 503, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new EvolutionWhatsAppProvider(config).sendText("5511987654321", "Olá", "once")).rejects.toThrow("503");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("usa digitação proporcional ao tamanho da mensagem", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ key: { id: "sent-1" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new EvolutionWhatsAppProvider(config);
    await provider.sendText("5511987654321", "Oi", "short");
    await provider.sendText("5511987654321", "Uma mensagem consideravelmente maior para simular o tempo natural de digitação.", "long");
    const shortBody = JSON.parse(String((fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0]![1].body));
    const longBody = JSON.parse(String((fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[1]![1].body));
    expect(shortBody.delay).toBe(0);
    expect(longBody.delay).toBe(0);
  });
  it("envia newline real e preserva UTF-8, acentos e emoji", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ key: { id: "sent-utf8" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await new EvolutionWhatsAppProvider(config).sendText("5511987654321", "Olá! 😊\\nÓtica, medição, prescrição, você, não.", "utf8");
    const body = JSON.parse(String((fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0]![1].body));
    expect(body.text).toBe("Olá! 😊\nÓtica, medição, prescrição, você, não.");
    expect(body.text).not.toContain("\\n");
  });
  it("preserva o opener brasileiro exato no JSON enviado ao Evolution", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ key: { id: "sent-opener-utf8" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const text = "Tudo certo? Você é o responsável pela ótica por aí?";
    await new EvolutionWhatsAppProvider(config).sendText("5582988543864", text, "opener-utf8");
    const body = JSON.parse(String((fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0]![1].body));
    expect(body.text).toBe(text);
    expect(body.text).not.toContain("�");
    expect(body.text).toContain("Você");
    expect(body.text).toContain("responsável");
    expect(body.text).toContain("ótica");
    expect(body.text).toContain("aí");
  });

  it("expõe erro aninhado e tolera resposta HTML de proxy", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Forbidden", response: { message: ["Instance already exists"] } }), { status: 403 })));
    await expect(new EvolutionWhatsAppProvider(config).sendText("5511987654321", "Olá", "once")).rejects.toThrow("Instance already exists");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>tunnel error</html>", { status: 502 })));
    await expect(new EvolutionWhatsAppProvider(config).sendText("5511987654321", "Olá", "twice")).rejects.toThrow("Evolution respondeu 502");
  });

  it("reaproveita instância já existente durante o connect", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("connectionState")) return new Response(JSON.stringify({}), { status: 404 });
      if (url.endsWith("/instance/create")) return new Response(JSON.stringify({ error: "Forbidden", response: { message: ["Instance already exists"] } }), { status: 403 });
      return new Response(JSON.stringify({ base64: "qr-code" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(new EvolutionWhatsAppProvider(config).connect()).resolves.toMatchObject({ status: "connecting" });
  });

  it("busca o número nos detalhes quando connectionState retorna somente open", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("connectionState")) return new Response(JSON.stringify({ instance: { state: "open" } }), { status: 200 });
      if (url.includes("fetchInstances")) return new Response(JSON.stringify([{ ownerJid: "5511987654321@s.whatsapp.net" }]), { status: 200 });
      return new Response(JSON.stringify({}), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(new EvolutionWhatsAppProvider(config).getConnectionStatus()).resolves.toMatchObject({ state: "open", number: "5511987654321" });
  });

  it("acompanha somente o QR vigente e não inicia pairing durante polling em close", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("connectionState")) return new Response(JSON.stringify({ instance: { state: "close" } }), { status: 200 });
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(new EvolutionWhatsAppProvider(config).getQrCode()).resolves.toEqual({ code: null, pairingCode: null, expiresAt: null, status: "close", count: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toContain("connectionState");
  });

  it("normaliza a imagem e o contador reais do QR em connecting", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("connectionState")) return new Response(JSON.stringify({ instance: { state: "connecting" } }), { status: 200 });
      return new Response(JSON.stringify({ count: 26, base64: "data:image/png;base64,aGVsbG8=" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(new EvolutionWhatsAppProvider(config).getQrCode()).resolves.toMatchObject({ status: "connecting", count: 26, code: "data:image/png;base64,aGVsbG8=" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("não entrega o texto cru do protocolo como src de imagem", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("connectionState")) return new Response(JSON.stringify({ instance: { state: "connecting" } }), { status: 200 });
      return new Response(JSON.stringify({ count: 2, code: "2@raw-whatsapp-pairing-payload" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(new EvolutionWhatsAppProvider(config).getQrCode()).resolves.toMatchObject({ code: null, count: 2 });
  });
});

describe("normalização de texto para WhatsApp", () => {
  it("preserva newline válido e converte escape textual de paridade ímpar", () => {
    expect(normalizeWhatsAppText("Oi\nQual é o seu nome?")).toBe("Oi\nQual é o seu nome?");
    expect(normalizeWhatsAppText("Oi\\nQual é o seu nome?")).toBe("Oi\nQual é o seu nome?");
    expect(normalizeWhatsAppText("Oi\\r\\nQual é o seu nome?")).toBe("Oi\nQual é o seu nome?");
  });
  it("não decodifica barra escapada nem conteúdo de código", () => {
    expect(normalizeWhatsAppText(String.raw`Use \\n como exemplo`)).toBe(String.raw`Use \\n como exemplo`);
    expect(normalizeWhatsAppText(String.raw`Código: \`x\\ny\``)).toBe(String.raw`Código: \`x\\ny\``);
  });
  it("preserva acentos, aspas, apóstrofos e emoji", () => {
    const text = `"Ótica", medição, prescrição, você não; d'água 😊`;
    expect(normalizeWhatsAppText(text)).toBe(text);
  });
});

describe("MockWhatsAppProvider", () => {
  it("executa o ciclo completo sem rede ou envio real", async () => {
    const provider = new MockWhatsAppProvider({ instanceName: config.instanceName, webhookSecret: config.webhookSecret });
    expect((await provider.getConnectionStatus()).state).toBe("not_created");
    await provider.createInstance();
    const qr = await provider.connect();
    expect(qr.code).toBeNull();
    provider.simulateConnected();
    expect((await provider.getConnectionStatus()).state).toBe("open");
    expect((await provider.sendText("5511987654321", "Teste", "mock-once")).status).toBe("simulated");
    expect((await provider.sendImage({ phone: "5511987654321", mediaUrl: "https://example.test/a.png", mimeType: "image/png", fileName: "a.png", idempotencyKey: "img-once" })).status).toBe("simulated");
    await provider.logout();
    expect((await provider.getConnectionStatus()).state).toBe("close");
    await provider.deleteInstance();
    expect((await provider.getConnectionStatus()).state).toBe("not_created");
  });
});
