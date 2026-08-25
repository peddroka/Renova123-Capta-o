import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { aggregateOutreachByHour } from "@renova123/core";
import type { DashboardStats, LeadSummary, OutreachAnalytics, PageKey } from "@renova123/shared";

export type PageResult = {
  rows: Array<Record<string, unknown>>;
  total: number;
  page: number;
  pageSize: number;
};

/** Retries only read-only Supabase requests after a transient socket reset. */
export async function supabaseFetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const method = String(init?.method ?? "GET").toUpperCase();
  const readOnly = method === "GET" || method === "HEAD" || method === "OPTIONS";
  const attempts = readOnly ? 2 : 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(input, init);
    } catch (error) {
      if (attempt >= attempts || !readOnly) throw error;
      await new Promise((resolve) => setTimeout(resolve, 120 + Math.round(Math.random() * 180)));
    }
  }
  throw new Error("Supabase request failed without a response.");
}
export type PersistentQueueName = "outreach_queue" | "ai_response_queue" | "follow_up_queue" | "jobs";
export type QueueJob = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts?: number;
  queue?: PersistentQueueName;
  lockedAt?: Date | undefined;
  lockedBy?: string | undefined;
};
export type StaleJobRecovery = { found: number; recovered: number };
export type EditableResourceKey =
  | "leads"
  | "batches"
  | "queue"
  | "conversations"
  | "demos"
  | "followups"
  | "handoffs"
  | "optouts"
  | "materials"
  | "knowledge"
  | "notifications"
  | "openers"
  | "wolfCalls"
  | "wolfTurns"
  | "wolfInsights"
  | "wolfLeadStates"
  | "wolfCallEvents";
const legacySettingsSections = new Set(["general", "outreach", "mind", "groq", "whatsapp", "appointments"]);
export function shouldMirrorLegacySettings(section: string) {
  return legacySettingsSections.has(section);
}
export type PhoneInspectionStatus =
  "duplicate_existing" | "blocked" | "already_approached" | "in_conversation";
export type OutreachCapacity = { allowed: boolean; reason: string | null; retryAt: string };
export type PresenceState = "online" | "offline" | "unavailable_to_detect";
export type ManualTestContext = {
  leadId: string;
  conversationId: string;
  createdLead: boolean;
  createdConversation: boolean;
};

export interface Repository {
  dashboard(): Promise<DashboardStats>;
  outreachAnalytics(): Promise<OutreachAnalytics>;
  leads(input: {
    page: number;
    pageSize: number;
    search?: string | undefined;
    stage?: string | undefined;
  }): Promise<PageResult>;
  page(
    key: PageKey,
    input: { page: number; pageSize: number; search?: string | undefined; stage?: string | undefined },
  ): Promise<PageResult>;
  inspectPhones(phones: string[]): Promise<Record<string, PhoneInspectionStatus>>;
  createResource(key: EditableResourceKey, values: Record<string, unknown>): Promise<Record<string, unknown>>;
  updateResource(
    key: EditableResourceKey,
    id: string,
    values: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  deleteResource(key: EditableResourceKey, id: string): Promise<void>;
  createBatch(
    input: Record<string, unknown>,
    phones: string[],
  ): Promise<{ batchId: string; imported: number; skipped: number }>;
  saveSettings(section: string, values: Record<string, unknown>): Promise<void>;
  getSettings(section: string): Promise<Record<string, unknown>>;
  recordWebhook(eventId: string, eventType: string, payload: unknown): Promise<boolean>;
  messages(input: { page: number; pageSize: number }): Promise<PageResult>;
  recordMessage(values: Record<string, unknown>): Promise<Record<string, unknown>>;
  ensureManualTestContext(phone: string): Promise<ManualTestContext>;
  resetLeadSession(
    phone: string,
  ): Promise<{ leads: number; conversations: number; messages: number; jobs: number }>;
  persistInboundEvent(event: Record<string, unknown>): Promise<{
    leadId: string;
    conversationId: string;
    inserted: boolean;
    humanActive: boolean;
    automationPaused: boolean;
  }>;
  enqueue(
    type: string,
    payload: Record<string, unknown>,
    availableAt?: Date,
    idempotencyKey?: string,
  ): Promise<string>;
  enqueueInboundDebounced(
    payload: { phone: string; text: string; messageId: string },
    availableAt: Date,
  ): Promise<string>;
  claimJobs(
    limit: number,
    options?: { includeOutbound?: boolean; outboundPhoneAllowlist?: string[] },
  ): Promise<QueueJob[]>;
  recoverStaleJobs(timeoutMs: number): Promise<StaleJobRecovery>;
  renewJobLease(id: string, workerId: string): Promise<boolean>;
  completeJob(id: string): Promise<void>;
  failJob(id: string, error: string, retryAt: Date | null): Promise<void>;
  deferJob(id: string, retryAt: Date, reason: string): Promise<void>;
  releaseOutreachForPresence(phone: string): Promise<number>;
  updateOutreachPresence(phone: string, state: PresenceState, occurredAt: string): Promise<number>;
  deferOutreachWithPayload(
    id: string,
    retryAt: Date,
    reason: string,
    payload: Record<string, unknown>,
  ): Promise<void>;
  markOutreachCapacityReserved(id: string, reservedAt: string): Promise<void>;
  reserveOutreachPacing(minIntervalSeconds: number, maxIntervalSeconds: number): Promise<{ allowed: boolean; retryAt: string; intervalSeconds?: number }>;
  reserveOutreachQuota(dailyLimit: number, hourlyLimit: number, allowControlledTestBypass?: boolean): Promise<{ allowed: boolean; reason: string | null; retryAt: string }>;
  cancelJob(id: string, reason: string): Promise<void>;
  outreachCapacity(
    leadId: string,
    dailyLimit: number,
    hourlyLimit: number,
    allowControlledTestBypass?: boolean,
  ): Promise<OutreachCapacity>;
  audit(
    action: string,
    entityType: string,
    entityId: string | null,
    details?: Record<string, unknown>,
  ): Promise<void>;
}

export function createRepository(config: {
  mock: boolean;
  supabaseUrl: string | undefined;
  serviceRoleKey: string | undefined;
  mockFilePath?: string | null | undefined;
}): Repository {
  if (config.mock || !config.supabaseUrl || !config.serviceRoleKey)
    return new MemoryRepository(
      config.mockFilePath === undefined ? path.resolve(".runtime", "mock-db.json") : config.mockFilePath,
    );
  return new SupabaseRepository(
    createClient(config.supabaseUrl, config.serviceRoleKey, {
      auth: { persistSession: false },
      global: { fetch: supabaseFetchWithRetry },
    }),
  );
}

class MemoryRepository implements Repository {
  private readonly mockLeads: LeadSummary[] = [];
  private settings = new Map<string, Record<string, unknown>>([
    [
      "outreach",
      {
        dailyLimit: 50,
        hourlyLimit: 8,
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        startTime: "08:00",
        endTime: "23:00",
        minIntervalSeconds: 5,
        maxIntervalSeconds: 5,
        timezone: "America/Sao_Paulo",
        maxConsecutiveFailures: 5,
        autoPause: true,
        dailyProactiveLimit: 50,
        cadenceDelaysDays: [0, 1, 2, 4, 8, 16],
        followUpsEnabled: true,
        maxFollowUps: 3,
        followUpIntervalHours: 48,
        batchPriority: "priority",
      },
    ],
    [
      "general",
      {
        simulationMode: true,
        realSendingEnabled: false,
        globalPause: false,
        automationEnabled: false,
        salesCloserName: "Pedro",
        salesCloserPhone: "5582988543864",
        agentName: "Francisco",
        companyName: "Renova 123",
      },
    ],
    [
      "groq",
      {
        model: "openai/gpt-oss-120b",
        fallbackModel: "openai/gpt-oss-20b",
        configured: false,
        temperature: 0.35,
      },
    ],
    [
      "mind",
      {
        agentName: "Francisco",
        role: "Assistente comercial",
        presentation: "",
        mission: "",
        primaryGoal: "",
        secondaryGoal: "",
        communicationStyle: "",
        tone: "",
        personality: "",
        preferredLength: "",
        targetAudience: "",
        companyDescription: "",
        productDescription: "",
        benefits: "",
        features: "",
        differentiators: "",
        prices: "",
        implementation: "",
        plans: "",
        freeTrial: "",
        multiStoreDiscount: "",
        referralProgram: "",
        validity: "",
        commercialTerms: "",
        exceptions: "",
        authorizationRequired: "",
        objections: "",
        approvedAnswers: "",
        faq: "",
        mandatoryRules: "",
        forbiddenInformation: "",
        hotLeadCriteria: "",
        handoffCriteria: "",
        additionalInstructions: "",
      },
    ],
  ]);
  private jobs: Array<
    QueueJob & {
      status: string;
      availableAt: Date;
      lastError?: string;
      completedAt?: Date;
      idempotencyKey?: string;
    }
  > = [];
  private webhookIds = new Set<string>();
  private messageRows: Array<Record<string, unknown>> = [];
  private readonly resources: Record<string, Array<Record<string, unknown>>> = Object.fromEntries(
    Object.entries(mockRows).map(([key, rows]) => [key, structuredClone(rows)]),
  );
  private lockDescriptor: number | null = null;
  constructor(private readonly filePath: string | null) {
    if (filePath && fs.existsSync(filePath)) this.refresh();
    else this.mutate(() => undefined);
  }

  private refresh() {
    const acquired = this.acquireFileLock();
    try {
      this.refreshUnlocked();
    } finally {
      if (acquired) this.releaseFileLock();
    }
  }
  private refreshUnlocked() {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    try {
      const state = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as any;
      this.mockLeads.splice(0, this.mockLeads.length, ...(state.leads ?? []));
      this.settings = new Map(Object.entries(state.settings ?? {}));
      this.jobs = (state.jobs ?? []).map((job: any) => {
        const recovered =
          job.status === "processing" &&
          (!job.lockedAt ||
            Date.now() - Date.parse(String(job.lockedAt)) > 5 * 60_000 ||
            deadProcess(job.lockedBy));
        return {
          ...job,
          status: recovered ? "pending" : job.status,
          availableAt: recovered ? new Date() : new Date(job.availableAt),
          lockedAt: recovered ? undefined : job.lockedAt ? new Date(job.lockedAt) : undefined,
          lockedBy: recovered ? undefined : job.lockedBy,
          completedAt: job.completedAt ? new Date(job.completedAt) : undefined,
        };
      });
      this.webhookIds = new Set(state.webhookIds ?? []);
      this.messageRows = state.messages ?? [];
      for (const key of Object.keys(this.resources)) delete this.resources[key as PageKey];
      Object.assign(this.resources, state.resources ?? {});
    } catch {
      /* O doctor exibirá qualquer arquivo corrompido; preserve os defaults nesta execução. */
    }
  }
  private persistUnlocked() {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(
      temporary,
      JSON.stringify(
        {
          leads: this.mockLeads,
          settings: Object.fromEntries(this.settings),
          jobs: this.jobs,
          webhookIds: [...this.webhookIds],
          messages: this.messageRows,
          resources: this.resources,
        },
        null,
        2,
      ),
      "utf8",
    );
    for (let attempt = 0; ; attempt += 1) {
      try {
        fs.copyFileSync(temporary, this.filePath);
        fs.unlinkSync(temporary);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (!["EPERM", "EBUSY", "EACCES"].includes(code ?? "") || attempt >= 20) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10 + attempt * 5);
      }
    }
  }
  private mutate<T>(operation: () => T): T {
    const acquired = this.acquireFileLock();
    try {
      this.refreshUnlocked();
      const result = operation();
      this.persistUnlocked();
      return result;
    } finally {
      if (acquired) this.releaseFileLock();
    }
  }
  private acquireFileLock() {
    if (!this.filePath || this.lockDescriptor !== null) return false;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const lockPath = `${this.filePath}.lock`;
    for (let attempt = 0; attempt < 600; attempt += 1) {
      try {
        this.lockDescriptor = fs.openSync(lockPath, "wx");
        fs.writeFileSync(this.lockDescriptor, `${process.pid}\n${new Date().toISOString()}`, "utf8");
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        try {
          const raw = fs.readFileSync(lockPath, "utf8");
          const lockPid = Number(raw.split(/\r?\n/)[0]);
          const staleByProcess = Number.isInteger(lockPid) && lockPid > 0 && deadProcess(lockPid);
          const ageMs = Date.now() - fs.statSync(lockPath).mtimeMs;
          const staleByMalformedLock = !Number.isInteger(lockPid) && ageMs > 1_000;
          const staleByAge = ageMs > 30_000;
          if (staleByProcess || staleByMalformedLock || staleByAge) fs.unlinkSync(lockPath);
        } catch {
          /* O outro processo pode ter liberado o lock. */
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
    throw new Error(`Timeout aguardando lock do repositório local: ${lockPath}`);
  }
  private releaseFileLock() {
    if (!this.filePath || this.lockDescriptor === null) return;
    const descriptor = this.lockDescriptor;
    this.lockDescriptor = null;
    try {
      fs.closeSync(descriptor);
    } finally {
      try {
        fs.unlinkSync(`${this.filePath}.lock`);
      } catch {
        /* Lock já liberado. */
      }
    }
  }

  async dashboard(): Promise<DashboardStats> {
    this.refresh();
    const today = new Date().toISOString().slice(0, 10);
    const general = this.settings.get("general") ?? {};
    const outreach = this.settings.get("outreach") ?? {};
    return {
      totalLeads: this.mockLeads.length,
      contactedToday: this.jobs.filter((job) => ["outreach", "follow_up"].includes(job.type) && job.status === "completed" && job.completedAt?.toISOString().startsWith(today)).length,
      activeConversations: this.mockLeads.filter((lead) => ["engaged", "interested"].includes(lead.stage))
        .length,
      interested: this.mockLeads.filter((lead) => lead.stage === "interested").length,
      scheduledDemos: this.mockLeads.filter((lead) => lead.stage === "demo_scheduled").length,
      handoffs: this.mockLeads.filter((lead) => lead.stage === "human_handoff").length,
      optOuts: (this.resources.optouts ?? []).filter((row) => row.active !== false).length,
      queuePending: this.jobs.filter((job) => job.status === "pending").length,
      dailyLimit: Number(outreach.dailyLimit ?? 50),
      simulationMode: general.simulationMode !== false,
    };
  }
  async outreachAnalytics() {
    this.refresh();
    const conversations = this.resources.conversations ?? [];
    return aggregateOutreachByHour(
      this.mockLeads.map((lead) => {
        const conversation = conversations.find((row) => String(row.leadId) === String(lead.id));
        return {
          initialOutreachSentAt:
            (lead as any).initialOutreachSentAt ?? conversation?.firstOutboundAt ?? lead.lastContactAt,
          firstInboundAt: (lead as any).firstInboundAt ?? conversation?.firstInboundAt,
          qualifiedAt: (lead as any).qualifiedAt,
          stalledAt: (lead as any).stalledAt,
        };
      }),
    );
  }
  async leads(input: {
    page: number;
    pageSize: number;
    search?: string | undefined;
    stage?: string | undefined;
  }): Promise<PageResult> {
    this.refresh();
    let rows = this.mockLeads.filter((lead) => !input.stage || lead.stage === input.stage);
    if (input.search) {
      const query = input.search.toLowerCase();
      rows = rows.filter((lead) => JSON.stringify(lead).toLowerCase().includes(query));
    }
    return paginate(rows as unknown as Array<Record<string, unknown>>, input.page, input.pageSize);
  }
  async page(
    key: PageKey,
    input: { page: number; pageSize: number; search?: string | undefined; stage?: string | undefined },
  ): Promise<PageResult> {
    this.refresh();
    if (key === "queue") {
      let rows = this.jobs.map((job) => ({
        id: job.id,
        type: job.type,
        status: job.status,
        attempts: job.attempts,
        availableAt: job.availableAt.toISOString(),
        lastError: job.lastError ?? null,
        createdAt: job.completedAt?.toISOString() ?? null,
      }));
      if (input.search)
        rows = rows.filter((row) => JSON.stringify(row).toLowerCase().includes(input.search!.toLowerCase()));
      return paginate(rows, input.page, input.pageSize);
    }
    if (key === "qualified") {
      const rows = this.mockLeads.filter((lead) => Boolean((lead as any).qualifiedAt) || lead.stage === "human_handoff");
      return paginate(rows as unknown as Array<Record<string, unknown>>, input.page, input.pageSize);
    }
    if (["leads", "interested", "lost", "unanswered"].includes(key)) {
      const stages: Partial<Record<PageKey, string>> = {
        interested: "interested",
        lost: "lost",
        unanswered: "contacted",
      };
      const stage = stages[key] ?? input.stage;
      return stage ? this.leads({ ...input, stage }) : this.leads(input);
    }
    let rows = this.resources[key] ?? [];
    if (input.search) {
      const query = input.search.toLowerCase();
      rows = rows.filter((row) => JSON.stringify(row).toLowerCase().includes(query));
    }
    return paginate(rows, input.page, input.pageSize);
  }
  async inspectPhones(phones: string[]) {
    this.refresh();
    const result: Record<string, PhoneInspectionStatus> = {};
    const blocked = new Set(
      (this.resources.optouts ?? []).filter((row) => row.active !== false).map((row) => String(row.phone)),
    );
    for (const phone of phones) {
      if (blocked.has(phone)) {
        result[phone] = "blocked";
        continue;
      }
      const lead = this.mockLeads.find((item) => item.phone === phone);
      if (!lead) continue;
      result[phone] = ["engaged", "interested", "demo_scheduled", "human_handoff"].includes(lead.stage)
        ? "in_conversation"
        : lead.lastContactAt
          ? "already_approached"
          : "duplicate_existing";
    }
    return result;
  }
  async createResource(key: EditableResourceKey, values: Record<string, unknown>) {
    return this.mutate(() => {
      const row = {
        id: crypto.randomUUID(),
        ...structuredClone(values),
        createdAt: new Date().toISOString(),
      };
      if (key === "leads") this.mockLeads.unshift(row as unknown as LeadSummary);
      else (this.resources[key] ??= []).unshift(row);
      return structuredClone(row);
    });
  }
  async updateResource(key: EditableResourceKey, id: string, values: Record<string, unknown>) {
    return this.mutate(() => {
      if (key === "queue") {
        const job = this.jobs.find((item) => item.id === id);
        if (!job) throw Object.assign(new Error("Registro não encontrado."), { statusCode: 404 });
        if (values.status) job.status = String(values.status);
        if (values.attempts !== undefined) job.attempts = Number(values.attempts);
        if (values.availableAt) job.availableAt = new Date(String(values.availableAt));
        if (values.lastError === null) delete job.lastError;
        else if (values.lastError) job.lastError = String(values.lastError);
        return {
          id: job.id,
          type: job.type,
          status: job.status,
          attempts: job.attempts,
          availableAt: job.availableAt.toISOString(),
          lastError: job.lastError ?? null,
        };
      }
      const rows =
        key === "leads"
          ? (this.mockLeads as unknown as Array<Record<string, unknown>>)
          : (this.resources[key] ?? []);
      const index = rows.findIndex((row) => row.id === id);
      if (index < 0) throw Object.assign(new Error("Registro não encontrado."), { statusCode: 404 });
      rows[index] = { ...rows[index], ...structuredClone(values), updatedAt: new Date().toISOString() };
      return structuredClone(rows[index]!);
    });
  }
  async deleteResource(key: EditableResourceKey, id: string) {
    this.mutate(() => {
      const rows =
        key === "leads"
          ? (this.mockLeads as unknown as Array<Record<string, unknown>>)
          : (this.resources[key] ?? []);
      const index = rows.findIndex((row) => row.id === id);
      if (index < 0) throw Object.assign(new Error("Registro não encontrado."), { statusCode: 404 });
      rows.splice(index, 1);
    });
  }
  async createBatch(input: Record<string, unknown>, phones: string[]) {
    return this.mutate(() => {
      const batchId = crypto.randomUUID();
      const batch = {
        id: batchId,
        name: input.name,
        source: input.source,
        status: "active",
        priority: input.priority ?? 5,
        totalCount: 0,
        processedCount: 0,
        startDate: input.startDate,
        dailyLimit: input.dailyLimit ?? null,
        createdAt: new Date().toISOString(),
      };
      const openers = (this.resources.openers ?? []).filter((row) => row.active !== false);
      const initialStrategy = String(input.initialStrategy ?? "").trim();
      if (!initialStrategy && !openers.length)
        throw Object.assign(
          new Error(
            "Cadastre uma mensagem inicial ou informe uma estratégia para este lote antes de importar.",
          ),
          { statusCode: 409 },
        );
      (this.resources.batches ??= []).unshift(batch);
      let imported = 0;
      let skipped = 0;
      const general = this.settings.get("general") ?? {};
      const mind = this.settings.get("mind") ?? {};
      for (const phone of phones) {
        if (
          this.mockLeads.some((lead) => lead.phone === phone) ||
          (this.resources.optouts ?? []).some((row) => row.phone === phone && row.active !== false)
        ) {
          skipped += 1;
          continue;
        }
        const leadId = crypto.randomUUID();
        this.mockLeads.unshift({
          id: leadId,
          batchId,
          phone,
          name: null,
          company: null,
          stage: "queued",
          source: String(input.source ?? ""),
          lastContactAt: null,
          createdAt: new Date().toISOString(),
        });
        (this.resources.wolfLeadStates ??= []).unshift({
          id: crypto.randomUUID(),
          leadId,
          status: "not_called",
          cohortDate: new Date().toISOString().slice(0, 10),
          totalAttempts: 0,
          answeredAttempts: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        const opening = openers[imported % Math.max(1, openers.length)];
        const content = String(initialStrategy || opening?.content || "")
          .replaceAll("{{nome}}", "")
          .replaceAll("{{empresa}}", String(general.companyName ?? ""))
          .replaceAll("{{produto}}", String(mind.productName ?? ""))
          .replaceAll("{{agente}}", String(general.agentName ?? mind.agentName ?? ""))
          .replaceAll("{{origem}}", String(input.source ?? ""));
        const settings = this.settings.get("outreach") ?? {};
        const dailyLimit = Math.max(1, Number(input.dailyLimit ?? settings.dailyLimit ?? 100));
        const day = Math.floor(imported / dailyLimit);
        const slot = imported % dailyLimit;
        const start = new Date(String(input.startDate ?? new Date().toISOString()));
        start.setDate(start.getDate() + day);
        start.setHours(8, 0, 0, 0);
        const end = new Date(start);
        end.setHours(22, 0, 0, 0);
        const availableAt = new Date(
          start.getTime() + (end.getTime() - start.getTime()) * (slot / Math.max(1, dailyLimit - 1)),
        );
        this.jobs.push({
          id: crypto.randomUUID(),
          type: "outreach",
          payload: {
            leadId,
            phone,
            text: content,
            templateStrategy: opening?.name ?? (initialStrategy || "initial"),
          },
          attempts: 0,
          status: "pending",
          availableAt,
        });
        imported += 1;
      }
      batch.totalCount = imported;
      return { batchId, imported, skipped };
    });
  }
  async saveSettings(section: string, values: Record<string, unknown>) {
    this.mutate(() => {
      this.settings.set(section, structuredClone(values));
    });
  }
  async getSettings(section: string) {
    this.refresh();
    return structuredClone(this.settings.get(section) ?? {});
  }
  async recordWebhook(eventId: string) {
    return this.mutate(() => {
      if (this.webhookIds.has(eventId)) return false;
      this.webhookIds.add(eventId);
      return true;
    });
  }
  async messages(input: { page: number; pageSize: number }) {
    this.refresh();
    return paginate(this.messageRows, input.page, input.pageSize);
  }
  async recordMessage(values: Record<string, unknown>) {
    return this.mutate(() => {
      const idempotencyKey = String(values.idempotencyKey ?? "");
      const existing = idempotencyKey
        ? this.messageRows.find((row) => row.idempotencyKey === idempotencyKey)
        : undefined;
      if (existing) {
        Object.assign(existing, structuredClone(values));
        return structuredClone(existing);
      }
      const row = {
        id: crypto.randomUUID(),
        ...structuredClone(values),
        createdAt: String(values.createdAt ?? new Date().toISOString()),
      };
      this.messageRows.unshift(row);
      return structuredClone(row);
    });
  }
  async ensureManualTestContext(phone: string): Promise<ManualTestContext> {
    return this.mutate(() => {
      let lead = this.mockLeads.find((row) => row.phone === phone);
      const createdLead = !lead;
      if (!lead) {
        lead = {
          id: crypto.randomUUID(),
          phone,
          name: "Teste manual WhatsApp",
          company: null,
          stage: "engaged",
          source: "manual_test",
          lastContactAt: null,
          createdAt: new Date().toISOString(),
        };
        this.mockLeads.unshift(lead);
      }
      const resolvedLead = lead;
      if (!resolvedLead) throw new Error("Não foi possível resolver o lead do teste manual.");
      const conversations = (this.resources.conversations ??= []);
      let conversation = conversations.find((row) => String(row.leadId) === String(resolvedLead.id));
      const createdConversation = !conversation;
      if (!conversation) {
        conversation = {
          id: crypto.randomUUID(),
          leadId: resolvedLead.id,
          status: "active",
          stage: resolvedLead.stage,
          humanActive: false,
          summary: "Teste manual da integração WhatsApp",
          createdAt: new Date().toISOString(),
        };
        conversations.unshift(conversation);
      }
      return { leadId: String(resolvedLead.id), conversationId: String(conversation.id), createdLead, createdConversation };
    });
  }
  async resetLeadSession(phone: string) {
    return this.mutate(() => {
      const leadIds = new Set(
        this.mockLeads.filter((lead) => lead.phone === phone).map((lead) => String(lead.id)),
      );
      const conversationRows = this.resources.conversations ?? [];
      const conversationIds = new Set(
        conversationRows.filter((row) => leadIds.has(String(row.leadId))).map((row) => String(row.id)),
      );
      const messageCount = this.messageRows.filter(
        (row) => leadIds.has(String(row.leadId)) || conversationIds.has(String(row.conversationId)),
      ).length;
      const jobCount = this.jobs.filter(
        (job) => leadIds.has(String(job.payload.leadId)) || job.payload.phone === phone,
      ).length;
      const result = {
        leads: leadIds.size,
        conversations: conversationIds.size,
        messages: messageCount,
        jobs: jobCount,
      };
      this.messageRows = this.messageRows.filter(
        (row) => !leadIds.has(String(row.leadId)) && !conversationIds.has(String(row.conversationId)),
      );
      this.jobs = this.jobs.filter(
        (job) => !leadIds.has(String(job.payload.leadId)) && job.payload.phone !== phone,
      );
      for (const key of [
        "conversations",
        "followups",
        "handoffs",
        "demos",
        "notifications",
        "optouts",
      ] as const)
        this.resources[key] = (this.resources[key] ?? []).filter(
          (row) =>
            !leadIds.has(String(row.leadId)) &&
            !conversationIds.has(String(row.conversationId)) &&
            row.phone !== phone,
        );
      for (let index = this.mockLeads.length - 1; index >= 0; index -= 1)
        if (leadIds.has(String(this.mockLeads[index]?.id))) this.mockLeads.splice(index, 1);
      return result;
    });
  }
  async persistInboundEvent(event: Record<string, unknown>) {
    return this.mutate(() => {
      const phone = String(event.phone ?? "");
      let lead = this.mockLeads.find((row) => row.phone === phone);
      if (!lead) {
        lead = {
          id: crypto.randomUUID(),
          phone,
          name: typeof event.pushName === "string" ? event.pushName : null,
          company: null,
          stage: "engaged",
          source: "whatsapp_inbound",
          lastContactAt: String(event.occurredAt ?? new Date().toISOString()),
          createdAt: new Date().toISOString(),
        };
        this.mockLeads.unshift(lead);
      }
      const conversations = (this.resources.conversations ??= []);
      let conversation = conversations.find((row) => row.leadId === lead!.id);
      if (!conversation) {
        conversation = {
          id: crypto.randomUUID(),
          leadId: lead.id,
          status: "active",
          stage: lead.stage,
          humanActive: Boolean((lead as any).humanActive),
          unreadCount: 0,
          createdAt: new Date().toISOString(),
        };
        conversations.unshift(conversation);
      }
      const externalId = String(event.externalMessageId ?? event.eventId ?? "");
      const inserted = !this.messageRows.some((row) => row.externalId === externalId);
      if (inserted) {
        this.messageRows.unshift({
          id: crypto.randomUUID(),
          externalId,
          leadId: lead.id,
          conversationId: conversation.id,
          direction: "inbound",
          senderType: "lead",
          origin: "whatsapp",
          messageType: event.messageType ?? "text",
          content: event.text ?? "",
          transcription: event.transcription ?? null,
          status: "received",
          receivedAt: event.occurredAt,
          createdAt: new Date().toISOString(),
        });
        conversation.unreadCount = Number(conversation.unreadCount ?? 0) + 1;
        conversation.lastMessageAt = event.occurredAt;
      }
      return {
        leadId: String(lead.id),
        conversationId: String(conversation.id),
        inserted,
        humanActive: Boolean((lead as any).humanActive),
        automationPaused: Boolean((lead as any).automationPaused),
      };
    });
  }
  async enqueue(
    type: string,
    payload: Record<string, unknown>,
    availableAt = new Date(),
    idempotencyKey?: string,
  ) {
    return this.mutate(() => {
      const existing = idempotencyKey
        ? this.jobs.find((job) => job.idempotencyKey === idempotencyKey)
        : undefined;
      if (existing) return existing.id;
      const id = crypto.randomUUID();
      this.jobs.push({
        id,
        type,
        payload,
        attempts: 0,
        status: "pending",
        availableAt,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      });
      return id;
    });
  }
  async enqueueInboundDebounced(
    payload: { phone: string; text: string; messageId: string },
    availableAt: Date,
  ) {
    return this.mutate(() => {
      const existing = this.jobs.find(
        (job) =>
          job.type === "inbound_reply" && job.status === "pending" && job.payload.phone === payload.phone,
      );
      if (existing) {
        existing.payload.text = `${String(existing.payload.text ?? "")}\n${payload.text}`.trim();
        existing.payload.messageId = payload.messageId;
        existing.availableAt = availableAt;
        return existing.id;
      }
      const id = crypto.randomUUID();
      this.jobs.push({
        id,
        type: "inbound_reply",
        payload,
        attempts: 0,
        status: "pending",
        availableAt,
        idempotencyKey: `reply:${payload.messageId}`,
      });
      return id;
    });
  }
  async claimJobs(
    limit: number,
    options: { includeOutbound?: boolean; outboundPhoneAllowlist?: string[] } = {},
  ) {
    return this.mutate(() => {
      const allowlist = new Set(options.outboundPhoneAllowlist ?? []);
      const due = this.jobs
        .filter(
          (job) =>
            job.status === "pending" &&
            job.availableAt <= new Date() &&
            (options.includeOutbound !== false ||
              (allowlist.size > 0 && allowlist.has(String(job.payload.phone ?? ""))) ||
              !["outreach", "follow_up"].includes(job.type)),
        )
        .sort(
          (a, b) =>
            jobPriority(a.type) - jobPriority(b.type) || a.availableAt.getTime() - b.availableAt.getTime(),
        )
        .slice(0, limit);
      due.forEach((job) => {
        job.status = "processing";
        job.attempts += 1;
        job.lockedAt = new Date();
        job.lockedBy = `${process.pid}`;
      });
      return structuredClone(due);
    });
  }
  async recoverStaleJobs(timeoutMs: number) {
    return this.mutate(() => {
      const now = Date.now();
      let found = 0;
      let recovered = 0;
      for (const job of this.jobs) {
        if (job.status !== "processing") continue;
        const stale = !job.lockedAt || now - job.lockedAt.getTime() >= timeoutMs || deadProcess(job.lockedBy);
        if (!stale) continue;
        found += 1;
        job.status = "pending";
        job.availableAt = new Date();
        job.lockedAt = undefined;
        job.lockedBy = undefined;
        job.lastError = "lease_expired_recovered";
        recovered += 1;
      }
      return { found, recovered };
    });
  }
  async renewJobLease(id: string, workerId: string) {
    return this.mutate(() => {
      const job = this.jobs.find(
        (item) => item.id === id && item.status === "processing" && item.lockedBy === workerId,
      );
      if (!job) return false;
      job.lockedAt = new Date();
      return true;
    });
  }
  async completeJob(id: string) {
    this.mutate(() => {
      const job = this.jobs.find((item) => item.id === id && item.status === "processing");
      if (job) {
        job.status = "completed";
        job.completedAt = new Date();
        job.lockedAt = undefined;
        job.lockedBy = undefined;
      }
    });
  }
  async failJob(id: string, error: string, retryAt: Date | null) {
    this.mutate(() => {
      const job = this.jobs.find((item) => item.id === id);
      if (job) {
        job.status = retryAt ? "pending" : "dead";
        job.availableAt = retryAt ?? new Date();
        job.lastError = error;
        job.lockedAt = undefined;
        job.lockedBy = undefined;
      }
    });
  }
  async deferJob(id: string, retryAt: Date, reason: string) {
    this.mutate(() => {
      const job = this.jobs.find((item) => item.id === id);
      if (job) {
        job.status = "pending";
        job.availableAt = retryAt;
        job.attempts = Math.max(0, job.attempts - 1);
        job.lastError = reason;
        job.lockedAt = undefined;
        job.lockedBy = undefined;
      }
    });
  }
  async releaseOutreachForPresence(phone: string) {
    return this.mutate(() => {
      let released = 0;
      for (const job of this.jobs)
        if (
          job.type === "outreach" &&
          job.payload.phone === phone &&
          ["pending", "scheduled", "retry"].includes(job.status)
        ) {
          job.status = "pending";
          job.availableAt = new Date();
          job.payload.onlineReady = true;
          released += 1;
        }
      return released;
    });
  }
  async updateOutreachPresence(phone: string, state: PresenceState, occurredAt: string) {
    return this.mutate(() => {
      let changed = 0;
      for (const job of this.jobs)
        if (
          job.type === "outreach" &&
          job.payload.phone === phone &&
          ["pending", "scheduled", "retry"].includes(job.status)
        ) {
          job.payload = {
            ...job.payload,
            presenceState: state,
            presenceObservedAt: occurredAt,
            onlineReady: state === "online",
          };
          if (state === "online") {
            job.status = "pending";
            job.availableAt = new Date();
          }
          changed += 1;
        }
      return changed;
    });
  }
  async deferOutreachWithPayload(
    id: string,
    retryAt: Date,
    reason: string,
    payload: Record<string, unknown>,
  ) {
    this.mutate(() => {
      const job = this.jobs.find((item) => item.id === id);
      if (job) {
        job.status = "pending";
        job.availableAt = retryAt;
        job.attempts = Math.max(0, job.attempts - 1);
        job.lastError = reason;
        job.payload = { ...job.payload, ...payload };
      }
    });
  }
  async markOutreachCapacityReserved(id: string, reservedAt: string) {
    this.mutate(() => {
      const job = this.jobs.find((item) => item.id === id);
      if (job) job.payload = { ...job.payload, capacityReservedAt: reservedAt };
    });
  }
  async reserveOutreachPacing(minIntervalSeconds: number, _maxIntervalSeconds: number) {
    return { allowed: true, retryAt: new Date(Date.now() + minIntervalSeconds * 1000).toISOString(), intervalSeconds: minIntervalSeconds };
  }
  async reserveOutreachQuota(dailyLimit: number, hourlyLimit: number, allowControlledTestBypass = false) {
    return allowControlledTestBypass
      ? { allowed: true, reason: null, retryAt: new Date().toISOString() }
      : this.outreachCapacity("", dailyLimit, hourlyLimit, false);
  }
  async cancelJob(id: string, reason: string) {
    this.mutate(() => {
      const job = this.jobs.find((item) => item.id === id);
      if (job) { job.status = "cancelled"; job.lastError = reason; job.lockedAt = undefined; job.lockedBy = undefined; }
    });
  }
  async outreachCapacity(
    leadId: string,
    dailyLimit: number,
    hourlyLimit: number,
    allowControlledTestBypass = false,
  ) {
    if (allowControlledTestBypass) return { allowed: true, reason: null, retryAt: new Date().toISOString() };
    this.refresh();
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    const hour = new Date();
    hour.setMinutes(0, 0, 0);
    const completed = this.jobs.filter(
      (job) => job.type === "outreach" && job.status === "completed" && job.completedAt,
    );
    const today = completed.filter((job) => job.completedAt! >= day).length;
    const thisHour = completed.filter((job) => job.completedAt! >= hour).length;
    const lead = this.mockLeads.find((item) => item.id === leadId);
    const batch = (this.resources.batches ?? []).find((row) => row.id === (lead as any)?.batchId);
    const batchLimit = Number(batch?.dailyLimit ?? 0);
    const batchToday = batch
      ? completed.filter(
          (job) =>
            this.mockLeads.find(
              (item) => item.id === job.payload.leadId && (item as any).batchId === batch.id,
            ) && job.completedAt! >= day,
        ).length
      : 0;
    const reason =
      today >= dailyLimit
        ? "Limite diário geral atingido."
        : thisHour >= hourlyLimit
          ? "Limite por hora atingido."
          : batchLimit > 0 && batchToday >= batchLimit
            ? "Limite diário do lote atingido."
            : null;
    return {
      allowed: !reason,
      reason,
      retryAt: new Date(
        reason?.includes("hora") ? hour.getTime() + 3_660_000 : day.getTime() + 33 * 3_600_000,
      ).toISOString(),
    };
  }
  async audit(
    action: string,
    entityType: string,
    entityId: string | null,
    details: Record<string, unknown> = {},
  ) {
    this.mutate(() => {
      (this.resources.logs ??= []).unshift({
        id: crypto.randomUUID(),
        action,
        entityType,
        entityId,
        details,
        actor: "Administrador",
        createdAt: new Date().toISOString(),
      });
    });
  }
}

class SupabaseRepository implements Repository {
  private cachedOwnerId: string | null = null;
  private readonly claimedQueues = new Map<string, PersistentQueueName>();
  constructor(private readonly db: SupabaseClient) {}
  async dashboard(): Promise<DashboardStats> {
    const { data, error } = await this.db.rpc("get_dashboard_stats", { p_owner: await this.ownerId() });
    if (error) throw error;
    return data as DashboardStats;
  }
  async outreachAnalytics() {
    const owner = await this.ownerId();
    const [leads, conversations] = await Promise.all([
      this.db
        .from("leads")
        .select("id,initial_outreach_sent_at,qualified_at,stalled_at")
        .eq("owner_id", owner),
      this.db.from("conversations").select("lead_id,first_inbound_at").eq("owner_id", owner),
    ]);
    if (leads.error) throw leads.error;
    if (conversations.error) throw conversations.error;
    const inboundByLead = new Map(
      (conversations.data ?? []).map((row) => [String(row.lead_id), row.first_inbound_at as string | null]),
    );
    return aggregateOutreachByHour(
      (leads.data ?? []).map((lead) => ({
        initialOutreachSentAt: lead.initial_outreach_sent_at,
        qualifiedAt: lead.qualified_at,
        stalledAt: lead.stalled_at,
        firstInboundAt: inboundByLead.get(String((lead as any).id)) ?? null,
      })),
    );
  }
  async leads(input: {
    page: number;
    pageSize: number;
    search?: string | undefined;
    stage?: string | undefined;
  }): Promise<PageResult> {
    let query = this.db
      .from("leads")
      .select("id,phone,name,company,stage,source,last_contact_at,created_at", { count: "exact" })
      .eq("owner_id", await this.ownerId());
    if (input.stage) query = query.eq("stage", input.stage);
    if (input.search)
      query = query.or(
        `phone.ilike.%${safeSearch(input.search)}%,name.ilike.%${safeSearch(input.search)}%,company.ilike.%${safeSearch(input.search)}%`,
      );
    const from = (input.page - 1) * input.pageSize;
    const { data, count, error } = await query
      .order("created_at", { ascending: false })
      .range(from, from + input.pageSize - 1);
    if (error) throw error;
    return {
      rows: ((data ?? []) as unknown as Array<Record<string, unknown>>).map(toCamelRecord),
      total: count ?? 0,
      page: input.page,
      pageSize: input.pageSize,
    };
  }
  async page(
    key: PageKey,
    input: { page: number; pageSize: number; search?: string | undefined; stage?: string | undefined },
  ): Promise<PageResult> {
    if (key === "queue") return this.queuePage(input);
    if (key === "qualified") {
      let query = this.db
        .from("leads")
        .select("id,phone,name,company,source,stage,qualified_at,updated_at", { count: "exact" })
        .eq("owner_id", await this.ownerId())
        .or("qualified_at.not.is.null,stage.eq.human_handoff");
      if (input.search)
        query = query.or(
          `phone.ilike.%${safeSearch(input.search)}%,name.ilike.%${safeSearch(input.search)}%,company.ilike.%${safeSearch(input.search)}%`,
        );
      const from = (input.page - 1) * input.pageSize;
      const { data, count, error } = await query
        .order("qualified_at", { ascending: false, nullsFirst: false })
        .range(from, from + input.pageSize - 1);
      if (error) throw error;
      return { rows: (data ?? []).map(toCamelRecord), total: count ?? 0, page: input.page, pageSize: input.pageSize };
    }
    const config = pageTable[key];
    if (!config) {
      const stage =
        key === "interested"
          ? "interested"
          : key === "lost"
            ? "lost"
            : key === "unanswered"
              ? "contacted"
              : input.stage;
      return stage ? this.leads({ ...input, stage }) : this.leads(input);
    }
    const from = (input.page - 1) * input.pageSize;
    let query = this.db.from(config.table).select(config.select, { count: "exact" });
    if (config.owned !== false) query = query.eq("owner_id", await this.ownerId());
    if (input.search && config.search?.length)
      query = query.or(
        config.search.map((column) => `${column}.ilike.%${safeSearch(input.search!)}%`).join(","),
      );
    const { data, count, error } = await query
      .order(config.order, { ascending: false })
      .range(from, from + input.pageSize - 1);
    if (error) throw error;
    return {
      rows: ((data ?? []) as unknown as Array<Record<string, unknown>>).map(toCamelRecord),
      total: count ?? 0,
      page: input.page,
      pageSize: input.pageSize,
    };
  }
  async inspectPhones(phones: string[]) {
    const owner = await this.ownerId();
    const result: Record<string, PhoneInspectionStatus> = {};
    for (let offset = 0; offset < phones.length; offset += 500) {
      const chunk = phones.slice(offset, offset + 500);
      const [leads, blocked] = await Promise.all([
        this.db.from("leads").select("phone,stage,approached_at").eq("owner_id", owner).in("phone", chunk),
        this.db.from("suppression_list").select("phone").eq("active", true).in("phone", chunk),
      ]);
      if (leads.error) throw leads.error;
      if (blocked.error) throw blocked.error;
      for (const row of blocked.data ?? []) result[row.phone] = "blocked";
      for (const row of leads.data ?? []) {
        if (result[row.phone] === "blocked") continue;
        result[row.phone] = ["engaged", "interested", "demo_scheduled", "human_handoff"].includes(row.stage)
          ? "in_conversation"
          : row.approached_at
            ? "already_approached"
            : "duplicate_existing";
      }
    }
    return result;
  }
  async createResource(key: EditableResourceKey, values: Record<string, unknown>) {
    const config = editableTable[key];
    const payload = { ...toSnakeRecord(values), owner_id: await this.ownerId() };
    const { data, error } = await this.db.from(config.table).insert(payload).select(config.select).single();
    if (error) throw error;
    return toCamelRecord(data as unknown as Record<string, unknown>);
  }
  async updateResource(key: EditableResourceKey, id: string, values: Record<string, unknown>) {
    const config = editableTable[key];
    const { data, error } = await this.db
      .from(config.table)
      .update(toSnakeRecord(values))
      .eq("id", id)
      .eq("owner_id", await this.ownerId())
      .select(config.select)
      .single();
    if (error) throw error;
    return toCamelRecord(data as unknown as Record<string, unknown>);
  }
  async deleteResource(key: EditableResourceKey, id: string) {
    const config = editableTable[key];
    const { error } = await this.db
      .from(config.table)
      .delete()
      .eq("id", id)
      .eq("owner_id", await this.ownerId());
    if (error) throw error;
  }
  async createBatch(input: Record<string, unknown>, phones: string[]) {
    const owner = await this.ownerId();
    const { data, error } = await this.db.rpc("import_lead_batch", {
      p_owner: owner,
      batch_input: input,
      normalized_phones: phones,
    });
    if (error) throw error;
    const value = data as any;
    const batchId = String(value.batch_id);
    const members = await this.db
      .from("lead_batch_members")
      .select("lead_id")
      .eq("owner_id", owner)
      .eq("batch_id", batchId);
    if (members.error) throw members.error;
    const cohortDate = new Date().toISOString().slice(0, 10);
    const states = (members.data ?? []).map((row) => ({
      owner_id: owner,
      lead_id: row.lead_id,
      status: "not_called",
      cohort_date: cohortDate,
      total_attempts: 0,
      answered_attempts: 0,
    }));
    if (states.length) {
      const linked = await this.db
        .from("wolf_lead_state")
        .upsert(states, { onConflict: "lead_id", ignoreDuplicates: true });
      if (linked.error) throw linked.error;
    }
    return { batchId, imported: value.imported, skipped: value.skipped };
  }
  async saveSettings(section: string, values: Record<string, unknown>) {
    const owner = await this.ownerId();
    const canonical = await this.db
      .from("app_settings")
      .upsert({ owner_id: owner, section, values }, { onConflict: "owner_id,section" });
    if (canonical.error) throw canonical.error;
    if (shouldMirrorLegacySettings(section)) {
      const legacy = await this.db
        .from("system_settings")
        .upsert({ owner_id: owner, section, values }, { onConflict: "owner_id,section" });
      if (legacy.error) throw legacy.error;
    }
  }
  async getSettings(section: string) {
    const owner = await this.ownerId();
    const canonical = await this.db
      .from("app_settings")
      .select("values")
      .eq("owner_id", owner)
      .eq("section", section)
      .maybeSingle();
    if (canonical.error) throw canonical.error;
    if (canonical.data?.values) return canonical.data.values as Record<string, unknown>;
    const legacy = await this.db
      .from("system_settings")
      .select("values")
      .eq("owner_id", owner)
      .eq("section", section)
      .maybeSingle();
    if (legacy.error) throw legacy.error;
    return (legacy.data?.values as Record<string, unknown>) ?? {};
  }
  async recordWebhook(eventId: string, eventType: string, payload: unknown) {
    const result = await this.db.rpc("record_webhook_event", {
      p_event_id: eventId,
      p_event_type: eventType,
      p_payload: payload,
    });
    if (!result.error) return Boolean(result.data);
    if (result.error.code !== "PGRST202") throw result.error;
    const inserted = await this.db
      .from("webhook_events")
      .insert({ event_id: eventId.slice(0, 300), event_type: eventType.slice(0, 100), payload })
      .select("event_id")
      .maybeSingle();
    if (!inserted.error) return Boolean(inserted.data);
    if (inserted.error.code === "23505") return false;
    throw inserted.error;
  }
  async messages(input: { page: number; pageSize: number }) {
    const from = (input.page - 1) * input.pageSize;
    const result = await this.db
      .from("messages")
      .select(
        "id,external_id,conversation_id,lead_id,direction,sender_type,origin,message_type,content,transcription,file_path,status,error_message,attempt,received_at,sent_at,delivered_at,read_at,created_at",
        { count: "exact" },
      )
      .eq("owner_id", await this.ownerId())
      .order("created_at", { ascending: false })
      .range(from, from + input.pageSize - 1);
    if (result.error) throw result.error;
    return {
      rows: (result.data ?? []).map((row) => toCamelRecord(row as Record<string, unknown>)),
      total: result.count ?? 0,
      page: input.page,
      pageSize: input.pageSize,
    };
  }
  async recordMessage(values: Record<string, unknown>) {
    const owner = await this.ownerId();
    const payload: Record<string, unknown> = { ...toSnakeRecord(values), owner_id: owner };
    const result = await this.db.from("messages").insert(payload).select("*").single();
    if (!result.error) return toCamelRecord(result.data as Record<string, unknown>);
    if (result.error.code !== "23505" || !payload.idempotency_key) throw result.error;
    const updated = await this.db
      .from("messages")
      .update(payload)
      .eq("owner_id", owner)
      .eq("idempotency_key", payload.idempotency_key)
      .select("*")
      .single();
    if (updated.error) throw updated.error;
    return toCamelRecord(updated.data as Record<string, unknown>);
  }
  async ensureManualTestContext(phone: string): Promise<ManualTestContext> {
    const owner = await this.ownerId();
    let leadResult = await this.db
      .from("leads")
      .select("id")
      .eq("owner_id", owner)
      .eq("phone", phone)
      .maybeSingle();
    if (leadResult.error) throw leadResult.error;
    let createdLead = false;
    if (!leadResult.data) {
      const inserted = await this.db
        .from("leads")
        .insert({ owner_id: owner, phone, name: "Teste manual WhatsApp", stage: "engaged", source: "manual_test" })
        .select("id")
        .maybeSingle();
      if (inserted.error && inserted.error.code !== "23505") throw inserted.error;
      leadResult = inserted.data ? inserted : await this.db.from("leads").select("id").eq("owner_id", owner).eq("phone", phone).maybeSingle();
      if (leadResult.error) throw leadResult.error;
      createdLead = Boolean(inserted.data);
    }
    const leadId = String(leadResult.data?.id ?? "");
    if (!leadId) throw new Error("Não foi possível resolver o lead do teste manual.");
    let conversationResult = await this.db
      .from("conversations")
      .select("id,lead_id")
      .eq("owner_id", owner)
      .eq("lead_id", leadId)
      .maybeSingle();
    if (conversationResult.error) throw conversationResult.error;
    let createdConversation = false;
    if (!conversationResult.data) {
      const inserted = await this.db
        .from("conversations")
        .insert({ owner_id: owner, lead_id: leadId, status: "active", stage: "engaged", summary: "Teste manual da integração WhatsApp" })
        .select("id,lead_id")
        .maybeSingle();
      if (inserted.error && inserted.error.code !== "23505") throw inserted.error;
      conversationResult = inserted.data ? inserted : await this.db.from("conversations").select("id,lead_id").eq("owner_id", owner).eq("lead_id", leadId).maybeSingle();
      if (conversationResult.error) throw conversationResult.error;
      createdConversation = Boolean(inserted.data);
    }
    const conversationId = String(conversationResult.data?.id ?? "");
    if (!conversationId) throw new Error("Não foi possível resolver a conversa do teste manual.");
    return { leadId, conversationId, createdLead, createdConversation };
  }
  async resetLeadSession(phone: string) {
    const owner = await this.ownerId();
    const leads = await this.db.from("leads").select("id").eq("owner_id", owner).eq("phone", phone);
    if (leads.error) throw leads.error;
    const ids = (leads.data ?? []).map((row) => String(row.id));
    const conversations = ids.length
      ? await this.db
          .from("conversations")
          .select("id", { count: "exact", head: true })
          .eq("owner_id", owner)
          .in("lead_id", ids)
      : { count: 0, error: null };
    const messages = ids.length
      ? await this.db
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("owner_id", owner)
          .in("lead_id", ids)
      : { count: 0, error: null };
    const jobs = await this.db
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", owner)
      .or(
        ids.length
          ? `payload->>phone.eq.${phone},payload->>leadId.in.(${ids.join(",")})`
          : `payload->>phone.eq.${phone}`,
      );
    if (conversations.error || messages.error || jobs.error)
      throw conversations.error ?? messages.error ?? jobs.error;
    const scoped = async (table: string, column: string) => {
      if (!ids.length) return;
      const result = await this.db.from(table).delete().eq("owner_id", owner).in(column, ids);
      if (result.error) throw result.error;
    };
    for (const [table, column] of [
      ["lead_events", "lead_id"],
      ["lead_memories", "lead_id"],
      ["conversation_memories", "lead_id"],
      ["messages", "lead_id"],
      ["follow_ups", "lead_id"],
      ["handoffs", "lead_id"],
      ["appointments", "lead_id"],
      ["lead_batch_members", "lead_id"],
      ["outreach_queue", "lead_id"],
      ["ai_response_queue", "lead_id"],
      ["follow_up_queue", "lead_id"],
      ["notifications", "lead_id"],
      ["conversation_takeovers", "lead_id"],
    ] as const)
      await scoped(table, column);
    const jobsDeleted = await this.db
      .from("jobs")
      .delete()
      .eq("owner_id", owner)
      .or(
        ids.length
          ? `payload->>phone.eq.${phone},payload->>leadId.in.(${ids.join(",")})`
          : `payload->>phone.eq.${phone}`,
      );
    if (jobsDeleted.error) throw jobsDeleted.error;
    const suppression = await this.db.from("suppression_list").delete().eq("phone", phone);
    if (suppression.error) throw suppression.error;
    const webhooks = await this.db.from("webhook_events").delete().eq("payload->>phone", phone);
    if (webhooks.error) throw webhooks.error;
    const integration = await this.db
      .from("integration_events")
      .delete()
      .eq("owner_id", owner)
      .eq("payload->>phone", phone);
    if (integration.error) throw integration.error;
    if (ids.length) {
      const removed = await this.db.from("leads").delete().eq("owner_id", owner).in("id", ids);
      if (removed.error) throw removed.error;
    }
    return {
      leads: ids.length,
      conversations: conversations.count ?? 0,
      messages: messages.count ?? 0,
      jobs: jobs.count ?? 0,
    };
  }
  async persistInboundEvent(event: Record<string, unknown>) {
    const result = await this.db.rpc("persist_inbound_evolution_event", {
      p_owner: await this.ownerId(),
      p_event: event,
    });
    if (result.error) throw result.error;
    return result.data as {
      leadId: string;
      conversationId: string;
      inserted: boolean;
      humanActive: boolean;
      automationPaused: boolean;
    };
  }
  async enqueue(
    type: string,
    payload: Record<string, unknown>,
    availableAt = new Date(),
    idempotencyKey?: string,
  ) {
    const queue = canonicalQueue(type);
    const leadId = typeof payload.leadId === "string" ? payload.leadId : null;
    if (queue && leadId) {
      const ownerId = await this.ownerId();
      if (idempotencyKey) {
        const existing = await this.db
          .from(queue)
          .select("id")
          .eq("owner_id", ownerId)
          .eq("deduplication_key", idempotencyKey)
          .maybeSingle();
        if (existing.error) throw existing.error;
        if (existing.data?.id) return String(existing.data.id);
      }
      const row = {
        owner_id: ownerId,
        lead_id: leadId,
        payload: { ...payload, type },
        available_at: availableAt.toISOString(),
        deduplication_key: idempotencyKey,
        status: queue === "follow_up_queue" ? "scheduled" : "pending",
      };
      const { data, error } = await this.db.from(queue).insert(row).select("id").single();
      if (error?.code === "23505" && idempotencyKey) {
        const existing = await this.db
          .from(queue)
          .select("id")
          .eq("owner_id", ownerId)
          .eq("deduplication_key", idempotencyKey)
          .single();
        if (existing.error) throw existing.error;
        return String(existing.data.id);
      }
      if (error) throw error;
      return String(data.id);
    }
    const { data, error } = await this.db
      .from("jobs")
      .insert({
        owner_id: await this.ownerId(),
        type,
        payload,
        available_at: availableAt.toISOString(),
        idempotency_key: idempotencyKey,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id as string;
  }
  async enqueueInboundDebounced(
    payload: { phone: string; text: string; messageId: string },
    availableAt: Date,
  ) {
    const { data, error } = await this.db.rpc("enqueue_inbound_debounced", {
      p_owner: await this.ownerId(),
      p_phone: payload.phone,
      p_text: payload.text,
      p_message_id: payload.messageId,
      p_available_at: availableAt.toISOString(),
    });
    if (error) throw error;
    return String(data);
  }
  async claimJobs(
    limit: number,
    options: { includeOutbound?: boolean; outboundPhoneAllowlist?: string[] } = {},
  ) {
    const jobs: QueueJob[] = [];
    const workerId = `${process.env.COMPUTERNAME ?? "local"}:${process.pid}`;
    // ai_response_queue is conversation work, not proactive outreach. It must
    // remain claimable while prospecting is paused/outside its operating window.
    for (const queue of (["ai_response_queue"] as const)) {
      if (jobs.length >= limit) break;
      const { data, error } = await this.db.rpc("claim_queue_items", {
        p_queue: queue,
        p_limit: limit - jobs.length,
        p_worker_id: workerId,
      });
      if (error) throw error;
      for (const row of data ?? []) {
        const payload = row.payload as Record<string, unknown>;
        const job = {
          id: String(row.id),
          type: String(payload.type ?? queueJobType(queue)),
          payload,
          attempts: Number(row.attempts),
          maxAttempts: Number(row.max_attempts),
          queue,
        } satisfies QueueJob;
        this.claimedQueues.set(job.id, queue);
        jobs.push(job);
      }
    }
    if (jobs.length < limit) {
      const { data, error } = await this.db.rpc("claim_jobs", {
        p_owner: await this.ownerId(),
        p_limit: limit - jobs.length,
        p_worker_id: workerId,
      });
      if (error) throw error;
      for (const row of data ?? []) {
        this.claimedQueues.set(String(row.id), "jobs");
        jobs.push({
          id: String(row.id),
          type: String(row.type),
          payload: row.payload as Record<string, unknown>,
          attempts: Number(row.attempts),
          queue: "jobs",
        });
      }
    }
    for (const queue of (options.includeOutbound === false && !options.outboundPhoneAllowlist?.length
      ? []
      : ["outreach_queue", "follow_up_queue"]) as Array<"outreach_queue" | "follow_up_queue">) {
      if (jobs.length >= limit) break;
      const rpc = options.outboundPhoneAllowlist?.length
        ? "claim_queue_items_allowlisted"
        : "claim_queue_items";
      const args = options.outboundPhoneAllowlist?.length
        ? {
            p_queue: queue,
            p_limit: limit - jobs.length,
            p_worker_id: workerId,
            p_phone_allowlist: options.outboundPhoneAllowlist,
          }
        : { p_queue: queue, p_limit: limit - jobs.length, p_worker_id: workerId };
      const { data, error } = await this.db.rpc(rpc, args);
      if (error) throw error;
      for (const row of data ?? []) {
        const payload = row.payload as Record<string, unknown>;
        const job = {
          id: String(row.id),
          type: String(payload.type ?? queueJobType(queue)),
          payload,
          attempts: Number(row.attempts),
          maxAttempts: Number(row.max_attempts),
          queue,
        } satisfies QueueJob;
        this.claimedQueues.set(job.id, queue);
        jobs.push(job);
      }
    }
    return jobs;
  }
  async recoverStaleJobs(timeoutMs: number) {
    const result = await this.db.rpc("recover_stale_queue_items", {
      p_stale_after: `${Math.max(1, Math.round(timeoutMs / 1000))} seconds`,
    });
    if (result.error) throw result.error;
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    return {
      found: Number(typeof result.data === "number" ? result.data : row?.stale_jobs_found ?? row?.found ?? 0),
      recovered: Number(row?.stale_jobs_recovered ?? row?.recovered ?? (typeof result.data === "number" ? result.data : 0)),
    };
  }
  async renewJobLease(id: string, workerId: string) {
    const queue = this.claimedQueues.get(id) ?? "jobs";
    const result = await this.db
      .from(queue)
      .update({ locked_at: new Date().toISOString() })
      .eq("id", id)
      .eq("locked_by", workerId)
      .eq("status", "processing")
      .select("id")
      .maybeSingle();
    if (result.error) throw result.error;
    return Boolean(result.data?.id);
  }
  async completeJob(id: string) {
    const queue = this.claimedQueues.get(id) ?? "jobs";
    const values = {
      status: "completed",
      completed_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
    };
    const { error } = await this.db.from(queue).update(values).eq("id", id).eq("status", "processing");
    if (error) throw error;
    this.claimedQueues.delete(id);
  }
  async reserveOutreachPacing(minIntervalSeconds: number, maxIntervalSeconds: number) {
    const { data, error } = await this.db.rpc("reserve_outreach_pacing", {
      p_owner: await this.ownerId(),
      p_min_interval_seconds: minIntervalSeconds,
      p_max_interval_seconds: maxIntervalSeconds,
    });
    if (error) throw error;
    return data as { allowed: boolean; retryAt: string; intervalSeconds?: number };
  }
  async reserveOutreachQuota(dailyLimit: number, hourlyLimit: number, allowControlledTestBypass = false) {
    if (allowControlledTestBypass) return { allowed: true, reason: null, retryAt: new Date().toISOString() };
    const { data, error } = await this.db.rpc("reserve_outreach_quota", {
      p_owner: await this.ownerId(),
      p_daily_limit: dailyLimit,
      p_hourly_limit: hourlyLimit,
    });
    if (error) throw error;
    return data as { allowed: boolean; reason: string | null; retryAt: string };
  }
  async cancelJob(id: string, reason: string) {
    const queue = this.claimedQueues.get(id) ?? "jobs";
    const { error } = await this.db
      .from(queue)
      .update({ status: "cancelled", last_error: reason, locked_at: null, locked_by: null })
      .eq("id", id)
      .eq("status", "processing");
    if (error) throw error;
    this.claimedQueues.delete(id);
  }
  async failJob(id: string, errorMessage: string, retryAt: Date | null) {
    const queue = this.claimedQueues.get(id) ?? "jobs";
    const status = queue === "jobs" ? (retryAt ? "pending" : "dead") : retryAt ? "retry" : "dead_letter";
    const { error } = await this.db
      .from(queue)
      .update({
        status,
        available_at: retryAt?.toISOString(),
        last_error: errorMessage.slice(0, 2000),
        locked_at: null,
        locked_by: null,
      })
      .eq("id", id);
    if (error) throw error;
    if (!retryAt) {
      const failed = await this.db.from("failed_jobs").insert({
        owner_id: await this.ownerId(),
        queue_name: queue === "jobs" ? "legacy_jobs" : queue,
        original_job_id: id,
        job_type: queueJobType(queue),
        error_message: errorMessage.slice(0, 4000),
      });
      if (failed.error) throw failed.error;
    }
    this.claimedQueues.delete(id);
  }
  async deferJob(id: string, retryAt: Date, reason: string) {
    const queue = this.claimedQueues.get(id) ?? "jobs";
    if (queue === "jobs") {
      const owner = await this.ownerId();
      const current = await this.db
        .from("jobs")
        .select("attempts")
        .eq("owner_id", owner)
        .eq("id", id)
        .single();
      if (current.error) throw current.error;
      const deferred = await this.db
        .from("jobs")
        .update({
          status: "pending",
          available_at: retryAt.toISOString(),
          locked_at: null,
          locked_by: null,
          attempts: Math.max(0, Number(current.data.attempts ?? 0) - 1),
          last_error: reason.slice(0, 500),
        })
        .eq("owner_id", owner)
        .eq("id", id);
      if (deferred.error) throw deferred.error;
    } else {
      const { error } = await this.db
        .from(queue)
        .update({
          status: "scheduled",
          available_at: retryAt.toISOString(),
          locked_at: null,
          locked_by: null,
          attempts: 0,
          last_error: reason.slice(0, 500),
        })
        .eq("id", id);
      if (error) throw error;
    }
    this.claimedQueues.delete(id);
  }
  async releaseOutreachForPresence(phone: string) {
    const owner = await this.ownerId();
    const pending = await this.db
      .from("outreach_queue")
      .select("id,payload")
      .eq("owner_id", owner)
      .in("status", ["pending", "scheduled", "retry"])
      .eq("payload->>phone", phone);
    if (pending.error) throw pending.error;
    let released = 0;
    for (const row of pending.data ?? []) {
      const payload = { ...((row.payload ?? {}) as Record<string, unknown>), onlineReady: true };
      const result = await this.db
        .from("outreach_queue")
        .update({
          status: "pending",
          available_at: new Date().toISOString(),
          locked_at: null,
          locked_by: null,
          last_error: null,
          payload,
        })
        .eq("owner_id", owner)
        .eq("id", row.id);
      if (result.error) throw result.error;
      released += 1;
    }
    return released;
  }
  async updateOutreachPresence(phone: string, state: PresenceState, occurredAt: string) {
    const owner = await this.ownerId();
    const pending = await this.db
      .from("outreach_queue")
      .select("id,payload")
      .eq("owner_id", owner)
      .in("status", ["pending", "scheduled", "retry"])
      .eq("payload->>phone", phone);
    if (pending.error) throw pending.error;
    let changed = 0;
    for (const row of pending.data ?? []) {
      const payload = {
        ...((row.payload ?? {}) as Record<string, unknown>),
        presenceState: state,
        presenceObservedAt: occurredAt,
        onlineReady: state === "online",
      };
      const values =
        state === "online"
          ? {
              status: "pending",
              available_at: new Date().toISOString(),
              locked_at: null,
              locked_by: null,
              last_error: null,
              payload,
            }
          : { payload };
      const result = await this.db
        .from("outreach_queue")
        .update(values)
        .eq("owner_id", owner)
        .eq("id", row.id);
      if (result.error) throw result.error;
      changed += 1;
    }
    return changed;
  }
  async deferOutreachWithPayload(
    id: string,
    retryAt: Date,
    reason: string,
    payload: Record<string, unknown>,
  ) {
    const queue = this.claimedQueues.get(id) ?? "outreach_queue";
    if (queue !== "outreach_queue") return this.deferJob(id, retryAt, reason);
    const result = await this.db
      .from("outreach_queue")
      .update({
        status: "scheduled",
        available_at: retryAt.toISOString(),
        locked_at: null,
        locked_by: null,
        attempts: 0,
        last_error: reason.slice(0, 500),
        payload,
      })
      .eq("id", id);
    if (result.error) throw result.error;
    this.claimedQueues.delete(id);
  }
  async markOutreachCapacityReserved(id: string, reservedAt: string) {
    const owner = await this.ownerId();
    const current = await this.db
      .from("outreach_queue")
      .select("payload")
      .eq("owner_id", owner)
      .eq("id", id)
      .single();
    if (current.error) throw current.error;
    const payload = {
      ...((current.data.payload ?? {}) as Record<string, unknown>),
      capacityReservedAt: reservedAt,
    };
    const result = await this.db
      .from("outreach_queue")
      .update({ payload })
      .eq("owner_id", owner)
      .eq("id", id)
      .eq("status", "processing");
    if (result.error) throw result.error;
  }
  async outreachCapacity(
    leadId: string,
    dailyLimit: number,
    hourlyLimit: number,
    allowControlledTestBypass = false,
  ) {
    const { data, error } = await this.db.rpc("check_outreach_capacity", {
      p_owner: await this.ownerId(),
      p_lead: leadId,
      p_daily_limit: dailyLimit,
      p_hourly_limit: hourlyLimit,
      p_allow_controlled_test_bypass: allowControlledTestBypass,
    });
    if (error) throw error;
    return data as OutreachCapacity;
  }
  async audit(
    action: string,
    entityType: string,
    entityId: string | null,
    details: Record<string, unknown> = {},
  ) {
    const owner = await this.ownerId();
    const { error } = await this.db.from("audit_logs").insert({
      owner_id: owner,
      actor_id: owner,
      action,
      entity_type: entityType,
      entity_id: entityId,
      details,
    });
    if (error) throw error;
  }
  private async queuePage(input: {
    page: number;
    pageSize: number;
    search?: string | undefined;
  }): Promise<PageResult> {
    const owner = await this.ownerId();
    type QueuePageChunk = { count: number; rows: Array<Record<string, unknown>> };
    const canonical = [
      ["outreach_queue", "outreach"],
      ["ai_response_queue", "inbound_reply"],
      ["follow_up_queue", "follow_up"],
    ] as const;
    const results: QueuePageChunk[] = await Promise.all([
      ...canonical.map(async ([table, type]) => {
        const result = await this.db
          .from(table)
          .select(
            "id,status,priority,available_at,attempts,max_attempts,last_error,deduplication_key,created_at",
            { count: "exact" },
          )
          .eq("owner_id", owner)
          .order("created_at", { ascending: false })
          .limit(1000);
        if (result.error) throw result.error;
        return {
          count: result.count ?? 0,
          rows: (result.data ?? []).map((row) => {
            const value = row as Record<string, unknown>;
            const payload = (value.payload ?? {}) as Record<string, unknown>;
            return {
              ...value,
              presence_status:
                table === "outreach_queue"
                  ? (payload.presenceState ?? (payload.onlineReady === true ? "online" : "unknown"))
                  : null,
              queue_name: table,
              type,
            };
          }),
        };
      }),
      (async () => {
        const result = await this.db
          .from("jobs")
          .select("id,type,status,available_at,attempts,max_attempts,last_error,idempotency_key,created_at", {
            count: "exact",
          })
          .eq("owner_id", owner)
          .order("created_at", { ascending: false })
          .limit(1000);
        if (result.error) throw result.error;
        return {
          count: result.count ?? 0,
          rows: (result.data ?? []).map((row) => ({
            ...(row as Record<string, unknown>),
            queue_name: "jobs",
          })),
        };
      })(),
    ]);
    let rows = results
      .flatMap((result) => result.rows)
      .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));
    if (input.search) {
      const query = input.search.toLowerCase();
      rows = rows.filter((row) => JSON.stringify(row).toLowerCase().includes(query));
    }
    const total = input.search ? rows.length : results.reduce((sum, result) => sum + result.count, 0);
    const from = (input.page - 1) * input.pageSize;
    return {
      rows: rows.slice(from, from + input.pageSize).map(toCamelRecord),
      total,
      page: input.page,
      pageSize: input.pageSize,
    };
  }
  private async ownerId() {
    if (this.cachedOwnerId) return this.cachedOwnerId;
    const { data, error } = await this.db
      .from("profiles")
      .select("id")
      .eq("role", "admin")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (error || !data?.id)
      throw Object.assign(new Error("Crie o administrador e execute o seed antes de iniciar a operação."), {
        statusCode: 503,
      });
    this.cachedOwnerId = data.id as string;
    return this.cachedOwnerId;
  }
}

const pageTable: Partial<
  Record<PageKey, { table: string; select: string; order: string; search?: string[]; owned?: boolean }>
> = {
  wolfCalls: {
    table: "wolf_calls",
    select:
      "id,lead_id,operator_id,direction,status,started_at,ended_at,duration_seconds,result,summary,live_context,transcript,created_at",
    order: "created_at",
    search: ["status", "result", "summary"],
  },
  wolfLeadStates: {
    table: "wolf_lead_state",
    select:
      "id,lead_id,status,cohort_date,first_call_at,last_call_at,next_call_at,total_attempts,answered_attempts,converted_at,conversion_type,created_at,updated_at",
    order: "next_call_at",
    search: ["status"],
  },
  wolfCallEvents: {
    table: "wolf_call_events",
    select: "id,lead_id,call_id,event_type,occurred_at,metadata",
    order: "occurred_at",
    search: ["event_type"],
  },
  batches: {
    table: "lead_batches",
    select: "id,name,source,status,priority,total_count,processed_count,start_date,created_at",
    order: "created_at",
    search: ["name", "source"],
  },
  queue: {
    table: "jobs",
    select: "id,type,status,attempts,available_at,last_error,created_at",
    order: "created_at",
  },
  conversations: {
    table: "conversations",
    select: "id,lead_id,status,stage,human_active,takeover_state,last_message_at,summary,created_at",
    order: "last_message_at",
    search: ["summary"],
  },
  demos: {
    table: "appointments",
    select:
      "id,lead_id,conversation_id,starts_at,ends_at,status,assignee,notes,origin,reminder_at,rescheduled_from,cancelled_at,created_at,updated_at",
    order: "starts_at",
    search: ["assignee", "notes"],
  },
  followups: {
    table: "follow_ups",
    select: "id,lead_id,scheduled_at,status,attempt_number,reason,created_at",
    order: "scheduled_at",
    search: ["reason"],
  },
  handoffs: {
    table: "handoffs",
    select: "id,lead_id,reason,status,assigned_to,result,assumed_at,closed_at,created_at",
    order: "created_at",
    search: ["reason", "assigned_to", "result"],
  },
  optouts: {
    table: "suppression_list",
    select: "id,phone,reason,source,active,created_at",
    order: "created_at",
    search: ["phone", "reason", "source"],
  },
  materials: {
    table: "materials",
    select:
      "id,name,description,category,tags,mime_type,size_bytes,active,auto_send_allowed,human_confirmation_required,allowed_stages,related_intent,instruction,archived_at,created_at,updated_at",
    order: "created_at",
    search: ["name", "category"],
  },
  knowledge: {
    table: "knowledge_items",
    select: "id,title,category,subject,tags,stages,source,content,active,archived_at,created_at,updated_at",
    order: "updated_at",
    search: ["title", "category", "subject", "content"],
  },
  notifications: {
    table: "notifications",
    select: "id,type,level,title,body,lead_id,conversation_id,read_at,created_at",
    order: "created_at",
    search: ["title", "body", "type"],
  },
  openers: {
    table: "message_templates",
    select: "id,name,content,active,use_count,last_used_at,created_at",
    order: "created_at",
    search: ["name", "content"],
  },
  logs: {
    table: "audit_logs",
    select:
      "id,action,entity_type,entity_id,level,service,lead_id,conversation_id,job_id,integration,event_type,details,created_at",
    order: "created_at",
    search: ["action", "entity_type", "service", "event_type"],
  },
};

const editableTable: Record<EditableResourceKey, { table: string; select: string }> = {
  leads: { table: "leads", select: "id,phone,name,company,stage,source,last_contact_at,created_at" },
  batches: { table: "lead_batches", select: pageTable.batches!.select },
  queue: { table: "jobs", select: pageTable.queue!.select },
  conversations: { table: "conversations", select: pageTable.conversations!.select },
  demos: { table: "appointments", select: pageTable.demos!.select },
  followups: { table: "follow_ups", select: pageTable.followups!.select },
  handoffs: { table: "handoffs", select: pageTable.handoffs!.select },
  optouts: { table: "suppression_list", select: pageTable.optouts!.select },
  materials: { table: "materials", select: pageTable.materials!.select },
  knowledge: { table: "knowledge_items", select: pageTable.knowledge!.select },
  notifications: { table: "notifications", select: pageTable.notifications!.select },
  openers: { table: "message_templates", select: pageTable.openers!.select },
  wolfCalls: { table: "wolf_calls", select: pageTable.wolfCalls!.select },
  wolfTurns: {
    table: "wolf_call_turns",
    select: "id,call_id,speaker,text,started_at,ended_at,sequence,created_at",
  },
  wolfInsights: { table: "wolf_call_insights", select: "id,call_id,kind,value,confidence,created_at" },
  wolfLeadStates: {
    table: "wolf_lead_state",
    select:
      "id,lead_id,status,cohort_date,first_call_at,last_call_at,next_call_at,total_attempts,answered_attempts,converted_at,conversion_type,created_at,updated_at",
  },
  wolfCallEvents: { table: "wolf_call_events", select: "id,lead_id,call_id,event_type,occurred_at,metadata" },
};

const mockRows: Partial<Record<PageKey, Array<Record<string, unknown>>>> = {};

function paginate(rows: Array<Record<string, unknown>>, page: number, pageSize: number): PageResult {
  const from = (page - 1) * pageSize;
  return { rows: rows.slice(from, from + pageSize), total: rows.length, page, pageSize };
}
function safeSearch(value: string) {
  return value.replace(/[%(),]/g, "").slice(0, 80);
}
function toCamelRecord(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
      value,
    ]),
  );
}
function toSnakeRecord(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
      value,
    ]),
  );
}
function jobPriority(type: string) {
  return type === "opt_out" ? 0 : type === "inbound_reply" ? 1 : 2;
}
function deadProcess(value: unknown) {
  const pid = Number(value);
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}
function canonicalQueue(type: string): Exclude<PersistentQueueName, "jobs"> | null {
  return type === "outreach"
    ? "outreach_queue"
    : type === "inbound_reply"
      ? "ai_response_queue"
      : type === "follow_up"
        ? "follow_up_queue"
        : null;
}
function queueJobType(queue: PersistentQueueName) {
  return queue === "outreach_queue"
    ? "outreach"
    : queue === "ai_response_queue"
      ? "inbound_reply"
      : queue === "follow_up_queue"
        ? "follow_up"
        : "unknown";
}
