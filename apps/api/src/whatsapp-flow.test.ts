import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRepository } from "@renova123/database";
import { MockWhatsAppProvider } from "@renova123/integrations";

describe("fluxo WhatsApp completo em mock", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-08-09T12:00:00-03:00")); });
  afterEach(() => { vi.useRealTimers(); });
  it("percorre importação, outbound, inbound, status, mídia e reconexão sem rede", async () => {
    const repository = createRepository({ mock: true, supabaseUrl: undefined, serviceRoleKey: undefined, mockFilePath: null });
    const provider = new MockWhatsAppProvider({ instanceName: "renova123-francisco", webhookSecret: "flow-secret-with-more-than-16" });
    await provider.createInstance();
    expect((await provider.connect()).code).toBeNull();
    provider.simulateConnected();

    const imported = await repository.createBatch({ name: "Fluxo WhatsApp", source: "Teste autorizado", startDate: new Date().toISOString(), initialStrategy: "Mensagem isolada do teste" }, ["5511912345678"]);
    expect(imported).toMatchObject({ imported: 1, skipped: 0 });
    const outbound = (await repository.claimJobs(10))[0]!;
    const sent = await provider.sendText(String(outbound.payload.phone), String(outbound.payload.text), `outbound:${outbound.id}`);
    expect(sent.status).toBe("simulated");
    await repository.completeJob(outbound.id);

    const rawInbound = { event: "MESSAGES_UPSERT", instance: "renova123-francisco", data: { key: { id: "reply-1", remoteJid: "5511912345678@s.whatsapp.net", fromMe: false }, message: { conversation: "Tenho interesse" } } };
    const inbound = provider.normalizeEvent(rawInbound);
    expect(await repository.recordWebhook(inbound.eventId, inbound.sourceEvent, inbound.raw)).toBe(true);
    expect(await repository.recordWebhook(inbound.eventId, inbound.sourceEvent, inbound.raw)).toBe(false);
    const persisted = await repository.persistInboundEvent(inbound as unknown as Record<string, unknown>);
    expect(persisted.inserted).toBe(true);
    expect((await repository.messages({ page: 1, pageSize: 10 })).rows[0]).toMatchObject({ externalId: "reply-1", content: "Tenho interesse", status: "received" });

    const delivery = provider.normalizeEvent({ event: "MESSAGES_UPDATE", data: { key: { id: sent.externalMessageId, remoteJid: "5511912345678@s.whatsapp.net", fromMe: true }, status: "DELIVERY_ACK" } });
    expect(delivery).toMatchObject({ eventType: "message.delivered", status: "delivered" });
    expect((await provider.sendDocument({ phone: "5511912345678", mediaUrl: "https://signed.test/material.pdf", mimeType: "application/pdf", fileName: "material.pdf", idempotencyKey: "material:1" })).status).toBe("simulated");

    await provider.logout();
    expect((await provider.getConnectionStatus()).state).toBe("close");
    expect((await provider.restart()).state).toBe("open");
    await provider.deleteInstance();
    expect((await provider.getConnectionStatus()).state).toBe("not_created");
  });
});
