import pino from "pino";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  AgentContextBuilder,
  AgentExecutionService,
  canAttemptGroupDelivery,
  canStartOutreach,
  ConversationMemoryService,
  decryptSecret,
  deriveConversationState,
  evaluateScheduledResume,
  formatDisqualifiedGroupMessageClean,
  formatHumanQualifiedGroupMessage,
  formatStalledGroupMessage,
  groupNotificationDedupKey,
  interpretBrazilianContext,
  isExplicitNoInterestText,
  isOptOutText,
  isOwnerRoleAnswer,
  normalizeBrazilianPhone,
  nextCadenceAttempt,
  planConversation,
  ProviderCircuitBreaker,
  regionFromBrazilianPhone,
  shouldMarkStalled,
  type AgentCallMetrics,
  type AgentExecutionResult,
  type AgentSnapshot,
} from "@renova123/core";
import { createRepository, type QueueJob } from "@renova123/database";
import {
  AiStructuredOutputError,
  EvolutionWhatsAppProvider,
  GeminiProvider,
  GeminiProviderError,
  GeminiRateLimitError,
  GroqModelUnavailableError,
  GroqProvider,
  GroqProviderError,
  GroqRateLimitError,
  MockWhatsAppProvider,
  normalizeWhatsAppText,
  OpenRouterProvider,
  OpenRouterProviderError,
  OpenRouterRateLimitError,
  type NormalizedWhatsAppEvent,
  type WhatsAppMediaInput,
  type WhatsAppProvider,
  type WhatsAppSendResult,
} from "@renova123/integrations";
import { aiDecisionSchema, outreachSettingsSchema, type AiDecision } from "@renova123/shared";
import { workerConfig } from "./config.js";
import {
  appendLatestLeadMessageIfMissing,
  conversationalBubbleDelayMs,
  currentLeadTurn,
  ensureActiveInboundReply,
  isIrritatedTurn,
  naturalMessageParts,
  needsOutboundIdentityRepair,
  needsRecentQuestionRepair,
  roleFromStoredMessage,
} from "./conversation-style.js";
import {
  deliveryIsUncertain,
  deliveryWasAccepted,
  markDeliveryAccepted,
  markDeliveryUncertain,
} from "./delivery-ledger.js";
import { sendOrderedParts } from "./ordered-message-sequence.js";
import {
  AIResponseWorker,
  AppointmentWorker,
  DelayedReplyWorker,
  FollowUpWorker,
  InboundMessageWorker,
  MaintenanceWorker,
  MediaWorker,
  OutreachWorker,
  type WorkerService,
} from "./services.js";
import { structuredOutputFailurePlan } from "./structured-output-policy.js";
import { groqAttemptModels, isSharedGroqQuotaError, providerPoolRetrySeconds } from "./ai-fallback-policy.js";
import { compareOutboundText, materializeOutreachTemplate } from "./outbound-text-integrity.js";
import { ConversationLanes } from "./conversation-lanes.js";
import {
  isControlledOutreachTestJob,
  isOperationalTestMode,
  operationalTestDestination,
} from "./outreach-policy.js";

const mock = workerConfig.MOCK_MODE;
const simulation = workerConfig.simulation;
const log = pino({
  level: workerConfig.LOG_LEVEL,
  redact: ["*.apiKey", "*.token", "*.password", "*.secret", "*.authorization"],
});
const repository = createRepository({
  mock,
  supabaseUrl: workerConfig.SUPABASE_URL,
  serviceRoleKey: workerConfig.SUPABASE_SERVICE_ROLE_KEY,
  mockFilePath: workerConfig.MOCK_DB_PATH,
});
const serviceDb =
  !mock && workerConfig.SUPABASE_URL && workerConfig.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(workerConfig.SUPABASE_URL, workerConfig.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      })
    : null;
const whatsapp: WhatsAppProvider = workerConfig.MOCK_EVOLUTION
  ? new MockWhatsAppProvider({
      instanceName: workerConfig.EVOLUTION_INSTANCE_NAME,
      webhookSecret: workerConfig.EVOLUTION_WEBHOOK_SECRET ?? "development-only-secret-change-me",
    })
  : new EvolutionWhatsAppProvider({
      baseUrl: workerConfig.EVOLUTION_BASE_URL,
      apiKey: workerConfig.EVOLUTION_API_KEY,
      instanceName: workerConfig.EVOLUTION_INSTANCE_NAME,
      webhookUrl: workerConfig.EVOLUTION_WEBHOOK_URL,
      webhookSecret: workerConfig.EVOLUTION_WEBHOOK_SECRET ?? "development-only-secret-change-me",
    });
const instanceId = `${process.env.COMPUTERNAME ?? "local"}:${process.pid}:${crypto.randomUUID()}`;
const localHeartbeatPath = path.resolve(
  `${workerConfig.MOCK_DB_PATH ?? ".runtime/mock-db.json"}.worker-heartbeat.json`,
);
const groqCircuit = new ProviderCircuitBreaker({ failureThreshold: 3, cooldownMs: 60_000 });
const openRouter1Circuit = new ProviderCircuitBreaker({ failureThreshold: 3, cooldownMs: 1_000 });
const geminiCircuit = new ProviderCircuitBreaker({ failureThreshold: 3, cooldownMs: 60_000 });

let stopping = false;
let workerLeaseLost = false;
let lastHeartbeatAtMs = Date.now();
let localWorkerLockDescriptor: number | null = null;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

const services: WorkerService[] = [
  new OutreachWorker(processOutbound),
  new InboundMessageWorker(processInboundEvent),
  new AIResponseWorker(processInbound),
  new DelayedReplyWorker(processDelayedReply),
  new FollowUpWorker(processFollowUp),
  new MediaWorker(processMaterial),
  new AppointmentWorker(processAppointment),
  new MaintenanceWorker(processMaintenance),
];

let lastDailyPlanKey: string | null = null;
async function ensureDailyCadencePlan(outreach: Record<string, unknown>) {
  const timezone = String(outreach.timezone ?? workerConfig.TIMEZONE);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  const planDate = `${get("year")}-${get("month")}-${get("day")}`;
  const planKey = `daily_plan:${planDate}`;
  if (lastDailyPlanKey === planKey) return;
  const startTime = String(outreach.startTime ?? "08:00");
  if (`${get("hour")}:${get("minute")}` < startTime) return;
  const budget = Number(outreach.newLeadsDailyLimit ?? outreach.dailyProactiveLimit ?? 50);
  if (!serviceDb) {
    const queue = await repository.page("queue", { page: 1, pageSize: 5000 });
    const today = planDate;
    const completedToday = queue.rows.filter(
      (row) =>
        ["outreach", "follow_up"].includes(String(row.type)) &&
        String(row.status) === "completed" &&
        String(row.completedAt ?? "").startsWith(today),
    ).length;
    const reservedToday = queue.rows.filter(
      (row) =>
        ["outreach", "follow_up"].includes(String(row.type)) &&
        ["pending", "processing", "retry", "scheduled"].includes(String(row.status)) &&
        String((row.payload as Record<string, unknown> | undefined)?.proactivePlanDate ?? "") === planKey,
    ).length;
    const remaining = Math.max(0, budget - completedToday - reservedToday);
    if (remaining === 0) {
      lastDailyPlanKey = planKey;
      return;
    }
    const openers = await repository.page("openers", { page: 1, pageSize: 1 });
    const text = String(openers.rows[0]?.content ?? "").trim();
    if (!text) {
      await repository.audit("cadence.daily_plan.blocked", "system", null, {
        planKey,
        reason: "opening_template_missing",
        budget,
      });
      lastDailyPlanKey = planKey;
      return;
    }
    const leads = await repository.leads({ page: 1, pageSize: 5000 });
    const activeLeadIds = new Set(
      queue.rows
        .filter(
          (row) =>
            ["outreach", "follow_up"].includes(String(row.type)) &&
            ["pending", "processing", "retry", "scheduled"].includes(String(row.status)),
        )
        .map((row) => String((row.payload as Record<string, unknown> | undefined)?.leadId ?? "")),
    );
    const candidates = leads.rows
      .filter((lead) => ["new", "queued"].includes(String(lead.stage)) && !activeLeadIds.has(String(lead.id)))
      .slice(0, remaining);
    for (const lead of candidates) {
      await repository.enqueue(
        "outreach",
        {
          leadId: String(lead.id),
          phone: String(lead.phone),
          text,
          templateStrategy: "daily_plan",
          proactivePlanDate: planKey,
        },
        new Date(),
        `daily:${planKey}:${String(lead.id)}`,
      );
    }
    await repository.audit("cadence.daily_plan.created", "system", null, {
      planKey,
      budget,
      plannedNewLeadCount: candidates.length,
      completedToday,
    });
    lastDailyPlanKey = planKey;
    return;
  }
  const ownerId = await getOwnerId();
  const existing = await serviceDb
    .from("daily_cadence_plans")
    .select("id,status")
    .eq("owner_id", ownerId)
    .eq("plan_date", planDate)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    lastDailyPlanKey = planKey;
    return;
  }
  const inserted = await serviceDb
    .from("daily_cadence_plans")
    .insert({ owner_id: ownerId, plan_date: planDate, status: "processing", daily_budget: budget })
    .select("id")
    .single();
  if (inserted.error) {
    if (inserted.error.code === "23505") {
      lastDailyPlanKey = planKey;
      return;
    }
    throw inserted.error;
  }
  try {
    const now = new Date().toISOString();
    const dueFollowUps = await serviceDb
      .from("follow_up_queue")
      .select("id")
      .eq("owner_id", ownerId)
      .in("status", ["pending", "scheduled", "retry"])
      .lte("available_at", now)
      .order("priority", { ascending: true })
      .order("available_at", { ascending: true })
      .limit(10000);
    if (dueFollowUps.error) throw dueFollowUps.error;
    const followUpCount = dueFollowUps.data?.length ?? 0;
    // Follow-ups are due work and must never consume the new-lead quota.
    const newSlots = budget;
    const newLeads = newSlots
      ? await serviceDb
          .from("outreach_queue")
          .select("id")
          .eq("owner_id", ownerId)
          .in("status", ["pending", "scheduled", "retry"])
          .gte("available_at", now)
          .order("priority", { ascending: true })
          .order("available_at", { ascending: true })
          .limit(newSlots)
      : { data: [], error: null };
    if (newLeads.error) throw newLeads.error;
    const completed = await serviceDb
      .from("daily_cadence_plans")
      .update({
        status: "completed",
        follow_up_count: followUpCount,
        new_lead_count: newLeads.data?.length ?? 0,
        completed_at: new Date().toISOString(),
      })
      .eq("owner_id", ownerId)
      .eq("id", inserted.data.id);
    if (completed.error) throw completed.error;
    await repository.audit("cadence.daily_plan.created", "system", null, {
      idempotencyKey: planKey,
      planDate,
      budget,
      followUpCount,
      newLeadCount: newLeads.data?.length ?? 0,
    });
    lastDailyPlanKey = planKey;
  } catch (error) {
    await serviceDb
      .from("daily_cadence_plans")
      .update({
        status: "failed",
        last_error: error instanceof Error ? error.message : "Falha ao montar o plano diário.",
      })
      .eq("owner_id", ownerId)
      .eq("id", inserted.data.id);
    throw error;
  }
}

async function runWorker() {
  const lockAcquired = await acquireInstanceLock();
  if (!lockAcquired) throw new Error("Já existe uma instância ativa do worker principal.");
  let lastDeadlineScan = 0;
  let diagnosticTicks = 0;
  let heartbeatInFlight = false;
  const activeJobs = new Set<Promise<void>>();
  const activeKeys = new ConversationLanes();
  const seenConversationKeys = new Set<string>();
  const heartbeatLoop = async () => {
    if (heartbeatInFlight) return;
    heartbeatInFlight = true;
    try {
      await heartbeat();
      lastHeartbeatAtMs = Date.now();
    } catch (error) {
      workerLeaseLost = true;
      stopping = true;
      log.fatal({ err: error, instanceId, pid: process.pid }, "worker_lock_lost_stopping");
    } finally {
      heartbeatInFlight = false;
    }
  };
  const effectiveOutreach: Record<string, unknown> = await repository
    .getSettings("outreach")
    .catch(() => ({}));
  log.info(
    {
      instanceId,
      workerId: instanceId,
      pid: process.pid,
      version: workerConfig.BUILD_VERSION,
      provider: workerConfig.MOCK_GROQ ? "mock" : "groq",
      model: workerConfig.GROQ_MODEL,
      startedAt: new Date().toISOString(),
      effectiveConfig: {
        OUTREACH_ENABLED: workerConfig.OUTREACH_ENABLED,
        SIMULATION_MODE: workerConfig.SIMULATION_MODE,
        REAL_SENDING_ENABLED: workerConfig.REAL_SENDING_ENABLED,
        campaignStartAt: effectiveOutreach.campaignStartAt ?? null,
        timezone: effectiveOutreach.timezone ?? null,
        startHour: effectiveOutreach.startTime ?? null,
        endHour: effectiveOutreach.endTime ?? null,
        dailyNewLeadCap: effectiveOutreach.dailyLimit ?? null,
        persistedOutreachEnabled: effectiveOutreach.enabled ?? false,
      },
      services: services.map((service) => service.name),
    },
    "worker_started",
  );
  await heartbeatLoop();
  await recoverStaleJobs();
  log.info(
    {
      workerReady: true,
      workerPid: process.pid,
      databasePath: workerConfig.MOCK_DB_PATH ?? null,
      cwd: process.cwd(),
      nodeEnv: workerConfig.NODE_ENV,
      mockMode: workerConfig.MOCK_MODE,
      outreachEnabled: workerConfig.OUTREACH_ENABLED,
      simulationMode: workerConfig.SIMULATION_MODE,
      realSendingEnabled: workerConfig.REAL_SENDING_ENABLED,
    },
    "worker_ready",
  );
  const heartbeatTimer = setInterval(() => {
    void heartbeatLoop();
  }, workerConfig.WORKER_HEARTBEAT_MS);
  try {
    while (!stopping) {
      try {
        if (workerLeaseLost) break;
        if (Date.now() - lastDeadlineScan >= 60_000) {
          await processQualificationDeadlines();
          lastDeadlineScan = Date.now();
        }
        await recoverStaleJobs();
        let general = await repository.getSettings("general");
        general = await reconcileScheduledResume(general);
        await ensureDailyCadencePlan(await repository.getSettings("outreach"));
        const testMode = isOperationalTestMode(
          general.globalPause,
          workerConfig.OUTREACH_ONLINE_ONLY,
          workerConfig.OUTREACH_ONLINE_TEST_PHONE,
        );
        const automationEnabled = general.automationEnabled !== false;
        // Inbound qualification must continue while the global pause is on so
        // that safe inbound state is persisted. claimJobs excludes outbound
        // queues in this mode; commercial automation remains paused.
        if (general.globalPause === true || (automationEnabled && (!general.globalPause || testMode))) {
          const capacity = Math.max(0, 10 - activeJobs.size);
          if (diagnosticTicks < 10) {
            const queueSnapshot = await repository.page("queue", { page: 1, pageSize: 5000 });
            const pending = queueSnapshot.rows.filter((row) =>
              ["pending", "scheduled", "retry"].includes(String(row.status)),
            );
            log.info(
              {
                tick: diagnosticTicks + 1,
                capacity,
                pendingJobs: pending.length,
                pendingAvailableNow: pending.filter(
                  (row) => Date.parse(String(row.availableAt ?? "")) <= Date.now(),
                ).length,
                claimRequested: capacity,
                activeJobs: activeJobs.size,
                activeUniqueConversations: activeKeys.size,
                automationEnabled,
                globalPause: general.globalPause === true,
              },
              "worker_poll_diagnostic",
            );
            diagnosticTicks += 1;
          }
          log.debug(
            {
              activeUniqueConversations: activeKeys.size(),
              activeJobs: activeJobs.size,
              capacity,
              automationEnabled,
              globalPause: general.globalPause === true,
            },
            "worker_capacity",
          );
          if (capacity > 0) {
            const jobs = await repository.claimJobs(capacity, {
              includeOutbound: !general.globalPause || testMode,
              ...(testMode && workerConfig.OUTREACH_ONLINE_TEST_PHONE
                ? { outboundPhoneAllowlist: [workerConfig.OUTREACH_ONLINE_TEST_PHONE] }
                : {}),
            });
            if (diagnosticTicks <= 10)
              log.info(
                {
                  claimReturned: jobs.length,
                  returnedJobIds: jobs.map((job) => job.id),
                  returnedConversationKeys: jobs.map((job) => conversationKey(job)),
                },
                "worker_claim_diagnostic",
              );
            for (const job of jobs) {
              if (workerLeaseLost) break;
              const key = conversationKey(job);
              if (!activeKeys.tryStart(key)) {
                await repository.deferJob(job.id, new Date(Date.now() + 1_000), "conversation_lane_busy");
                log.info({ jobId: job.id, conversationKey: key }, "conversation_lane_busy_requeued");
                continue;
              }
              const laneEvent =
                key && seenConversationKeys.has(key)
                  ? "conversation_lane_reused"
                  : "conversation_lane_started";
              if (key) seenConversationKeys.add(key);
              log.info({ jobId: job.id, conversationKey: key }, laneEvent);
              const task = (async () => {
                const leaseOwner = serviceDb ? instanceId : String(process.pid);
                const leaseTimer = setInterval(
                  () => {
                    void repository
                      .renewJobLease(job.id, leaseOwner)
                      .catch((error) => log.warn({ err: error, jobId: job.id }, "job_lease_renew_failed"));
                  },
                  Math.max(1_000, Math.floor(workerConfig.JOB_LEASE_TIMEOUT_MS / 3)),
                );
                try {
                  await processSafely(job);
                } finally {
                  clearInterval(leaseTimer);
                }
              })();
              activeJobs.add(task);
              const cleanup = () => {
                activeJobs.delete(task);
                activeKeys.finish(key);
                log.info({ jobId: job.id, conversationKey: key }, "conversation_lane_finished");
              };
              void task.then(cleanup, cleanup);
            }
          }
        }
      } catch (error) {
        log.error({ err: error }, "worker_cycle_failed");
      }
      if (workerConfig.WORKER_RUN_ONCE) stopping = true;
      if (stopping) break;
      await sleep(workerConfig.WORKER_POLL_MS);
    }
  } finally {
    clearInterval(heartbeatTimer);
    await Promise.allSettled([...activeJobs]);
    await releaseInstanceLock();
    log.info({ instanceId }, "worker_stopped");
  }
}

async function recoverStaleJobs() {
  try {
    const result = await repository.recoverStaleJobs(workerConfig.JOB_LEASE_TIMEOUT_MS);
    if (result.found || result.recovered)
      log.info(
        {
          stale_jobs_found: result.found,
          stale_jobs_recovered: result.recovered,
          leaseTimeoutMs: workerConfig.JOB_LEASE_TIMEOUT_MS,
        },
        "stale_jobs_reconciled",
      );
  } catch (error) {
    log.warn({ err: error }, "stale_jobs_reconciliation_failed");
  }
}

async function processSafely(job: QueueJob) {
  try {
    if (workerLeaseLost)
      throw new DeferredJobError(
        "Lock do worker perdido; job devolvido para a fila.",
        new Date(Date.now() + 15_000),
      );
    if (await blockJobDuringOperationalTest(job)) return;
    const service = services.find((candidate) => candidate.accepts(job));
    if (!service) throw new NonRetryableJobError(`Tipo de job desconhecido: ${job.type}`);
    if (job.type === "outreach" && !workerConfig.OUTREACH_ENABLED && !isScopedOnlineTestJob(job))
      throw new DeferredJobError("OUTREACH_ENABLED está desligado.", new Date(Date.now() + 5 * 60_000));
    if (
      job.type === "outreach" &&
      serviceDb &&
      (await repository.getSettings("outreach")).enabled !== true &&
      !isScopedOnlineTestJob(job)
    )
      throw new DeferredJobError("Outreach persistido está desligado.", new Date(Date.now() + 5 * 60_000));
    await service.process(job);
    if (workerLeaseLost)
      throw new DeferredJobError(
        "Lock do worker perdido antes da conclusão; job devolvido para a fila.",
        new Date(Date.now() + 15_000),
      );
    await repository.completeJob(job.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha desconhecida";
    if (
      process.env.NODE_ENV !== "production" &&
      process.env.QA_FAIL_ALL === "true" &&
      /provider unavailable/i.test(message)
    ) {
      const general = await repository.getSettings("general");
      if (general.globalPause !== true) {
        await repository.saveSettings("general", {
          ...general,
          globalPause: true,
          globalPauseReason: message,
        });
        await repository.audit("campaign.global_pause.systemic_provider_failure", "system", null, {
          reason: message,
        });
      }
    }
    if (error instanceof AiStructuredOutputError && job.type === "inbound_reply") {
      const failurePlan = structuredOutputFailurePlan(job.attempts);
      if (failurePlan.disposition === "retry") {
        const retryAt = new Date(Date.now() + 30_000);
        await repository.failJob(job.id, message, retryAt);
        await recordInboundLifecycle(job, failurePlan.lifecycle, {
          error: message.slice(0, 500),
          retryAt: retryAt.toISOString(),
        });
        log.warn({ jobId: job.id, provider: error.provider, retryAt }, "ai_structured_output_retry");
      } else {
        await repository.failJob(job.id, message, null);
        await flagInboundForReview(job, message, error.rawOutput);
        await recordInboundLifecycle(job, failurePlan.lifecycle, { error: message.slice(0, 500) });
        log.error({ jobId: job.id, provider: error.provider }, "ai_structured_output_review_required");
      }
      return;
    }
    if (error instanceof GroqRateLimitError) {
      const retryAt = new Date(Date.now() + Math.max(1, error.retryAfterSeconds) * 1000);
      await recordGroqFailure(message, false, error.rateLimits);
      await repository.deferJob(job.id, retryAt, message);
      log.warn({ jobId: job.id, retryAt, rateLimits: error.rateLimits }, "groq_rate_limited");
      return;
    }
    if (error instanceof GeminiRateLimitError) {
      const retryAt = new Date(Date.now() + Math.max(1, error.retryAfterSeconds) * 1000);
      await repository.deferJob(job.id, retryAt, message);
      await recordInboundLifecycle(job, "retrying", {
        provider: "gemini",
        error: message.slice(0, 500),
        retryAt: retryAt.toISOString(),
      });
      log.warn({ jobId: job.id, retryAt }, "gemini_rate_limited");
      return;
    }
    if (error instanceof GeminiProviderError && error.recoverable) {
      const retryAt = new Date(Date.now() + 60_000);
      await repository.deferJob(job.id, retryAt, message);
      await recordInboundLifecycle(job, "retrying", {
        provider: "gemini",
        error: message.slice(0, 500),
        retryAt: retryAt.toISOString(),
      });
      log.warn({ jobId: job.id, retryAt }, "gemini_temporarily_unavailable");
      return;
    }
    if (error instanceof GroqModelUnavailableError) {
      await recordGroqFailure(message, true, { availableModels: error.availableModels });
      await repository.failJob(job.id, message, null);
      log.error(
        { jobId: job.id, model: error.model, availableModels: error.availableModels },
        "groq_model_unavailable",
      );
      return;
    }
    if (error instanceof DeferredJobError) {
      if (error.payloadPatch)
        await repository.deferOutreachWithPayload(job.id, error.retryAt, message, {
          ...job.payload,
          ...error.payloadPatch,
        });
      else await repository.deferJob(job.id, error.retryAt, message);
      log.info(
        { jobId: job.id, retryAt: error.retryAt, payloadPatch: Boolean(error.payloadPatch) },
        "job_deferred",
      );
      return;
    }
    const retryAt =
      error instanceof NonRetryableJobError || job.attempts >= (job.maxAttempts ?? 5)
        ? null
        : new Date(Date.now() + retryDelayMs(job.attempts));
    await repository.failJob(job.id, message, retryAt);
    if (["evolution_event", "inbound_reply", "ai_send"].includes(job.type))
      await recordInboundLifecycle(job, retryAt ? "retrying" : "failed_final", {
        error: message.slice(0, 500),
        retryAt: retryAt?.toISOString() ?? null,
      });
    if (["evolution_event", "inbound_reply", "ai_send"].includes(job.type))
      await reportInboundFailure(job, message, retryAt);
    if (job.type === "outreach" && serviceDb && job.payload.leadId)
      await recordOutreachFailure(String(job.payload.leadId));
    log.error({ jobId: job.id, type: job.type, attempts: job.attempts, retryAt, err: error }, "job_failed");
  }
}

async function flagInboundForReview(job: QueueJob, reason: string, rawOutput: string | null) {
  const phone = typeof job.payload.phone === "string" ? job.payload.phone : "";
  const title = "Resposta de IA requer revisão";
  const body =
    "A mensagem recebida foi preservada, mas Groq e Gemini não produziram uma AiDecision válida após duas tentativas. A automação desta conversa foi pausada para revisão humana.";
  if (!serviceDb) {
    const found = await repository.leads({ page: 1, pageSize: 10, search: phone });
    const lead = found.rows.find((row) => row.phone === phone);
    if (lead?.id) await repository.updateResource("leads", String(lead.id), { automationPaused: true });
    await repository.createResource("notifications", {
      type: "groq_error",
      level: "critical",
      title,
      body,
      leadId: lead?.id ?? null,
      dedupKey: `ai-review:${job.id}`,
    });
    await repository.audit("agent.structured_output.review_required", "job", job.id, {
      providerFailure: reason.slice(0, 1_000),
      rawOutput: rawOutput?.slice(0, 4_000) ?? null,
      phoneSuffix: phone.slice(-4),
    });
    return;
  }
  const ownerId = await getOwnerId();
  const lead = await serviceDb
    .from("leads")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("phone", phone)
    .maybeSingle();
  if (lead.error) throw lead.error;
  const leadId = lead.data?.id ?? null;
  if (leadId) {
    const paused = await serviceDb
      .from("leads")
      .update({ automation_paused: true })
      .eq("owner_id", ownerId)
      .eq("id", leadId);
    if (paused.error) throw paused.error;
    const conversation = await serviceDb
      .from("conversations")
      .update({ status: "paused", takeover_state: "ai_paused" })
      .eq("owner_id", ownerId)
      .eq("lead_id", leadId);
    if (conversation.error) throw conversation.error;
  }
  const notification = await serviceDb.from("notifications").insert({
    owner_id: ownerId,
    type: "groq_error",
    level: "critical",
    title,
    body,
    lead_id: leadId,
    dedup_key: `ai-review:${job.id}`,
  });
  if (notification.error && notification.error.code !== "23505") throw notification.error;
  await repository.audit("agent.structured_output.review_required", "job", job.id, {
    providerFailure: reason.slice(0, 1_000),
    rawOutput: rawOutput?.slice(0, 4_000) ?? null,
    phoneSuffix: phone.slice(-4),
  });
}

async function reportInboundFailure(job: QueueJob, reason: string, retryAt: Date | null) {
  const event = (job.payload.event ?? {}) as NormalizedWhatsAppEvent;
  const phone = typeof job.payload.phone === "string" ? job.payload.phone : (event.phone ?? "");
  const leadId = typeof job.payload.leadId === "string" ? job.payload.leadId : null;
  const title = retryAt ? "Resposta ao lead em nova tentativa" : "Resposta ao lead requer atenção";
  const body = retryAt
    ? `Uma mensagem recebida não foi respondida nesta tentativa. O retry está agendado para ${retryAt.toISOString()}.`
    : "Uma mensagem recebida esgotou as tentativas automáticas e precisa de resposta humana.";
  if (!serviceDb) {
    await repository.createResource("notifications", {
      type: "queue_failed",
      level: retryAt ? "warning" : "critical",
      title,
      body,
      leadId,
      dedupKey: `inbound-failure:${job.id}`,
    });
  } else {
    const ownerId = await getOwnerId();
    const resolvedLead = leadId
      ? { data: { id: leadId }, error: null }
      : await serviceDb.from("leads").select("id").eq("owner_id", ownerId).eq("phone", phone).maybeSingle();
    if (resolvedLead.error) throw resolvedLead.error;
    const notification = await serviceDb.from("notifications").insert({
      owner_id: ownerId,
      type: "queue_failed",
      level: retryAt ? "warning" : "critical",
      title,
      body,
      lead_id: resolvedLead.data?.id ?? null,
      dedup_key: `inbound-failure:${job.id}`,
    });
    if (notification.error && notification.error.code !== "23505") throw notification.error;
  }
  await repository.audit("agent.inbound_reply.failure_visible", "job", job.id, {
    phoneSuffix: phone.slice(-4),
    retryAt: retryAt?.toISOString() ?? null,
    error: reason.slice(0, 500),
  });
}

async function processInboundEvent(job: QueueJob) {
  if (job.type === "opt_out") return processOptOut(job);
  const event = (job.payload.event ?? {}) as NormalizedWhatsAppEvent;
  if (!event.eventType || !event.relevant) return;
  if (serviceDb)
    await serviceDb.from("integration_events").insert({
      owner_id: await getOwnerId(),
      provider: "evolution",
      external_event_id: event.eventId,
      event_type: event.eventType,
      status: "processed",
      payload: event.raw,
      processed_at: new Date().toISOString(),
    });
  else
    await repository.audit("evolution.event.processed", "integration", event.eventId, {
      eventType: event.eventType,
    });
  if (
    event.eventType === "message.delivered" ||
    event.eventType === "message.read" ||
    event.eventType === "message.failed" ||
    event.eventType === "message.updated"
  ) {
    if (!serviceDb || !event.externalMessageId || !event.status) return;
    const message = await serviceDb
      .from("messages")
      .select("id")
      .eq("external_id", event.externalMessageId)
      .maybeSingle();
    if (!message.data?.id) return;
    await serviceDb.from("delivery_receipts").upsert(
      {
        message_id: message.data.id,
        external_id: event.externalMessageId,
        status: event.status,
        payload: event.raw,
      },
      { onConflict: "external_id,status" },
    );
    await serviceDb
      .from("messages")
      .update({
        status: event.status,
        delivered_at: event.status === "delivered" ? event.occurredAt : undefined,
        read_at: event.status === "read" ? event.occurredAt : undefined,
        error_message: event.status === "failed" ? "Falha informada pelo provedor" : undefined,
      })
      .eq("id", message.data.id);
    return;
  }
  if (event.eventType === "connection.updated") {
    const integrationStatus =
      event.connectionState === "open"
        ? "connected"
        : event.connectionState === "connecting"
          ? "connecting"
          : event.connectionState === "unavailable"
            ? "failed"
            : "disconnected";
    if (serviceDb)
      await serviceDb.from("integration_connections").upsert(
        {
          owner_id: await getOwnerId(),
          provider: "evolution",
          instance_name: event.instanceName,
          status: integrationStatus,
          connected_at: integrationStatus === "connected" ? event.occurredAt : null,
          last_seen_at: event.occurredAt,
          last_error: integrationStatus === "failed" ? "Evolution indisponível" : null,
        },
        { onConflict: "owner_id,provider,instance_name" },
      );
    if (!simulation && integrationStatus === "disconnected")
      await repository.enqueue(
        "maintenance",
        { action: "reconnect_evolution", eventId: event.eventId },
        new Date(Date.now() + 15_000),
        `reconnect:${event.eventId}`,
      );
    return;
  }
  if (event.eventType === "presence.updated") {
    if (!workerConfig.OUTREACH_ONLINE_ONLY || !event.phone) return;
    const freshness = Date.now() - Date.parse(event.occurredAt);
    const state = presenceState(event.raw);
    if (freshness < 0 || freshness > workerConfig.OUTREACH_ONLINE_FRESHNESS_SECONDS * 1000) {
      await repository.audit("outreach.presence_stale", "lead", null, {
        phoneSuffix: event.phone.slice(-4),
        freshnessSeconds: Math.floor(freshness / 1000),
        state,
      });
      return;
    }
    if (state === "online") {
      const released = await repository.updateOutreachPresence(event.phone, "online", event.occurredAt);
      await repository.audit("outreach.online_detected", "lead", null, {
        phoneSuffix: event.phone.slice(-4),
        released,
        freshnessSeconds: Math.floor(freshness / 1000),
      });
    } else if (state === "offline") {
      const changed = await repository.updateOutreachPresence(event.phone, "offline", event.occurredAt);
      await repository.audit("outreach.offline_detected", "lead", null, {
        phoneSuffix: event.phone.slice(-4),
        changed,
      });
    }
    return;
  }
  if (event.eventType !== "message.received" || !event.phone) return;
  const validated = normalizeBrazilianPhone(event.phone);
  if (!validated.valid || !validated.normalized)
    throw new NonRetryableJobError(validated.reason ?? "Telefone recebido é inválido.");
  const phone = validated.normalized;
  let text = event.text?.trim() ?? "";
  let transcription: string | null = null;
  let mediaPath: string | null = null;
  if (event.messageType === "audio" && workerConfig.TRANSCRIBE_AUDIO_ENABLED) {
    const audioId = event.externalMessageId ?? job.id;
    await repository.audit("audio_received", "message", audioId, {
      messageId: audioId,
      phoneSuffix: phone.slice(-4),
    });
    await repository.audit("audio_download_started", "message", audioId, { messageId: audioId });
    let media: Awaited<ReturnType<WhatsAppProvider["downloadMedia"]>>;
    try {
      media = await whatsapp.downloadMedia(
        (event.raw as Record<string, unknown>).data as Record<string, unknown>,
      );
    } catch (error) {
      await repository.audit("audio_transcription_failed", "message", audioId, {
        messageId: audioId,
        phase: "download",
        error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
      });
      throw error;
    }
    await repository.audit("audio_download_ok", "message", audioId, {
      messageId: audioId,
      bytes: media.bytes.byteLength,
      mimeType: media.mimeType,
    });
    const runtime = await configuredGroq();
    if (runtime.processingPaused)
      throw new DeferredJobError(
        "Processamento Groq pausado até a seleção de um modelo ativo.",
        new Date(Date.now() + 10 * 60_000),
      );
    await repository.audit("audio_transcription_started", "message", audioId, {
      messageId: audioId,
      model: runtime.transcriptionModel,
      mimeType: media.mimeType.split(";", 1)[0]!.trim(),
      fileName: media.fileName ?? `${audioId}.opus`,
    });
    let transcriptionResult;
    try {
      const normalizedMime = media.mimeType.split(";", 1)[0]!.trim();
      const transcriptionFileName = normalizedMime === "audio/ogg" ? `${audioId}.ogg` : `${audioId}.audio`;
      transcriptionResult = await runtime.provider.transcribeAudio({
        bytes: media.bytes,
        fileName: transcriptionFileName,
        mimeType: normalizedMime,
        model: runtime.transcriptionModel,
      });
    } catch (error) {
      await repository.audit("audio_transcription_failed", "message", audioId, {
        messageId: audioId,
        error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
      });
      throw error;
    }
    transcription = transcriptionResult.text?.trim() || null;
    await repository.audit("audio_transcription_ok", "message", audioId, {
      messageId: audioId,
      ...(transcriptionResult.metrics ?? {}),
      provider: "groq",
      model: runtime.transcriptionModel,
    });
    await repository.audit("groq.transcription", "message", event.externalMessageId ?? job.id, {
      ...(transcriptionResult.metrics ?? {}),
      provider: "groq",
      model: runtime.transcriptionModel,
      success: true,
    });
    if (transcription) text = transcription;
    if (serviceDb) {
      const path = `${await getOwnerId()}/${event.externalMessageId ?? job.id}/${media.fileName ?? "audio.ogg"}`;
      const stored = await serviceDb.storage
        .from("message-media")
        .upload(path, media.bytes, { contentType: media.mimeType, upsert: false });
      if (stored.error)
        log.warn({ err: stored.error, eventId: event.eventId }, "inbound_audio_storage_failed");
      else mediaPath = path;
    }
  }
  const state = await repository.persistInboundEvent({ ...event, phone, text, transcription, mediaPath });
  const { leadId, humanActive, automationPaused } = state;
  const inboundAt = event.occurredAt || new Date().toISOString();
  if (serviceDb) {
    const conversation = await serviceDb
      .from("conversations")
      .select("first_inbound_at,qualification_deadline_at")
      .eq("id", state.conversationId)
      .maybeSingle();
    if (!conversation.error && !conversation.data?.first_inbound_at)
      await serviceDb
        .from("conversations")
        .update({
          first_inbound_at: inboundAt,
          qualification_deadline_at: new Date(
            Date.parse(inboundAt) + workerConfig.QUALIFICATION_DEADLINE_HOURS * 3_600_000,
          ).toISOString(),
        })
        .eq("id", state.conversationId);
  } else {
    const conversations = await repository.page("conversations", { page: 1, pageSize: 100 });
    const conversation = conversations.rows.find((row) => String(row.id) === state.conversationId);
    if (conversation && !conversation.firstInboundAt)
      await repository.updateResource("conversations", state.conversationId, {
        firstInboundAt: inboundAt,
        qualificationDeadlineAt: new Date(
          Date.parse(inboundAt) + workerConfig.QUALIFICATION_DEADLINE_HOURS * 3_600_000,
        ).toISOString(),
      });
  }
  await repository.audit("message.inbound.saved", "lead", leadId, {
    externalId: event.externalMessageId,
    messageType: event.messageType,
    length: text.length,
    inserted: state.inserted,
  });
  if (!state.inserted) {
    await repository.audit("message.inbound.duplicate_ignored", "lead", leadId, {
      externalId: event.externalMessageId,
      eventId: event.eventId,
    });
    return;
  }
  await markCadenceResponded(leadId, inboundAt);
  await repository.audit("inbound.lifecycle", "message", event.externalMessageId ?? job.id, {
    messageId: event.externalMessageId ?? job.id,
    state: "received",
    messageType: event.messageType,
  });
  if (
    (await operationalTestModeActive()) &&
    !operationalTestDestination(phone, workerConfig.OUTREACH_ONLINE_TEST_PHONE).allowed
  ) {
    if (text)
      await repository.enqueueInboundDebounced(
        { phone, text, messageId: event.externalMessageId ?? event.eventId },
        new Date(Date.now() + 6_000),
      );
    await repository.audit("TEST_MODE_INBOUND_PRESERVED", "lead", leadId, {
      phone,
      job: job.id,
      messageId: event.externalMessageId ?? event.eventId,
      reason: "Inbound real preservado; resposta automática aguarda retomada manual.",
      timestamp: new Date().toISOString(),
    });
    return;
  }
  if (text && isOptOutText(text)) {
    await repository.enqueue("opt_out", { phone, leadId }, new Date(), `optout:${event.eventId}`);
    return;
  }
  if (humanActive || automationPaused) return;
  if (!text) return;
  if (event.messageType === "audio")
    await repository.audit("audio_inbound_enqueued", "message", event.externalMessageId ?? job.id, {
      messageId: event.externalMessageId ?? job.id,
      transcriptionLength: text.length,
    });
  await repository.enqueueInboundDebounced(
    { phone, text, messageId: event.externalMessageId ?? event.eventId },
    new Date(Date.now() + 6_000),
  );
}

async function setInboundPresence(phone: string, presence: "composing" | "paused", jobId: string) {
  const at = new Date().toISOString();
  try {
    if (!simulation) await whatsapp.sendPresence(phone, presence, 0);
    await repository.audit(
      presence === "composing" ? "inbound.typing.started" : "inbound.typing.stopped",
      "job",
      jobId,
      { phoneSuffix: phone.slice(-4), at, workerInstanceId: instanceId },
    );
  } catch (error) {
    log.warn({ err: error, jobId, phoneSuffix: phone.slice(-4), presence }, "inbound_typing_update_failed");
    await repository
      .audit("inbound.typing.failed", "job", jobId, {
        phoneSuffix: phone.slice(-4),
        requestedPresence: presence,
        at,
        error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
      })
      .catch(() => undefined);
  }
}

async function processInbound(job: QueueJob) {
  const phone = typeof job.payload.phone === "string" ? job.payload.phone : null;
  const typingStartedAt = new Date().toISOString();
  if (phone) {
    job.payload.typingStartedAt = typingStartedAt;
    await setInboundPresence(phone, "composing", job.id);
  }
  try {
    await processInboundTurn(job);
  } finally {
    if (phone) await setInboundPresence(phone, "paused", job.id);
  }
}

async function processInboundTurn(job: QueueJob) {
  const phone = requiredString(job.payload.phone, "phone");
  const text = requiredString(job.payload.text, "text");
  const pipelineStartedAt = new Date().toISOString();
  await recordInboundLifecycle(job, "processing");
  const context = await loadContext(
    phone,
    text,
    typeof job.payload.messageId === "string" ? job.payload.messageId : undefined,
  );
  if (context.leadId && typeof job.payload.messageId === "string") {
    const latestMessageId = await latestInboundMessageId(context.leadId);
    if (latestMessageId && latestMessageId !== job.payload.messageId) {
      await repository.audit("agent.reply.superseded_before_generation", "lead", context.leadId, {
        sourceMessageId: job.payload.messageId,
        latestInboundId: latestMessageId,
        providerRequestsAvoided: 1,
      });
      await ensureLatestInboundProcessing(phone, context.leadId, context.snapshot);
      return;
    }
  }
  const turnText = currentLeadTurn(context.snapshot, text);
  const conversationPlan = planConversation(context.snapshot, turnText);
  const plannedMemories = mergeMemoryUpdates(
    context.snapshot.memories,
    conversationPlan.deterministicMemoryUpdates,
  );
  const plannedSnapshot = { ...context.snapshot, memories: plannedMemories };
  let execution = await executeAgentWithDailyLimitFallback(plannedSnapshot, turnText, job.id);
  const providerFinishedAt = new Date().toISOString();
  const contextualInterpretation = interpretBrazilianContext(turnText);
  const needsIdentityRepair = needsOutboundIdentityRepair(
    execution.decision.replyText,
    plannedSnapshot,
    turnText,
  );
  const needsRecentQuestion = needsRecentQuestionRepair(
    execution.decision.replyText,
    plannedSnapshot,
    turnText,
  );
  const needsAcknowledgementRepair =
    contextualInterpretation.speechAct === "acknowledgement" && !execution.decision.replyText?.trim();
  if (needsIdentityRepair || needsAcknowledgementRepair) {
    const repairReason = needsAcknowledgementRepair
      ? "acknowledgement_without_reply"
      : "missing_outbound_introduction";
    await repository.audit("agent.reply.continuity_repair", "lead", context.leadId, {
      messageId: String(job.payload.messageId ?? job.id),
      reason: repairReason,
      rejectedReply: execution.decision.replyText?.slice(0, 1_600) ?? null,
    });
    const repairedReply = needsAcknowledgementRepair
      ? "Vamos continuar de onde paramos."
      : `Prazer! Sou o Francisco, da Renova123.${execution.decision.replyText?.trim() ? ` ${execution.decision.replyText.trim()}` : " Converso com óticas para entender a rotina da loja e ver se nosso sistema pode ajudar."}`;
    execution = {
      ...execution,
      decision: { ...execution.decision, replyText: repairedReply },
      ...(execution.metrics ? { metrics: { ...execution.metrics, regenerationCount: 0 } } : {}),
    };
    if (!needsAcknowledgementRepair)
      execution = {
        ...execution,
        decision: {
          ...execution.decision,
          replyText:
            "Sou o Francisco, da Renova123. Entrei em contato porque ajudamos óticas a organizar e acompanhar melhor os atendimentos e orçamentos pelo WhatsApp.",
        },
      };
  }
  if (needsRecentQuestion) {
    await repository.audit("agent.reply.repeated_question_repair", "lead", context.leadId, {
      messageId: String(job.payload.messageId ?? job.id),
      rejectedReply: execution.decision.replyText?.slice(0, 1_600) ?? null,
      reason: "greeting_without_answer_to_previous_question",
    });
    execution = await executeAgentWithDailyLimitFallback(
      plannedSnapshot,
      turnText,
      job.id,
      "Você acabou de fazer essa pergunta. O lead apenas cumprimentou você. Não repita a pergunta agora. Apresente-se e explique brevemente o motivo do contato, preservando a informação que ainda falta descobrir.",
    );
  }
  const extractedMemory = commercialMemoryUpdates(turnText, plannedSnapshot);
  const safeModelUpdates =
    conversationPlan.interpretation === "AMBIGUOUS" ? [] : execution.decision.memoryUpdates;
  const allUpdates = mergeDecisionMemoryUpdates([
    ...safeModelUpdates,
    ...conversationPlan.deterministicMemoryUpdates,
    ...extractedMemory,
  ]);
  const enrichedDecision = { ...execution.decision, memoryUpdates: allUpdates };
  const continuitySafeReply = enrichedDecision.replyText?.trim() || null;
  const deterministicNoInterest = isExplicitNoInterestText(turnText);
  /* legacy ambiguous fallback disabled
    ? "Acho que sua mensagem cortou aqui 😅 Pode completar?"
    : continuitySafeReply; */
  const candidateReply = continuitySafeReply;
  const replyText = ensureActiveInboundReply(candidateReply, {
    shouldHandoff: enrichedDecision.shouldHandoff,
    shouldOptOut: enrichedDecision.shouldOptOut,
    noInterest: deterministicNoInterest,
  });
  const decision = deterministicNoInterest
    ? {
        ...enrichedDecision,
        replyText,
        detectedIntent: "no_interest" as const,
        leadStage: "lost" as const,
        qualificationStatus: "disqualified" as const,
        qualificationScore: 0,
        shouldHandoff: false,
        shouldOptOut: false,
        handoffType: null,
        followUpAction: {
          action: "cancel" as const,
          delayHours: null,
          reason: "Desinteresse comercial explícito.",
        },
      }
    : { ...enrichedDecision, replyText };
  const sales = decision.shouldHandoff ? await salesCloserSettings() : null;
  const decisionWithSalesContact = sales
    ? { ...decision, replyText: ensureSalesContactReply(decision.replyText, sales.name, sales.phone) }
    : decision;
  const adjustedExecution = { ...execution, decision: decisionWithSalesContact };
  const finalBubbles = naturalMessageParts(replyText ?? "");
  await repository.audit("agent.reply.pipeline", "lead", context.leadId, {
    messageId: String(job.payload.messageId ?? job.id),
    inputText: turnText.slice(0, 1_600),
    selectedHistory: execution.context.selected.recentMessages ?? [],
    contextualInterpretation,
    conversationState: deriveConversationState(plannedSnapshot, turnText),
    conversationPlan: {
      interpretation: conversationPlan.interpretation,
      currentTopic: conversationPlan.currentTopic,
      interestLevel: conversationPlan.interestLevel,
      answeredTopics: conversationPlan.answeredTopics,
      forbiddenActions: conversationPlan.forbiddenActions,
    },
    rawModelReply: execution.rawDecision.replyText?.slice(0, 1_600) ?? null,
    rawShouldOptOut: execution.rawDecision.shouldOptOut,
    validatedReply: execution.decision.replyText?.slice(0, 1_600) ?? null,
    validatedShouldOptOut: execution.decision.shouldOptOut,
    guardedReply: continuitySafeReply?.slice(0, 1_600) ?? null,
    finalReply: replyText?.slice(0, 1_600) ?? null,
    finalBubbles,
    bubbleCount: finalBubbles.length,
    finalShouldOptOut: decision.shouldOptOut,
    changedByValidation: execution.rawDecision.replyText !== execution.decision.replyText,
    changedByGuards: execution.decision.replyText !== continuitySafeReply,
    changedByBubbleTransport: finalBubbles.length > 1,
  });
  await persistAgentExecution(context, adjustedExecution, "completed", job.id);
  // Persist the inbound classification before creating any outbound work.
  // With globalPause enabled, ai_send is intentionally not claimed; the
  // qualification/cadence state must not depend on an outbound reply.
  await persistInboundDecision(
    phone,
    turnText,
    String(job.payload.messageId ?? job.id),
    decisionWithSalesContact,
    context,
    execution.selectedMaterial?.id ?? null,
  );
  if (job.payload.messageId && serviceDb) {
    const source = await serviceDb
      .from("messages")
      .select("message_type")
      .eq("external_id", String(job.payload.messageId))
      .maybeSingle();
    if (source.data?.message_type === "audio")
      await repository.audit("audio_ai_decision", "lead", context.leadId, {
        messageId: String(job.payload.messageId),
        detectedIntent: decision.detectedIntent,
        shouldHandoff: decision.shouldHandoff,
      });
  }
  if (decision.shouldOptOut) {
    await repository.enqueue("opt_out", { phone, leadId: context.leadId }, new Date(), `optout:ai:${job.id}`);
    return;
  }
  const sourceMessageId = job.payload.messageId ? String(job.payload.messageId) : job.id;
  const aiSendCreatedAt = new Date().toISOString();
  await repository.enqueue(
    "ai_send",
    {
      phone,
      leadId: context.leadId,
      inputText: turnText,
      sourceMessageId,
      decision: decisionWithSalesContact,
      materialId: execution.selectedMaterial?.id ?? null,
      latency: {
        pipelineStartedAt,
        providerFinishedAt,
        aiSendCreatedAt,
        typingStartedAt: job.payload.typingStartedAt ?? null,
        workerInstanceId: instanceId,
        provider: execution.metrics?.provider ?? null,
        model: execution.metrics?.model ?? null,
        providerMs: execution.metrics?.latencyMs ?? null,
        fallbackCount: execution.metrics?.fallbackCount ?? 0,
        fallbackReason: execution.metrics?.fallbackReason ?? null,
      },
    },
    new Date(),
    `ai-send:${job.id}`,
  );
}

async function processDelayedReply(job: QueueJob) {
  const phone = requiredString(job.payload.phone, "phone");
  const leadId = requiredString(job.payload.leadId, "leadId");
  const sourceMessageId = requiredString(job.payload.sourceMessageId, "sourceMessageId");
  const inputText = requiredString(job.payload.inputText, "inputText");
  const decision = aiDecisionSchema.parse(job.payload.decision);
  const context = await loadContext(phone, inputText);
  const latestInboundId = await latestInboundMessageId(leadId);
  if (latestInboundId && latestInboundId !== sourceMessageId) {
    await repository.audit("agent.reply.superseded", "lead", leadId, { sourceMessageId, latestInboundId });
    await ensureLatestInboundProcessing(phone, leadId, context.snapshot);
    return;
  }
  const materialId = typeof job.payload.materialId === "string" ? job.payload.materialId : null;
  const sendStartedAt = new Date().toISOString();
  if (decision.shouldHandoff && decision.replyText) {
    await sendTextSequence(
      leadId,
      phone,
      decision.replyText,
      `ai:${job.id}`,
      context.ownerId,
      async () => (await latestInboundMessageId(leadId)) === sourceMessageId,
    );
    if ((await latestInboundMessageId(leadId)) !== sourceMessageId) {
      await repository.audit("agent.reply.superseded_after_send", "lead", leadId, { sourceMessageId });
      await ensureLatestInboundProcessing(phone, leadId, context.snapshot);
      return;
    }
    await recordInboundLatency(
      job,
      leadId,
      sourceMessageId,
      context,
      sendStartedAt,
      new Date().toISOString(),
    );
    if (decision.handoffType === "sales_qualified") {
      await notifySalesQualified(context, decision);
    }
    await recordInboundLifecycle(job, "responded", { sourceMessageId });
    return;
  }
  if (decision.qualificationStatus === "disqualified" && decision.detectedIntent === "no_interest")
    await notifyDisqualified(context, inputText);
  if (!decision.replyText) return;
  await sendTextSequence(
    leadId,
    phone,
    decision.replyText,
    `ai:${job.id}`,
    context.ownerId,
    async () => (await latestInboundMessageId(leadId)) === sourceMessageId,
    inputText,
  );
  if ((await latestInboundMessageId(leadId)) !== sourceMessageId) {
    await repository.audit("agent.reply.superseded_after_send", "lead", leadId, { sourceMessageId });
    await ensureLatestInboundProcessing(phone, leadId, context.snapshot);
    return;
  }
  await recordInboundLatency(job, leadId, sourceMessageId, context, sendStartedAt, new Date().toISOString());
  await recordInboundLifecycle(job, "responded", { sourceMessageId });
  if (serviceDb) {
    const source = await serviceDb
      .from("messages")
      .select("message_type")
      .eq("external_id", sourceMessageId)
      .maybeSingle();
    if (source.data?.message_type === "audio")
      await repository.audit("audio_reply_sent", "lead", leadId, { messageId: sourceMessageId });
  }
  if (materialId)
    await repository.enqueue(
      "send_material",
      { phone, leadId, materialId },
      new Date(Date.now() + 2_500),
      `material:${job.id}:${materialId}`,
    );
}

async function processOptOut(job: QueueJob) {
  const phone = requiredString(job.payload.phone, "phone");
  if (serviceDb) {
    const owner = await getOwnerId();
    const leadId = requiredString(job.payload.leadId, "leadId");
    const existing = await serviceDb
      .from("suppression_list")
      .select("id")
      .eq("phone", phone)
      .eq("active", true)
      .maybeSingle();
    if (existing.error) throw existing.error;
    const confirmation = await serviceDb
      .from("messages")
      .select("id")
      .eq("owner_id", owner)
      .eq("idempotency_key", `optout-confirm:${leadId}`)
      .maybeSingle();
    if (confirmation.error) throw confirmation.error;
    if (!existing.data && !confirmation.data) {
      try {
        await sendTextOnce(
          leadId,
          phone,
          "Entendido. Não enviaremos novas mensagens para este número.",
          `optout-confirm:${leadId}`,
          owner,
        );
      } catch (error) {
        log.warn({ err: error, leadId }, "optout_confirmation_not_sent");
      }
    }
    const applied = await serviceDb.rpc("apply_lead_opt_out", {
      p_owner: owner,
      p_lead: leadId,
      p_phone: phone,
      p_reason: "Solicitação explícita pelo WhatsApp",
      p_source: "francisco",
    });
    if (applied.error) throw applied.error;
  } else {
    const found = await repository.leads({ page: 1, pageSize: 10, search: phone });
    const lead = found.rows.find((row) => row.phone === phone);
    if (lead?.stage !== "opted_out" && lead?.id) {
      try {
        await sendTextOnce(
          String(lead.id),
          phone,
          "Entendido. Não enviaremos novas mensagens para este número.",
          `optout-confirm:${String(lead.id)}`,
        );
      } catch (error) {
        log.warn({ err: error, leadId: String(lead.id) }, "optout_confirmation_not_sent");
      }
    }
    if (lead?.id)
      await repository.updateResource("leads", String(lead.id), {
        stage: "opted_out",
        automationPaused: true,
        humanActive: false,
        lastContactAt: new Date().toISOString(),
      });
    await repository.createResource("optouts", {
      phone,
      reason: "whatsapp_opt_out",
      source: "francisco",
      active: true,
    });
  }
  if (serviceDb)
    await finalizeCadence(
      requiredString(job.payload.leadId, "leadId"),
      "opted_out",
      "Solicitação explícita pelo WhatsApp",
    );
  await repository.audit("lead.opted_out", "lead", null, { phoneSuffix: phone.slice(-4) });
}

async function processOutbound(job: QueueJob) {
  const settings = outreachSettingsSchema.parse(await repository.getSettings("outreach"));
  const presenceState = String(job.payload.presenceState ?? "unknown");
  const fallbackReady = presenceState === "unavailable_to_detect";
  if (workerConfig.OUTREACH_ONLINE_ONLY && job.payload.onlineReady !== true && !fallbackReady) {
    if (presenceState === "offline")
      throw new DeferredJobError(
        "Lead offline confirmado; aguardando próxima oportunidade.",
        new Date(Date.now() + workerConfig.OUTREACH_PRESENCE_PROBE_INTERVAL_SECONDS * 1000),
      );
    const attempts = Number(job.payload.presenceProbeAttempts ?? 0);
    if (attempts >= workerConfig.OUTREACH_PRESENCE_PROBE_ATTEMPTS) {
      const fallbackAt = nextCommercialSlot(new Date(), settings);
      await repository.audit("outreach.presence_unavailable", "lead", null, {
        phoneSuffix: String(job.payload.phone).slice(-4),
        attempts,
        fallbackAt: fallbackAt.toISOString(),
      });
      throw new DeferredJobError(
        "Presença indisponível; abordagem agendada pelo scheduler normal.",
        fallbackAt,
        {
          presenceState: "unavailable_to_detect",
          presenceProbeAttempts: attempts,
          fallbackScheduledAt: fallbackAt.toISOString(),
          onlineReady: false,
        },
      );
    }
    await whatsapp.presenceSubscribe(requiredString(job.payload.phone, "phone"));
    const nextAttempt = attempts + 1;
    await repository.audit("outreach.presence_subscribe_attempt", "lead", null, {
      phoneSuffix: String(job.payload.phone).slice(-4),
      attempt: nextAttempt,
      maxAttempts: workerConfig.OUTREACH_PRESENCE_PROBE_ATTEMPTS,
      jid: `${job.payload.phone}@s.whatsapp.net`,
    });
    throw new DeferredJobError(
      "Aguardando presença online recente do lead.",
      new Date(Date.now() + workerConfig.OUTREACH_PRESENCE_PROBE_INTERVAL_SECONDS * 1000),
      {
        presenceProbeAttempts: nextAttempt,
        presenceState: "unknown",
        onlineReady: false,
        lastPresenceProbeAt: new Date().toISOString(),
      },
    );
  }
  const allowTestWindow = isScopedOnlineTestJob(job) && job.payload.onlineReady === true;
  if (
    !allowTestWindow &&
    settings.campaignStartAt &&
    Date.now() < Date.parse(String(settings.campaignStartAt))
  )
    throw new DeferredJobError(
      "Campanha ainda não iniciou.",
      new Date(Date.parse(String(settings.campaignStartAt))),
    );
  if (!allowTestWindow && !canStartOutreach(new Date(), settings))
    throw new DeferredJobError("Fora do horário configurado.", new Date(Date.now() + 30 * 60_000));
  const phone = requiredString(job.payload.phone, "phone");
  const text = requiredString(job.payload.text, "text");
  const leadId = requiredString(job.payload.leadId, "leadId");
  if (serviceDb) {
    const leadState = await serviceDb
      .from("leads")
      .select("metadata")
      .eq("owner_id", await getOwnerId())
      .eq("id", leadId)
      .maybeSingle();
    if (leadState.error) throw leadState.error;
    if ((leadState.data?.metadata as Record<string, unknown> | null)?.outreachQuarantined === true) {
      throw new NonRetryableJobError("Lead em quarentena após falhas repetidas de outbound.");
    }
  }
  if (serviceDb && job.queue === "outreach_queue") {
    const queued = await serviceDb
      .from("outreach_queue")
      .select("template_id")
      .eq("id", job.id)
      .maybeSingle();
    if (queued.error) throw queued.error;
    if (queued.data?.template_id) {
      const template = await serviceDb
        .from("message_templates")
        .select("content")
        .eq("id", queued.data.template_id)
        .single();
      if (template.error) throw template.error;
      const leadSource = await serviceDb
        .from("leads")
        .select("source")
        .eq("owner_id", await getOwnerId())
        .eq("id", leadId)
        .single();
      if (leadSource.error) throw leadSource.error;
      const expected = materializeOutreachTemplate(
        String(template.data.content ?? ""),
        String(leadSource.data.source ?? ""),
      );
      const integrity = compareOutboundText(expected, text);
      await repository.audit("outreach.encoding.validated", "job", job.id, {
        leadId,
        templateId: queued.data.template_id,
        expectedLength: integrity.expectedLength,
        actualLength: integrity.actualLength,
        equal: integrity.equal,
      });
      if (!integrity.equal) {
        await repository.audit("outreach.encoding.blocked", "job", job.id, {
          leadId,
          templateId: queued.data.template_id,
          reason: "queue_text_differs_from_template_unicode",
        });
        throw new NonRetryableJobError(
          "Outbound bloqueado: texto da fila diverge do template Unicode original.",
        );
      }
    }
  }
  const latestOutreach = serviceDb ? await repository.getSettings("outreach") : settings;
  if (!allowTestWindow && (!workerConfig.OUTREACH_ENABLED || (serviceDb && latestOutreach.enabled !== true)))
    throw new DeferredJobError(
      "Outreach bloqueado imediatamente antes da reserva.",
      new Date(Date.now() + 5 * 60_000),
    );
  if (!job.payload.capacityReservedAt) {
    const capacity = await repository.outreachCapacity(
      leadId,
      Number(settings.newLeadsDailyLimit ?? settings.dailyProactiveLimit),
      settings.hourlyLimit,
      allowTestWindow,
    );
    if (!capacity.allowed)
      throw new DeferredJobError(
        capacity.reason ?? "Limite operacional atingido.",
        new Date(capacity.retryAt),
      );
    try {
      await repository.markOutreachCapacityReserved(job.id, new Date().toISOString());
    } catch (error) {
      throw new NonRetryableJobError(
        `Reserva de limite criada, mas não foi possível persistir o marcador local: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  await sendTextSequence(leadId, phone, text, `outbound:${job.id}`);
  const sentAt = new Date().toISOString();
  const templateStrategy = String(job.payload.templateStrategy ?? job.payload.strategy ?? "initial");
  await repository.audit(
    fallbackReady ? "outreach.sent_by_fallback" : "outreach.sent_by_online",
    "lead",
    leadId,
    {
      phoneSuffix: phone.slice(-4),
      presenceState,
      presenceToSendLatencyMs: job.payload.presenceObservedAt
        ? Math.max(0, Date.now() - Date.parse(String(job.payload.presenceObservedAt)))
        : null,
    },
  );
  if (serviceDb) {
    const ownerId = await getOwnerId();
    const updates = await Promise.all([
      serviceDb
        .from("leads")
        .update({
          stage: "contacted",
          approached_at: sentAt,
          last_contact_at: sentAt,
          initial_outreach_sent_at: sentAt,
          outreach_template_strategy: templateStrategy,
          consecutive_failures: 0,
        })
        .eq("owner_id", ownerId)
        .eq("id", leadId)
        .is("initial_outreach_sent_at", null),
      serviceDb
        .from("lead_batch_members")
        .update({ status: "completed" })
        .eq("owner_id", ownerId)
        .eq("lead_id", leadId),
    ]);
    for (const update of updates)
      if (update.error) log.error({ err: update.error, leadId }, "outreach_post_send_persistence_failed");
    const cadence = outreachSettingsSchema.parse(await repository.getSettings("outreach"));
    const currentCadence = await serviceDb
      .from("outreach_cadence_state")
      .select("flow_step,attempt_count")
      .eq("owner_id", ownerId)
      .eq("lead_id", leadId)
      .maybeSingle();
    const flowStep = Math.min(6, Math.max(1, Number(currentCadence.data?.flow_step ?? 1)));
    const nextFlowStep = Math.min(6, flowStep + 1);
    const nextAttemptAt =
      flowStep < 6
        ? nextCadenceAttempt(new Date(sentAt), flowStep, cadence.cadenceDelaysDays).toISOString()
        : null;
    await serviceDb.from("outreach_cadence_state").upsert(
      {
        owner_id: ownerId,
        lead_id: leadId,
        status: "active",
        flow_step: nextFlowStep,
        attempt_count: Number(currentCadence.data?.attempt_count ?? 0) + 1,
        last_attempt_at: sentAt,
        next_attempt_at: nextAttemptAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "lead_id" },
    );
    await serviceDb
      .from("conversations")
      .upsert({ owner_id: ownerId, lead_id: leadId }, { onConflict: "lead_id" });
    await serviceDb
      .from("conversations")
      .update({ first_outbound_at: sentAt })
      .eq("owner_id", ownerId)
      .eq("lead_id", leadId)
      .is("first_outbound_at", null);
  } else {
    const found = await repository.leads({ page: 1, pageSize: 10, search: phone });
    const lead = found.rows.find((row) => String(row.id) === leadId);
    await repository.updateResource("leads", leadId, {
      stage: "contacted",
      lastContactAt: sentAt,
      ...(lead && !(lead as any).initialOutreachSentAt
        ? { initialOutreachSentAt: sentAt, outreachTemplateStrategy: templateStrategy }
        : {}),
    });
    const conversations = await repository.page("conversations", { page: 1, pageSize: 100 });
    const conversation = conversations.rows.find((row) => row.leadId === leadId);
    if (conversation && !conversation.firstOutboundAt)
      await repository.updateResource("conversations", String(conversation.id), { firstOutboundAt: sentAt });
  }
}

async function markCadenceResponded(leadId: string, respondedAt: string) {
  if (!serviceDb || !leadId) return;
  const ownerId = await getOwnerId();
  const result = await serviceDb.rpc("mark_cadence_responded", {
    p_owner: ownerId,
    p_lead: leadId,
    p_at: respondedAt,
  });
  if (result.error) log.warn({ err: result.error, leadId }, "cadence_response_state_not_updated");
  else await repository.audit("flow_response_received", "lead", leadId, { respondedAt });
}

async function finalizeCadence(
  leadId: string,
  status: "qualified" | "no_interest" | "opted_out" | "demo_requested",
  reason: string,
) {
  if (!serviceDb || !leadId) return;
  const ownerId = await getOwnerId();
  const now = new Date().toISOString();
  const updated = await serviceDb.from("outreach_cadence_state").upsert(
    {
      owner_id: ownerId,
      lead_id: leadId,
      status,
      next_attempt_at: null,
      exited_at: now,
      exit_reason: reason.slice(0, 500),
      updated_at: now,
    },
    { onConflict: "lead_id" },
  );
  if (updated.error) throw updated.error;
  const cancellations = await Promise.all([
    serviceDb
      .from("outreach_queue")
      .update({ status: "cancelled", locked_at: null, locked_by: null, updated_at: now })
      .eq("owner_id", ownerId)
      .eq("lead_id", leadId)
      .in("status", ["pending", "scheduled", "retry"]),
    serviceDb
      .from("follow_up_queue")
      .update({ status: "cancelled", locked_at: null, locked_by: null, updated_at: now })
      .eq("owner_id", ownerId)
      .eq("lead_id", leadId)
      .in("status", ["pending", "scheduled", "retry"]),
    serviceDb
      .from("follow_ups")
      .update({ status: "cancelled", updated_at: now })
      .eq("owner_id", ownerId)
      .eq("lead_id", leadId)
      .eq("status", "scheduled"),
  ]);
  for (const cancellation of cancellations) if (cancellation.error) throw cancellation.error;
}

async function processFollowUp(job: QueueJob) {
  const phone = requiredString(job.payload.phone, "phone");
  const context = await loadContext(phone, "Follow-up programado pelo sistema.");
  if (!context.leadId) return;
  const settings = outreachSettingsSchema.parse(await repository.getSettings("outreach"));
  const terminal = [
    "opted_out",
    "no_interest",
    "demo_scheduled",
    "handoff",
    "human_handoff",
    "manual_service",
    "blocked",
    "lost",
    "converted",
    "won",
  ];
  if (
    !settings.followUpsEnabled ||
    context.snapshot.humanActive ||
    context.snapshot.automationPaused ||
    context.snapshot.blocked ||
    terminal.includes(context.snapshot.stage)
  )
    return;
  // Flow 2 is unlimited due follow-up work. Flows 3-6 have independent
  // per-stage daily caps and are checked immediately before AI/send work.
  const currentCadence = serviceDb
    ? await serviceDb
        .from("outreach_cadence_state")
        .select("flow_step,last_attempt_at")
        .eq("owner_id", context.ownerId)
        .eq("lead_id", context.leadId)
        .maybeSingle()
    : { data: null, error: null };
  if (currentCadence.error) throw currentCadence.error;
  const stage = Math.min(6, Math.max(1, Number(currentCadence.data?.flow_step ?? 2)));
  const stageLimit = Number((settings.stageDailyLimits as number[] | undefined)?.[stage - 1] ?? 500);
  if (serviceDb && stage >= 3) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const used = await serviceDb
      .from("outreach_cadence_state")
      .select("lead_id", { count: "exact", head: true })
      .eq("owner_id", context.ownerId)
      .eq("flow_step", stage)
      .gte("last_attempt_at", start.toISOString());
    if (used.error) throw used.error;
    if ((used.count ?? 0) >= stageLimit && !currentCadence.data?.last_attempt_at) {
      throw new DeferredJobError(
        `Limite diário do Fluxo ${stage} atingido.`,
        nextCommercialSlot(new Date(), settings),
      );
    }
  }
  const prompt =
    "Escreva uma retomada breve e natural, sem repetir a abertura, sem inventar informações e respeitando o histórico.";
  const execution = await executeAgent(context.snapshot, prompt);
  const decision = execution.decision;
  await persistAgentExecution(context, execution, "completed", job.id);
  if (!decision.replyText || decision.shouldOptOut || decision.shouldHandoff) return;
  await sendTextOnce(context.leadId, phone, decision.replyText, `followup:${job.id}`, context.ownerId);
  if (serviceDb && job.payload.followUpId)
    await serviceDb
      .from("follow_ups")
      .update({ status: "completed" })
      .eq("owner_id", context.ownerId)
      .eq("id", String(job.payload.followUpId));
  else if (job.payload.followUpId)
    await repository.updateResource("followups", String(job.payload.followUpId), { status: "completed" });
}

async function processMaterial(job: QueueJob) {
  if (!serviceDb) return;
  const materialId = requiredString(job.payload.materialId, "materialId");
  const leadId = requiredString(job.payload.leadId, "leadId");
  const ownerId = await getOwnerId();
  const [materialResult, leadResult, conversationResult] = await Promise.all([
    serviceDb
      .from("materials")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("id", materialId)
      .eq("active", true)
      .is("archived_at", null)
      .eq("auto_send_allowed", true)
      .eq("human_confirmation_required", false)
      .single(),
    serviceDb
      .from("leads")
      .select("automation_paused,human_active,stage")
      .eq("owner_id", ownerId)
      .eq("id", leadId)
      .single(),
    serviceDb
      .from("conversations")
      .select("id,human_active,takeover_state")
      .eq("owner_id", ownerId)
      .eq("lead_id", leadId)
      .maybeSingle(),
  ]);
  const { data: material, error } = materialResult;
  if (error || !material) throw new Error("Material inativo ou sem permissão para envio automático.");
  if (leadResult.error) throw leadResult.error;
  const takeoverState = String(conversationResult.data?.takeover_state ?? "ai_active");
  if (
    leadResult.data.automation_paused ||
    leadResult.data.human_active ||
    conversationResult.data?.human_active ||
    ["human_requested", "human_active", "ai_paused"].includes(takeoverState)
  ) {
    await serviceDb.from("material_send_history").insert({
      owner_id: ownerId,
      material_id: materialId,
      material_name: material.name,
      lead_id: leadId,
      conversation_id: conversationResult.data?.id ?? null,
      mode: "automatic",
      status: "blocked",
      reason: `takeover:${takeoverState}`,
    });
    throw new NonRetryableJobError("Envio automatico de material bloqueado por atendimento humano.");
  }
  const mimeType = String(material.mime_type ?? "").toLowerCase();
  const sizeBytes = Number(material.size_bytes ?? 0);
  const extension =
    String(material.storage_path ?? "")
      .split(".")
      .pop()
      ?.toLowerCase() ?? "";
  const allowedExtensions: Record<string, string[]> = {
    "image/jpeg": ["jpg", "jpeg"],
    "image/png": ["png"],
    "image/webp": ["webp"],
    "video/mp4": ["mp4"],
    "audio/ogg": ["ogg", "opus"],
    "audio/mpeg": ["mp3"],
    "audio/mp4": ["m4a", "mp4"],
    "application/pdf": ["pdf"],
    "application/msword": ["doc"],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
    "application/vnd.ms-powerpoint": ["ppt"],
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ["pptx"],
  };
  if (
    !/^(image\/(jpeg|png|webp)|video\/mp4|audio\/(ogg|mpeg|mp4)|application\/(pdf|msword|vnd\.ms-powerpoint|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|presentationml\.presentation)))$/.test(
      mimeType,
    )
  )
    throw new NonRetryableJobError(`MIME não permitido para envio: ${mimeType || "ausente"}.`);
  if (!allowedExtensions[mimeType]?.includes(extension))
    throw new NonRetryableJobError("Extensão do material não corresponde ao MIME cadastrado.");
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > 25 * 1024 * 1024)
    throw new NonRetryableJobError("Material vazio ou acima do limite de 25 MB.");
  const signed = await serviceDb.storage.from("materials").createSignedUrl(material.storage_path, 600);
  if (signed.error) throw signed.error;
  const input = {
    phone: requiredString(job.payload.phone, "phone"),
    mediaUrl: signed.data.signedUrl,
    mimeType,
    fileName: String(material.name),
    idempotencyKey: `material:${job.id}`,
  };
  if (mimeType.startsWith("image/")) await sendMediaSafely("sendImage", input);
  else if (mimeType.startsWith("video/")) await sendMediaSafely("sendVideo", input);
  else if (mimeType.startsWith("audio/")) await sendMediaSafely("sendAudio", input);
  else await sendMediaSafely("sendDocument", input);
  await serviceDb.from("material_send_history").insert({
    owner_id: ownerId,
    material_id: materialId,
    material_name: material.name,
    lead_id: leadId,
    conversation_id: conversationResult.data?.id ?? null,
    mode: simulation ? "simulation" : "automatic",
    status: "sent",
  });
}

async function processAppointment(job: QueueJob) {
  await repository.audit(
    "appointment.reminder.processed",
    "appointment",
    String(job.payload.appointmentId ?? job.id),
    { simulation },
  );
}

async function processMaintenance(job: QueueJob) {
  if (job.payload.action === "reconnect_evolution") await whatsapp.restart();
  if (job.payload.action === "deliver_group_notification")
    await deliverGroupNotification(requiredString(job.payload.notificationId, "notificationId"));
  await repository.audit("maintenance.completed", "job", job.id, { type: job.type });
  if (serviceDb) await serviceDb.rpc("recover_stale_queue_items");
}

async function loadContext(phone: string, latestText: string, latestMessageId?: string) {
  if (!serviceDb) {
    const found = await repository.leads({ page: 1, pageSize: 10, search: phone });
    const lead = found.rows.find((row) => row.phone === phone) ?? { phone, stage: "engaged" };
    const mind = await repository.getSettings("mind");
    const commercial = { ...mind, ...(await repository.getSettings("commercial")) };
    const [conversationPage, messagePage, knowledgePage, materialsPage, followUpPage] = await Promise.all([
      repository.page("conversations", { page: 1, pageSize: 100 }),
      repository.messages({ page: 1, pageSize: 200 }),
      repository.page("knowledge", { page: 1, pageSize: 100 }),
      repository.page("materials", { page: 1, pageSize: 100 }),
      repository.page("followups", { page: 1, pageSize: 100 }),
    ]);
    const leadId = lead.id ? String(lead.id) : null;
    const conversation = conversationPage.rows.find((row) => row.leadId === leadId);
    const persistedHistory = messagePage.rows
      .filter((row) => row.leadId === leadId || row.conversationId === conversation?.id)
      .reverse()
      .map((message) => ({
        id: String(message.id ?? ""),
        externalId: String(message.externalId ?? ""),
        role: roleFromStoredMessage(message.direction, message.senderType),
        text: String(message.content ?? message.transcription ?? ""),
        createdAt: String(message.createdAt ?? message.receivedAt ?? message.sentAt ?? ""),
      }));
    const history = appendLatestLeadMessageIfMissing(
      persistedHistory,
      latestText,
      new Date().toISOString(),
      latestMessageId,
    );
    const snapshot: AgentSnapshot = {
      mind,
      commercial,
      knowledgeItems: knowledgePage.rows,
      lead,
      batch: {},
      stage: String(lead.stage ?? "engaged") as AgentSnapshot["stage"],
      summary: String(conversation?.summary ?? ""),
      messages: history,
      memories: Array.isArray(conversation?.memories)
        ? (conversation.memories as AgentSnapshot["memories"])
        : [],
      materials: materialsPage.rows.map((item) => ({
        id: String(item.id),
        name: String(item.name ?? ""),
        description: String(item.description ?? ""),
        category: String(item.category ?? ""),
        instruction: String(item.instruction ?? ""),
        active: item.active !== false,
        allowedStages: Array.isArray(item.allowedStages) ? item.allowedStages.map(String) : [],
        relatedIntent: item.relatedIntent ? String(item.relatedIntent) : null,
      })),
      availableSlots: [],
      followUps: followUpPage.rows.filter((item) => item.leadId === leadId),
      questionsAsked: Array.isArray(conversation?.questionsAsked)
        ? conversation.questionsAsked.map(String)
        : [],
      materialsSent: Array.isArray(conversation?.materialsSent) ? conversation.materialsSent.map(String) : [],
      humanActive: lead.humanActive === true,
      automationPaused: lead.automationPaused === true,
      blocked: lead.stage === "blocked" || lead.stage === "opted_out",
      qualificationStatus:
        typeof lead.qualificationStatus === "string"
          ? (lead.qualificationStatus as NonNullable<AgentSnapshot["qualificationStatus"]>)
          : "discovering",
      qualificationScore: Number(lead.qualificationScore ?? 0),
      handoffType: typeof lead.handoffType === "string" ? lead.handoffType : null,
      mariliaConsent:
        typeof lead.mariliaConsent === "string"
          ? (lead.mariliaConsent as NonNullable<AgentSnapshot["mariliaConsent"]>)
          : "not_asked",
    };
    return { ownerId: null, leadId, snapshot };
  }
  const ownerId = await getOwnerId();
  const [
    leadResult,
    mindResult,
    commercialResult,
    materialsResult,
    knowledgeResult,
    slotsResult,
    suppressionResult,
  ] = await Promise.all([
    serviceDb
      .from("leads")
      .select("*,lead_batches(*)")
      .eq("owner_id", ownerId)
      .eq("phone", phone)
      .maybeSingle(),
    repository.getSettings("mind"),
    repository.getSettings("commercial"),
    serviceDb
      .from("materials")
      .select("id,name,description,category,allowed_stages,related_intent,instruction")
      .eq("owner_id", ownerId)
      .eq("active", true),
    serviceDb
      .from("knowledge_items")
      .select("title,category,subject,tags,stages,source,content,active")
      .eq("owner_id", ownerId)
      .eq("active", true)
      .is("archived_at", null)
      .limit(100),
    serviceDb.rpc("get_available_demo_slots", {
      p_owner: ownerId,
      p_from: new Date().toISOString(),
      p_limit: 8,
    }),
    serviceDb.from("suppression_list").select("id").eq("phone", phone).eq("active", true).maybeSingle(),
  ]);
  const lead: any = leadResult.data ?? { phone, stage: "engaged" };
  const conversationResetAt =
    typeof lead.metadata?.conversationResetAt === "string" &&
    Number.isFinite(Date.parse(lead.metadata.conversationResetAt))
      ? lead.metadata.conversationResetAt
      : null;
  let messageHistoryQuery = serviceDb
    .from("messages")
    .select("id,external_id,direction,sender_type,content,created_at")
    .eq("owner_id", ownerId)
    .eq("lead_id", lead.id)
    .order("created_at", { ascending: false })
    .limit(200);
  if (conversationResetAt) messageHistoryQuery = messageHistoryQuery.gte("created_at", conversationResetAt);
  const [messages, memories, conversation, followUps] = lead.id
    ? await Promise.all([
        messageHistoryQuery,
        serviceDb
          .from("lead_memories")
          .select("key,value,evidence_type,confidence")
          .eq("owner_id", ownerId)
          .eq("lead_id", lead.id)
          .eq("active", true),
        serviceDb
          .from("conversations")
          .select(
            "summary,questions_asked,materials_sent,human_active,status,qualification_status,qualification_score,handoff_type,marilia_consent",
          )
          .eq("owner_id", ownerId)
          .eq("lead_id", lead.id)
          .maybeSingle(),
        serviceDb
          .from("follow_ups")
          .select("id,status,attempt_number,scheduled_at,reason")
          .eq("owner_id", ownerId)
          .eq("lead_id", lead.id)
          .order("created_at", { ascending: false })
          .limit(10),
      ])
    : [{ data: [] }, { data: [] }, { data: null }, { data: [] }];
  const slots = (slotsResult.data ?? []).map((slot: any) => String(slot.starts_at));
  const sent = (conversation.data?.materials_sent ?? []).map(String);
  const materials = (materialsResult.data ?? []).map((material: any) => ({
    id: String(material.id),
    name: String(material.name),
    description: String(material.description ?? ""),
    category: String(material.category ?? ""),
    instruction: String(material.instruction ?? ""),
    active: true,
    allowedStages: (material.allowed_stages ?? []).map(String),
    relatedIntent: material.related_intent ? String(material.related_intent) : null,
    alreadySent: sent.includes(String(material.id)),
  }));
  const persistedHistory = [...(messages.data ?? [])].reverse().map((message: any) => ({
    id: String(message.id ?? ""),
    externalId: String(message.external_id ?? ""),
    role: roleFromStoredMessage(message.direction, message.sender_type),
    text: String(message.content ?? ""),
    createdAt: String(message.created_at ?? ""),
  }));
  const history = appendLatestLeadMessageIfMissing(
    persistedHistory,
    latestText,
    new Date().toISOString(),
    latestMessageId,
  );
  const snapshot: AgentSnapshot = {
    mind: mindResult as Record<string, unknown>,
    commercial: {
      ...(mindResult as Record<string, unknown>),
      ...(commercialResult as Record<string, unknown>),
    },
    knowledgeItems: knowledgeResult.data ?? [],
    lead,
    batch: lead.lead_batches ?? {},
    stage: String(lead.stage ?? "engaged") as AgentSnapshot["stage"],
    summary: String(conversation.data?.summary ?? ""),
    messages: history,
    memories: (memories.data ?? []).map((memory: any) => ({
      key: String(memory.key),
      value: String(memory.value),
      evidenceType: memory.evidence_type,
      confidence: Number(memory.confidence ?? 1),
    })),
    materials,
    availableSlots: slots,
    followUps: followUps.data ?? [],
    questionsAsked: (conversation.data?.questions_asked ?? []).map(String),
    materialsSent: sent,
    humanActive: lead.human_active === true || conversation.data?.human_active === true,
    automationPaused: lead.automation_paused === true,
    blocked: Boolean(suppressionResult.data) || lead.stage === "blocked" || lead.stage === "opted_out",
    qualificationStatus:
      conversation.data?.qualification_status ?? lead.qualification_status ?? "discovering",
    qualificationScore: Number(conversation.data?.qualification_score ?? lead.qualification_score ?? 0),
    handoffType: conversation.data?.handoff_type ?? lead.handoff_type ?? null,
    mariliaConsent: conversation.data?.marilia_consent ?? lead.marilia_consent ?? "not_asked",
  };
  return { ownerId, leadId: lead.id ? String(lead.id) : null, snapshot };
}

async function persistInboundDecision(
  phone: string,
  text: string,
  externalId: string,
  decision: AiDecision,
  context: Awaited<ReturnType<typeof loadContext>>,
  materialId: string | null,
) {
  const { leadId, ownerId } = context;
  if (!leadId) return;
  const pausesAutomation = decision.shouldHandoff && decision.handoffType !== "sales_qualified";
  const cadenceTerminal =
    decision.detectedIntent === "no_interest"
      ? "no_interest"
      : decision.qualificationStatus === "qualified"
        ? decision.shouldScheduleDemo
          ? "demo_requested"
          : "qualified"
        : null;
  if (!serviceDb) {
    const qualificationAt =
      decision.qualificationStatus === "qualified" ? new Date().toISOString() : undefined;
    const stalledAt = decision.qualificationStatus === "stalled" ? new Date().toISOString() : undefined;
    await repository.updateResource("leads", leadId, {
      stage: decision.leadStage,
      lastContactAt: new Date().toISOString(),
      automationPaused: pausesAutomation,
      humanActive: pausesAutomation,
      qualificationStatus: decision.qualificationStatus ?? "discovering",
      qualificationScore: decision.qualificationScore ?? 0,
      handoffType: decision.handoffType ?? null,
      mariliaConsent: decision.mariliaConsent ?? "not_asked",
      qualificationUpdatedAt: new Date().toISOString(),
      ...(qualificationAt ? { qualifiedAt: qualificationAt } : {}),
      ...(stalledAt ? { stalledAt } : {}),
    });
    const conversations = await repository.page("conversations", { page: 1, pageSize: 100 });
    const existing = conversations.rows.find((row) => row.leadId === leadId);
    const questionsAsked = mergeAskedQuestions(existing?.questionsAsked, decision.replyText);
    const memories = new Map(
      (Array.isArray(existing?.memories) ? existing.memories : []).map((item: any) => [
        String(item.key),
        item,
      ]),
    );
    for (const item of decision.memoryUpdates) memories.set(item.key, item);
    const summary = new ConversationMemoryService().rollingSummary(
      String(existing?.summary ?? context.snapshot.summary ?? decision.summaryUpdate ?? ""),
      [...memories.values()] as any,
      decision.leadStage,
      decision.mariliaConsent,
      decision.followUpAction.reason,
    );
    const conversationValues = {
      status: pausesAutomation ? "paused" : "active",
      stage: decision.leadStage,
      humanActive: pausesAutomation,
      takeoverState: pausesAutomation ? "human_requested" : "ai_active",
      summary,
      questionsAsked,
      memories: [...memories.values()],
      materialsSent: materialId
        ? [
            ...new Set([
              ...(Array.isArray(existing?.materialsSent) ? existing.materialsSent.map(String) : []),
              materialId,
            ]),
          ]
        : (existing?.materialsSent ?? []),
      detectedIntent: decision.detectedIntent,
      confidence: decision.confidence,
      operationalSummary: decision.internalReasoningSummary,
      nextAction: decision.followUpAction,
      qualificationStatus: decision.qualificationStatus ?? "discovering",
      qualificationScore: decision.qualificationScore ?? 0,
      handoffType: decision.handoffType ?? null,
      mariliaConsent: decision.mariliaConsent ?? "not_asked",
      qualificationUpdatedAt: new Date().toISOString(),
      lastMessageAt: new Date().toISOString(),
    };
    if (existing) await repository.updateResource("conversations", String(existing.id), conversationValues);
    else await repository.createResource("conversations", { leadId, ...conversationValues });
    if (decision.shouldHandoff) {
      const handoffs = await repository.page("handoffs", { page: 1, pageSize: 1000 });
      if (!handoffs.rows.some((row) => row.leadId === leadId && row.status !== "cancelled"))
        await repository.createResource("handoffs", {
          leadId,
          reason: decision.handoffReason ?? "Recomendação da IA",
          status: "pending",
          createdAt: new Date().toISOString(),
        });
    }
    if (
      decision.followUpAction.action === "schedule" &&
      decision.followUpAction.delayHours &&
      !decision.shouldHandoff
    ) {
      const scheduledAt = new Date(Date.now() + decision.followUpAction.delayHours * 3_600_000);
      const followUp = await repository.createResource("followups", {
        leadId,
        scheduledAt: scheduledAt.toISOString(),
        status: "scheduled",
        attemptNumber: 1,
        reason: decision.followUpAction.reason,
      });
      await repository.enqueue(
        "follow_up",
        { phone, leadId, followUpId: followUp.id },
        scheduledAt,
        `followup:${leadId}:${scheduledAt.toISOString()}`,
      );
    }
    await repository.audit("message.inbound.processed", "lead", leadId, {
      externalId,
      length: text.length,
      stage: decision.leadStage,
      materialId,
    });
    return;
  }
  const existingConversation = await serviceDb
    .from("conversations")
    .select("id,questions_asked,materials_sent")
    .eq("owner_id", ownerId)
    .eq("lead_id", leadId)
    .maybeSingle();
  if (existingConversation.error) throw existingConversation.error;
  const questions = mergeAskedQuestions(existingConversation.data?.questions_asked, decision.replyText);
  const sentMaterials = materialId
    ? [...new Set([...(existingConversation.data?.materials_sent ?? []), materialId])]
    : (existingConversation.data?.materials_sent ?? []);
  const summary = new ConversationMemoryService().rollingSummary(
    context.snapshot.summary,
    context.snapshot.memories.concat(decision.memoryUpdates),
    decision.leadStage,
    decision.mariliaConsent,
    decision.followUpAction.reason,
  );
  const conversation = await serviceDb
    .from("conversations")
    .upsert(
      {
        owner_id: ownerId,
        lead_id: leadId,
        status: pausesAutomation ? "paused" : "active",
        stage: decision.leadStage,
        human_active: pausesAutomation,
        takeover_state: pausesAutomation ? "human_requested" : "ai_active",
        summary,
        questions_asked: questions,
        materials_sent: sentMaterials,
        qualification_status: decision.qualificationStatus ?? "discovering",
        qualification_score: decision.qualificationScore ?? 0,
        handoff_type: decision.handoffType ?? null,
        marilia_consent: decision.mariliaConsent ?? "not_asked",
        qualification_updated_at: new Date().toISOString(),
        last_message_at: new Date().toISOString(),
      },
      { onConflict: "lead_id" },
    )
    .select("id")
    .single();
  if (conversation.error) throw conversation.error;
  await serviceDb.from("messages").upsert(
    {
      owner_id: ownerId,
      lead_id: leadId,
      conversation_id: conversation.data.id,
      direction: "inbound",
      sender_type: "lead",
      content: text,
      external_id: externalId,
      status: "received",
      raw_data: {},
    },
    { onConflict: "external_id" },
  );
  const qualificationAt = decision.qualificationStatus === "qualified" ? new Date().toISOString() : null;
  const stalledAt = decision.qualificationStatus === "stalled" ? new Date().toISOString() : null;
  await serviceDb
    .from("leads")
    .update({
      stage: decision.leadStage,
      last_contact_at: new Date().toISOString(),
      automation_paused: pausesAutomation,
      human_active: pausesAutomation,
      qualified_at: qualificationAt,
      stalled_at: stalledAt,
      metadata: leadMetadata(context.snapshot.lead, decision),
    })
    .eq("owner_id", ownerId)
    .eq("id", leadId);
  if (cadenceTerminal)
    await finalizeCadence(
      leadId,
      cadenceTerminal,
      decision.followUpAction.reason ?? "Estado terminal da cadência.",
    );
  if (decision.memoryUpdates.length) {
    await serviceDb.from("lead_memories").upsert(
      decision.memoryUpdates.map((memory) => ({
        owner_id: ownerId,
        lead_id: leadId,
        key: memory.key,
        value: memory.value,
        source: "ai",
        evidence_type: memory.evidenceType,
        confidence: memory.confidence,
        active: true,
      })),
      { onConflict: "lead_id,key" },
    );
    await serviceDb.from("conversation_memories").upsert(
      decision.memoryUpdates.map((memory) => ({
        owner_id: ownerId,
        conversation_id: conversation.data.id,
        lead_id: leadId,
        key: memory.key,
        value: memory.value,
        source: "ai",
        evidence_type: memory.evidenceType,
        confidence: memory.confidence,
        active: true,
      })),
      { onConflict: "conversation_id,key" },
    );
  }
  if (decision.shouldHandoff) {
    const prior = await serviceDb
      .from("handoffs")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("lead_id", leadId)
      .neq("status", "cancelled")
      .limit(1)
      .maybeSingle();
    if (prior.error) throw prior.error;
    if (!prior.data)
      await serviceDb.from("handoffs").insert({
        owner_id: ownerId,
        lead_id: leadId,
        reason: decision.handoffReason ?? "Recomendação da IA",
        status: "pending",
      });
    if (pausesAutomation)
      await serviceDb.from("conversation_takeovers").insert({
        owner_id: ownerId,
        lead_id: leadId,
        conversation_id: conversation.data.id,
        state: "human_requested",
        reason: decision.handoffReason ?? "Recomendação da IA",
      });
  }
  if (decision.shouldScheduleDemo && decision.appointmentData) {
    const calendar = await repository.getSettings("outreach");
    await serviceDb.from("appointments").insert({
      owner_id: ownerId,
      lead_id: leadId,
      conversation_id: conversation.data.id,
      starts_at: decision.appointmentData.startsAt,
      ends_at: decision.appointmentData.endsAt,
      status: "pending",
      origin: "ai",
      assignee: String(calendar.salesCloserName ?? calendar.demoCloser ?? workerConfig.SALES_CLOSER_NAME),
      notes: decision.appointmentData.notes,
    });
    await serviceDb
      .from("leads")
      .update({ stage: "demo_requested" })
      .eq("owner_id", ownerId)
      .eq("id", leadId);
  }
  await applyFollowUpDecision(phone, leadId, ownerId, decision);
}

function leadMetadata(lead: Record<string, unknown>, decision: AiDecision) {
  const metadata =
    lead.metadata && typeof lead.metadata === "object"
      ? { ...(lead.metadata as Record<string, unknown>) }
      : {};
  const professional = decision.memoryUpdates.find(
    (item) =>
      item.key === "professional_category" && item.evidenceType === "explicit" && item.confidence >= 0.7,
  );
  if (professional) metadata.professionalCategory = professional.value;
  metadata.qualificationStatus = decision.qualificationStatus ?? "discovering";
  metadata.qualificationScore = decision.qualificationScore ?? 0;
  metadata.handoffType = decision.handoffType ?? null;
  metadata.salesHandoffConsent = decision.mariliaConsent ?? "not_asked";
  if (
    decision.memoryUpdates.some((item) => item.key === "current_system" && item.evidenceType === "explicit")
  )
    metadata.usesSystem = true;
  return metadata;
}

async function notifySalesQualified(context: Awaited<ReturnType<typeof loadContext>>, decision: AiDecision) {
  if (!context.leadId) return;
  const memory = new Map(context.snapshot.memories.map((item) => [item.key, item.value]));
  for (const item of decision.memoryUpdates) memory.set(item.key, item.value);
  const contextText = humanConversationSummary(memory);
  const availability = memory.get("availability");
  const sales = await salesCloserSettings();
  const nextStep = availability
    ? `${sales.name} validar a disponibilidade para a demonstração. ${availability}`
    : `${sales.name} entrar em contato para dar continuidade ao atendimento.`;
  const body = formatHumanQualifiedGroupMessage({
    name: memory.get("informed_name"),
    phone: context.snapshot.lead.phone,
    company: memory.get("store_name") ?? context.snapshot.lead.company,
    region: memory.get("city") ?? regionFromPhone(String(context.snapshot.lead.phone ?? "")),
    context: contextText,
    mainInterest: humanMainInterest(memory),
    nextStep,
  });
  await enqueueGroupNotification(
    "lead_interested",
    "Lead qualificado para Pedro",
    body,
    context.leadId,
    groupNotificationDedupKey("lead_interested", context.leadId),
  );
  const directBody = `${body}\n\n🔗 WhatsApp: https://wa.me/${context.snapshot.lead.phone ?? ""}`;
  await sendSalesHandoffOnce(context.leadId, sales.phone, directBody, "qualified_sales_closer");
}

async function salesCloserSettings() {
  const general = await repository.getSettings("general");
  const configuredPhone = String(general.salesCloserPhone ?? workerConfig.SALES_CLOSER_PHONE);
  const normalized = normalizeBrazilianPhone(configuredPhone);
  return {
    name: String(general.salesCloserName ?? workerConfig.SALES_CLOSER_NAME),
    phone: normalized.normalized ?? workerConfig.SALES_CLOSER_PHONE,
  };
}

function ensureSalesContactReply(reply: string | null, name: string, phone: string) {
  const base =
    reply?.trim() || `Perfeito. Vou encaminhar seu contato para o ${name} dar continuidade por aqui.`;
  if (base.includes(phone)) return base;
  return `${base} Se quiser falar com ele agora, o número é ${phone}. Também estou encaminhando seu contato para ele.`;
}

const localSalesHandoffDeliveries = new Set<string>();
async function sendSalesHandoffOnce(
  leadId: string,
  phone: string,
  text: string,
  channel: "qualified_sales_closer",
) {
  const key = `${channel}:${leadId}`;
  if (!serviceDb) {
    if (localSalesHandoffDeliveries.has(key)) return;
    await sendTextSafely(phone, text, key);
    localSalesHandoffDeliveries.add(key);
    return;
  }
  const ownerId = await getOwnerId();
  const existing = await serviceDb
    .from("sales_handoff_deliveries")
    .select("status")
    .eq("owner_id", ownerId)
    .eq("lead_id", leadId)
    .eq("channel", channel)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data?.status === "sent" || existing.data?.status === "processing") return;
  const inserted = await serviceDb
    .from("sales_handoff_deliveries")
    .upsert(
      { owner_id: ownerId, lead_id: leadId, channel, status: "processing", idempotency_key: key },
      { onConflict: "owner_id,lead_id,channel", ignoreDuplicates: true },
    )
    .select("id,status")
    .maybeSingle();
  if (inserted.error) throw inserted.error;
  if (!inserted.data || inserted.data.status !== "processing") return;
  try {
    await sendTextSafely(phone, text, key);
    await serviceDb
      .from("sales_handoff_deliveries")
      .update({ status: "sent", delivered_at: new Date().toISOString(), last_error: null })
      .eq("owner_id", ownerId)
      .eq("lead_id", leadId)
      .eq("channel", channel);
  } catch (error) {
    await serviceDb
      .from("sales_handoff_deliveries")
      .update({ status: "failed", last_error: error instanceof Error ? error.message : "Falha no handoff." })
      .eq("owner_id", ownerId)
      .eq("lead_id", leadId)
      .eq("channel", channel);
    throw error;
  }
}

async function notifyDisqualified(context: Awaited<ReturnType<typeof loadContext>>, reason: string) {
  if (!context.leadId) return;
  const memory = new Map(context.snapshot.memories.map((item) => [item.key, item.value]));
  const inboundCount =
    serviceDb && context.ownerId
      ? await countUniqueRelevantInboundMessages(context.ownerId, context.leadId)
      : context.snapshot.messages.filter((message) => message.role === "lead" && message.text.trim()).length;
  if (inboundCount < 3) return;
  const body = formatDisqualifiedGroupMessageClean({
    name: memory.get("informed_name"),
    phone: context.snapshot.lead.phone,
    company: memory.get("store_name") ?? context.snapshot.lead.company,
    region: memory.get("city") ?? regionFromPhone(String(context.snapshot.lead.phone ?? "")),
    context: humanConversationSummary(memory),
    reason: humanDisqualificationReason(reason),
  });
  await enqueueGroupNotification(
    "lead_stalled",
    "Lead desqualificado — sem interesse",
    body,
    context.leadId,
    groupNotificationDedupKey("lead_disqualified", context.leadId),
  );
}

async function countUniqueRelevantInboundMessages(ownerId: string, leadId: string) {
  const result = await serviceDb!
    .from("messages")
    .select("external_id,content,transcription,message_type")
    .eq("owner_id", ownerId)
    .eq("lead_id", leadId)
    .eq("direction", "inbound");
  if (result.error) throw result.error;
  const unique = new Set<string>();
  for (const message of result.data ?? []) {
    const content = String(message.content ?? message.transcription ?? "").trim();
    if (!content) continue;
    unique.add(String(message.external_id ?? `${message.message_type}:${content}`));
  }
  return unique.size;
}

function humanDisqualificationReason(reason: string) {
  return isExplicitNoInterestText(reason) ? "Não teve interesse em continuar a conversa comercial." : reason;
}

function relatedCapability(mainPain: string | undefined) {
  return /or[cç]amento/i.test(mainPain ?? "")
    ? "Orçamentos: criar, revisar, salvar, gerar PDF, enviar pelo WhatsApp e consultar histórico recente"
    : "A confirmar com o Pedro conforme o contexto informado";
}
function regionFromPhone(phone: string) {
  return regionFromBrazilianPhone(phone) ?? "Não informado";
}
void relatedCapability;

function humanConversationSummary(memory: Map<string, string>) {
  const parts: string[] = [];
  const store = memory.get("store_name");
  if (memory.get("decision_maker"))
    parts.push(store ? `É responsável pela ${store}.` : "É responsável pela ótica.");
  else if (store) parts.push(`Representa a ${store}.`);
  if (memory.get("current_system")) parts.push(`Atualmente, ${lowerFirst(memory.get("current_system")!)}.`);
  if (memory.get("current_process")) parts.push(`Processo atual: ${memory.get("current_process")}.`);
  if (memory.get("main_pain")) parts.push(`Comentou: ${memory.get("main_pain")}.`);
  if (memory.get("interest")) parts.push("Demonstrou interesse em conhecer o Renova123 e aceitou avançar.");
  if (memory.get("availability")) parts.push(memory.get("availability")!);
  return parts.join(" ") || "Conversa comercial iniciada, sem outros fatos confirmados.";
}

function humanMainInterest(memory: Map<string, string>) {
  if (memory.get("current_system_type") === "generic")
    return "Conhecer um sistema desenvolvido especificamente para óticas.";
  return memory.get("interest") ?? memory.get("main_pain") ?? "Conhecer o Renova123 na demonstração.";
}
function lowerFirst(value: string) {
  return value ? `${value[0]!.toLocaleLowerCase("pt-BR")}${value.slice(1)}` : value;
}

async function enqueueGroupNotification(
  type: "lead_interested" | "lead_stalled",
  title: string,
  body: string,
  leadId: string,
  dedupKey: string,
  payload: Record<string, unknown> = {},
) {
  let notificationId: string | null = null;
  if (serviceDb) {
    const ownerId = await getOwnerId();
    const existing = await serviceDb
      .from("notifications")
      .select("id,delivery_status")
      .eq("owner_id", ownerId)
      .eq("dedup_key", dedupKey)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data?.delivery_status === "sent") return;
    if (existing.data?.id) notificationId = String(existing.data.id);
    else {
      const inserted = await serviceDb
        .from("notifications")
        .insert({
          owner_id: ownerId,
          type,
          level: type === "lead_stalled" ? "warning" : "info",
          title,
          body,
          lead_id: leadId,
          dedup_key: dedupKey,
          delivery_payload: payload,
        })
        .select("id")
        .single();
      if (inserted.error && inserted.error.code !== "23505") throw inserted.error;
      notificationId = inserted.data?.id
        ? String(inserted.data.id)
        : String(
            (
              await serviceDb
                .from("notifications")
                .select("id")
                .eq("owner_id", ownerId)
                .eq("dedup_key", dedupKey)
                .single()
            ).data?.id ?? "",
          );
    }
  } else {
    const existing = (await repository.page("notifications", { page: 1, pageSize: 1000 })).rows.find(
      (row) => row.dedupKey === dedupKey,
    );
    if (existing?.deliveryStatus === "sent") return;
    if (existing?.id) notificationId = String(existing.id);
    else
      notificationId = String(
        (
          await repository.createResource("notifications", {
            type,
            level: type === "lead_stalled" ? "warning" : "info",
            title,
            body,
            leadId,
            dedupKey,
            deliveryStatus: "pending",
            deliveryAttempts: 0,
            deliveryPayload: payload,
          })
        ).id,
      );
  }
  if (notificationId)
    await repository.enqueue(
      "maintenance",
      { action: "deliver_group_notification", notificationId },
      new Date(),
      `group-notification:${dedupKey}`,
    );
}

async function deliverGroupNotification(notificationId: string) {
  const groupForType = (type: string) =>
    type === "lead_interested"
      ? workerConfig.WHATSAPP_QUALIFIED_GROUP_ID
      : workerConfig.WHATSAPP_STALLED_GROUP_ID;
  if (!serviceDb) {
    const row = (await repository.page("notifications", { page: 1, pageSize: 1000 })).rows.find(
      (item) => String(item.id) === notificationId,
    );
    if (!row || !canAttemptGroupDelivery(String(row.deliveryStatus ?? "pending"))) return;
    const groupId = groupForType(String(row.type));
    if (!groupId) {
      await repository.updateResource("notifications", notificationId, {
        deliveryStatus: "blocked",
        deliveryLastError: "Grupo não configurado.",
      });
      return;
    }
    try {
      await sendTextSafely(
        groupId,
        String(row.body ?? ""),
        `group:${String(row.dedupKey ?? notificationId)}`,
      );
      await repository.updateResource("notifications", notificationId, {
        deliveryStatus: "sent",
        deliveredAt: new Date().toISOString(),
      });
    } catch (error) {
      await repository.updateResource("notifications", notificationId, {
        deliveryStatus: "pending",
        deliveryAttempts: Number(row.deliveryAttempts ?? 0) + 1,
        deliveryLastError: error instanceof Error ? error.message : "Falha no grupo.",
      });
      throw error;
    }
    return;
  }
  const ownerId = await getOwnerId();
  const row = await serviceDb
    .from("notifications")
    .select("id,type,body,delivery_status,delivery_attempts,dedup_key")
    .eq("owner_id", ownerId)
    .eq("id", notificationId)
    .single();
  if (row.error) throw row.error;
  if (!canAttemptGroupDelivery(String(row.data.delivery_status ?? "pending"))) return;
  const groupId = groupForType(String(row.data.type));
  if (!groupId) {
    await serviceDb
      .from("notifications")
      .update({ delivery_status: "blocked", delivery_last_error: "Grupo não configurado." })
      .eq("owner_id", ownerId)
      .eq("id", notificationId);
    return;
  }
  try {
    await serviceDb
      .from("notifications")
      .update({
        delivery_status: "processing",
        delivery_attempts: Number(row.data.delivery_attempts ?? 0) + 1,
      })
      .eq("owner_id", ownerId)
      .eq("id", notificationId);
    await sendTextSafely(
      groupId,
      String(row.data.body ?? ""),
      `group:${String(row.data.dedup_key ?? notificationId)}`,
    );
    await serviceDb
      .from("notifications")
      .update({ delivery_status: "sent", delivery_last_error: null })
      .eq("owner_id", ownerId)
      .eq("id", notificationId);
  } catch (error) {
    await serviceDb
      .from("notifications")
      .update({
        delivery_status: "pending",
        delivery_last_error: error instanceof Error ? error.message : "Falha no grupo.",
      })
      .eq("owner_id", ownerId)
      .eq("id", notificationId);
    throw error;
  }
}

async function processQualificationDeadlines() {
  const now = Date.now();
  if (!serviceDb) {
    const leads = (await repository.leads({ page: 1, pageSize: 1000 })).rows;
    const conversations = (await repository.page("conversations", { page: 1, pageSize: 1000 })).rows;
    for (const lead of leads) {
      const conversation = conversations.find((row) => row.leadId === lead.id);
      const status = String(conversation?.qualificationStatus ?? lead.qualificationStatus ?? "discovering");
      const deadline = String(
        conversation?.qualificationDeadlineAt ??
          (conversation?.firstInboundAt
            ? new Date(
                Date.parse(String(conversation.firstInboundAt)) +
                  workerConfig.QUALIFICATION_DEADLINE_HOURS * 3_600_000,
              ).toISOString()
            : lead.lastContactAt
              ? new Date(
                  Date.parse(String(lead.lastContactAt)) +
                    workerConfig.QUALIFICATION_DEADLINE_HOURS * 3_600_000,
                ).toISOString()
              : ""),
      );
      const messages = (await repository.messages({ page: 1, pageSize: 1000 })).rows.filter(
        (row) => row.leadId === lead.id && row.direction === "inbound" && row.senderType === "lead",
      );
      const explicitNoInterest = messages.some((message) =>
        isExplicitNoInterestText(String(message.content ?? "")),
      );
      const hasCommercialEngagement =
        Number(conversation?.qualificationScore ?? 0) > 0 ||
        messages.some((message) =>
          /\b(otica|loja|sistema|estoque|preco|quanto|problema|dor|cidade|venda|cliente|plano)\b/i.test(
            String(message.content ?? "")
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, ""),
          ),
        );
      if (
        !shouldMarkStalled({
          deadlineReached: Boolean(deadline && Date.parse(deadline) <= now),
          inboundMessages: messages.length,
          hasCommercialEngagement,
          explicitNoInterest,
          qualificationStatus: status,
          stage: String(lead.stage ?? ""),
          humanActive: Boolean(lead.humanActive),
          automationPaused: Boolean(lead.automationPaused),
          takeoverState: String(conversation?.takeoverState ?? ""),
        })
      )
        continue;
      await markStalledLead(String(lead.id), String(lead.phone), {
        name: lead.name,
        company: lead.company,
        firstContactAt: lead.lastContactAt,
        responseCount: messages.length,
        summary: conversation?.summary,
        perceivedInterest: conversation?.qualificationScore,
      });
    }
    return;
  }
  const ownerId = await getOwnerId();
  const [leadsResult, conversationsResult, inboundResult] = await Promise.all([
    serviceDb
      .from("leads")
      .select("id,phone,name,company,stage,approached_at,automation_paused,human_active,metadata")
      .eq("owner_id", ownerId),
    serviceDb
      .from("conversations")
      .select(
        "lead_id,first_inbound_at,qualification_deadline_at,last_inbound_at,qualification_status,qualification_score,summary,human_active,takeover_state",
      )
      .eq("owner_id", ownerId),
    serviceDb
      .from("messages")
      .select("lead_id,content,created_at")
      .eq("owner_id", ownerId)
      .eq("direction", "inbound")
      .eq("sender_type", "lead")
      .order("created_at", { ascending: true }),
  ]);
  if (leadsResult.error) throw leadsResult.error;
  if (conversationsResult.error) throw conversationsResult.error;
  if (inboundResult.error) throw inboundResult.error;
  const inboundByLead = new Map<string, Array<{ content: string; createdAt: string }>>();
  for (const message of inboundResult.data ?? []) {
    const items = inboundByLead.get(String(message.lead_id)) ?? [];
    items.push({ content: String(message.content ?? ""), createdAt: String(message.created_at ?? "") });
    inboundByLead.set(String(message.lead_id), items);
  }
  for (const lead of leadsResult.data ?? []) {
    const conversation = (conversationsResult.data ?? []).find((row) => row.lead_id === lead.id);
    const inboundMessages = inboundByLead.get(String(lead.id)) ?? [];
    const explicitNoInterest = inboundMessages.some((message) => isExplicitNoInterestText(message.content));
    const hasCommercialEngagement =
      Number(conversation?.qualification_score ?? 0) > 0 ||
      inboundMessages.some((message) =>
        /\b(otica|loja|sistema|estoque|preco|quanto|problema|dor|cidade|venda|cliente|plano)\b/i.test(
          message.content.normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
        ),
      );
    const status = String(
      conversation?.qualification_status ?? (lead.metadata as any)?.qualificationStatus ?? "discovering",
    );
    const deadline =
      conversation?.qualification_deadline_at ??
      (conversation?.first_inbound_at
        ? new Date(
            Date.parse(conversation.first_inbound_at) + workerConfig.QUALIFICATION_DEADLINE_HOURS * 3_600_000,
          ).toISOString()
        : lead.approached_at
          ? new Date(
              Date.parse(lead.approached_at) + workerConfig.QUALIFICATION_DEADLINE_HOURS * 3_600_000,
            ).toISOString()
          : null);
    if (
      !shouldMarkStalled({
        deadlineReached: Boolean(deadline && Date.parse(deadline) <= now),
        inboundMessages: inboundMessages.length,
        hasCommercialEngagement,
        explicitNoInterest,
        qualificationStatus: status,
        stage: lead.stage,
        humanActive: lead.human_active,
        automationPaused: lead.automation_paused,
        takeoverState: conversation?.takeover_state,
      })
    )
      continue;
    await serviceDb
      .from("leads")
      .update({
        automation_paused: true,
        metadata: {
          ...((lead.metadata as Record<string, unknown>) ?? {}),
          qualificationStatus: "stalled",
          stalledAt: new Date().toISOString(),
        },
      })
      .eq("owner_id", ownerId)
      .eq("id", lead.id);
    if (conversation)
      await serviceDb
        .from("conversations")
        .update({
          status: "paused",
          takeover_state: "ai_paused",
          qualification_status: "stalled",
          qualification_updated_at: new Date().toISOString(),
        })
        .eq("owner_id", ownerId)
        .eq("lead_id", lead.id);
    const body = formatStalledGroupMessage({
      name: lead.name,
      phone: lead.phone,
      company: lead.company,
      firstContactAt: lead.approached_at,
      lastResponseAt: conversation?.last_inbound_at,
      responseCount: inboundMessages.length,
      perceivedInterest: conversation?.qualification_score,
      summary: conversation?.summary,
      missingForQualification: "interesse comercial, contexto operacional e próximo passo",
    });
    await enqueueGroupNotification(
      "lead_stalled",
      "Lead sem avanço — contato humano",
      body,
      String(lead.id),
      groupNotificationDedupKey("lead_stalled", String(lead.id)),
    );
  }
}

async function markStalledLead(leadId: string, phone: string, data: Record<string, unknown>) {
  await repository.updateResource("leads", leadId, {
    automationPaused: true,
    qualificationStatus: "stalled",
    stalledAt: new Date().toISOString(),
  });
  const conversations = await repository.page("conversations", { page: 1, pageSize: 1000 });
  const conversation = conversations.rows.find((row) => row.leadId === leadId);
  if (conversation?.id)
    await repository.updateResource("conversations", String(conversation.id), {
      status: "paused",
      takeoverState: "ai_paused",
      qualificationStatus: "stalled",
      qualificationUpdatedAt: new Date().toISOString(),
    });
  const body = formatStalledGroupMessage({
    phone,
    ...data,
    missingForQualification: "interesse comercial, contexto operacional e próximo passo",
  });
  await enqueueGroupNotification(
    "lead_stalled",
    "Lead sem avanço — contato humano",
    body,
    leadId,
    groupNotificationDedupKey("lead_stalled", leadId),
  );
}

async function configuredGroq() {
  const settings = await repository.getSettings("groq");
  let apiKey = workerConfig.GROQ_API_KEY;
  if (typeof settings.apiKeyEncrypted === "string" && settings.apiKeyEncrypted)
    apiKey = decryptSecret(settings.apiKeyEncrypted, workerConfig.ENCRYPTION_KEY);
  const provider = new GroqProvider({ apiKey, simulationMode: workerConfig.MOCK_GROQ });
  return {
    provider,
    model: String(settings.model ?? workerConfig.GROQ_MODEL),
    fallbackModel: String(settings.fallbackModel ?? workerConfig.GROQ_FALLBACK_MODEL),
    transcriptionModel: String(settings.transcriptionModel ?? workerConfig.GROQ_WHISPER_MODEL),
    temperature: Number(settings.temperature ?? 0.3),
    processingPaused: settings.processingPaused === true,
    cooldownUntil: typeof settings.cooldownUntil === "string" ? settings.cooldownUntil : null,
  };
}

async function configuredGemini() {
  const settings = await repository.getSettings("gemini");
  return {
    provider: new GeminiProvider({
      ...(workerConfig.GEMINI_API_KEY ? { apiKey: workerConfig.GEMINI_API_KEY } : {}),
      model: String(settings.model ?? workerConfig.GEMINI_MODEL),
      simulationMode: workerConfig.MOCK_GEMINI || simulation,
    }),
    model: String(settings.model ?? workerConfig.GEMINI_MODEL),
    cooldownUntil: typeof settings.cooldownUntil === "string" ? settings.cooldownUntil : null,
  };
}

async function configuredOpenRouter() {
  const settings = await repository.getSettings("openrouter_1");
  const model = String(settings.model ?? workerConfig.OPENROUTER_MODEL);
  return {
    provider: new OpenRouterProvider({
      ...(workerConfig.OPENROUTER_API_KEY_1 ? { apiKey: workerConfig.OPENROUTER_API_KEY_1 } : {}),
    }),
    model,
    configured: Boolean(workerConfig.OPENROUTER_API_KEY_1) && settings.enabled === true,
    cooldownUntil: typeof settings.cooldownUntil === "string" ? settings.cooldownUntil : null,
  };
}

async function executeAgent(
  snapshot: AgentSnapshot,
  userMessage: string,
  modelOverride?: string,
  systemInstructionSuffix?: string,
) {
  const runtime = await configuredGroq();
  if (runtime.processingPaused)
    throw new DeferredJobError(
      "Processamento Groq pausado até a seleção de um modelo ativo.",
      new Date(Date.now() + 10 * 60_000),
    );
  return new AgentExecutionService(runtime.provider).execute({
    snapshot,
    userMessage,
    model: modelOverride ?? runtime.model,
    temperature: runtime.temperature,
    ...(systemInstructionSuffix ? { systemInstructionSuffix } : {}),
  });
}

async function executeAgentWithDailyLimitFallback(
  snapshot: AgentSnapshot,
  userMessage: string,
  jobId: string,
  systemInstructionSuffix?: string,
) {
  const reasonFor = (error: unknown) =>
    error instanceof GroqRateLimitError
      ? "groq_rate_limit"
      : error instanceof GroqProviderError
        ? error.status >= 500
          ? "groq_unavailable"
          : "groq_provider_failure"
        : "groq_timeout";
  const attempts: NonNullable<AgentCallMetrics["providerAttempts"]> = [];
  const configured = await configuredGroq();
  const persistedGroqCooldown = cooldownRemainingSeconds(configured.cooldownUntil);
  if (persistedGroqCooldown > 0) groqCircuit.recordFailure(persistedGroqCooldown, true);
  let reason = groqCircuit.state() === "cooldown" ? "groq_cooldown" : null;
  let lastGroqError: unknown = null;
  if (!reason && groqCircuit.canAttempt()) {
    const primaryStarted = Date.now();
    try {
      const result = await executeAgent(snapshot, userMessage, undefined, systemInstructionSuffix);
      groqCircuit.recordSuccess();
      attempts.push({
        provider: "groq",
        model: configured.model,
        latencyMs: Date.now() - primaryStarted,
        success: true,
        rateLimited: false,
      });
      return withAttemptMetrics(result, attempts, null);
    } catch (error) {
      lastGroqError = error;
      const sharedQuotaBlocked = error instanceof GroqRateLimitError && isSharedGroqQuotaError(error);
      attempts.push({
        provider: "groq",
        model: configured.model,
        latencyMs: Date.now() - primaryStarted,
        success: false,
        rateLimited: error instanceof GroqRateLimitError,
        reason: reasonFor(error),
      });
      reason = reasonFor(error);
      groqCircuit.recordFailure(
        error instanceof GroqRateLimitError ? error.retryAfterSeconds : null,
        sharedQuotaBlocked,
      );
      const fallbackRuntime = await configuredGroq();
      const groqModels = groqAttemptModels({
        primaryModel: fallbackRuntime.model,
        fallbackModel: fallbackRuntime.fallbackModel,
        circuitOpen: groqCircuit.state() === "cooldown",
        sharedQuotaBlocked: sharedQuotaBlocked || error instanceof GroqRateLimitError,
      });
      if (groqModels.length > 1) {
        const fallbackStarted = Date.now();
        try {
          const fallbackModel = groqModels[1]!;
          const fallback = await executeAgent(snapshot, userMessage, fallbackModel, systemInstructionSuffix);
          groqCircuit.recordSuccess();
          attempts.push({
            provider: "groq",
            model: fallbackModel,
            latencyMs: Date.now() - fallbackStarted,
            success: true,
            rateLimited: false,
          });
          return withAttemptMetrics(fallback, attempts, reason);
        } catch (fallbackError) {
          lastGroqError = fallbackError;
          attempts.push({
            provider: "groq",
            model: groqModels[1]!,
            latencyMs: Date.now() - fallbackStarted,
            success: false,
            rateLimited: fallbackError instanceof GroqRateLimitError,
            reason: reasonFor(fallbackError),
          });
          reason = reasonFor(fallbackError);
          groqCircuit.recordFailure(
            fallbackError instanceof GroqRateLimitError ? fallbackError.retryAfterSeconds : null,
            fallbackError instanceof GroqRateLimitError && isSharedGroqQuotaError(fallbackError),
          );
        }
      }
      await recordGroqFailure(
        lastGroqError instanceof Error ? lastGroqError.message : "Falha no provider Groq",
        false,
        lastGroqError instanceof GroqRateLimitError ? lastGroqError.rateLimits : { reason },
      );
    }
  }
  const providerCooldowns = [persistedGroqCooldown];
  let lastStructuredError: AiStructuredOutputError | null = null;
  const openRouterRuntime = await configuredOpenRouter();
  const persistedOpenRouterCooldown = cooldownRemainingSeconds(openRouterRuntime.cooldownUntil);
  providerCooldowns.push(persistedOpenRouterCooldown);
  if (persistedOpenRouterCooldown > 0) openRouter1Circuit.recordFailure(persistedOpenRouterCooldown, true);
  if (openRouterRuntime.configured && openRouter1Circuit.canAttempt()) {
    const openRouterStarted = Date.now();
    try {
      const result = await new AgentExecutionService(openRouterRuntime.provider).execute({
        snapshot,
        userMessage,
        model: openRouterRuntime.model,
        temperature: 0.3,
        ...(systemInstructionSuffix ? { systemInstructionSuffix } : {}),
      });
      openRouter1Circuit.recordSuccess();
      attempts.push({
        provider: "openrouter_1",
        model: result.metrics?.model ?? openRouterRuntime.model,
        latencyMs: Date.now() - openRouterStarted,
        success: true,
        rateLimited: false,
      });
      await recordOpenRouterState(
        openRouterRuntime.model,
        result.metrics?.model ?? openRouterRuntime.model,
        "healthy",
        null,
        result.rateLimits,
        null,
      );
      return withAttemptMetrics(result, attempts, reason ?? "groq_unavailable");
    } catch (error) {
      const rateLimited = error instanceof OpenRouterRateLimitError;
      const configurationBlocked =
        error instanceof OpenRouterProviderError && [401, 402, 403, 404].includes(error.status);
      const retryAfter = rateLimited ? error.retryAfterSeconds : configurationBlocked ? 3_600 : null;
      openRouter1Circuit.recordFailure(retryAfter, rateLimited || configurationBlocked);
      attempts.push({
        provider: "openrouter_1",
        model: openRouterRuntime.model,
        latencyMs: Date.now() - openRouterStarted,
        success: false,
        rateLimited,
        reason: rateLimited ? "openrouter_1_rate_limit" : "openrouter_1_failure",
      });
      if (error instanceof AiStructuredOutputError) lastStructuredError = error;
      const cooldownUntil =
        rateLimited || configurationBlocked
          ? new Date(Date.now() + Math.max(1, retryAfter ?? 1) * 1000).toISOString()
          : openRouter1Circuit.cooldownUntilIso();
      await recordOpenRouterState(
        openRouterRuntime.model,
        null,
        "unhealthy",
        cooldownUntil,
        error instanceof OpenRouterRateLimitError ? error.rateLimits : null,
        error instanceof Error ? error.message : "Falha OpenRouter",
      );
      providerCooldowns[1] = cooldownRemainingSeconds(cooldownUntil);
      log.warn(
        { jobId, provider: "openrouter_1", rateLimited, eligibleAt: cooldownUntil },
        "openrouter_fallback_skipped",
      );
    }
  }

  const runtime = await configuredGemini();
  const persistedGeminiCooldown = cooldownRemainingSeconds(runtime.cooldownUntil);
  providerCooldowns.push(persistedGeminiCooldown);
  if (persistedGeminiCooldown > 0) geminiCircuit.recordFailure(persistedGeminiCooldown, true);
  if (geminiCircuit.canAttempt()) {
    const geminiStarted = Date.now();
    try {
      // Fallback preserves the same context budget and prompt semantics.
      const compactBuilder = new AgentContextBuilder();
      const result = await new AgentExecutionService(runtime.provider, compactBuilder).execute({
        snapshot,
        userMessage,
        model: runtime.model,
        temperature: 0.3,
        ...(systemInstructionSuffix ? { systemInstructionSuffix } : {}),
      });
      geminiCircuit.recordSuccess();
      attempts.push({
        provider: "gemini",
        model: runtime.model,
        latencyMs: Date.now() - geminiStarted,
        success: true,
        rateLimited: false,
      });
      return withAttemptMetrics(result, attempts, reason ?? "groq_unavailable");
    } catch (error) {
      const rateLimited = error instanceof GeminiRateLimitError;
      attempts.push({
        provider: "gemini",
        model: runtime.model,
        latencyMs: Date.now() - geminiStarted,
        success: false,
        rateLimited,
        reason: rateLimited ? "gemini_rate_limit" : "gemini_failure",
      });
      geminiCircuit.recordFailure(rateLimited ? error.retryAfterSeconds : null, rateLimited);
      if (rateLimited) {
        await recordProviderCooldown("gemini", error.retryAfterSeconds, error.message);
        providerCooldowns[2] = error.retryAfterSeconds;
      }
      if (error instanceof AiStructuredOutputError) lastStructuredError = error;
      log.error(
        { jobId, fallbackReason: reason ?? "groq_unavailable", provider: "gemini" },
        "ai_fallback_failed",
      );
    }
  }
  if (lastStructuredError) throw lastStructuredError;
  const retrySeconds = providerPoolRetrySeconds(...providerCooldowns);
  throw new DeferredJobError(
    "Todos os providers de IA estão temporariamente indisponíveis.",
    new Date(Date.now() + retrySeconds * 1000),
  );
}

function withAttemptMetrics(
  result: AgentExecutionResult,
  attempts: NonNullable<AgentCallMetrics["providerAttempts"]>,
  fallbackReason: string | null,
): AgentExecutionResult {
  if (!result.metrics) return result;
  const failed = attempts.filter((attempt) => !attempt.success).length;
  return {
    ...result,
    metrics: {
      ...result.metrics,
      providerAttempts: attempts,
      regenerationCount: 0,
      fallbackCount: failed,
      ...(fallbackReason ? { fallbackReason } : {}),
    },
  };
}

function cooldownRemainingSeconds(value: string | null | undefined) {
  const until = value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}

async function persistAgentExecution(
  context: Awaited<ReturnType<typeof loadContext>>,
  execution: AgentExecutionResult,
  status: "completed" | "blocked",
  jobId: string,
) {
  if (!serviceDb || !context.ownerId) {
    if (context.leadId)
      await repository.updateResource("leads", context.leadId, {
        aiProvider: execution.metrics?.provider ?? "groq",
        aiModel: execution.metrics?.model ?? (await configuredGroq()).model,
      });
    await repository.audit("agent.execution", "lead", context.leadId, {
      provider: execution.metrics?.provider ?? "groq",
      status,
      model: execution.metrics?.model ?? (await configuredGroq()).model,
      ...(execution.metrics ?? {}),
      jobId,
      intent: execution.decision.detectedIntent,
      confidence: execution.decision.confidence,
    });
    await auditTokenUsage(context, execution, jobId, null);
    return;
  }
  const conversation = context.leadId
    ? await serviceDb
        .from("conversations")
        .select("id")
        .eq("owner_id", context.ownerId)
        .eq("lead_id", context.leadId)
        .maybeSingle()
    : { data: null, error: null };
  if (conversation.error) throw conversation.error;
  const runtime = await configuredGroq();
  const metrics = execution.metrics;
  if (context.leadId)
    await serviceDb
      .from("leads")
      .update({ ai_provider: metrics?.provider ?? "groq", ai_model: metrics?.model ?? runtime.model })
      .eq("owner_id", context.ownerId)
      .eq("id", context.leadId);
  const saved = await serviceDb.from("agent_executions").insert({
    owner_id: context.ownerId,
    lead_id: context.leadId,
    conversation_id: conversation.data?.id ?? null,
    provider: metrics?.provider ?? "groq",
    model: metrics?.model ?? runtime.model,
    status,
    detected_intent: execution.decision.detectedIntent,
    lead_stage: execution.decision.leadStage,
    confidence: execution.decision.confidence,
    operational_summary: execution.decision.internalReasoningSummary,
    context_tokens_estimate: execution.context.estimatedTokens,
    context_was_summarized: execution.context.summarized,
    input_tokens: metrics?.inputTokens ?? execution.context.estimatedTokens,
    output_tokens: metrics?.outputTokens ?? 0,
    total_tokens: metrics?.totalTokens ?? execution.context.estimatedTokens,
    latency_ms: metrics?.latencyMs ?? null,
    success: metrics?.success ?? true,
    rate_limited: metrics?.rateLimited ?? false,
    fallback_reason: metrics?.fallbackReason ?? null,
    fallback_count: metrics?.fallbackCount ?? 0,
    rate_limits: execution.rateLimits ?? {},
  });
  if (saved.error) throw saved.error;
  await auditTokenUsage(context, execution, jobId, conversation.data?.id ?? null);
}

async function auditTokenUsage(
  context: Awaited<ReturnType<typeof loadContext>>,
  execution: AgentExecutionResult,
  jobId: string,
  conversationId: string | null,
) {
  const metrics = execution.metrics;
  await repository.audit("ai.token_usage", "lead", context.leadId, {
    leadId: context.leadId,
    conversationId,
    jobId,
    provider: metrics?.provider ?? null,
    model: metrics?.model ?? null,
    providerPool: metrics?.providerPool ?? null,
    openRouterModel: metrics?.openRouterModel ?? null,
    freeModel: metrics?.freeModel ?? null,
    usageCost: metrics?.usageCost ?? null,
    inputTokens: metrics?.inputTokens ?? execution.context.estimatedTokens,
    outputTokens: metrics?.outputTokens ?? 0,
    totalTokens: metrics?.totalTokens ?? execution.context.estimatedTokens,
    systemTokens: metrics?.systemTokens ?? execution.context.tokenBreakdown.systemTokens,
    mindTokens: execution.context.tokenBreakdown.mindTokens,
    historyTokens: execution.context.tokenBreakdown.historyTokens,
    summaryTokens: execution.context.tokenBreakdown.summaryTokens,
    semanticTokens: execution.context.tokenBreakdown.semanticTokens,
    qualificationTokens: execution.context.tokenBreakdown.qualificationTokens,
    knowledgeTokens: execution.context.tokenBreakdown.knowledgeTokens,
    productTokens: execution.context.tokenBreakdown.productTokens,
    schemaTokens: metrics?.schemaTokens ?? null,
    currentTurnTokens: execution.context.tokenBreakdown.currentTurnTokens,
    providerAttempts: metrics?.providerAttempts ?? [],
    regenerationCount: metrics?.regenerationCount ?? 0,
    cachedTokens: metrics?.cachedTokens ?? 0,
    latencyMs: metrics?.latencyMs ?? null,
    rateLimit: execution.rateLimits ?? null,
    cooldownUntil: metrics?.cooldownUntil ?? null,
  });
}

async function recordGroqFailure(message: string, pause: boolean, rateLimits: unknown) {
  const current = await repository.getSettings("groq");
  const retryAfterSeconds =
    rateLimits && typeof rateLimits === "object"
      ? Number((rateLimits as Record<string, unknown>).retryAfterSeconds ?? 0)
      : 0;
  const values = {
    ...current,
    ...(pause ? { model: null, processingPaused: true } : {}),
    lastFailure: message.slice(0, 1000),
    rateLimits,
    failedAt: new Date().toISOString(),
    cooldownUntil: new Date(Date.now() + Math.max(60, retryAfterSeconds || 0) * 1000).toISOString(),
  };
  await repository.saveSettings("groq", values);
  const reason =
    rateLimits && typeof rateLimits === "object"
      ? String((rateLimits as Record<string, unknown>).reason ?? "")
      : "";
  await repository.audit(
    pause
      ? "groq.model_unavailable"
      : reason === "groq_rate_limit"
        ? "groq.rate_limited"
        : "groq.provider_failure",
    "integration",
    null,
    { message: message.slice(0, 500), rateLimits },
  );
  if (serviceDb)
    await serviceDb.from("agent_executions").insert({
      owner_id: await getOwnerId(),
      provider: "groq",
      model: String(current.model ?? workerConfig.GROQ_MODEL),
      status: pause ? "model_unavailable" : "rate_limited",
      operational_summary: pause
        ? "Modelo selecionado indisponível; IA pausada."
        : "Execução devolvida à fila conforme Retry-After.",
      rate_limits: rateLimits ?? {},
      error_message: message.slice(0, 2000),
      success: false,
      rate_limited: !pause,
    });
}

async function recordProviderCooldown(section: "gemini", retryAfterSeconds: number, message: string) {
  const current = await repository.getSettings(section);
  await repository.saveSettings(section, {
    ...current,
    lastFailure: message.slice(0, 500),
    failedAt: new Date().toISOString(),
    cooldownUntil: new Date(Date.now() + Math.max(60, retryAfterSeconds) * 1000).toISOString(),
  });
}

async function recordOpenRouterState(
  requestedModel: string,
  actualModel: string | null,
  health: "healthy" | "unhealthy",
  cooldownUntil: string | null,
  rateLimits: unknown,
  message: string | null,
) {
  const current = await repository.getSettings("openrouter_1");
  const now = new Date().toISOString();
  await repository.saveSettings("openrouter_1", {
    ...current,
    model: requestedModel,
    providerPool: "openrouter_1",
    enabled: true,
    freeModel: true,
    actualModel,
    circuit: health === "healthy" ? "online" : cooldownUntil ? "cooldown" : "offline",
    cooldownUntil,
    eligibleAt: cooldownUntil ?? now,
    lastHealth: { status: health, observedAt: now },
    rateLimits,
    ...(health === "healthy"
      ? { lastSuccessAt: now, lastFailure: null }
      : { failedAt: now, lastFailure: message?.slice(0, 500) ?? "Falha OpenRouter" }),
  });
}

async function applyFollowUpDecision(
  phone: string,
  leadId: string,
  ownerId: string | null,
  decision: AiDecision,
) {
  if (decision.followUpAction.action === "cancel") {
    if (serviceDb)
      await serviceDb
        .from("follow_ups")
        .update({ status: "cancelled" })
        .eq("owner_id", ownerId)
        .eq("lead_id", leadId)
        .eq("status", "scheduled");
    return;
  }
  if (
    decision.followUpAction.action !== "schedule" ||
    !decision.followUpAction.delayHours ||
    decision.shouldHandoff ||
    decision.shouldOptOut
  )
    return;
  const settings = outreachSettingsSchema.parse(await repository.getSettings("outreach"));
  if (!settings.followUpsEnabled || settings.maxFollowUps === 0) return;
  const scheduledAt = new Date(Date.now() + decision.followUpAction.delayHours * 3_600_000);
  if (!serviceDb) {
    const followUp = await repository.createResource("followups", {
      leadId,
      scheduledAt: scheduledAt.toISOString(),
      status: "scheduled",
      attemptNumber: 1,
      reason: decision.followUpAction.reason,
    });
    await repository.enqueue(
      "follow_up",
      { phone, leadId, followUpId: followUp.id },
      scheduledAt,
      `followup:${leadId}:${scheduledAt.toISOString()}`,
    );
    return;
  }
  const count = await serviceDb
    .from("follow_ups")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("lead_id", leadId);
  if (count.error) throw count.error;
  if ((count.count ?? 0) >= settings.maxFollowUps) return;
  const followUp = await serviceDb
    .from("follow_ups")
    .insert({
      owner_id: ownerId,
      lead_id: leadId,
      scheduled_at: scheduledAt.toISOString(),
      status: "scheduled",
      attempt_number: (count.count ?? 0) + 1,
      reason: decision.followUpAction.reason,
    })
    .select("id")
    .single();
  if (followUp.error) throw followUp.error;
  await repository.enqueue(
    "follow_up",
    { phone, leadId, followUpId: followUp.data.id },
    scheduledAt,
    `followup:${leadId}:${scheduledAt.toISOString()}`,
  );
}

async function sendTextSequence(
  leadId: string | null,
  phone: string,
  text: string,
  idempotencyKey: string,
  ownerId?: string | null,
  shouldContinue?: () => Promise<boolean>,
  leadTurn = "",
) {
  const parts = naturalMessageParts(normalizeWhatsAppText(text));
  await sendOrderedParts(parts, {
    pause: async (index) => {
      const delay = conversationalBubbleDelayMs(parts, leadTurn);
      if (delay && index === 1) await sleep(delay);
    },
    ...(shouldContinue ? { beforePart: async () => shouldContinue() } : {}),
    send: async (part, index) => {
      await sendTextOnce(
        leadId,
        phone,
        part,
        parts.length === 1 ? idempotencyKey : `${idempotencyKey}:part:${index + 1}`,
        ownerId,
      );
    },
  });
}

async function recordInboundLifecycle(
  job: QueueJob,
  state: "processing" | "responded" | "retrying" | "failed_final",
  details: Record<string, unknown> = {},
) {
  const event = (job.payload.event ?? {}) as NormalizedWhatsAppEvent;
  const messageId = String(
    job.payload.sourceMessageId ??
      job.payload.messageId ??
      event.externalMessageId ??
      event.eventId ??
      job.id,
  );
  await repository.audit("inbound.lifecycle", "message", messageId, {
    messageId,
    state,
    jobId: job.id,
    jobType: job.type,
    ...details,
  });
}

async function recordInboundLatency(
  job: QueueJob,
  leadId: string,
  sourceMessageId: string,
  context: Awaited<ReturnType<typeof loadContext>>,
  sendStartedAt: string,
  sendFinishedAt: string,
) {
  const latency = (
    job.payload.latency && typeof job.payload.latency === "object" ? job.payload.latency : {}
  ) as Record<string, unknown>;
  let inboundMessages = context.snapshot.messages.filter((message) => message.role === "lead");
  if (serviceDb && context.ownerId) {
    const source = await serviceDb
      .from("messages")
      .select("created_at,received_at")
      .eq("owner_id", context.ownerId)
      .eq("external_id", sourceMessageId)
      .maybeSingle();
    if (source.error) throw source.error;
    if (source.data?.created_at) {
      const previousOutbound = await serviceDb
        .from("messages")
        .select("created_at,sent_at")
        .eq("owner_id", context.ownerId)
        .eq("lead_id", leadId)
        .eq("direction", "outbound")
        .lt("created_at", source.data.created_at)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (previousOutbound.error) throw previousOutbound.error;
      const turnStart = previousOutbound.data?.created_at ?? "1970-01-01T00:00:00.000Z";
      const turnInbound = await serviceDb
        .from("messages")
        .select("created_at,received_at")
        .eq("owner_id", context.ownerId)
        .eq("lead_id", leadId)
        .eq("direction", "inbound")
        .gte("created_at", turnStart)
        .lte("created_at", source.data.created_at)
        .order("created_at", { ascending: true });
      if (turnInbound.error) throw turnInbound.error;
      inboundMessages = (turnInbound.data ?? []).map((message) => ({
        role: "lead" as const,
        text: "",
        createdAt: String(message.received_at ?? message.created_at ?? ""),
      }));
    }
  }
  const firstInboundAt = inboundMessages[0]?.createdAt ?? null;
  const lastInboundAt = inboundMessages.at(-1)?.createdAt ?? null;
  const jobRow =
    serviceDb && context.ownerId
      ? await serviceDb
          .from("jobs")
          .select("created_at,available_at")
          .eq("owner_id", context.ownerId)
          .eq("id", job.id)
          .maybeSingle()
      : { data: null, error: null };
  if (jobRow.error) throw jobRow.error;
  const isoMs = (value: unknown) =>
    typeof value === "string" && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
  const duration = (start: unknown, end: unknown) => {
    const a = isoMs(start);
    const b = isoMs(end);
    return a !== null && b !== null ? Math.max(0, b - a) : null;
  };
  const sentAt = isoMs(sendFinishedAt);
  const firstAt = isoMs(firstInboundAt);
  await repository.audit("inbound.latency", "lead", leadId, {
    sourceMessageId,
    firstInboundAt,
    lastInboundAt,
    debounceMs: duration(lastInboundAt, latency.pipelineStartedAt),
    queueWaitMs: duration(jobRow.data?.created_at, latency.pipelineStartedAt),
    providerAttempts: latency.provider
      ? [
          {
            provider: latency.provider,
            model: latency.model,
            latencyMs: latency.providerMs,
            fallbackReason: latency.fallbackReason,
          },
        ]
      : [],
    providerMs: latency.providerMs ?? null,
    validationMs: null,
    aiSendQueueMs: duration(latency.aiSendCreatedAt, sendStartedAt),
    evolutionMs: duration(sendStartedAt, sendFinishedAt),
    sendMs: duration(sendStartedAt, sendFinishedAt),
    totalLatencyMs: firstAt !== null && sentAt !== null ? Math.max(0, sentAt - firstAt) : null,
    providerUsed: latency.provider ?? null,
    fallbackCount: latency.fallbackCount ?? 0,
    retryCount: job.attempts > 0 ? job.attempts - 1 : 0,
    jobCreatedAt: jobRow.data?.created_at ?? null,
    jobAvailableAt: jobRow.data?.available_at ?? null,
    contextStartedAt: latency.pipelineStartedAt ?? null,
    aiSendCreatedAt: latency.aiSendCreatedAt ?? null,
    typingStartedAt: latency.typingStartedAt ?? null,
    workerHeartbeatAgeMs: Math.max(0, Date.now() - lastHeartbeatAtMs),
    workerInstanceId: latency.workerInstanceId ?? instanceId,
    sendStartedAt,
    evolutionAcceptedAt: sendFinishedAt,
    finalStatus: "sent",
  });
}

async function latestInboundMessageId(leadId: string) {
  if (!serviceDb) {
    const messages = await repository.messages({ page: 1, pageSize: 300 });
    return (
      String(
        messages.rows.find((message) => message.leadId === leadId && message.direction === "inbound")
          ?.externalId ?? "",
      ) || null
    );
  }
  const latest = await serviceDb
    .from("messages")
    .select("external_id")
    .eq("owner_id", await getOwnerId())
    .eq("lead_id", leadId)
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest.error) throw latest.error;
  return latest.data?.external_id ? String(latest.data.external_id) : null;
}

async function ensureLatestInboundProcessing(phone: string, leadId: string, snapshot: AgentSnapshot) {
  if (snapshot.humanActive || snapshot.automationPaused || snapshot.blocked) {
    await repository.audit("agent.reply.latest_inbound_not_requeued", "lead", leadId, {
      phoneSuffix: phone.slice(-4),
      reason: snapshot.humanActive
        ? "human_active"
        : snapshot.automationPaused
          ? "automation_paused"
          : "blocked",
    });
    return;
  }
  let latest: { externalId: string; text: string } | null = null;
  if (serviceDb) {
    const result = await serviceDb
      .from("messages")
      .select("external_id,content")
      .eq("owner_id", await getOwnerId())
      .eq("lead_id", leadId)
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (result.error) throw result.error;
    if (result.data?.external_id && result.data.content)
      latest = { externalId: String(result.data.external_id), text: String(result.data.content) };
  } else {
    const messages = await repository.messages({ page: 1, pageSize: 300 });
    const row = messages.rows.find((message) => message.leadId === leadId && message.direction === "inbound");
    if (row?.externalId && row.content)
      latest = { externalId: String(row.externalId), text: String(row.content) };
  }
  if (!latest) return;
  const jobId = await repository.enqueueInboundDebounced(
    { phone, text: latest.text, messageId: latest.externalId },
    new Date(Date.now() + 6_000),
  );
  await repository.audit("agent.reply.latest_inbound_requeued", "lead", leadId, {
    phoneSuffix: phone.slice(-4),
    latestInboundId: latest.externalId,
    jobId,
    reason: "superseded_decision_requires_latest_processing",
  });
}

async function sendTextOnce(
  leadId: string | null,
  phone: string,
  text: string,
  idempotencyKey: string,
  knownOwnerId?: string | null,
) {
  if (!leadId) return;
  if (process.env.NODE_ENV !== "production") {
    const slowPhone = process.env.QA_SLOW_PHONE;
    const slowMs = Math.max(0, Number(process.env.QA_SLOW_MS ?? 0));
    if (slowPhone && phone === slowPhone && slowMs > 0) await sleep(Math.min(slowMs, 120_000));
    const failPhone = process.env.QA_FAIL_PHONE;
    const failAll = process.env.QA_FAIL_ALL === "true";
    if ((failAll || (failPhone && phone === failPhone)) && process.env.QA_FAIL_SEND === "true") {
      const message = failAll
        ? "provider unavailable (QA systemic failure)"
        : "provider unavailable (QA lead failure)";
      if (process.env.QA_FAIL_NON_RETRYABLE === "true") throw new NonRetryableJobError(message);
      throw new Error(message);
    }
  }
  await assertOperationalTestDestination(phone, idempotencyKey);
  if (workerLeaseLost)
    throw new DeferredJobError("Lock do worker perdido antes do envio.", new Date(Date.now() + 15_000));
  if (!serviceDb) {
    const found = await repository.leads({ page: 1, pageSize: 10, search: phone });
    const lead = found.rows.find((row) => String(row.id) === leadId || row.phone === phone);
    if (lead?.stage === "opted_out" || lead?.automationPaused || lead?.humanActive)
      throw new NonRetryableJobError(
        "Envio bloqueado por opt-out, pausa de automação ou atendimento humano.",
      );
    const conversations = await repository.page("conversations", { page: 1, pageSize: 100 });
    const conversation =
      conversations.rows.find((row) => row.leadId === leadId) ??
      (await repository.createResource("conversations", {
        leadId,
        status: "active",
        stage: lead?.stage ?? "contacted",
        humanActive: false,
        unreadCount: 0,
        summary: "Primeiro contato enviado pelo Francisco.",
        lastMessageAt: new Date().toISOString(),
      }));
    if (deliveryWasAccepted(workerConfig.MOCK_DB_PATH, idempotencyKey)) return;
    if (deliveryIsUncertain(workerConfig.MOCK_DB_PATH, idempotencyKey))
      throw new NonRetryableJobError(
        `O envio ${idempotencyKey} tem resultado incerto e exige revisão; repetição automática bloqueada.`,
      );
    const existingMessages = await repository.messages({ page: 1, pageSize: 300 });
    const existingMessage = existingMessages.rows.find(
      (message) => message.idempotencyKey === idempotencyKey,
    );
    if (
      existingMessage &&
      ["sent", "simulated", "delivered", "read"].includes(String(existingMessage.status))
    )
      return;
    if (existingMessage && String(existingMessage.status) !== "queued")
      throw new NonRetryableJobError(
        `Mensagem ${idempotencyKey} já foi reservada; reenvio automático bloqueado.`,
      );
    const message = {
      leadId,
      conversationId: conversation.id,
      direction: "outbound",
      senderType: "agent",
      origin: "ai",
      messageType: "text",
      content: text,
      idempotencyKey,
    };
    await repository.recordMessage({ ...message, status: "queued" });
    let raw;
    try {
      raw = await sendTextSafely(phone, text, idempotencyKey);
    } catch (error) {
      markDeliveryUncertain(workerConfig.MOCK_DB_PATH, idempotencyKey);
      await repository.recordMessage({
        ...message,
        status: "review_required",
        errorMessage: error instanceof Error ? error.message : "Resultado do provedor desconhecido",
      });
      throw new NonRetryableJobError(
        `Não foi possível confirmar ${idempotencyKey}; reenvio automático bloqueado para evitar duplicação.`,
      );
    }
    markDeliveryAccepted(workerConfig.MOCK_DB_PATH, idempotencyKey);
    await repository.recordMessage({
      ...message,
      externalId: raw.externalMessageId,
      status: simulation ? "simulated" : "sent",
      sentAt: new Date().toISOString(),
    });
    await repository.updateResource("conversations", String(conversation.id), {
      lastMessageAt: new Date().toISOString(),
    });
    await repository.audit("message.sent", "lead", leadId, {
      phoneSuffix: phone.slice(-4),
      simulation,
      length: text.length,
      idempotencyKey,
      accepted: Boolean(raw),
    });
    return;
  }
  const ownerId = knownOwnerId ?? (await getOwnerId());
  const [leadState, suppression] = await Promise.all([
    serviceDb
      .from("leads")
      .select("stage,automation_paused,human_active")
      .eq("owner_id", ownerId)
      .eq("id", leadId)
      .single(),
    serviceDb.from("suppression_list").select("id").eq("phone", phone).eq("active", true).maybeSingle(),
  ]);
  if (leadState.error) throw leadState.error;
  if (suppression.error) throw suppression.error;
  if (
    suppression.data ||
    leadState.data.stage === "opted_out" ||
    leadState.data.automation_paused ||
    leadState.data.human_active
  )
    throw new NonRetryableJobError(
      "Envio bloqueado por opt-out, supressão, pausa de automação ou atendimento humano.",
    );
  const status = await whatsapp.getConnectionStatus();
  if (!simulation && status.state !== "open")
    throw new DeferredJobError("WhatsApp desconectado; envio adiado.", new Date(Date.now() + 60_000));
  const conversation = await serviceDb
    .from("conversations")
    .upsert({ owner_id: ownerId, lead_id: leadId, status: "active" }, { onConflict: "lead_id" })
    .select("id")
    .single();
  if (conversation.error) throw conversation.error;
  const existing = await serviceDb
    .from("messages")
    .select("id,status,external_id,metadata")
    .eq("owner_id", ownerId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data && ["sent", "simulated", "delivered", "read"].includes(String(existing.data.status)))
    return;
  const reconciledAsNotSent =
    existing.data?.status === "failed" &&
    !existing.data.external_id &&
    (existing.data.metadata as Record<string, unknown> | null)?.recoveryConfirmedNotSent === true;
  if (existing.data && !reconciledAsNotSent)
    throw new NonRetryableJobError(
      `Mensagem ${idempotencyKey} já foi reservada; revisão manual necessária antes de qualquer reenvio.`,
    );
  const controlledTest = isControlledOutreachTestJob(
    phone,
    workerConfig.OUTREACH_ONLINE_ONLY,
    workerConfig.OUTREACH_ONLINE_TEST_PHONE,
  );
  const metadata = controlledTest
    ? { controlledTest: true, newLeadReservation: false }
    : idempotencyKey.startsWith("outbound:")
      ? { newLeadReservation: true }
      : {};
  const reserved = reconciledAsNotSent
    ? await serviceDb
        .from("messages")
        .update({ status: "queued", error_message: null, raw_data: {} })
        .eq("id", existing.data!.id)
        .eq("status", "failed")
        .select("id")
        .single()
    : await serviceDb
        .from("messages")
        .insert({
          owner_id: ownerId,
          lead_id: leadId,
          conversation_id: conversation.data.id,
          direction: "outbound",
          sender_type: "agent",
          origin: "ai",
          content: text,
          idempotency_key: idempotencyKey,
          status: "queued",
          raw_data: {},
          metadata,
        })
        .select("id")
        .single();
  if (reserved.error) {
    if (reserved.error.code === "23505")
      throw new NonRetryableJobError(
        `Mensagem ${idempotencyKey} já foi reservada; reenvio automático bloqueado.`,
      );
    throw reserved.error;
  }
  const raw = await sendTextSafely(phone, text, idempotencyKey);
  const accepted = await serviceDb
    .from("messages")
    .update({
      external_id: raw.externalMessageId,
      status: simulation ? "simulated" : "sent",
      sent_at: new Date().toISOString(),
      attempt: 1,
      raw_data: raw.raw,
    })
    .eq("id", reserved.data.id)
    .eq("status", "queued");
  if (accepted.error)
    throw new NonRetryableJobError(
      `Provedor aceitou ${idempotencyKey}, mas a confirmação local falhou; reenvio automático bloqueado.`,
    );
  const conversationUpdated = await serviceDb
    .from("conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("owner_id", ownerId)
    .eq("lead_id", leadId);
  if (conversationUpdated.error)
    throw new NonRetryableJobError(
      `Provedor aceitou ${idempotencyKey}, mas a data da conversa não foi atualizada; reenvio automático bloqueado.`,
    );
  const usageField = idempotencyKey.startsWith("outbound:") ? "outreach_count" : "ai_response_count";
  const usageDate = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const usage = await serviceDb
    .from("daily_usage")
    .select(`id,${usageField}`)
    .eq("owner_id", ownerId)
    .eq("usage_date", usageDate)
    .maybeSingle();
  if (!usage.error && !idempotencyKey.startsWith("outbound:"))
    await serviceDb.from("daily_usage").upsert(
      {
        owner_id: ownerId,
        usage_date: usageDate,
        [usageField]: Number((usage.data as any)?.[usageField] ?? 0) + 1,
      },
      { onConflict: "owner_id,usage_date" },
    );
  await repository.audit("message.sent", "lead", leadId, { phoneSuffix: phone.slice(-4), simulation });
}

function requiredString(value: unknown, name: string) {
  if (typeof value !== "string" || !value) throw new Error(`Payload sem ${name}.`);
  return value;
}
function simulatedSendResult(idempotencyKey: string): WhatsAppSendResult {
  return {
    externalMessageId: `simulation:${idempotencyKey}`,
    status: "simulated",
    raw: { simulation: true, idempotencyKey },
  };
}
async function sendTextSafely(
  phone: string,
  text: string,
  idempotencyKey: string,
): Promise<WhatsAppSendResult> {
  await assertOperationalTestDestination(phone, idempotencyKey);
  return simulation ? simulatedSendResult(idempotencyKey) : whatsapp.sendText(phone, text, idempotencyKey);
}
async function sendMediaSafely(
  method: "sendImage" | "sendVideo" | "sendAudio" | "sendDocument",
  input: WhatsAppMediaInput,
): Promise<WhatsAppSendResult> {
  await assertOperationalTestDestination(input.phone, input.idempotencyKey);
  return simulation ? simulatedSendResult(input.idempotencyKey) : whatsapp[method](input);
}

async function operationalTestModeActive() {
  const general = await repository.getSettings("general");
  return isOperationalTestMode(
    general.globalPause,
    workerConfig.OUTREACH_ONLINE_ONLY,
    workerConfig.OUTREACH_ONLINE_TEST_PHONE,
  );
}

async function reconcileScheduledResume(general: Record<string, unknown>) {
  const outreach = outreachSettingsSchema.parse(await repository.getSettings("outreach"));
  const now = new Date();
  const scheduledAt =
    typeof general.scheduledResumeAt === "string" ? Date.parse(general.scheduledResumeAt) : NaN;
  let preflightOk = false;
  if (Number.isFinite(scheduledAt) && scheduledAt <= now.getTime() && canStartOutreach(now, outreach)) {
    try {
      const whatsappStatus = await whatsapp.getConnectionStatus();
      const groqHealth =
        workerConfig.MOCK_GROQ || !workerConfig.GROQ_API_KEY
          ? { ok: workerConfig.MOCK_GROQ }
          : await new GroqProvider({
              apiKey: workerConfig.GROQ_API_KEY,
              simulationMode: false,
            }).healthCheck();
      preflightOk =
        Boolean(serviceDb) &&
        whatsappStatus.state === "open" &&
        groqHealth.ok &&
        Boolean(workerConfig.GEMINI_API_KEY || workerConfig.MOCK_GEMINI);
      if (!preflightOk)
        await repository.audit("campaign.resume_preflight_blocked", "system", null, {
          whatsapp: whatsappStatus.state,
          groq: groqHealth.ok,
          supabase: Boolean(serviceDb),
          gemini: Boolean(workerConfig.GEMINI_API_KEY || workerConfig.MOCK_GEMINI),
          scheduledResumeAt: general.scheduledResumeAt,
        });
    } catch (error) {
      await repository.audit("campaign.resume_preflight_blocked", "system", null, {
        error: error instanceof Error ? error.message : "Falha no preflight",
        scheduledResumeAt: general.scheduledResumeAt,
      });
    }
  }
  const decision = evaluateScheduledResume(
    {
      globalPause: general.globalPause === true,
      scheduledResumeAt: typeof general.scheduledResumeAt === "string" ? general.scheduledResumeAt : null,
      scheduledResumeAppliedAt:
        typeof general.scheduledResumeAppliedAt === "string" ? general.scheduledResumeAppliedAt : null,
    },
    now,
    canStartOutreach(now, outreach),
    preflightOk,
  );
  if (decision.action !== "activate") return general;
  const activated = {
    ...general,
    globalPause: false,
    scheduledResumeAt: null,
    scheduledResumeAppliedAt: decision.appliedAt,
    operationalTestMode: false,
    authorizedTestPhone: null,
  };
  await repository.saveSettings("general", activated);
  await repository.saveSettings("outreach", { ...outreach, enabled: true });
  await repository.audit("campaign.resumed_scheduled", "system", null, {
    scheduledResumeAt: general.scheduledResumeAt,
    appliedAt: decision.appliedAt,
    timezone: outreach.timezone,
  });
  return activated;
}

async function assertOperationalTestDestination(phone: string, job: string) {
  if (!(await operationalTestModeActive())) return;
  if (job.startsWith("ai:")) return;
  const destination = operationalTestDestination(phone, workerConfig.OUTREACH_ONLINE_TEST_PHONE);
  if (destination.allowed) return;
  const details = {
    phone: destination.normalizedPhone,
    job,
    reason: "Destino fora da allowlist do modo de teste.",
    timestamp: new Date().toISOString(),
  };
  await repository.audit("TEST_MODE_BLOCKED_OUTBOUND", "job", job, details);
  log.warn(details, "TEST_MODE_BLOCKED_OUTBOUND");
  throw new TestModeBlockedOutboundError("TEST_MODE_BLOCKED_OUTBOUND");
}

async function blockJobDuringOperationalTest(job: QueueJob) {
  if (!(await operationalTestModeActive()) || job.type === "evolution_event") return false;
  if (job.type === "inbound_reply" || job.type === "ai_send") return false;
  const destination = operationalTestDestination(jobPhone(job), workerConfig.OUTREACH_ONLINE_TEST_PHONE);
  if (destination.allowed) return false;
  const details = {
    phone: destination.normalizedPhone,
    job: job.id,
    reason: `Job ${job.type} preservado durante modo de teste.`,
    timestamp: new Date().toISOString(),
  };
  await repository.audit("TEST_MODE_BLOCKED_OUTBOUND", "job", job.id, details);
  log.warn(details, "TEST_MODE_BLOCKED_OUTBOUND");
  await repository.deferJob(job.id, new Date(Date.now() + 5 * 60_000), "TEST_MODE_BLOCKED_OUTBOUND");
  return true;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function conversationKey(job: QueueJob) {
  const eventPhone = (job.payload.event as { phone?: unknown } | undefined)?.phone;
  const phone =
    typeof job.payload.phone === "string"
      ? job.payload.phone
      : typeof eventPhone === "string"
        ? eventPhone
        : null;
  return phone
    ? `phone:${phone}`
    : typeof job.payload.leadId === "string"
      ? `lead:${job.payload.leadId}`
      : null;
}
class DeferredJobError extends Error {
  constructor(
    message: string,
    public readonly retryAt: Date,
    public readonly payloadPatch?: Record<string, unknown>,
  ) {
    super(message);
  }
}
class NonRetryableJobError extends Error {}
class TestModeBlockedOutboundError extends Error {}
function retryDelayMs(attempts: number) {
  const base = Math.min(3_600_000, 15_000 * 2 ** Math.max(0, attempts - 1));
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

async function acquireInstanceLock() {
  if (!serviceDb) {
    const lockPath = workerConfig.MOCK_DB_PATH
      ? `${workerConfig.MOCK_DB_PATH}.worker.lock`
      : path.resolve(".runtime", "worker.lock");
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    try {
      localWorkerLockDescriptor = fs.openSync(lockPath, "wx");
      fs.writeFileSync(
        localWorkerLockDescriptor,
        `${process.pid}\n${instanceId}\n${new Date().toISOString()}`,
        "utf8",
      );
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const raw = fs.readFileSync(lockPath, "utf8");
        const pid = Number(raw.split(/\r?\n/)[0]);
        if (pid && !processExists(pid)) fs.unlinkSync(lockPath);
        else return false;
      } catch {
        return false;
      }
      localWorkerLockDescriptor = fs.openSync(lockPath, "wx");
      fs.writeFileSync(
        localWorkerLockDescriptor,
        `${process.pid}\n${instanceId}\n${new Date().toISOString()}`,
        "utf8",
      );
      return true;
    }
  }
  const { data, error } = await serviceDb.rpc("acquire_worker_lock", {
    p_owner: await getOwnerId(),
    p_instance_id: instanceId,
    p_worker_type: "main",
    p_ttl_seconds: Math.ceil(workerConfig.WORKER_HEARTBEAT_MS / 1000) * 3,
  });
  if (error) throw error;
  return Boolean(data);
}
async function heartbeat() {
  if (!serviceDb) {
    fs.mkdirSync(path.dirname(localHeartbeatPath), { recursive: true });
    fs.writeFileSync(
      localHeartbeatPath,
      JSON.stringify({
        instanceId,
        pid: process.pid,
        status: "online",
        lastHeartbeatAt: new Date().toISOString(),
      }),
      "utf8",
    );
    log.debug({ instanceId }, "worker_heartbeat_mock");
    return;
  }
  const { data, error } = await serviceDb.rpc("heartbeat_worker", {
    p_instance_id: instanceId,
    p_ttl_seconds: Math.ceil(workerConfig.WORKER_HEARTBEAT_MS / 1000) * 3,
  });
  if (error || !data) throw error ?? new Error("Lock do worker expirou.");
}
async function releaseInstanceLock() {
  if (!serviceDb) {
    if (localWorkerLockDescriptor !== null) {
      try {
        fs.closeSync(localWorkerLockDescriptor);
      } catch {
        /* já fechado */
      }
      localWorkerLockDescriptor = null;
      try {
        fs.unlinkSync(path.resolve(".runtime", "worker.lock"));
      } catch {
        /* lock já removido */
      }
    }
    try {
      fs.unlinkSync(localHeartbeatPath);
    } catch {
      /* heartbeat já removido */
    }
    return;
  }
  const { error } = await serviceDb.rpc("release_worker_lock", { p_instance_id: instanceId });
  if (error) log.error({ err: error }, "worker_lock_release_failed");
}

function processExists(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

let ownerIdCache: string | null = null;
async function getOwnerId() {
  if (ownerIdCache) return ownerIdCache;
  if (!serviceDb) throw new Error("Banco não configurado.");
  const { data, error } = await serviceDb
    .from("profiles")
    .select("id")
    .eq("role", "admin")
    .order("created_at", { ascending: true })
    .limit(1)
    .single();
  if (error || !data?.id) throw new Error("Administrador não encontrado. Execute o seed.");
  ownerIdCache = data.id as string;
  return ownerIdCache;
}
async function recordOutreachFailure(leadId: string) {
  if (!serviceDb) return;
  const ownerId = await getOwnerId();
  const current = await serviceDb
    .from("leads")
    .select("consecutive_failures,metadata")
    .eq("owner_id", ownerId)
    .eq("id", leadId)
    .single();
  const failures = Number(current.data?.consecutive_failures ?? 0) + 1;
  const settings = outreachSettingsSchema.parse(await repository.getSettings("outreach"));
  const quarantine = settings.autoPause && failures >= settings.maxConsecutiveFailures;
  const metadata =
    current.data?.metadata && typeof current.data.metadata === "object"
      ? { ...(current.data.metadata as Record<string, unknown>) }
      : {};
  if (quarantine) metadata.outreachQuarantined = true;
  await serviceDb
    .from("leads")
    .update({ consecutive_failures: failures, metadata })
    .eq("owner_id", ownerId)
    .eq("id", leadId);
  await repository.audit(quarantine ? "outreach.lead_quarantined" : "outreach.lead_failure", "lead", leadId, {
    failures,
    maxConsecutiveFailures: settings.maxConsecutiveFailures,
    globalPauseChanged: false,
  });
}

function presenceState(raw: Record<string, unknown>): "online" | "offline" | "unknown" {
  const data = (raw.data ?? raw) as Record<string, unknown>;
  const presences = (data.presences ?? data.presence ?? data.status) as unknown;
  const text = JSON.stringify(presences ?? "").toLocaleLowerCase("pt-BR");
  if (/unavailable|offline/.test(text)) return "offline";
  if (/available|composing|recording/.test(text)) return "online";
  return "unknown";
}

function nextCommercialSlot(
  from: Date,
  settings: { timezone: string; weekdays: number[]; startTime: string; endTime: string },
) {
  const candidate = new Date(from.getTime() + 60_000);
  for (let index = 0; index < 7 * 24 * 2; index += 1) {
    if (canStartOutreach(candidate, settings as any)) return candidate;
    candidate.setMinutes(candidate.getMinutes() + 30);
  }
  return new Date(from.getTime() + 24 * 60 * 60_000);
}

function isScopedOnlineTestJob(job: QueueJob) {
  return isControlledOutreachTestJob(
    jobPhone(job),
    workerConfig.OUTREACH_ONLINE_ONLY,
    workerConfig.OUTREACH_ONLINE_TEST_PHONE,
  );
}

function jobPhone(job: QueueJob) {
  const event = (job.payload.event ?? {}) as NormalizedWhatsAppEvent;
  return typeof job.payload.phone === "string" ? job.payload.phone : (event.phone ?? null);
}

function commercialMemoryUpdates(text: string, snapshot: AgentSnapshot): AiDecision["memoryUpdates"] {
  const normalized = text
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const updates: AiDecision["memoryUpdates"] = [];
  const informedName = text.match(
    /\b(?:me chamo|meu nome (?:é|e)|pode me chamar de)\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ'-]{1,30}(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'-]{1,30})?)/i,
  )?.[1];
  if (informedName)
    updates.push({
      key: "informed_name",
      value: informedName.trim(),
      evidenceType: "explicit",
      confidence: 1,
    });
  const previousQuestion =
    [...snapshot.messages]
      .reverse()
      .find((message) => (message.role === "agent" || message.role === "human") && message.text.includes("?"))
      ?.text ?? "";
  const compactAnswer = text.trim().split(/\r?\n/)[0]?.trim() ?? "";
  if (
    !informedName &&
    /(?:como posso te chamar|qual (?:e|é) (?:o )?seu nome|aliás,? qual (?:e|é) (?:o )?seu nome)/i.test(
      previousQuestion,
    ) &&
    /^[A-Za-zÀ-ÿ'-]{2,30}(?:\s+[A-Za-zÀ-ÿ'-]{2,30})?$/.test(compactAnswer)
  )
    updates.push({ key: "informed_name", value: compactAnswer, evidenceType: "explicit", confidence: 1 });
  if (
    /(?:qual (?:e|é) o nome da (?:sua )?(?:otica|ótica|loja)|como chama a (?:sua )?(?:otica|ótica|loja))/i.test(
      previousQuestion,
    ) &&
    compactAnswer.length >= 2 &&
    compactAnswer.length <= 100
  )
    updates.push({ key: "store_name", value: compactAnswer, evidenceType: "explicit", confidence: 1 });
  if (isIrritatedTurn(text))
    updates.push({ key: "preferred_tone", value: "direct", evidenceType: "explicit", confidence: 1 });
  if (/(?:n[aã]o sei (?:o )?n[uú]mero exato|muitos?|bastante)/.test(normalized))
    updates.push(
      { key: "impact", value: "Volume alto, não quantificado", evidenceType: "explicit", confidence: 1 },
      {
        key: "answered_questions",
        value: "volume informado sem quantidade exata",
        evidenceType: "explicit",
        confidence: 1,
      },
    );
  if (
    /\b(?:quero ver|tenho interesse|me interessa|faz sentido|vamos avançar|pode mostrar)\b/.test(normalized)
  )
    updates.push({
      key: "interest",
      value: "Demonstrou interesse em avançar",
      evidenceType: "explicit",
      confidence: 1,
    });
  if (/planilha/.test(normalized) || /papel|caderno/.test(normalized))
    updates.push({
      key: "current_system",
      value: "Planilha e papel/caderno",
      evidenceType: "explicit",
      confidence: 1,
    });
  else if (
    /(?:ja uso|uso|tenho|trabalho com).{0,24}(?:sistema|software|programa)/.test(normalized) ||
    /sistema (?:de gestao|para otica)/.test(normalized)
  )
    updates.push({
      key: "current_system",
      value: "Já utiliza um sistema de gestão",
      evidenceType: "explicit",
      confidence: 1,
    });
  if (/vende?m? bem|vendemos bem|a gente vende bem/.test(normalized) && /controle/.test(normalized))
    updates.push({
      key: "main_pain",
      value: "Vendem bem, mas não têm controle da operação",
      evidenceType: "explicit",
      confidence: 1,
    });
  const state = deriveConversationState(snapshot, text);
  if (
    isOwnerRoleAnswer(text, previousQuestion) ||
    (state.answerToQuestion &&
      /\b(?:dono|responsavel|funcao|cargo|decisor)\b/.test(
        state.answerToQuestion
          .toLocaleLowerCase("pt-BR")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, ""),
      ))
  ) {
    updates.push(
      {
        key: "decision_maker",
        value: "É dono ou responsável pela ótica",
        evidenceType: "explicit",
        confidence: 1,
      },
      { key: "professional_category", value: "owner_responsible", evidenceType: "explicit", confidence: 1 },
      {
        key: "answered_questions",
        value: "função de dono ou responsável",
        evidenceType: "explicit",
        confidence: 1,
      },
    );
  }
  return updates;
}

function mergeMemoryUpdates(current: AgentSnapshot["memories"], updates: AgentSnapshot["memories"]) {
  return new ConversationMemoryService().merge(current, updates);
}
function mergeDecisionMemoryUpdates(updates: AiDecision["memoryUpdates"]): AiDecision["memoryUpdates"] {
  const merged = new Map<AiDecision["memoryUpdates"][number]["key"], AiDecision["memoryUpdates"][number]>();
  for (const item of updates) {
    merged.delete(item.key);
    merged.set(item.key, item);
  }
  return [...merged.values()].slice(-16);
}

function mergeAskedQuestions(previous: unknown, replyText: string | null | undefined) {
  const prior = Array.isArray(previous) ? previous.map(String) : [];
  if (!replyText?.trim()) return prior;
  const asked =
    replyText
      .match(/[^?\n.!]*\?/g)
      ?.map((question) => question.trim())
      .filter((question) => {
        const normalized = question
          .toLocaleLowerCase("pt-BR")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");
        return question.length >= 4 && !/^(?:o que aconteceu|como assim)\?$/.test(normalized);
      }) ?? [];
  return [...new Set([...prior, ...asked])].slice(-80);
}

await runWorker();
