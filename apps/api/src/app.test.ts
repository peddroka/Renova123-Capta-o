import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { createRepository } from "@renova123/database";
import { MockWhatsAppProvider } from "@renova123/integrations";

const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("API", () => {
  const auth = { authorization: "Bearer mock-admin-token" };
  it("cria sessão standalone com telefone, sem exigir lead do CRM", async () => {
    const app = await buildApp();
    apps.push(app);
    const phone = `+55 21 9${String(Date.now()).slice(-8)}`;
    const response = await app.inject({
      method: "POST",
      url: "/wolf/calls",
      headers: auth,
      payload: {
        mode: "standalone",
        type: "standalone",
        source: "whatsapp_web",
        leadId: null,
        direction: "outbound",
        status: "preparing",
        standalone: true,
        phone,
        displayName: "Contato WhatsApp",
        chatType: "individual",
      },
    });
    expect([200, 201]).toContain(response.statusCode);
    expect(response.json()).toMatchObject({
      id: expect.any(String),
      liveContext: { standalone: true, source: "whatsapp_web", phone },
    });
  });

  it("cria standalone sem telefone e aceita contato desconhecido", async () => {
    const app = await buildApp();
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/wolf/calls",
      headers: auth,
      payload: {
        mode: "standalone",
        type: "standalone",
        leadId: null,
        direction: "outbound",
        status: "preparing",
        standalone: true,
        phone: null,
        displayName: "Ótica Lucas",
        businessName: null,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: expect.any(String),
      leadId: null,
      liveContext: { standalone: true, displayName: "Ótica Lucas", phone: null },
    });
  });

  it("faz match CRM opcional no standalone sem transformar a sessão em CRM", async () => {
    const repository = createRepository({
      mock: true,
      supabaseUrl: undefined,
      serviceRoleKey: undefined,
      mockFilePath: null,
    });
    const lead = await repository.createResource("leads", {
      phone: "5521986322905",
      name: "Lead pareado",
      company: null,
      stage: "new",
      source: "teste",
    });
    const app = await buildApp({ repository });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/wolf/calls",
      headers: auth,
      payload: {
        mode: "standalone",
        leadId: lead.id,
        direction: "outbound",
        status: "preparing",
        standalone: true,
        phone: "+55 21 98632-2905",
        displayName: "Contato pareado",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      leadId: lead.id,
      liveContext: { standalone: true, matchedLeadId: lead.id },
    });
  });

  it("retorna campos específicos para payload de chamada inválido", async () => {
    const app = await buildApp();
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/wolf/calls",
      headers: auth,
      payload: {
        mode: "standalone",
        type: "standalone",
        leadId: null,
        direction: "outbound",
        status: "preparing",
        standalone: true,
        phone: null,
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "INVALID_CALL_PAYLOAD",
      fields: { displayName: expect.any(String) },
    });
  });
  it("responde health sem autenticação", async () => {
    const app = await buildApp();
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("ok");
  });
  it("responde health live sem tocar em dependências profundas", async () => {
    const app = await buildApp();
    apps.push(app);
    const started = performance.now();
    const response = await app.inject({ method: "GET", url: "/health/live" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, service: "api", uptime: expect.any(Number) });
    expect(performance.now() - started).toBeLessThan(250);
  });

  it("usa uma origem válida no teste manual do WhatsApp", async () => {
    const repository = createRepository({
      mock: true,
      supabaseUrl: undefined,
      serviceRoleKey: undefined,
      mockFilePath: null,
    });
    const recorded: Array<Record<string, unknown>> = [];
    const recordMessage = repository.recordMessage.bind(repository);
    repository.recordMessage = async (values) => {
      recorded.push(values);
      return recordMessage(values);
    };
    const provider = new MockWhatsAppProvider({
      instanceName: "renova123-francisco",
      webhookSecret: "test-secret-with-more-than-16",
    });
    const app = await buildApp({ repository, whatsappProvider: provider });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/whatsapp/test",
      headers: auth,
      payload: {
        phone: "5582988543864",
        text: "Teste controlado",
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("simulated");
    expect(recorded.length).toBe(2);
    expect(recorded.every((message) => message.origin === "manual")).toBe(true);
    expect(recorded.every((message) => typeof message.leadId === "string" && message.leadId.length > 0)).toBe(
      true,
    );
    expect(
      recorded.every(
        (message) => typeof message.conversationId === "string" && message.conversationId.length > 0,
      ),
    ).toBe(true);
  });

  it("cria contexto completo para número sem lead e reutiliza no mesmo teste", async () => {
    const repository = createRepository({
      mock: true,
      supabaseUrl: undefined,
      serviceRoleKey: undefined,
      mockFilePath: null,
    });
    const app = await buildApp({
      repository,
      whatsappProvider: new MockWhatsAppProvider({
        instanceName: "renova123-francisco",
        webhookSecret: "test-secret-with-more-than-16",
      }),
    });
    apps.push(app);
    const payload = (idempotencyKey: string) => ({
      phone: "5511999999999",
      text: "Teste controlado",
      idempotencyKey,
    });
    for (const idempotencyKey of [
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/whatsapp/test",
        headers: auth,
        payload: payload(idempotencyKey),
      });
      expect(response.statusCode).toBe(200);
    }
    const leads = await repository.leads({ page: 1, pageSize: 100, search: "5511999999999" });
    const conversations = await repository.page("conversations", { page: 1, pageSize: 100 });
    expect(leads.rows).toHaveLength(1);
    expect(conversations.rows.filter((row) => row.leadId === leads.rows[0]?.id)).toHaveLength(1);
    const messages = await repository.messages({ page: 1, pageSize: 100 });
    expect(messages.rows).toHaveLength(2);
    expect(messages.rows.every((row) => row.leadId === leads.rows[0]?.id && row.origin === "manual")).toBe(
      true,
    );
  });

  it("reutiliza lead existente no teste manual sem criar outro registro", async () => {
    const repository = createRepository({
      mock: true,
      supabaseUrl: undefined,
      serviceRoleKey: undefined,
      mockFilePath: null,
    });
    const existing = await repository.createResource("leads", {
      phone: "5511988888888",
      name: "Lead existente",
      company: null,
      stage: "new",
      source: "import",
    });
    const app = await buildApp({
      repository,
      whatsappProvider: new MockWhatsAppProvider({
        instanceName: "renova123-francisco",
        webhookSecret: "test-secret-with-more-than-16",
      }),
    });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/whatsapp/test",
      headers: auth,
      payload: {
        phone: "5511988888888",
        text: "Teste controlado",
        idempotencyKey: "44444444-4444-4444-8444-444444444444",
      },
    });
    expect(response.statusCode).toBe(200);
    const leads = await repository.leads({ page: 1, pageSize: 100, search: "5511988888888" });
    expect(leads.rows).toHaveLength(1);
    expect(leads.rows[0]?.id).toBe(existing.id);
    const messages = await repository.messages({ page: 1, pageSize: 100 });
    expect(messages.rows[0]).toMatchObject({ leadId: existing.id, origin: "manual" });
  });

  it("protege o dashboard", async () => {
    const app = await buildApp();
    apps.push(app);
    expect((await app.inject({ method: "GET", url: "/dashboard" })).statusCode).toBe(401);
  });
  it("persiste limites separados para novos leads e etapas do fluxo", async () => {
    const repository = createRepository({
      mock: true,
      supabaseUrl: undefined,
      serviceRoleKey: undefined,
      mockFilePath: null,
    });
    const app = await buildApp({ repository });
    apps.push(app);
    const current = await app.inject({ method: "GET", url: "/settings/outreach", headers: auth });
    const saved = await app.inject({
      method: "PUT",
      url: "/settings/outreach",
      headers: auth,
      payload: {
        ...current.json(),
        newLeadsDailyLimit: 37,
        dailyProactiveLimit: 37,
        stageDailyLimits: [500, 500, 12, 13, 14, 15],
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ success: true });
    const reread = await app.inject({ method: "GET", url: "/settings/outreach", headers: auth });
    expect(reread.json()).toMatchObject({
      newLeadsDailyLimit: 37,
      dailyProactiveLimit: 37,
      stageDailyLimits: [500, 500, 12, 13, 14, 15],
    });
  });

  it("libera PATCH no preflight CORS", async () => {
    const app = await buildApp();
    apps.push(app);
    const response = await app.inject({
      method: "OPTIONS",
      url: "/notifications/fixture/read",
      headers: { origin: "http://127.0.0.1:5173", "access-control-request-method": "PATCH" },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-methods"]).toContain("PATCH");
  });
  it("não consome rate-limit com preflight nem healthchecks", async () => {
    const app = await buildApp();
    apps.push(app);
    const headers = { origin: "http://127.0.0.1:5173", "access-control-request-method": "GET" };
    const responses = await Promise.all([
      ...Array.from({ length: 20 }, () => app.inject({ method: "OPTIONS", url: "/dashboard", headers })),
      ...Array.from({ length: 20 }, () => app.inject({ method: "GET", url: "/health/live" })),
    ]);
    expect(responses.every((response) => response.statusCode === 204 || response.statusCode === 200)).toBe(
      true,
    );
  });
  it("mantém CORS em 429 de uma rota protegida", async () => {
    const app = await buildApp();
    apps.push(app);
    const responses = await Promise.all(
      Array.from({ length: 205 }, () =>
        app.inject({
          method: "POST",
          url: "/auth/login",
          headers: { origin: "http://127.0.0.1:5173" },
          payload: { email: "invalid@example.com", password: "invalid-password" },
        }),
      ),
    );
    const limited = responses.find((response) => response.statusCode === 429);
    expect(limited?.statusCode).toBe(429);
    expect(limited?.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:5173");
  });

  it("entra em modo mock e lista dados", async () => {
    const app = await buildApp();
    apps.push(app);
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "admin@renova123.local", password: "renova123" },
    });
    expect(login.statusCode).toBe(200);
    const response = await app.inject({
      method: "GET",
      url: "/dashboard",
      headers: { authorization: "Bearer mock-admin-token" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().dailyLimit).toBeGreaterThan(0);
  });

  it("persiste o desligamento da automação e retorna a fonte de verdade", async () => {
    const repository = createRepository({
      mock: true,
      supabaseUrl: undefined,
      serviceRoleKey: undefined,
      mockFilePath: null,
    });
    const app = await buildApp({ repository });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/system/pause",
      headers: auth,
      payload: { paused: true },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ paused: true, automationEnabled: false, operation: "paused" });
    expect((await repository.getSettings("general")).automationEnabled).toBe(false);
  });

  it("classifica contatos existentes antes de importar", async () => {
    const repository = createRepository({
      mock: true,
      supabaseUrl: undefined,
      serviceRoleKey: undefined,
      mockFilePath: null,
    });
    await repository.createResource("leads", {
      phone: "5511987654321",
      name: "Fixture existente",
      company: null,
      stage: "interested",
      source: "teste",
      lastContactAt: new Date().toISOString(),
    });
    const app = await buildApp({ repository });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/imports/preview",
      headers: auth,
      payload: { content: "telefone\n11987654321\n11911112222" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().rows.map((row: any) => row.status)).toEqual(["in_conversation", "valid"]);
    expect(response.json().summary.inConversation).toBe(1);
  });

  it("cria, edita e exclui uma mensagem inicial", async () => {
    const app = await buildApp();
    apps.push(app);
    const created = await app.inject({
      method: "POST",
      url: "/resources/openers",
      headers: auth,
      payload: {
        name: "Retomada",
        content: "Olá! Podemos retomar nossa conversa sobre a ótica?",
        active: true,
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    const updated = await app.inject({
      method: "PATCH",
      url: `/resources/openers/${id}`,
      headers: auth,
      payload: { active: false },
    });
    expect(updated.json().active).toBe(false);
    expect(
      (await app.inject({ method: "DELETE", url: `/resources/openers/${id}`, headers: auth })).statusCode,
    ).toBe(204);
  });

  it("expõe endpoints locais tipados sem retornar secrets", async () => {
    const app = await buildApp();
    apps.push(app);
    for (const url of [
      "/auth/session",
      "/imports",
      "/batches",
      "/queue",
      "/conversations",
      "/messages",
      "/templates",
      "/materials",
      "/knowledge",
      "/agent",
      "/schedules",
      "/appointments",
      "/handoffs",
      "/integrations",
      "/logs",
    ]) {
      const response = await app.inject({ method: "GET", url, headers: auth });
      expect(response.statusCode, url).toBe(200);
      expect(response.body.toLowerCase()).not.toContain("service_role");
      expect(response.body.toLowerCase()).not.toContain("api_key");
    }
  });

  it("expõe o pairing pela API principal sem vazar a chave da Evolution", async () => {
    const whatsappProvider = new MockWhatsAppProvider({
      instanceName: "renova123-francisco",
      webhookSecret: "test-webhook-secret-with-16-chars",
    });
    await whatsappProvider.connect();
    const app = await buildApp({ whatsappProvider });
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/whatsapp/pairing", headers: auth });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      evolution: "online",
      instanceName: "renova123-francisco",
      state: "connecting",
      qrCount: 1,
    });
    expect(response.body.toLowerCase()).not.toContain("api_key");
    expect(response.body).not.toContain("server-only-key");
  });

  it("aplica allowlist ao teste de WhatsApp durante pausa operacional", async () => {
    const repository = createRepository({
      mock: true,
      supabaseUrl: undefined,
      serviceRoleKey: undefined,
      mockFilePath: null,
    });
    const general = await repository.getSettings("general");
    await repository.saveSettings("general", { ...general, globalPause: true });
    const app = await buildApp({ repository });
    apps.push(app);
    const headers = { ...auth, origin: "http://127.0.0.1:5173" };
    const blocked = await app.inject({
      method: "POST",
      url: "/whatsapp/test",
      headers,
      payload: {
        phone: "5511992468815",
        text: "não enviar",
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
      },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().message).toBe("TEST_MODE_BLOCKED_OUTBOUND");
    const allowed = await app.inject({
      method: "POST",
      url: "/whatsapp/test",
      headers,
      payload: {
        phone: "5582988543864",
        text: "teste isolado",
        idempotencyKey: "22222222-2222-4222-8222-222222222222",
      },
    });
    expect(allowed.statusCode).toBe(200);
  });

  it("pagina leads e alterna simulação com auditoria", async () => {
    const repository = createRepository({
      mock: true,
      supabaseUrl: undefined,
      serviceRoleKey: undefined,
      mockFilePath: null,
    });
    await repository.createResource("leads", { phone: "5511911111111", stage: "new", source: "teste" });
    await repository.createResource("leads", { phone: "5511922222222", stage: "new", source: "teste" });
    const app = await buildApp({ repository });
    apps.push(app);
    const page = await app.inject({ method: "GET", url: "/leads?page=1&pageSize=2", headers: auth });
    expect(page.statusCode).toBe(200);
    expect(page.json().rows).toHaveLength(2);
    const simulation = await app.inject({
      method: "POST",
      url: "/system/simulation",
      headers: auth,
      payload: { enabled: false },
    });
    expect(simulation.statusCode).toBe(200);
    expect(simulation.json()).toEqual({ simulationMode: false });
  });

  it("cancela e recoloca item da fila por endpoint tipado", async () => {
    const app = await buildApp();
    apps.push(app);
    const imported = await app.inject({
      method: "POST",
      url: "/imports/commit",
      headers: auth,
      payload: {
        batch: {
          name: "Lote da fila",
          source: "Lista autorizada",
          context: "Teste do ciclo persistente",
          initialStrategy: "Mensagem isolada do teste",
          authorized: true,
          priority: 5,
          startDate: new Date().toISOString(),
          dailyLimit: 10,
        },
        phones: ["5511912345678"],
      },
    });
    expect(imported.statusCode).toBe(200);
    const queue = await app.inject({ method: "GET", url: "/queue", headers: auth });
    const row = queue.json().rows.find((item: Record<string, unknown>) => item.type === "outreach");
    expect(row?.id).toBeTruthy();
    const cancelled = await app.inject({
      method: "POST",
      url: `/queue/jobs/${row.id}/cancel`,
      headers: auth,
    });
    expect(cancelled.json().status).toBe("cancelled");
    const retried = await app.inject({
      method: "PATCH",
      url: `/queue/jobs/${row.id}`,
      headers: auth,
      payload: { status: "pending", availableAt: new Date().toISOString() },
    });
    expect(retried.json().status).toBe("pending");
  });

  it("valida, normaliza, enfileira e deduplica webhook da Evolution", async () => {
    const repository = createRepository({
      mock: true,
      supabaseUrl: undefined,
      serviceRoleKey: undefined,
      mockFilePath: null,
    });
    const whatsappProvider = new MockWhatsAppProvider({
      instanceName: "renova123-francisco",
      webhookSecret: "test-webhook-secret-with-16-chars",
    });
    const app = await buildApp({ repository, whatsappProvider });
    apps.push(app);
    const payload = {
      event: "MESSAGES_UPSERT",
      instance: "renova123-francisco",
      data: {
        key: { id: "inbound-1", remoteJid: "5511912345678@s.whatsapp.net", fromMe: false },
        pushName: "Lead teste",
        message: { conversation: "Quero conhecer o sistema" },
      },
    };
    const headers = { "x-webhook-secret": "test-webhook-secret-with-16-chars" };
    expect(
      (await app.inject({ method: "POST", url: "/webhooks/evolution", headers, payload })).statusCode,
    ).toBe(202);
    expect(
      (await app.inject({ method: "POST", url: "/webhooks/evolution", headers, payload })).json(),
    ).toEqual({ duplicate: true });
    const jobs = await repository.claimJobs(10);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      type: "evolution_event",
      payload: { event: { eventType: "message.received", phone: "5511912345678" } },
    });
  });

  it("valida e salva Groq sem devolver a chave completa", async () => {
    const app = await buildApp();
    apps.push(app);
    const apiKey = "gsk_test_key_12345678901234567890";
    const validation = await app.inject({
      method: "POST",
      url: "/groq/validate",
      headers: auth,
      payload: { apiKey },
    });
    expect(validation.statusCode).toBe(200);
    expect(validation.body).not.toContain(apiKey);
    const configured = await app.inject({
      method: "PUT",
      url: "/groq/config",
      headers: auth,
      payload: {
        apiKey,
        model: "openai/gpt-oss-120b",
        transcriptionModel: "whisper-large-v3-turbo",
        temperature: 0.3,
      },
    });
    expect(configured.statusCode).toBe(200);
    expect(configured.body).not.toContain(apiKey);
    expect(configured.body).not.toContain("apiKeyEncrypted");
    const settings = await app.inject({ method: "GET", url: "/settings/groq", headers: auth });
    expect(settings.statusCode).toBe(200);
    expect(settings.body).not.toContain(apiKey);
    expect(settings.body).not.toContain("apiKeyEncrypted");
    expect(settings.json()).toMatchObject({ configured: true, model: "openai/gpt-oss-120b" });
  });

  it("executa o fluxo operacional de conhecimento, agenda, takeover, notificações e arquivamento", async () => {
    const repository = createRepository({
      mock: true,
      supabaseUrl: undefined,
      serviceRoleKey: undefined,
      mockFilePath: null,
    });
    const createdLead = await repository.createResource("leads", {
      phone: "5511912345678",
      name: "Lead fixture",
      stage: "engaged",
      source: "teste",
    });
    await repository.createResource("notifications", {
      title: "Notificação fixture",
      body: "Teste",
      level: "info",
      readAt: null,
    });
    const createdNotification = (await repository.page("notifications", { page: 1, pageSize: 1 })).rows[0]!;
    await repository.createResource("materials", {
      name: "Material fixture",
      category: "Teste",
      active: true,
    });
    const createdMaterial = (await repository.page("materials", { page: 1, pageSize: 1 })).rows[0]!;
    const app = await buildApp({ repository });
    apps.push(app);
    const knowledge = await app.inject({
      method: "POST",
      url: "/knowledge",
      headers: auth,
      payload: {
        title: "Regra de opt-out",
        category: "Regra",
        subject: "Privacidade",
        tags: ["opt-out"],
        stages: ["engaged"],
        source: "text",
        content: "Ao pedir remoção, bloquear imediatamente.",
        active: true,
      },
    });
    expect(knowledge.statusCode).toBe(201);
    expect(
      (await app.inject({ method: "GET", url: "/knowledge?search=opt-out", headers: auth })).json().rows,
    ).toHaveLength(1);
    const leadId = String(createdLead.id);
    const startsAt = new Date(Date.now() + 14 * 86_400_000).toISOString();
    const endsAt = new Date(Date.now() + 14 * 86_400_000 + 45 * 60_000).toISOString();
    const appointment = await app.inject({
      method: "POST",
      url: "/resources/demos",
      headers: auth,
      payload: {
        leadId,
        startsAt,
        endsAt,
        status: "confirmed",
        assignee: "Closer teste",
        origin: "manual",
        notes: "Fluxo E2E",
      },
    });
    expect(appointment.statusCode).toBe(201);
    const conflict = await app.inject({
      method: "POST",
      url: "/resources/demos",
      headers: auth,
      payload: { leadId, startsAt, endsAt, status: "proposed", assignee: "Closer teste" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/conversations/${leadId}/takeover`,
          headers: auth,
          payload: { state: "human_active", reason: "Operador assumiu", notes: "Teste" },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/conversations/${leadId}/manual-message`,
          headers: auth,
          payload: { text: "Mensagem manual segura" },
        })
      ).json().status,
    ).toBe("simulated");
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/conversations/${leadId}/takeover`,
          headers: auth,
          payload: { state: "returned_to_ai", reason: "Atendimento concluído" },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/notifications/${String(createdNotification.id)}/read`,
          headers: auth,
        })
      ).json().readAt,
    ).toBeTruthy();
    expect(
      (await app.inject({ method: "DELETE", url: `/materials/${String(createdMaterial.id)}`, headers: auth }))
        .statusCode,
    ).toBe(204);
    const material = (await app.inject({ method: "GET", url: "/materials", headers: auth }))
      .json()
      .rows.find((row: any) => row.id === createdMaterial.id);
    expect(material).toMatchObject({ active: false });
    expect(material.archivedAt).toBeTruthy();
  });
});
