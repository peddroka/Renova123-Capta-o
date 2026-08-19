import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRepository, shouldMirrorLegacySettings } from "./index.js";

const directories: string[] = [];
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-08-09T12:00:00-03:00")); });
afterEach(() => { vi.useRealTimers(); for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

describe("repositório mock persistente", () => {
  it("persiste cooldown Gemini apenas no armazenamento canônico compatível", () => {
    expect(shouldMirrorLegacySettings("gemini")).toBe(false);
    expect(shouldMirrorLegacySettings("openrouter_1")).toBe(false);
    expect(shouldMirrorLegacySettings("groq")).toBe(true);
  });
  it("compartilha lotes e fila entre API e worker", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "renova-captacao-")); directories.push(directory);
    const file = path.join(directory, "mock-db.json");
    const apiRepository = createRepository({ mock: true, supabaseUrl: undefined, serviceRoleKey: undefined, mockFilePath: file });
    const result = await apiRepository.createBatch({ name: "Lote teste", source: "Teste autorizado", startDate: new Date().toISOString(), priority: 5, initialStrategy: "Mensagem isolada do teste" }, ["5511911112222"]);
    expect(result.imported).toBe(1);

    const workerRepository = createRepository({ mock: true, supabaseUrl: undefined, serviceRoleKey: undefined, mockFilePath: file });
    const jobs = await workerRepository.claimJobs(10);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.payload.phone).toBe("5511911112222");
    await workerRepository.completeJob(jobs[0]!.id);

    const queue = await apiRepository.page("queue", { page: 1, pageSize: 10 });
    expect(queue.rows[0]?.status).toBe("completed");
    expect((await apiRepository.leads({ page: 1, pageSize: 20, search: "5511911112222" })).total).toBe(1);
    const wolf = await apiRepository.page("wolfLeadStates", { page: 1, pageSize: 20 });
    expect(wolf.total).toBe(1);
    expect(wolf.rows[0]?.status).toBe("not_called");
    expect(wolf.rows[0]?.cohortDate).toBe("2026-08-09");
  });

  it("libera apenas a primeira abordagem quando chega presença online", async () => {
    const repository = createRepository({ mock: true, supabaseUrl: undefined, serviceRoleKey: undefined, mockFilePath: null });
    const result = await repository.createBatch({ name: "Online only", source: "Captação comercial", startDate: new Date().toISOString(), initialStrategy: "Mensagem inicial" }, ["5511912345678"]);
    expect(await repository.releaseOutreachForPresence("5511912345678")).toBe(1);
    const jobs = await repository.claimJobs(10);
    expect(jobs[0]?.payload.onlineReady).toBe(true);
    expect(result.imported).toBe(1);
  });

  it("não consome capacidade quando o worker valida o bypass controlado", async () => {
    const repository = createRepository({ mock: true, supabaseUrl: undefined, serviceRoleKey: undefined, mockFilePath: null });
    expect((await repository.outreachCapacity("lead-test", 0, 0, true)).allowed).toBe(true);
    expect((await repository.outreachCapacity("lead-test", 0, 0, false)).allowed).toBe(false);
  });

  it("mantém a reserva de limite no retry da mesma abordagem", async () => {
    const repository = createRepository({ mock: true, supabaseUrl: undefined, serviceRoleKey: undefined, mockFilePath: null });
    const result = await repository.createBatch({ name: "Retry seguro", source: "Teste", startDate: new Date().toISOString(), initialStrategy: "Mensagem inicial" }, ["5511912345678"]);
    const job = (await repository.claimJobs(10))[0]!;
    await repository.markOutreachCapacityReserved(job.id, new Date().toISOString());
    await repository.deferOutreachWithPayload(job.id, new Date(), "falha transitória", { ...job.payload, capacityReservedAt: true });
    const retried = (await repository.claimJobs(10))[0]!;
    expect(retried.payload.capacityReservedAt).toBe(true);
    expect(result.imported).toBe(1);
  });

  it("mantém o cancelamento de um job quando a conclusão chega depois do pre-send recheck", async () => {
    const repository = createRepository({ mock: true, supabaseUrl: undefined, serviceRoleKey: undefined, mockFilePath: null });
    const id = await repository.enqueue("follow_up", { leadId: "lead-replied" }, new Date(), "followup:replied");
    expect((await repository.claimJobs(1))[0]?.id).toBe(id);
    await repository.cancelJob(id, "follow_up_invalidated_by_inbound_or_terminal_state");
    await repository.completeJob(id);
    expect((await repository.page("queue", { page: 1, pageSize: 10 })).rows[0]?.status).toBe("cancelled");
  });

  it("reserva pacing mock sem permitir intervalo nulo", async () => {
    const repository = createRepository({ mock: true, supabaseUrl: undefined, serviceRoleKey: undefined, mockFilePath: null });
    const pacing = await repository.reserveOutreachPacing(45, 90);
    expect(pacing.allowed).toBe(true);
    expect(pacing.intervalSeconds).toBe(45);
  });

  it("persiste evento inbound duplicado sem duplicar mensagem nem conversa", async () => {
    const repository = createRepository({ mock: true, supabaseUrl: undefined, serviceRoleKey: undefined, mockFilePath: null });
    const event = { phone: "5511912345678", externalMessageId: "wamid-final-1", eventId: "evt-final-1", text: "Oi", occurredAt: new Date().toISOString(), messageType: "text" };
    expect((await repository.persistInboundEvent(event)).inserted).toBe(true);
    expect((await repository.persistInboundEvent(event)).inserted).toBe(false);
    expect((await repository.messages({ page: 1, pageSize: 20 })).total).toBe(1);
    expect((await repository.page("conversations", { page: 1, pageSize: 20 })).total).toBe(1);
  });

  it("deduplica jobs pela chave de idempotência", async () => {
    const repository = createRepository({ mock: true, supabaseUrl: undefined, serviceRoleKey: undefined, mockFilePath: null });
    const first = await repository.enqueue("follow_up", { leadId: "lead-1" }, new Date(), "followup:lead-1:1");
    const duplicate = await repository.enqueue("follow_up", { leadId: "lead-1" }, new Date(), "followup:lead-1:1");
    expect(duplicate).toBe(first);
    expect(await repository.claimJobs(10)).toHaveLength(1);
  });

  it("atualiza uma mensagem reservada sem criar uma segunda cópia", async () => {
    const repository = createRepository({ mock: true, supabaseUrl: undefined, serviceRoleKey: undefined, mockFilePath: null });
    await repository.recordMessage({ leadId: "lead-1", content: "Olá", idempotencyKey: "send:1", status: "queued" });
    await repository.recordMessage({ leadId: "lead-1", content: "Olá", idempotencyKey: "send:1", status: "sent", externalId: "wamid-1" });
    const messages = await repository.messages({ page: 1, pageSize: 10 });
    expect(messages.total).toBe(1);
    expect(messages.rows[0]).toMatchObject({ status: "sent", externalId: "wamid-1" });
  });

  it("faz claim exclusivo entre duas instâncias e respeita cancelamento", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "renova-claim-")); directories.push(directory);
    const file = path.join(directory, "mock-db.json");
    const firstWorker = createRepository({ mock: true, supabaseUrl: undefined, serviceRoleKey: undefined, mockFilePath: file });
    const secondWorker = createRepository({ mock: true, supabaseUrl: undefined, serviceRoleKey: undefined, mockFilePath: file });
    const claimable = await firstWorker.enqueue("inbound_reply", { phone: "5511911112222", text: "oi" }, new Date(), "in:1");
    const cancelled = await firstWorker.enqueue("follow_up", { leadId: "lead-2" }, new Date(), "follow:cancel");
    await firstWorker.updateResource("queue", cancelled, { status: "cancelled" });
    const [firstClaim, secondClaim] = await Promise.all([firstWorker.claimJobs(10), secondWorker.claimJobs(10)]);
    expect([...firstClaim, ...secondClaim].map((job) => job.id)).toEqual([claimable]);
  });

  it("preserva escritas de duas instâncias sem uma sobrescrever a outra", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "renova-lock-")); directories.push(directory);
    const file = path.join(directory, "mock-db.json");
    const api = createRepository({ mock: true, supabaseUrl: undefined, serviceRoleKey: undefined, mockFilePath: file });
    const worker = createRepository({ mock: true, supabaseUrl: undefined, serviceRoleKey: undefined, mockFilePath: file });
    await Promise.all([
      api.recordMessage({ leadId: "lead-1", content: "entrada", idempotencyKey: "in:1", status: "received" }),
      worker.recordMessage({ leadId: "lead-1", content: "saída", idempotencyKey: "out:1", status: "sent" }),
    ]);
    const rows = await api.messages({ page: 1, pageSize: 10 });
    expect(rows.total).toBe(2);
    expect(new Set(rows.rows.map((row) => row.idempotencyKey))).toEqual(new Set(["in:1", "out:1"]));
  });

  it("impede importação de opt-out e pagina resultados", async () => {
    const repository = createRepository({ mock: true, supabaseUrl: undefined, serviceRoleKey: undefined, mockFilePath: null });
    await repository.createResource("optouts", { phone: "5511999990000", reason: "Fixture do teste", active: true });
    const result = await repository.createBatch({ name: "Lote opt-out", source: "Consentida", startDate: new Date().toISOString(), initialStrategy: "Mensagem isolada do teste" }, ["5511999990000", "5511912345678", "5511912345679", "5511912345680"]);
    expect(result).toMatchObject({ imported: 3, skipped: 1 });
    const firstPage = await repository.leads({ page: 1, pageSize: 2 });
    const secondPage = await repository.leads({ page: 2, pageSize: 2 });
    expect(firstPage.rows).toHaveLength(2);
    expect(secondPage.rows).toHaveLength(1);
    expect(firstPage.total).toBeGreaterThan(2);
  });

  it("distribui novas abordagens na janela e prioriza respostas", async () => {
    const repository = createRepository({ mock: true, supabaseUrl: undefined, serviceRoleKey: undefined, mockFilePath: null });
    const result = await repository.createBatch({ name: "Cem contatos", source: "Teste autorizado", startDate: "2026-08-08", initialStrategy: "Mensagem inicial" }, Array.from({ length: 100 }, (_, index) => `551191234${String(index).padStart(4, "0")}`));
    expect(result.imported).toBe(100);
    const queue = await repository.page("queue", { page: 1, pageSize: 100 });
    const times = queue.rows.filter((row) => row.type === "outreach").map((row) => String(row.availableAt));
    expect(new Set(times).size).toBe(100);
    expect(new Date(times[0]!).getHours()).toBe(8);
    expect(new Date(times.at(-1)!).getHours()).toBe(22);
    await repository.enqueue("inbound_reply", { phone: "5511999999999", text: "respondeu" }, new Date(), "inbound:old-lead");
    expect((await repository.claimJobs(1))[0]?.type).toBe("inbound_reply");
  });

  it("recupera inbound pendente uma vez sem criar job duplicado", async () => {
    const repository = createRepository({ mock: true, supabaseUrl: undefined, serviceRoleKey: undefined, mockFilePath: null });
    const first = await repository.enqueueInboundDebounced({ phone: "5511992468815", text: "Sou eu", messageId: "inbound-8815" }, new Date());
    const reconciled = await repository.enqueueInboundDebounced({ phone: "5511992468815", text: "Sou eu", messageId: "inbound-8815" }, new Date());
    expect(reconciled).toBe(first);
    expect(await repository.claimJobs(10)).toHaveLength(1);
  });

  it("preserva outbound sem claim durante pausa operacional", async () => {
    const repository = createRepository({ mock: true, supabaseUrl: undefined, serviceRoleKey: undefined, mockFilePath: null });
    await repository.enqueue("outreach", { phone: "5511992468815", leadId: "real" }, new Date(), "outreach:paused-real");
    expect(await repository.claimJobs(10, { includeOutbound: false })).toEqual([]);
    expect((await repository.claimJobs(1))[0]?.type).toBe("outreach");
  });

  it("inbound já respondido não reaparece como recovery", async () => {
    const repository = createRepository({ mock: true, supabaseUrl: undefined, serviceRoleKey: undefined, mockFilePath: null });
    const id = await repository.enqueueInboundDebounced({ phone: "5511974442893", text: "Sim", messageId: "inbound-2893" }, new Date());
    expect((await repository.claimJobs(1))[0]?.id).toBe(id);
    await repository.completeJob(id);
    expect(await repository.claimJobs(10)).toEqual([]);
  });

  it("reenfileira o inbound mais novo enquanto a decisão anterior está processando", async () => {
    const repository = createRepository({ mock: true, supabaseUrl: undefined, serviceRoleKey: undefined, mockFilePath: null });
    const first = await repository.enqueueInboundDebounced({ phone: "5511974442893", text: "Costumo", messageId: "inbound-a" }, new Date());
    expect((await repository.claimJobs(1))[0]?.id).toBe(first);
    const second = await repository.enqueueInboundDebounced({ phone: "5511974442893", text: "Difícil mesmo no dia a dia", messageId: "inbound-b" }, new Date());
    expect(second).not.toBe(first);
    expect((await repository.claimJobs(1))[0]?.payload.text).toBe("Difícil mesmo no dia a dia");
  });

  it("consolida inbounds rápidos ainda pendentes em um único job", async () => {
    const repository = createRepository({ mock: true, supabaseUrl: undefined, serviceRoleKey: undefined, mockFilePath: null });
    const first = await repository.enqueueInboundDebounced({ phone: "5511974442893", text: "Sim", messageId: "inbound-c" }, new Date());
    const merged = await repository.enqueueInboundDebounced({ phone: "5511974442893", text: "eu mesmo", messageId: "inbound-d" }, new Date());
    expect(merged).toBe(first);
    const jobs = await repository.claimJobs(10);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.payload.text).toBe("Sim\neu mesmo");
  });

  it("cria novo processamento depois de uma resposta já concluída", async () => {
    const repository = createRepository({ mock: true, supabaseUrl: undefined, serviceRoleKey: undefined, mockFilePath: null });
    const first = await repository.enqueueInboundDebounced({ phone: "5511974442894", text: "A", messageId: "inbound-e" }, new Date());
    await repository.completeJob((await repository.claimJobs(1))[0]!.id);
    const second = await repository.enqueueInboundDebounced({ phone: "5511974442894", text: "B", messageId: "inbound-f" }, new Date());
    expect(second).not.toBe(first);
    expect((await repository.claimJobs(1))[0]?.payload.text).toBe("B");
  });

  it("mantém um único processamento para evento duplicado persistido", async () => {
    const repository = createRepository({ mock: true, supabaseUrl: undefined, serviceRoleKey: undefined, mockFilePath: null });
    const event = { phone: "5511974442895", externalMessageId: "inbound-dup", eventId: "evt-dup", text: "Sim", occurredAt: new Date().toISOString(), messageType: "text" };
    expect((await repository.persistInboundEvent(event)).inserted).toBe(true);
    expect((await repository.persistInboundEvent(event)).inserted).toBe(false);
    const first = await repository.enqueueInboundDebounced({ phone: event.phone, text: event.text, messageId: event.externalMessageId }, new Date());
    const duplicate = await repository.enqueueInboundDebounced({ phone: event.phone, text: event.text, messageId: event.externalMessageId }, new Date());
    expect(duplicate).toBe(first);
    expect(await repository.claimJobs(10)).toHaveLength(1);
  });

  it("preserva o inbound mais novo quando o primeiro processamento é adiado", async () => {
    const repository = createRepository({ mock: true, supabaseUrl: undefined, serviceRoleKey: undefined, mockFilePath: null });
    const first = await repository.enqueueInboundDebounced({ phone: "5511974442896", text: "A", messageId: "inbound-g" }, new Date());
    const claimed = (await repository.claimJobs(1))[0]!;
    await repository.deferJob(claimed.id, new Date(), "falha transitória");
    await repository.enqueueInboundDebounced({ phone: "5511974442896", text: "B", messageId: "inbound-h" }, new Date());
    const jobs = await repository.claimJobs(10);
    expect(jobs.some((job) => String(job.payload.text).includes("B"))).toBe(true);
    expect(first).toBe(claimed.id);
  });

  it("não cria outbound automático para um inbound bloqueado por estado humano", async () => {
    const repository = createRepository({ mock: true, supabaseUrl: undefined, serviceRoleKey: undefined, mockFilePath: null });
    const lead = await repository.persistInboundEvent({ phone: "5511974442897", externalMessageId: "inbound-human", eventId: "evt-human", text: "Não", occurredAt: new Date().toISOString(), messageType: "text" });
    await repository.updateResource("leads", lead.leadId, { humanActive: true, automationPaused: true });
    expect(await repository.claimJobs(10)).toEqual([]);
  });

  it("torna eventos de webhook idempotentes", async () => {
    const repository = createRepository({ mock: true, supabaseUrl: undefined, serviceRoleKey: undefined, mockFilePath: null });
    expect(await repository.recordWebhook("evt-1", "message", {})).toBe(true);
    expect(await repository.recordWebhook("evt-1", "message", {})).toBe(false);
  });

  it("persiste o fluxo inbound mock com lead, conversa e mensagem sem duplicar", async () => {
    const repository = createRepository({ mock: true, supabaseUrl: undefined, serviceRoleKey: undefined, mockFilePath: null });
    const event = { eventId: "evt-inbound", externalMessageId: "wamid-1", phone: "5511912345678", pushName: "Lead inbound", text: "Olá", messageType: "text", occurredAt: new Date().toISOString() };
    const first = await repository.persistInboundEvent(event);
    const duplicate = await repository.persistInboundEvent(event);
    expect(first).toMatchObject({ inserted: true, humanActive: false, automationPaused: false });
    expect(duplicate.inserted).toBe(false);
    expect((await repository.leads({ page: 1, pageSize: 10, search: "5511912345678" })).total).toBe(1);
    const messages = await repository.messages({ page: 1, pageSize: 10 });
    expect(messages.total).toBe(1);
    expect(messages.rows[0]).toMatchObject({ externalId: "wamid-1", content: "Olá", status: "received" });
  });
});
