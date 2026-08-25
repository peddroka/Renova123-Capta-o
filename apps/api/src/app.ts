import crypto from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import net from "node:net";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import rateLimit from "@fastify/rate-limit";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  decryptSecret,
  encryptSecret,
  FRANCISCO_HOURS,
  isProactiveWindow,
  maskSecret,
  normalizeBrazilianPhone,
  parsePhoneList,
} from "@renova123/core";
import { createRepository, type EditableResourceKey, type Repository } from "@renova123/database";
import {
  EvolutionWhatsAppProvider,
  GroqProvider,
  GroqProviderError,
  MockWhatsAppProvider,
  type WhatsAppProvider,
} from "@renova123/integrations";
import { importBatchSchema, leadStages, outreachSettingsSchema, type PageKey } from "@renova123/shared";
import { z } from "zod";
import { config } from "./config.js";
import { THE_WOLF_SYSTEM_PROMPT } from "./the-wolf-prompt.js";
import { WolfRealtimeSession, type WolfSpeaker } from "./wolf-realtime.js";

const execFileAsync = promisify(execFile);
const wolfExtensionToken = crypto
  .createHmac("sha256", config.ENCRYPTION_KEY)
  .update("the-wolf-extension-v1")
  .digest("hex");

declare module "fastify" {
  interface FastifyRequest {
    userId: string | null;
  }
}

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(100).optional(),
  stage: z.string().max(40).optional(),
  status: z.string().max(40).optional(),
});

type SupabaseErrorLike = { code?: string; message?: string } | null | undefined;

function isMissingAgentSchema(error: SupabaseErrorLike) {
  const message = String(error?.message ?? "").toLowerCase();
  return (
    error?.code === "42703" ||
    error?.code === "42p01" ||
    message.includes("agent_id") ||
    message.includes('relation "agents" does not exist')
  );
}

async function readFranciscoDailyUsage(client: SupabaseClient, ownerId: string, localDate: string) {
  const agentResult = await client
    .from("agents")
    .select("agent_id")
    .eq("owner_id", ownerId)
    .eq("slug", "francisco")
    .maybeSingle();

  if (agentResult.error && !isMissingAgentSchema(agentResult.error)) throw agentResult.error;
  const agentId = agentResult.data?.agent_id as string | undefined;

  if (agentId) {
    const scoped = await client
      .from("daily_usage")
      .select("outreach_count,agent_id")
      .eq("owner_id", ownerId)
      .eq("usage_date", localDate)
      .eq("agent_id", agentId);
    if (!scoped.error)
      return (scoped.data ?? []).reduce((sum, row) => sum + Number(row.outreach_count ?? 0), 0);
    if (!isMissingAgentSchema(scoped.error)) throw scoped.error;
  }

  // Compatibility path for production databases predating the agent_id migration.
  const legacy = await client
    .from("daily_usage")
    .select("outreach_count")
    .eq("owner_id", ownerId)
    .eq("usage_date", localDate);
  if (legacy.error) throw legacy.error;
  return (legacy.data ?? []).reduce((sum, row) => sum + Number(row.outreach_count ?? 0), 0);
}

function buildWolfLiveContext(transcript: Array<Record<string, unknown>>) {
  const text = transcript.map((turn) => String(turn.text ?? "")).join(" ");
  const clientText = transcript
    .filter((turn) => turn.speaker === "client")
    .map((turn) => String(turn.text ?? ""))
    .join(" ");
  const operatorText = transcript
    .filter((turn) => turn.speaker === "operator")
    .map((turn) => String(turn.text ?? ""))
    .join(" ");
  const system = text
    .match(/sistema\s+(?:chamado\s+|é\s+|e\s+)?([A-Za-zÀ-ÿ0-9][\wÀ-ÿ0-9 ]{1,40})/i)?.[1]
    ?.trim();
  const pain = clientText
    .match(/(equipe[^.?!]{0,100}(?:acompanhar|acompanhamento|follow[- ]?up)[^.?!]*)/i)?.[1]
    ?.trim();
  const frequency = clientText.match(
    /(quase todo dia|todos os dias|diariamente|às vezes|sempre|nunca)/i,
  )?.[1];
  const objections = clientText
    .match(/(não quero[^.?!]{0,120}|preciso conversar[^.?!]{0,120})/i)?.[1]
    ?.trim();
  const questionsAsked = [...operatorText.matchAll(/[^.?!]*\?/g)]
    .map((match) => match[0].trim())
    .filter(Boolean)
    .slice(-10);
  return {
    leadFacts: [],
    liveSummary: [
      system ? `Sistema atual: ${system}` : "",
      pain ? `Dor: ${pain}` : "",
      frequency ? `Frequência: ${frequency}` : "",
    ]
      .filter(Boolean)
      .join(" "),
    recentTurns: transcript.slice(-12),
    painPoints: pain ? [pain] : [],
    objections: objections ? [objections] : [],
    competitors: system ? [system] : [],
    commitments: [],
    questionsAsked,
    openQuestions: [],
    salesStage: objections ? "objection" : pain ? "discovery" : "opening",
    currentClientTurn: transcript.at(-1)?.speaker === "client" ? transcript.at(-1)?.text : "",
  };
}

export async function buildApp(
  overrides: { repository?: Repository; whatsappProvider?: WhatsAppProvider } = {},
) {
  const app = Fastify({
    // Production traffic reaches the API through Nginx.
    trustProxy: config.TRUST_PROXY,
    rewriteUrl: (request) => {
      const url = request.url ?? "/";
      if (url === "/api") return "/";
      return url.startsWith("/api/") ? url.slice(4) : url;
    },
    logger: {
      level: config.LOG_LEVEL,
      redact: ["req.headers.authorization", "req.headers.apikey", "*.apiKey", "*.password", "*.token"],
    },
    bodyLimit: 2 * 1024 * 1024,
  });
  const repository =
    overrides.repository ??
    createRepository({
      mock: config.MOCK_MODE,
      supabaseUrl: config.SUPABASE_URL || undefined,
      serviceRoleKey: config.SUPABASE_SERVICE_ROLE_KEY,
      mockFilePath: process.env.NODE_ENV === "test" ? null : process.env.MOCK_DB_PATH,
    });
  const authClient = createAuthClient();
  const serviceDb = createServiceClient();
  const connectionWhatsapp: WhatsAppProvider =
    overrides.whatsappProvider ??
    (config.MOCK_EVOLUTION
      ? new MockWhatsAppProvider({
          instanceName: config.EVOLUTION_INSTANCE_NAME,
          webhookSecret: config.WEBHOOK_SECRET,
        })
      : new EvolutionWhatsAppProvider({
          baseUrl: config.EVOLUTION_API_URL,
          apiKey: config.EVOLUTION_API_KEY,
          instanceName: config.EVOLUTION_INSTANCE_NAME,
          webhookUrl: config.EVOLUTION_WEBHOOK_URL,
          webhookSecret: config.WEBHOOK_SECRET,
        }));
  const pedroWhatsapp: WhatsAppProvider = config.MOCK_EVOLUTION
    ? new MockWhatsAppProvider({
        instanceName: config.EVOLUTION_PEDRO_INSTANCE_NAME,
        webhookSecret: config.PEDRO_WEBHOOK_SECRET,
      })
    : new EvolutionWhatsAppProvider({
        baseUrl: config.EVOLUTION_API_URL,
        apiKey: config.EVOLUTION_API_KEY,
        instanceName: config.EVOLUTION_PEDRO_INSTANCE_NAME,
        webhookUrl: config.EVOLUTION_WEBHOOK_URL,
        webhookSecret: config.PEDRO_WEBHOOK_SECRET,
      });
  const whatsappAgents = {
    francisco: {
      slug: "francisco",
      name: "Francisco",
      instanceName: config.EVOLUTION_INSTANCE_NAME,
      provider: connectionWhatsapp,
      webhookSecret: config.WEBHOOK_SECRET,
    },
    pedro: {
      slug: "pedro",
      name: "Pedro",
      instanceName: config.EVOLUTION_PEDRO_INSTANCE_NAME,
      provider: pedroWhatsapp,
      webhookSecret: config.PEDRO_WEBHOOK_SECRET,
    },
  } as const;
  const agentSlugSchema = z.enum(["francisco", "pedro"]);
  const agentForRequest = (request: FastifyRequest) => {
    const slug = agentSlugSchema.parse((request.params as { agentSlug?: string }).agentSlug);
    return whatsappAgents[slug];
  };
  const outboundWhatsapp: WhatsAppProvider =
    overrides.whatsappProvider ??
    (config.SIMULATION_MODE || !config.REAL_SENDING_ENABLED
      ? new MockWhatsAppProvider({
          instanceName: config.EVOLUTION_INSTANCE_NAME,
          webhookSecret: config.WEBHOOK_SECRET,
        })
      : connectionWhatsapp);
  const publicConnectionStatus = async () => ({
    ...(await connectionWhatsapp.getConnectionStatus()),
    simulation: config.SIMULATION_MODE || !config.REAL_SENDING_ENABLED,
  });
  const agentConnectionStatus = async (agent: (typeof whatsappAgents)[keyof typeof whatsappAgents]) => ({
    ...(await agent.provider.getConnectionStatus()),
    simulation: agent.slug === "pedro" || config.SIMULATION_MODE || !config.REAL_SENDING_ENABLED,
  });
  const agentPairing = async (
    agent: (typeof whatsappAgents)[keyof typeof whatsappAgents],
    includeQr = false,
  ) => {
    const status = await agentConnectionStatus(agent);
    const qr = includeQr && status.state === "connecting" ? await agent.provider.getQrCode() : null;
    return {
      agent: agent.slug,
      name: agent.name,
      evolution: status.state === "unavailable" ? "offline" : "online",
      instanceName: status.instanceName,
      state: status.state,
      number: status.number,
      available: status.available,
      circuit: status.circuit,
      simulation: status.simulation,
      lastConnectionAt: status.lastConnectionAt,
      lastEventAt: status.lastEventAt,
      webhook: config.EVOLUTION_WEBHOOK_URL ? "ok" : "error",
      qr: qr?.code ?? null,
      pairingCode: qr?.pairingCode ?? null,
      qrCount: qr?.count ?? null,
      qrExpiresAt: qr?.expiresAt ?? null,
      updatedAt: new Date().toISOString(),
    };
  };

  await app.register(helmet, { contentSecurityPolicy: false });
  const allowedOrigins = [
    ...new Set([
      config.APP_URL,
      config.APP_URL.replace("127.0.0.1", "localhost"),
      config.APP_URL.replace("localhost", "127.0.0.1"),
    ]),
  ];
  if (process.env.WOLF_EXTENSION_ID)
    allowedOrigins.push(`chrome-extension://${process.env.WOLF_EXTENSION_ID}`);
  await app.register(cors, {
    origin: (origin, callback) => {
      const allowed =
        !origin ||
        allowedOrigins.includes(origin) ||
        (origin.startsWith("chrome-extension://") && !process.env.WOLF_EXTENSION_ID);
      callback(null, allowed);
    },
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
  await app.register(rateLimit, {
    max: config.MOCK_MODE ? 2_000 : 120,
    timeWindow: "1 minute",
    allowList: (request) =>
      request.method === "OPTIONS" || request.url === "/health" || request.url === "/health/live",
  });
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
  await app.register(websocket);
  app.decorateRequest("userId", null);

  const wolfSessions = new Map<string, WolfRealtimeSession>();
  const wolfSockets = new Map<string, Set<{ readyState: number; send: (value: string) => void }>>();
  const wolfGeneration = new Map<string, number>();
  const wolfPartials = new Map<string, string>();
  let wolfGatewayConnected = false;
  let wolfGatewayFrames = 0;
  let wolfGatewayBytes = 0;
  let wolfLastAudioAt = 0;
  let wolfGatewayLastRms = 0;
  let wolfGatewayLastPeak = 0;
  let wolfGatewayDevice = "";
  let wolfClientPreflightSocket: {
    readyState: number;
    send: (value: string) => void;
    close: () => void;
  } | null = null;
  let wolfClientPreflightSession: WolfRealtimeSession | null = null;
  let wolfHelperProcess: ChildProcess | null = null;
  let wolfOllamaProcess: ChildProcess | null = null;
  let wolfOllamaOwned = false;
  let wolfQwenWarm = false;
  let wolfHelperDeviceId = process.env.WOLF_AUDIO_DEVICE_ID ?? "";
  const ensureWolfHelper = () => {
    if (
      config.NODE_ENV === "test" ||
      process.platform !== "win32" ||
      wolfGatewayConnected ||
      wolfHelperProcess
    )
      return;
    const projectRoot = existsSync(path.resolve(process.cwd(), "tools"))
      ? process.cwd()
      : path.resolve(process.cwd(), "../..");
    const dll = path.resolve(
      projectRoot,
      "tools",
      "wolf-audio-helper",
      "bin",
      "Release",
      "net8.0-windows",
      "WolfAudioHelper.dll",
    );
    if (!existsSync(dll)) return;
    const helperArgs = [
      dll,
      "--compatibility",
      "--host",
      "127.0.0.1",
      "--port",
      String(process.env.WOLF_AUDIO_PORT ?? 3344),
    ];
    if (wolfHelperDeviceId) helperArgs.push("--device-id", wolfHelperDeviceId);
    wolfHelperProcess = spawn("dotnet", helperArgs, { cwd: projectRoot, stdio: "ignore", windowsHide: true });
    wolfHelperProcess.once("exit", () => {
      wolfHelperProcess = null;
      setTimeout(ensureWolfHelper, 1000);
    });
  };
  const appendWolfTurn = async (callId: string, speaker: WolfSpeaker, text: string, at: string) => {
    const page = await repository.page("wolfCalls", { page: 1, pageSize: 100 });
    const call = page.rows.find((row) => String(row.id) === callId);
    if (!call || call.status !== "listening") return;
    const sequence = Array.isArray(call.transcript) ? call.transcript.length : 0;
    const createdTurn = await repository.createResource("wolfTurns", {
      callId,
      speaker,
      text,
      sequence,
      startedAt: at,
      endedAt: at,
      partial: false,
    });
    const transcript = Array.isArray(call.transcript) ? call.transcript : [];
    transcript.push({ speaker, text, timestamp: at, sequence });
    await repository.updateResource("wolfCalls", callId, { transcript });
    const liveContext = buildWolfLiveContext(transcript);
    await repository.updateResource("wolfCalls", callId, { liveContext });
    return createdTurn;
  };
  const wolfAudioServer = net.createServer((connection) => {
    wolfGatewayConnected = true;
    connection.on("error", (error) => {
      app.log.warn({ err: error }, "wolf_gateway_connection_closed");
    });
    let callId = "";
    let statusReceived = false;
    let buffer = Buffer.alloc(0);
    let session: WolfRealtimeSession | undefined;
    connection.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length) {
        if (!statusReceived) {
          const newline = buffer.indexOf(10);
          if (newline < 0) return;
          try {
            const status = JSON.parse(buffer.subarray(0, newline).toString()) as {
              type?: string;
              callId?: string;
              device?: string;
              source?: string;
            };
            callId = status.callId ?? "";
            wolfGatewayDevice = status.device ?? wolfGatewayDevice;
            statusReceived = status.type === "status";
            const connect = () => {
              if (callId && (config.WOLF_TRANSCRIPTION_PROVIDER === "local" || config.OPENAI_API_KEY)) {
                session = new WolfRealtimeSession(
                  config.WOLF_TRANSCRIPTION_MODEL,
                  "client",
                  (event) => {
                    if (event.kind === "final") void appendWolfTurn(callId, "client", event.text, event.at);
                  },
                  () => undefined,
                  config.WOLF_TRANSCRIPTION_PROVIDER === "local"
                    ? config.WOLF_LOCAL_TRANSCRIPTION_URL
                    : undefined,
                  `${callId}:client`,
                );
                session.open(config.OPENAI_API_KEY);
              }
            };
            if (status.type === "status" && !callId) {
              void repository.page("wolfCalls", { page: 1, pageSize: 20 }).then((page) => {
                const active = page.rows.find((row) => row.status === "listening");
                if (active) callId = String(active.id);
                connect();
              });
            } else if (status.type === "status") connect();
          } catch {
            /* wait for the next valid status line */
          }
          buffer = buffer.subarray(newline + 1);
          continue;
        }
        if (buffer.length < 4) return;
        const length = buffer.readInt32LE(0);
        if (length < 1 || length > 2_000_000) {
          connection.destroy();
          return;
        }
        if (buffer.length < length + 4) return;
        wolfGatewayFrames += 1;
        wolfGatewayBytes += length;
        wolfLastAudioAt = Date.now();
        let sum = 0;
        let peak = 0;
        for (let offset = 4; offset + 1 < length + 4; offset += 2) {
          const sample = buffer.readInt16LE(offset) / 32768;
          sum += sample * sample;
          peak = Math.max(peak, Math.abs(sample));
        }
        wolfGatewayLastRms = Math.sqrt(sum / Math.max(1, length / 2));
        wolfGatewayLastPeak = peak;
        if (
          wolfClientPreflightSocket?.readyState === 1 &&
          (wolfGatewayFrames === 1 || wolfGatewayFrames % 25 === 0)
        )
          wolfClientPreflightSocket.send(
            JSON.stringify({
              type: "gateway_diagnostic",
              frames: wolfGatewayFrames,
              bytes: wolfGatewayBytes,
              audioBytes: length,
            }),
          );
        (session ?? wolfClientPreflightSession)?.append(buffer.subarray(4, length + 4));
        buffer = buffer.subarray(length + 4);
      }
    });
    connection.on("close", () => {
      wolfGatewayConnected = false;
      session?.close();
      wolfClientPreflightSession?.close();
      wolfClientPreflightSession = null;
      setTimeout(ensureWolfHelper, 1000);
    });
  });
  if (config.NODE_ENV !== "test" && !process.env.VERCEL)
    await new Promise<void>((resolve) =>
      wolfAudioServer.listen(Number(process.env.WOLF_AUDIO_PORT ?? 3344), "127.0.0.1", () => resolve()),
    );
  setTimeout(ensureWolfHelper, 750);
  app.addHook("onClose", async () => {
    for (const session of wolfSessions.values()) session.close();
    wolfAudioServer.close();
  });

  app.get("/health", { config: { rateLimit: false } }, async () => {
    let worker: { status: string; lastHeartbeatAt?: string } = {
      status: config.MOCK_MODE ? "mock" : "unknown",
    };
    let scheduler: { status: string; lastHeartbeatAt?: string } = {
      status: config.MOCK_MODE ? "mock" : "unknown",
    };
    let queue = { pending: 0, failed: 0 };
    let messages = { lastInboundAt: null as string | null, lastOutboundAt: null as string | null };
    let dailyUsageToday = 0;
    if (serviceDb) {
      const heartbeat = await serviceDb
        .from("worker_heartbeats")
        .select("status,last_heartbeat_at,lock_expires_at")
        .order("last_heartbeat_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!heartbeat.error && heartbeat.data)
        worker = {
          status:
            new Date(heartbeat.data.lock_expires_at).getTime() > Date.now() ? heartbeat.data.status : "stale",
          lastHeartbeatAt: heartbeat.data.last_heartbeat_at,
        };
      const owner = await serverOwnerId(serviceDb);
      const [pending, failed, inbound, outbound] = await Promise.all([
        serviceDb
          .from("jobs")
          .select("id", { count: "exact", head: true })
          .eq("owner_id", owner)
          .eq("status", "pending"),
        serviceDb.from("failed_jobs").select("id", { count: "exact", head: true }).eq("owner_id", owner),
        serviceDb
          .from("messages")
          .select("received_at,created_at")
          .eq("owner_id", owner)
          .eq("direction", "inbound")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        serviceDb
          .from("messages")
          .select("sent_at,created_at")
          .eq("owner_id", owner)
          .eq("direction", "outbound")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      queue = { pending: pending.count ?? 0, failed: failed.count ?? 0 };
      messages = {
        lastInboundAt: inbound.data?.received_at ?? inbound.data?.created_at ?? null,
        lastOutboundAt: outbound.data?.sent_at ?? outbound.data?.created_at ?? null,
      };
      const localDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: FRANCISCO_HOURS.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      dailyUsageToday = await readFranciscoDailyUsage(serviceDb, owner, localDate);
      scheduler = worker;
    } else if (config.MOCK_MODE) {
      const configuredHeartbeat = `${process.env.MOCK_DB_PATH ?? ".runtime/mock-db.json"}.worker-heartbeat.json`;
      const heartbeatCandidates = [
        path.resolve(configuredHeartbeat),
        path.resolve(process.cwd(), "../..", configuredHeartbeat),
        path.resolve(process.cwd(), "../../..", configuredHeartbeat),
      ];
      const heartbeatPath =
        heartbeatCandidates.find((candidate) => existsSync(candidate)) ?? heartbeatCandidates[0]!;
      try {
        const local = JSON.parse(readFileSync(heartbeatPath, "utf8")) as {
          status?: string;
          lastHeartbeatAt?: string;
        };
        const ageMs = local.lastHeartbeatAt
          ? Date.now() - Date.parse(local.lastHeartbeatAt)
          : Number.POSITIVE_INFINITY;
        const status = ageMs <= 30_000 ? "online" : "stale";
        worker = { status, ...(local.lastHeartbeatAt ? { lastHeartbeatAt: local.lastHeartbeatAt } : {}) };
        scheduler = worker;
      } catch {
        worker = { status: "offline" };
        scheduler = { status: "offline" };
      }
    }
    const [outreach, general] = await Promise.all([
      repository.getSettings("outreach"),
      repository.getSettings("general"),
    ]);
    const started = Date.now();
    const whatsappState = await connectionWhatsapp
      .getConnectionStatus()
      .catch(() => ({ state: "unavailable" }));
    const dailyLimit = Number(
      outreach.newLeadsDailyLimit ?? outreach.dailyProactiveLimit ?? outreach.dailyLimit ?? 50,
    );
    const proactiveWindowOpen = isProactiveWindow(FRANCISCO_HOURS);
    const workerHealthy = ["online", "running", "mock"].includes(worker.status);
    const proactiveState = !workerHealthy
      ? "worker_offline"
      : whatsappState.state !== "open" && whatsappState.state !== "mock"
        ? "whatsapp_not_open"
        : config.SIMULATION_MODE || !config.REAL_SENDING_ENABLED
          ? "real_sending_blocked"
          : !config.OUTREACH_ENABLED || outreach.enabled !== true
            ? "outreach_disabled"
            : general.globalPause === true
              ? "global_pause"
              : general.automationEnabled === false
                ? "automation_disabled"
                : !proactiveWindowOpen
                  ? "outside_proactive_window"
                  : dailyUsageToday >= dailyLimit
                    ? "daily_quota_exhausted"
                    : "active";
    return {
      status: "ok",
      time: new Date().toISOString(),
      mode: config.MOCK_MODE ? "mock" : "supabase",
      latencyMs: Date.now() - started,
      simulationMode: config.SIMULATION_MODE || !config.REAL_SENDING_ENABLED,
      outreachEnabled: config.OUTREACH_ENABLED,
      automationActive:
        config.OUTREACH_ENABLED && general.globalPause !== true && general.automationEnabled !== false,
      usage: {
        dailyLimit,
        today: dailyUsageToday,
        remaining: Math.max(0, dailyLimit - dailyUsageToday),
      },
      proactive: {
        state: proactiveState,
        windowOpen: proactiveWindowOpen,
        window: `${FRANCISCO_HOURS.outreachStart}-${FRANCISCO_HOURS.outreachEnd}`,
        timezone: FRANCISCO_HOURS.timezone,
      },
      queue,
      messages,
      services: {
        frontend: "reachable",
        api: "healthy",
        database: config.MOCK_MODE ? "mock" : "configured",
        storage: config.MOCK_MODE ? "mock" : "configured",
        groq: config.MOCK_GROQ ? "mock" : config.GROQ_API_KEY ? "configured" : "not_configured",
        evolution: config.MOCK_EVOLUTION ? "mock" : config.EVOLUTION_API_KEY ? "configured" : "simulation",
        whatsapp: whatsappState.state,
        worker,
        scheduler,
      },
    };
  });

  app.get("/health/live", { config: { rateLimit: false } }, async () => ({
    ok: true,
    service: "api",
    uptime: process.uptime(),
  }));

  app.post(
    "/auth/login",
    {
      config: {
        rateLimit: config.MOCK_MODE
          ? { max: 200, timeWindow: "1 minute" }
          : { max: 8, timeWindow: "10 minutes" },
      },
    },
    async (request, reply) => {
      const body = z
        .object({ email: z.string().email(), password: z.string().min(6).max(200) })
        .parse(request.body);
      if (config.MOCK_MODE) {
        if (body.email !== "admin@renova123.local" || body.password !== "renova123")
          return reply.code(401).send({ message: "Credenciais inválidas." });
        return { accessToken: "mock-admin-token", user: { id: "mock-admin", email: body.email } };
      }
      if (!authClient) return reply.code(503).send({ message: "Supabase Auth não configurado." });
      const { data, error } = await authClient.auth.signInWithPassword(body);
      if (error || !data.session) return reply.code(401).send({ message: "Credenciais inválidas." });
      return {
        accessToken: data.session.access_token,
        expiresAt: data.session.expires_at,
        user: { id: data.user.id, email: data.user.email },
      };
    },
  );

  app.get("/auth/me", { preHandler: requireAuth(authClient) }, async (request) => ({ id: request.userId }));
  app.get("/auth/session", { preHandler: requireAuth(authClient) }, async (request) => ({
    authenticated: true,
    user: { id: request.userId },
  }));

  app.get("/wolf/audio/capabilities", { preHandler: requireAuth(authClient) }, async () => ({
    operatingSystem: process.platform,
    provider: config.WOLF_TRANSCRIPTION_PROVIDER,
    helper: {
      available: process.platform === "win32",
      isolation: "unavailable",
      compatibilityLoopback: process.platform === "win32",
      state: wolfGatewayConnected ? "receiving" : "disconnected",
      gatewayConnected: wolfGatewayConnected,
      audioFrames: wolfGatewayFrames,
      audioBytes: wolfGatewayBytes,
      audioReceiving: wolfLastAudioAt > Date.now() - 2_000,
      device: wolfGatewayDevice || "não informado",
      lastRms: wolfGatewayLastRms,
      lastPeak: wolfGatewayLastPeak,
      lastFrameAgeMs: wolfLastAudioAt ? Date.now() - wolfLastAudioAt : null,
    },
    transcription: {
      model:
        config.WOLF_TRANSCRIPTION_PROVIDER === "local"
          ? config.WOLF_LOCAL_TRANSCRIPTION_MODEL
          : config.WOLF_TRANSCRIPTION_MODEL,
      provider: config.WOLF_TRANSCRIPTION_PROVIDER,
      delay: config.WOLF_TRANSCRIPTION_DELAY,
      language: "pt",
    },
    devices: { microphone: "browser_permission_required", output: "helper_required" },
  }));
  app.get("/wolf/session/active", async () => {
    const sessions = await repository.page("wolfCalls", { page: 1, pageSize: 10000 });
    const session = sessions.rows
      .filter((row) => ["preparing", "listening", "paused"].includes(String(row.status)))
      .sort(
        (a, b) =>
          Date.parse(String(b.updatedAt ?? b.createdAt ?? 0)) -
          Date.parse(String(a.updatedAt ?? a.createdAt ?? 0)),
      )[0];
    if (!session) return { extensionToken: wolfExtensionToken, session: null };
    const context = session.liveContext as {
      testSession?: boolean;
      standalone?: boolean;
      phone?: string;
      displayName?: string;
      businessName?: string;
      matchedLeadId?: string | null;
    } | null;
    if (context?.testSession || context?.standalone) {
      const phone = String(context.phone ?? "");
      return {
        extensionToken: wolfExtensionToken,
        session: {
          sessionId: session.id,
          state: session.status,
          leadId: context.matchedLeadId ?? "",
          standalone: context.standalone === true,
          testSession: context.testSession === true,
          updatedAt: session.updatedAt ?? session.createdAt ?? null,
        },
        lead: {
          id: "",
          name: context.displayName ?? "Contato do WhatsApp",
          company: context.businessName ?? "Sessão autônoma",
          phone,
        },
      };
    }
    if (!session.leadId) return { extensionToken: wolfExtensionToken, session: null };
    const leads = await repository.leads({ page: 1, pageSize: 10000 });
    const lead = leads.rows.find((row) => String(row.id) === String(session.leadId));
    if (!lead) return { extensionToken: wolfExtensionToken, session: null };
    return {
      extensionToken: wolfExtensionToken,
      session: {
        sessionId: session.id,
        state: session.status,
        leadId: session.leadId,
        updatedAt: session.updatedAt ?? session.createdAt ?? null,
      },
      lead,
    };
  });
  app.get("/wolf/audio/devices", { preHandler: requireAuth(authClient) }, async (_request, reply) => {
    if (process.platform !== "win32") return { devices: [], reason: "WASAPI disponível somente no Windows." };
    const projectRoot = existsSync(path.resolve(process.cwd(), "tools"))
      ? process.cwd()
      : path.resolve(process.cwd(), "../..");
    const dll = path.resolve(
      projectRoot,
      "tools",
      "wolf-audio-helper",
      "bin",
      "Release",
      "net8.0-windows",
      "WolfAudioHelper.dll",
    );
    if (!existsSync(dll)) return reply.code(503).send({ message: "WolfAudioHelper não compilado." });
    try {
      const result = await execFileAsync("dotnet", [dll, "--list"], { timeout: 5_000, windowsHide: true });
      return JSON.parse(result.stdout.trim()) as { devices?: unknown[]; defaultMultimedia?: unknown };
    } catch (error) {
      return reply
        .code(503)
        .send({ message: error instanceof Error ? error.message : "Não foi possível listar saídas WASAPI." });
    }
  });
  app.post("/wolf/audio/device", { preHandler: requireAuth(authClient) }, async (request, reply) => {
    const body = z.object({ deviceId: z.string().min(1).max(500) }).parse(request.body);
    wolfHelperDeviceId = body.deviceId;
    process.env.WOLF_AUDIO_DEVICE_ID = body.deviceId;
    if (wolfHelperProcess) {
      wolfHelperProcess.kill();
      wolfHelperProcess = null;
    }
    setTimeout(ensureWolfHelper, 250);
    return reply.code(202).send({ ok: true, deviceId: body.deviceId, state: "restarting" });
  });
  app.post("/wolf/preflight/audio", { preHandler: requireAuth(authClient) }, async (request) => {
    const body = z
      .object({
        streamId: z.string().min(1).max(100),
        speaker: z.enum(["operator", "client"]),
        audio: z.string().min(1).max(2_000_000),
      })
      .parse(request.body);
    const response = await fetch(`${config.WOLF_LOCAL_TRANSCRIPTION_URL}/audio`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        stream_id: `preflight:${body.streamId}`,
        speaker: body.speaker,
        audio: body.audio,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const result = (await response.json()) as Record<string, unknown>;
    if (!response.ok)
      throw Object.assign(new Error(`Transcrição local HTTP ${response.status}`), {
        statusCode: response.status,
      });
    return result;
  });
  app.get("/wolf/preflight/audio", { websocket: true }, (socket, request) => {
    const query = z
      .object({ speaker: z.enum(["operator", "client"]).default("operator"), token: z.string().optional() })
      .parse(request.query);
    if (!config.MOCK_MODE && !query.token) {
      socket.close(1008, "authentication required");
      return;
    }
    const streamId = `preflight:${crypto.randomUUID()}`;
    const session = new WolfRealtimeSession(
      config.WOLF_TRANSCRIPTION_MODEL,
      query.speaker,
      (event) => {
        if (socket.readyState === 1) socket.send(JSON.stringify({ type: "transcript", ...event }));
      },
      (error) => {
        if (socket.readyState === 1) socket.send(JSON.stringify({ type: "error", message: error.message }));
      },
      config.WOLF_TRANSCRIPTION_PROVIDER === "local" ? config.WOLF_LOCAL_TRANSCRIPTION_URL : undefined,
      streamId,
      (diagnostic) => {
        if (socket.readyState === 1) socket.send(JSON.stringify({ type: "diagnostic", ...diagnostic }));
      },
    );
    if (config.WOLF_TRANSCRIPTION_PROVIDER === "local" || config.OPENAI_API_KEY)
      session.open(config.OPENAI_API_KEY);
    else {
      socket.send(JSON.stringify({ type: "error", message: "Provider de transcrição não configurado." }));
      socket.close(1011);
      return;
    }
    socket.on("message", (raw: Buffer, isBinary: boolean) => {
      if (isBinary) session.append(Buffer.from(raw));
      else {
        try {
          const message = JSON.parse(String(raw)) as { type?: string; audio?: string };
          if (message.type === "audio" && message.audio) session.append(Buffer.from(message.audio, "base64"));
        } catch {
          /* frame inválido, não derrubar a sessão */
        }
      }
    });
    socket.on("close", () => session.close());
  });
  app.get("/wolf/preflight/client-audio", { websocket: true }, (socket, request) => {
    const query = z.object({ token: z.string().optional() }).parse(request.query);
    if (!config.MOCK_MODE && !query.token) {
      socket.close(1008, "authentication required");
      return;
    }
    wolfClientPreflightSocket?.close();
    wolfClientPreflightSession?.close();
    wolfClientPreflightSocket = socket;
    wolfClientPreflightSession = new WolfRealtimeSession(
      config.WOLF_TRANSCRIPTION_MODEL,
      "client",
      (event) => {
        if (socket.readyState === 1) socket.send(JSON.stringify({ type: "transcript", ...event }));
      },
      (error) => {
        if (socket.readyState === 1) socket.send(JSON.stringify({ type: "error", message: error.message }));
      },
      config.WOLF_TRANSCRIPTION_PROVIDER === "local" ? config.WOLF_LOCAL_TRANSCRIPTION_URL : undefined,
      `preflight-client:${crypto.randomUUID()}`,
      (diagnostic) => {
        if (socket.readyState === 1) socket.send(JSON.stringify({ type: "diagnostic", ...diagnostic }));
      },
    );
    if (config.WOLF_TRANSCRIPTION_PROVIDER === "local" || config.OPENAI_API_KEY)
      wolfClientPreflightSession.open(config.OPENAI_API_KEY);
    socket.send(JSON.stringify({ type: "preflight_ready", speaker: "client" }));
    socket.on("close", () => {
      if (wolfClientPreflightSocket === socket) {
        wolfClientPreflightSocket = null;
        wolfClientPreflightSession?.close();
        wolfClientPreflightSession = null;
      }
    });
  });
  const ollamaTags = async () => {
    const response = await fetch(`${config.WOLF_OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return [] as string[];
    const data = (await response.json()) as { models?: Array<{ name?: string }> };
    return (data.models ?? []).map((model) => String(model.name ?? ""));
  };
  const ollamaIsOnline = async () => {
    try {
      const response = await fetch(`${config.WOLF_OLLAMA_BASE_URL}/api/tags`, {
        signal: AbortSignal.timeout(2_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  };
  const warmQwen = async () => {
    try {
      const response = await fetch(`${config.WOLF_OLLAMA_BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: config.WOLF_OLLAMA_MODEL,
          stream: false,
          think: false,
          format: "json",
          keep_alive: "10m",
          options: { num_predict: 1 },
          messages: [{ role: "user", content: "Responda apenas {}" }],
        }),
        signal: AbortSignal.timeout(60_000),
      });
      wolfQwenWarm = response.ok;
      return response.ok;
    } catch {
      wolfQwenWarm = false;
      return false;
    }
  };
  const unloadQwen = async () => {
    try {
      await fetch(`${config.WOLF_OLLAMA_BASE_URL}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: config.WOLF_OLLAMA_MODEL, prompt: "", stream: false, keep_alive: 0 }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      /* already offline */
    }
    wolfQwenWarm = false;
  };
  const getWolfAiStatus = async () => {
    const online = await ollamaIsOnline();
    if (!online)
      return {
        state: "off",
        label: "DESLIGADA",
        online: false,
        model: config.WOLF_OLLAMA_MODEL,
        installed: false,
        warm: false,
        ownedProcess: wolfOllamaOwned,
      };
    const models = await ollamaTags();
    const installed = models.some((model) => model.split(":")[0] === config.WOLF_OLLAMA_MODEL.split(":")[0]);
    if (!installed)
      return {
        state: "model_missing",
        label: "MODELO AUSENTE",
        online: true,
        model: config.WOLF_OLLAMA_MODEL,
        installed: false,
        warm: false,
        ownedProcess: wolfOllamaOwned,
      };
    return {
      state: wolfQwenWarm ? "ready" : "unloaded",
      label: wolfQwenWarm ? "PRONTA" : "DESLIGADA",
      online: true,
      model: config.WOLF_OLLAMA_MODEL,
      installed: true,
      warm: wolfQwenWarm,
      ownedProcess: wolfOllamaOwned,
    };
  };
  app.get("/wolf/readiness", { preHandler: requireWolfAuth(authClient) }, async () => {
    const checks: Record<string, boolean> = {
      api: true,
      database: config.MOCK_MODE || Boolean(serviceDb),
      ollama: false,
      qwen: false,
      qwenWarm: wolfQwenWarm,
      whisper: false,
      vad: false,
      audioGateway: config.NODE_ENV === "test" || Boolean(wolfAudioServer.listening),
      helperConnected: config.NODE_ENV === "test" || wolfGatewayConnected,
      windowsAudio: config.NODE_ENV === "test" || wolfLastAudioAt > Date.now() - 2_000,
    };
    const reasons: string[] = [];
    try {
      const response = await fetch(`${config.WOLF_OLLAMA_BASE_URL}/api/tags`, {
        signal: AbortSignal.timeout(2_000),
      });
      const data = (await response.json()) as { models?: Array<{ name?: string }> };
      checks.ollama = response.ok;
      checks.qwen = Boolean(
        data.models?.some(
          (model) => String(model.name ?? "").split(":")[0] === config.WOLF_OLLAMA_MODEL.split(":")[0],
        ),
      );
      if (checks.qwen) {
        try {
          const loaded = await fetch(`${config.WOLF_OLLAMA_BASE_URL}/api/ps`, {
            signal: AbortSignal.timeout(2_000),
          });
          const ps = (await loaded.json()) as { models?: Array<{ name?: string }> };
          checks.qwenWarm =
            wolfQwenWarm ||
            Boolean(
              ps.models?.some(
                (model) => String(model.name ?? "").split(":")[0] === config.WOLF_OLLAMA_MODEL.split(":")[0],
              ),
            );
        } catch {
          /* server may be online while model is unloaded */
        }
      }
    } catch {
      /* reported below */
    }
    if (config.WOLF_TRANSCRIPTION_PROVIDER === "local") {
      try {
        const response = await fetch(`${config.WOLF_LOCAL_TRANSCRIPTION_URL}/health`, {
          signal: AbortSignal.timeout(2_000),
        });
        const data = (await response.json()) as { ok?: boolean; vad?: string };
        checks.whisper = response.ok && data.ok === true;
        checks.vad = checks.whisper && Boolean(data.vad);
      } catch {
        /* reported below */
      }
    } else {
      checks.whisper = Boolean(config.OPENAI_API_KEY);
      checks.vad = checks.whisper;
    }
    for (const [name, ok] of Object.entries(checks).filter(([name]) => name !== "windowsAudio"))
      if (!ok)
        reasons.push(
          name === "qwen"
            ? `Modelo ${config.WOLF_OLLAMA_MODEL} não encontrado no Ollama.`
            : `${name} indisponível.`,
        );
    return {
      ready: Object.entries(checks)
        .filter(([name]) => name !== "windowsAudio")
        .every(([, ok]) => ok),
      helperConnected: wolfGatewayConnected,
      checks,
      reasons,
      openaiRequired: false,
      mode: config.WOLF_AI_PROVIDER,
    };
  });
  app.get("/wolf/ai/status", { preHandler: requireWolfAuth(authClient) }, async () => getWolfAiStatus());
  app.post("/wolf/ai/start", { preHandler: requireWolfAuth(authClient) }, async (_request, reply) => {
    const startedAt = Date.now();
    let serverReady = await ollamaIsOnline();
    if (!serverReady) {
      const executable = process.platform === "win32" ? "ollama.exe" : "ollama";
      wolfOllamaProcess = spawn(executable, ["serve"], { windowsHide: true, stdio: "ignore" });
      wolfOllamaOwned = true;
      for (let attempt = 0; attempt < 30 && !serverReady; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        serverReady = await ollamaIsOnline();
      }
    }
    if (!serverReady)
      return reply.code(503).send({
        message: "Ollama não iniciou. Verifique se está instalado e acessível.",
        state: "error",
        startedMs: Date.now() - startedAt,
      });
    const tags = await ollamaTags();
    if (!tags.some((model) => model.split(":")[0] === config.WOLF_OLLAMA_MODEL.split(":")[0]))
      return reply.code(409).send({
        message: `Modelo ${config.WOLF_OLLAMA_MODEL} não instalado.`,
        state: "model_missing",
        startedMs: Date.now() - startedAt,
      });
    const warm = await warmQwen();
    if (!warm)
      return reply.code(503).send({
        message: "Ollama respondeu, mas o Qwen não aqueceu.",
        state: "error",
        startedMs: Date.now() - startedAt,
      });
    return { ...(await getWolfAiStatus()), startedMs: Date.now() - startedAt };
  });
  app.post("/wolf/ai/stop", { preHandler: requireWolfAuth(authClient) }, async () => {
    await unloadQwen();
    if (wolfOllamaOwned) {
      wolfOllamaProcess?.kill();
      wolfOllamaProcess = null;
      wolfOllamaOwned = false;
    }
    return getWolfAiStatus();
  });
  app.get("/wolf/calls/:id/audio", { websocket: true }, (socket, request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const query = z
      .object({ channel: z.enum(["operator", "client"]), token: z.string().optional() })
      .parse(request.query);
    if (!config.MOCK_MODE && !query.token) {
      socket.close(1008, "authentication required");
      return;
    }
    const key = `${params.id}:${query.channel}`;
    const existing = wolfSessions.get(key);
    existing?.close();
    const session = new WolfRealtimeSession(
      config.WOLF_TRANSCRIPTION_MODEL,
      query.channel,
      (event) => {
        if (event.kind === "partial") wolfPartials.set(key, event.text);
        else {
          wolfPartials.delete(key);
          void appendWolfTurn(params.id, event.speaker, event.text, event.at);
        }
        if (socket.readyState === 1) socket.send(JSON.stringify({ type: "transcript", ...event }));
      },
      (error) => {
        if (socket.readyState === 1) socket.send(JSON.stringify({ type: "error", message: error.message }));
      },
      config.WOLF_TRANSCRIPTION_PROVIDER === "local" ? config.WOLF_LOCAL_TRANSCRIPTION_URL : undefined,
      `${params.id}:${query.channel}`,
      (diagnostic) => {
        if (socket.readyState === 1) socket.send(JSON.stringify({ type: "diagnostic", ...diagnostic }));
      },
    );
    wolfSessions.set(key, session);
    const peers =
      wolfSockets.get(params.id) ?? new Set<{ readyState: number; send: (value: string) => void }>();
    peers.add(socket);
    wolfSockets.set(params.id, peers);
    if (config.WOLF_TRANSCRIPTION_PROVIDER === "local" || config.OPENAI_API_KEY)
      session.open(config.OPENAI_API_KEY);
    else if (socket.readyState === 1)
      socket.send(JSON.stringify({ type: "error", message: "Provider de transcrição não configurado." }));
    socket.on("message", (raw: Buffer, isBinary: boolean) => {
      if (isBinary) session.append(Buffer.from(raw));
      else {
        try {
          const message = JSON.parse(String(raw)) as { type?: string; audio?: string };
          if (message.type === "audio" && message.audio) session.append(Buffer.from(message.audio, "base64"));
        } catch {
          /* ignore malformed client frames */
        }
      }
    });
    socket.on("close", () => {
      session.close();
      wolfSessions.delete(key);
      wolfPartials.delete(key);
      peers.delete(socket);
      if (!peers.size) wolfSockets.delete(params.id);
    });
  });
  app.get("/wolf/leads", { preHandler: requireAuth(authClient) }, async (request) =>
    repository.leads(paginationSchema.parse(request.query)),
  );
  app.get("/wolf/worklist", { preHandler: requireAuth(authClient) }, async (request) => {
    const query = paginationSchema.parse(request.query);
    const [allLeads, states, batches] = await Promise.all([
      repository.leads({ ...query, page: 1, pageSize: 10000 }),
      repository.page("wolfLeadStates", { page: 1, pageSize: 10000 }),
      repository.page("batches", { page: 1, pageSize: 10000 }),
    ]);
    const byLead = new Map(states.rows.map((row) => [String(row.leadId), row]));
    const byBatch = new Map(batches.rows.map((row) => [String(row.id), row]));
    const now = Date.now();
    const terminal = new Set([
      "interested",
      "qualified",
      "converted",
      "not_interested",
      "closed",
      "has_system",
      "no_interest",
    ]);
    const filter = String(query.status ?? "");
    const linkedLeads = allLeads.rows.filter((lead) => {
      const state = byLead.get(String(lead.id));
      if (!state) return false;
      if (filter === "active_queue")
        return (
          !terminal.has(String(state.status)) &&
          !(state.nextCallAt && Date.parse(String(state.nextCallAt)) > now)
        );
      if (filter === "callback") return Boolean(state.nextCallAt);
      if (filter === "no_interest") return ["no_interest", "not_interested"].includes(String(state.status));
      if (filter === "has_system") return String(state.status) === "has_system";
      return filter ? String(state.status) === filter : true;
    });
    const rows = linkedLeads
      .map((lead) => {
        const batch = lead.batchId ? byBatch.get(String(lead.batchId)) : undefined;
        return {
          ...lead,
          batchName: batch?.name ?? null,
          batchSource: batch?.source ?? lead.source ?? null,
          wolfState: byLead.get(String(lead.id)),
        };
      })
      .sort((a, b) => {
        const ac = a.wolfState?.nextCallAt ? Date.parse(String(a.wolfState.nextCallAt)) : 0;
        const bc = b.wolfState?.nextCallAt ? Date.parse(String(b.wolfState.nextCallAt)) : 0;
        const aDue = ac > 0 && ac <= now;
        const bDue = bc > 0 && bc <= now;
        if (aDue !== bDue) return aDue ? -1 : 1;
        if (aDue && ac !== bc) return ac - bc;
        const attempts = Number(a.wolfState?.totalAttempts ?? 0) - Number(b.wolfState?.totalAttempts ?? 0);
        if (attempts) return attempts;
        return (
          Date.parse(String(a.wolfState?.lastCallAt ?? a.wolfState?.createdAt ?? 0)) -
          Date.parse(String(b.wolfState?.lastCallAt ?? b.wolfState?.createdAt ?? 0))
        );
      });
    const from = (query.page - 1) * query.pageSize;
    const paged = rows.slice(from, from + query.pageSize);
    const counts = rows.reduce<Record<string, number>>((acc, row) => {
      const status = String(row.wolfState?.status ?? "not_called");
      acc[status] = (acc[status] ?? 0) + 1;
      return acc;
    }, {});
    return { rows: paged, total: rows.length, page: query.page, pageSize: query.pageSize, counts };
  });
  app.get("/wolf/followups", { preHandler: requireAuth(authClient) }, async (request) =>
    repository.page("followups", { ...paginationSchema.parse(request.query), pageSize: 100 }),
  );
  app.get("/wolf/leads/:leadId/history", { preHandler: requireWolfAuth(authClient) }, async (request) => {
    const { leadId } = z.object({ leadId: z.string().uuid() }).parse(request.params);
    const events = await repository.page("wolfCallEvents", { page: 1, pageSize: 10000 });
    return {
      rows: events.rows
        .filter((event) => String(event.leadId) === leadId)
        .sort((a, b) => Date.parse(String(b.occurredAt ?? 0)) - Date.parse(String(a.occurredAt ?? 0))),
    };
  });
  app.get("/wolf/leads/:leadId/context", { preHandler: requireWolfAuth(authClient) }, async (request) => {
    const { leadId } = z.object({ leadId: z.string().uuid() }).parse(request.params);
    const [leads, states] = await Promise.all([
      repository.leads({ page: 1, pageSize: 10000 }),
      repository.page("wolfLeadStates", { page: 1, pageSize: 10000 }),
    ]);
    const lead = leads.rows.find((row) => String(row.id) === leadId);
    if (!lead) throw Object.assign(new Error("Lead do atendimento não encontrado."), { statusCode: 404 });
    return { ...lead, wolfState: states.rows.find((row) => String(row.leadId) === leadId) ?? null };
  });
  app.get("/wolf/analytics", { preHandler: requireAuth(authClient) }, async () => {
    const events = await repository.page("wolfCallEvents", { page: 1, pageSize: 100 });
    const buckets = new Map<
      string,
      { attempts: number; answered: number; interested: number; converted: number }
    >();
    for (const event of events.rows) {
      const at = new Date(String(event.occurredAt ?? event.createdAt));
      const day = new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        timeZone: "America/Sao_Paulo",
      }).format(at);
      const hour = new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        hour12: false,
        timeZone: "America/Sao_Paulo",
      }).format(at);
      const key = `${day}|${hour}`;
      const bucket = buckets.get(key) ?? { attempts: 0, answered: 0, interested: 0, converted: 0 };
      if (event.eventType === "CALL_FINISHED") bucket.attempts++;
      if (["ANSWERED", "INTERESTED", "CONVERTED"].includes(String(event.eventType))) bucket.answered++;
      if (event.eventType === "INTERESTED") bucket.interested++;
      if (event.eventType === "CONVERTED") bucket.converted++;
      buckets.set(key, bucket);
    }
    return {
      timezone: "America/Sao_Paulo",
      buckets: [...buckets.entries()].map(([key, value]) => ({
        key,
        ...value,
        answerRate: value.attempts ? value.answered / value.attempts : 0,
        conversionRateOfAnswered: value.answered ? value.converted / value.answered : 0,
      })),
    };
  });
  app.post("/wolf/leads/:leadId/result", { preHandler: requireAuth(authClient) }, async (request) => {
    const params = z.object({ leadId: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        status: z.enum([
          "called",
          "no_answer",
          "answered",
          "busy",
          "callback",
          "has_system",
          "interested",
          "converted",
          "no_interest",
          "not_interested",
          "invalid",
          "closed",
        ]),
        nextCallAt: z.string().datetime().nullable().optional(),
        callId: z.string().uuid().nullable().optional(),
        conversionType: z.string().max(100).nullable().optional(),
      })
      .parse(request.body);
    const states = await repository.page("wolfLeadStates", { page: 1, pageSize: 10000 });
    const current = states.rows.find((row) => String(row.leadId) === params.leadId);
    if (!current)
      throw Object.assign(new Error("Estado operacional do lead não encontrado."), { statusCode: 404 });
    const now = new Date().toISOString();
    const answered = [
      "answered",
      "has_system",
      "interested",
      "converted",
      "no_interest",
      "not_interested",
    ].includes(body.status);
    const values = {
      status: body.status,
      lastCallAt: now,
      firstCallAt: current.firstCallAt ?? now,
      totalAttempts: Number(current.totalAttempts ?? 0) + 1,
      answeredAttempts: Number(current.answeredAttempts ?? 0) + (answered ? 1 : 0),
      nextCallAt: body.nextCallAt ?? null,
      convertedAt: body.status === "converted" ? now : (current.convertedAt ?? null),
      conversionType: body.conversionType ?? current.conversionType ?? null,
    };
    const state = await repository.updateResource("wolfLeadStates", String(current.id), values);
    await repository.createResource("wolfCallEvents", {
      leadId: params.leadId,
      callId: body.callId ?? null,
      eventType:
        body.status === "converted"
          ? "CONVERTED"
          : body.status === "has_system"
            ? "HAS_SYSTEM"
            : body.status === "no_interest"
              ? "NO_INTEREST"
              : body.status === "interested"
                ? "INTERESTED"
                : body.status === "no_answer"
                  ? "NO_ANSWER"
                  : answered
                    ? "ANSWERED"
                    : "CALL_FINISHED",
      occurredAt: now,
      metadata: { nextCallAt: body.nextCallAt ?? null },
    });
    return state;
  });
  app.get("/wolf/calls", { preHandler: requireWolfAuth(authClient) }, async (request) =>
    repository.page("wolfCalls", paginationSchema.parse(request.query)),
  );
  app.post("/wolf/test-sessions", { preHandler: requireAuth(authClient) }, async (request) => {
    const body = z.object({ phone: z.string().trim().min(8).max(40) }).parse(request.body);
    return repository.createResource("wolfCalls", {
      leadId: null,
      operatorId: request.userId,
      direction: "outbound",
      status: "preparing",
      startedAt: null,
      transcript: [],
      liveContext: { testSession: true, phone: body.phone, facts: [], objections: [], pains: [] },
    });
  });
  app.post("/wolf/standalone/sessions", { preHandler: requireWolfAuth(authClient) }, async (request) => {
    const body = z
      .object({
        displayName: z.string().trim().min(1).max(200),
        phone: z.string().trim().max(40).nullable().optional(),
        businessName: z.string().trim().max(200).nullable().optional(),
        chatType: z.string().trim().max(80).nullable().optional(),
      })
      .parse(request.body);
    const normalizedPhone = body.phone?.replace(/\D/g, "") || null;
    const leads = normalizedPhone
      ? await repository.leads({ page: 1, pageSize: 10000, search: normalizedPhone })
      : { rows: [] };
    const matched = leads.rows.find((row) => String(row.phone ?? "").replace(/\D/g, "") === normalizedPhone);
    return repository.createResource("wolfCalls", {
      leadId: matched?.id ?? null,
      operatorId: request.userId === "wolf-extension" ? null : request.userId,
      direction: "outbound",
      status: "preparing",
      startedAt: null,
      transcript: [],
      liveContext: {
        standalone: true,
        source: "whatsapp_web",
        displayName: body.displayName,
        phone: body.phone ?? null,
        businessName: body.businessName ?? null,
        chatType: body.chatType ?? null,
        matchedLeadId: matched?.id ?? null,
        facts: [],
        objections: [],
        pains: [],
      },
    });
  });
  app.post("/wolf/calls", { preHandler: requireWolfAuth(authClient) }, async (request) => {
    const body = z
      .object({
        mode: z.enum(["crm", "standalone", "test"]).optional(),
        type: z.enum(["crm", "standalone", "test"]).optional(),
        source: z.string().trim().max(80).optional(),
        chatType: z.string().trim().max(80).nullable().optional(),
        leadId: z.string().uuid().nullable().optional(),
        direction: z.enum(["inbound", "outbound"]),
        status: z.enum(["preparing", "listening"]).optional(),
        testSession: z.boolean().optional(),
        standalone: z.boolean().optional(),
        phone: z.string().trim().max(40).nullable().optional(),
        displayName: z.string().trim().max(200).nullable().optional(),
        businessName: z.string().trim().max(200).nullable().optional(),
      })
      .parse(request.body);
    const standalone = body.standalone === true || body.mode === "standalone" || body.type === "standalone";
    const testSession = body.testSession === true || body.mode === "test" || body.type === "test";
    request.log.info(
      {
        wolfCallPayload: {
          mode: body.mode ?? (standalone ? "standalone" : testSession ? "test" : "crm"),
          type: body.type ?? null,
          leadId: body.leadId ?? null,
          displayName: body.displayName ?? null,
          phone: body.phone ?? null,
          businessName: body.businessName ?? null,
          chatType: body.chatType ?? null,
          source: body.source ?? null,
          testMode: testSession,
        },
      },
      "wolf_call_create",
    );
    if (standalone && !body.displayName?.trim()) {
      throw Object.assign(new Error("Standalone exige displayName."), {
        statusCode: 400,
        code: "INVALID_CALL_PAYLOAD",
        fields: { displayName: "obrigatório em standalone" },
      });
    }
    let matchedLeadId = body.leadId ?? null;
    if (standalone && !matchedLeadId && body.phone) {
      const normalizedPhone = body.phone.replace(/\D/g, "");
      const leads = await repository.leads({ page: 1, pageSize: 10000, search: normalizedPhone });
      const matched = leads.rows.find(
        (row) => String(row.phone ?? "").replace(/\D/g, "") === normalizedPhone,
      );
      matchedLeadId = matched ? String(matched.id) : null;
    }
    const existing = (await repository.page("wolfCalls", { page: 1, pageSize: 10000 })).rows.find((row) => {
      if (row.status !== "preparing") return false;
      if (testSession || standalone) {
        const context = row.liveContext as {
          testSession?: boolean;
          standalone?: boolean;
          phone?: string | null;
          displayName?: string | null;
        } | null;
        return (
          context?.[standalone ? "standalone" : "testSession"] === true &&
          context.phone === body.phone &&
          (!standalone || body.phone || context.displayName === body.displayName)
        );
      }
      return Boolean(body.leadId) && String(row.leadId) === body.leadId;
    });
    if (existing) {
      if (body.status === "listening") {
        return repository.updateResource("wolfCalls", String(existing.id), {
          status: "listening",
          startedAt: new Date().toISOString(),
        });
      }
      return existing;
    }
    return repository.createResource("wolfCalls", {
      leadId: standalone ? matchedLeadId : (body.leadId ?? null),
      operatorId: request.userId === "wolf-extension" ? null : request.userId,
      direction: body.direction,
      status: body.status ?? "listening",
      startedAt: body.status === "preparing" ? null : new Date().toISOString(),
      transcript: [],
      liveContext: standalone
        ? {
            standalone: true,
            source: body.source ?? "whatsapp_web",
            phone: body.phone ?? null,
            displayName: body.displayName ?? null,
            businessName: body.businessName ?? null,
            chatType: body.chatType ?? null,
            matchedLeadId,
            facts: [],
            objections: [],
            pains: [],
          }
        : testSession
          ? { testSession: true, phone: body.phone ?? "", facts: [], objections: [], pains: [] }
          : { facts: [], objections: [], pains: [] },
    });
  });
  app.post("/wolf/calls/:id/turns", { preHandler: requireAuth(authClient) }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        speaker: z.enum(["operator", "client"]),
        text: z.string().trim().min(1).max(4000),
        sequence: z.number().int().min(0),
      })
      .parse(request.body);
    return appendWolfTurn(params.id, body.speaker, body.text, new Date().toISOString());
    /* const turn = await repository.createResource("wolfTurns", {
      callId: params.id,
      speaker: body.speaker,
      text: body.text,
      sequence: body.sequence,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      partial: false,
    });
    const page = await repository.page("wolfCalls", { page: 1, pageSize: 100 });
    const call = page.rows.find((row) => String(row.id) === params.id);
    if (!call) throw Object.assign(new Error("Sessão não encontrada."), { statusCode: 404 });
    const transcript = Array.isArray(call.transcript) ? call.transcript : [];
    transcript.push({
      speaker: body.speaker,
      text: body.text,
      timestamp: new Date().toISOString(),
      sequence: body.sequence,
    });
    await repository.updateResource("wolfCalls", params.id, { transcript });
    return turn; */
  });
  app.post("/wolf/calls/:id/suggest", { preHandler: requireWolfAuth(authClient) }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        alternative: z.boolean().optional(),
        stream: z.boolean().optional(),
        currentClientTurn: z.string().max(4000).optional(),
      })
      .parse(request.body);
    if (config.WOLF_AI_PROVIDER === "ollama") {
      const localPage = await repository.page("wolfCalls", { page: 1, pageSize: 100 });
      const localCall = localPage.rows.find((row) => String(row.id) === params.id);
      if (!localCall) throw Object.assign(new Error("Sessão não encontrada."), { statusCode: 404 });
      const localTranscript = Array.isArray(localCall.transcript) ? localCall.transcript : [];
      const abort = new AbortController();
      request.raw.once("aborted", () => abort.abort());
      request.raw.once("close", () => {
        if (!request.raw.complete) abort.abort();
      });
      const compactTranscript = localTranscript.slice(-8);
      const currentClientTurn = body.currentClientTurn?.trim();
      const lastClient = [...localTranscript].reverse().find((turn) => turn.speaker === "client");
      const lastOperator = [...localTranscript].reverse().find((turn) => turn.speaker === "operator");
      const currentText = currentClientTurn || String(lastClient?.text || "");
      const stage = /horario|agenda|demonstr/i.test(currentText)
        ? "agendamento"
        : /preco|custa|sistema|ocupad|tempo/i.test(currentText)
          ? "objeção"
          : localTranscript.length <= 3
            ? "abertura"
            : "descoberta";
      const salesContext = {
        goal: "agendar demonstração do Renova123",
        stage,
        trustedContactName: String(localCall.displayName || ""),
        asrDetectedName: null,
        operatorLast: String(lastOperator?.text || ""),
        clientStable: String(lastClient?.text || ""),
        clientCurrentPartial: currentClientTurn || "",
        importantFacts: [],
        objections: /ja uso|já uso|ocupad|custa|preco|preço/i.test(currentText) ? [currentText] : [],
        demoIntent: /mostrar|demonstra|pode me mostrar|agendar/i.test(currentText) ? "strong" : "none",
      };
      const localResponse = await fetch(`${config.WOLF_OLLAMA_BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: config.WOLF_OLLAMA_MODEL,
          stream: body.stream === true,
          think: false,
          options: { temperature: 0.2, num_predict: 60 },
          messages: [
            { role: "system", content: THE_WOLF_SYSTEM_PROMPT },
            {
              role: "user",
              content: JSON.stringify({
                leadId: localCall.leadId,
                salesContext,
                transcript: compactTranscript,
                currentClientTurn,
                alternative: body.alternative === true,
              }),
            },
          ],
        }),
        signal: abort.signal,
      });
      if (body.stream === true) {
        reply.hijack();
        reply.raw.writeHead(localResponse.status, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        if (!localResponse.ok || !localResponse.body) {
          reply.raw.write(
            `data: ${JSON.stringify({ error: `Ollama respondeu HTTP ${localResponse.status}.` })}\n\n`,
          );
          reply.raw.end();
          return;
        }
        const reader = localResponse.body.getReader();
        const decoder = new TextDecoder();
        let pending = "";
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            pending += decoder.decode(chunk.value, { stream: true });
            const lines = pending.split("\n");
            pending = lines.pop() || "";
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const packet = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
                const delta = packet.message?.content || "";
                if (delta) reply.raw.write(`data: ${JSON.stringify({ delta })}\n\n`);
              } catch {
                /* ignore incomplete Ollama packet */
              }
            }
          }
          reply.raw.write("data: [DONE]\n\n");
        } catch (error) {
          if (!(error instanceof Error && error.name === "AbortError"))
            reply.raw.write(
              `data: ${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n\n`,
            );
        }
        reply.raw.end();
        return;
      }
      const localData = (await localResponse.json()) as { message?: { content?: string }; error?: string };
      if (!localResponse.ok)
        throw Object.assign(new Error(localData.error ?? `Ollama respondeu HTTP ${localResponse.status}.`), {
          statusCode: localResponse.status,
        });
      return {
        faleAgora: (localData.message?.content ?? "").replace(/^```(?:json|text)?\s*|\s*```$/gi, "").trim(),
      };
    }
    const page = await repository.page("wolfCalls", { page: 1, pageSize: 100 });
    const call = page.rows.find((row) => String(row.id) === params.id);
    if (!call) throw Object.assign(new Error("Sessão não encontrada."), { statusCode: 404 });
    const transcript = Array.isArray(call.transcript) ? call.transcript : [];
    const key = config.OPENAI_API_KEY;
    if (!key)
      throw Object.assign(new Error("OPENAI_API_KEY não configurada para o copiloto."), { statusCode: 503 });
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: config.WOLF_AI_MODEL,
        reasoning: { effort: config.WOLF_REASONING_EFFORT },
        input: [
          { role: "system", content: THE_WOLF_SYSTEM_PROMPT },
          {
            role: "user",
            content: JSON.stringify({
              leadId: call.leadId,
              transcript: transcript.slice(-20),
              alternative: body.alternative === true,
            }),
          },
        ],
        max_output_tokens: 220,
        store: false,
      }),
    });
    const data = (await response.json()) as { output_text?: string; error?: { message?: string } };
    if (!response.ok)
      throw Object.assign(new Error(data.error?.message ?? `OpenAI respondeu HTTP ${response.status}.`), {
        statusCode: response.status,
      });
    return { faleAgora: (data.output_text ?? "").replace(/^```(?:json|text)?\s*|\s*```$/gi, "").trim() };
  });
  app.post("/wolf/calls/:id/finish", { preHandler: requireWolfAuth(authClient) }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const endedAt = new Date().toISOString();
    const page = await repository.page("wolfCalls", { page: 1, pageSize: 100 });
    const call = page.rows.find((row) => String(row.id) === params.id);
    if (!call) throw Object.assign(new Error("Sessão não encontrada."), { statusCode: 404 });
    const started = call.startedAt ? Date.parse(String(call.startedAt)) : Date.now();
    const context = call.liveContext as { standalone?: boolean; testSession?: boolean } | null;
    return repository.updateResource("wolfCalls", params.id, {
      status: context?.standalone || context?.testSession ? "ended" : "review",
      endedAt,
      durationSeconds: Math.max(0, Math.round((Date.parse(endedAt) - started) / 1000)),
      result: "revisar",
    });
  });
  app.patch("/wolf/calls/:id/status", { preHandler: requireWolfAuth(authClient) }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ status: z.enum(["listening", "paused"]) }).parse(request.body);
    return repository.updateResource("wolfCalls", params.id, { status: body.status });
  });
  app.patch("/wolf/calls/:id/review", { preHandler: requireAuth(authClient) }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        summary: z.string().max(8000),
        result: z.string().max(100),
        nextAction: z.string().max(2000).nullable().optional(),
        followUpDate: z.string().datetime().nullable().optional(),
        liveContext: z.record(z.unknown()).optional(),
      })
      .parse(request.body);
    return repository.updateResource("wolfCalls", params.id, { ...body, status: "completed" });
  });
  app.post("/wolf/calls/:id/discard", { preHandler: requireAuth(authClient) }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    return repository.updateResource("wolfCalls", params.id, {
      status: "discarded",
      result: null,
      summary: null,
    });
  });
  app.post("/auth/logout", { preHandler: requireAuth(authClient) }, async (_request, reply) =>
    reply.code(204).send(),
  );

  app.get("/dashboard", { preHandler: requireAuth(authClient) }, async () => {
    const stats = await repository.dashboard();
    const general = await repository.getSettings("general");
    const outreach = await repository.getSettings("outreach");
    const simulationMode =
      config.MOCK_MODE || config.MOCK_EVOLUTION || config.SIMULATION_MODE || !config.REAL_SENDING_ENABLED;
    const paused =
      general.globalPause === true ||
      general.automationEnabled !== true ||
      outreach.enabled !== true ||
      !config.OUTREACH_ENABLED;
    const sendMode = simulationMode ? "MOCK / BLOQUEADO" : paused ? "REAL / PAUSADO" : "REAL / ATIVO";
    let pendingUniqueLeads: number | undefined;
    if (serviceDb) {
      const owner = await serverOwnerId(serviceDb);
      const statuses = ["pending", "scheduled", "retry", "processing"];
      const queueResults = await Promise.all([
        serviceDb
          .from("outreach_queue")
          .select("lead_id")
          .eq("owner_id", owner)
          .in("status", statuses)
          .limit(10000),
        serviceDb
          .from("follow_up_queue")
          .select("lead_id")
          .eq("owner_id", owner)
          .in("status", statuses)
          .limit(10000),
        serviceDb
          .from("ai_response_queue")
          .select("lead_id")
          .eq("owner_id", owner)
          .in("status", statuses)
          .limit(10000),
        serviceDb.from("jobs").select("payload").eq("owner_id", owner).in("status", statuses).limit(10000),
      ]);
      const unique = new Set<string>();
      for (const result of queueResults) {
        if (result.error) continue;
        for (const row of result.data ?? []) {
          const item = row as { lead_id?: unknown; payload?: { leadId?: unknown } };
          const leadId = String(item.lead_id ?? item.payload?.leadId ?? "");
          if (leadId) unique.add(leadId);
        }
      }
      pendingUniqueLeads = unique.size;
    }
    return {
      ...stats,
      dailyLimit: Number(
        outreach.newLeadsDailyLimit ?? outreach.dailyProactiveLimit ?? stats.dailyLimit ?? 50,
      ),
      newLeadsDailyLimit: Number(outreach.newLeadsDailyLimit ?? outreach.dailyProactiveLimit ?? 50),
      simulationMode,
      sendMode,
      sendModeReason: simulationMode
        ? "REAL_SENDING_ENABLED está desligado."
        : paused
          ? "Pausa global, automação ou outreach desativado."
          : "Configuração real ativa.",
      pendingTasks: Number(stats.queuePending ?? 0),
      pendingUniqueLeads,
    };
  });
  app.get("/flow", { preHandler: requireAuth(authClient) }, async (request) => {
    const outreach = await repository.getSettings("outreach");
    const query = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(50).default(20),
        step: z.coerce.number().int().min(1).max(6).optional(),
        status: z.string().optional(),
        search: z.string().trim().max(100).optional(),
      })
      .parse(request.query);
    const dailyBudget = Number(
      outreach.newLeadsDailyLimit ?? outreach.dailyProactiveLimit ?? outreach.dailyLimit ?? 50,
    );
    const stageLimits = Array.isArray(outreach.stageDailyLimits)
      ? outreach.stageDailyLimits.map(Number)
      : [500, 500, 100, 100, 100, 100];
    const delays = Array.isArray(outreach.cadenceDelaysDays)
      ? outreach.cadenceDelaysDays
      : [0, 1, 2, 4, 8, 16];
    if (!serviceDb) {
      const leads = (await repository.leads({ page: 1, pageSize: 1000 })).rows;
      const steps = Array.from({ length: 6 }, (_, index) => ({
        step: index + 1,
        label: `Fluxo ${index + 1}`,
        delayDays: Number(delays[index] ?? 0),
        count: leads.filter((lead) => lead.stage === "contacted" && index === 0).length,
        dueToday: 0,
        overdue: 0,
        responseRate: 0,
        lastExecution: null,
        nextExecution: null,
      }));
      return {
        summary: {
          inFlow: steps.reduce((total, item) => total + item.count, 0),
          dueToday: 0,
          overdue: 0,
          responded: 0,
          qualified: 0,
          noInterest: 0,
        },
        steps,
        exits: [],
        rows: [],
        budget: {
          dueFollowups: 0,
          newLeadSlots: dailyBudget,
          dailyBudget,
          usedBudget: 0,
          remainingBudget: dailyBudget,
          followUpPolicy: "unlimited_due",
          stageLimits,
        },
      };
    }
    const owner = await serverOwnerId(serviceDb);
    const [states, leads] = await Promise.all([
      serviceDb
        .from("outreach_cadence_state")
        .select(
          "id,lead_id,status,flow_step,attempt_count,last_attempt_at,next_attempt_at,responded_at,exited_at,exit_reason,updated_at",
        )
        .eq("owner_id", owner)
        .order("next_attempt_at", { ascending: true, nullsFirst: false }),
      serviceDb.from("leads").select("id,name,phone,company,source,stage,metadata").eq("owner_id", owner),
    ]);
    if (states.error) throw states.error;
    if (leads.error) throw leads.error;
    const leadById = new Map((leads.data ?? []).map((lead) => [String(lead.id), lead]));
    const now = Date.now();
    const startToday = new Date();
    startToday.setHours(0, 0, 0, 0);
    const rows = (states.data ?? []).map((state) => ({
      ...state,
      lead: leadById.get(String(state.lead_id)) ?? null,
      dueToday: Boolean(
        state.next_attempt_at &&
        Date.parse(state.next_attempt_at) >= startToday.getTime() &&
        Date.parse(state.next_attempt_at) <= now + 86_400_000,
      ),
      overdue: Boolean(
        state.next_attempt_at && Date.parse(state.next_attempt_at) < now && state.status === "active",
      ),
    }));
    const active = rows.filter((row) => row.status === "active");
    const due = active.filter((row) => row.next_attempt_at && Date.parse(row.next_attempt_at) <= now);
    const steps = Array.from({ length: 6 }, (_, index) => {
      const bucket = active.filter((row) => Number(row.flow_step) === index + 1);
      const responded = rows.filter((row) => Number(row.flow_step) === index + 1 && row.responded_at).length;
      return {
        step: index + 1,
        label: `Fluxo ${index + 1}`,
        delayDays: Number(delays[index] ?? 0),
        count: bucket.length,
        currentLeads: bucket.length,
        dueToday: bucket.filter((row) => row.dueToday).length,
        overdue: bucket.filter((row) => row.overdue).length,
        processedToday: bucket.filter(
          (row) => row.last_attempt_at && Date.parse(row.last_attempt_at) >= startToday.getTime(),
        ).length,
        awaiting: bucket.filter((row) => !row.next_attempt_at || Date.parse(row.next_attempt_at) > now)
          .length,
        quota: index === 0 ? dailyBudget : (stageLimits[index] ?? 500),
        remaining: Math.max(
          0,
          (index === 0 ? dailyBudget : (stageLimits[index] ?? 500)) -
            bucket.filter(
              (row) => row.last_attempt_at && Date.parse(row.last_attempt_at) >= startToday.getTime(),
            ).length,
        ),
        responseRate:
          bucket.length + responded ? Math.round((responded / (bucket.length + responded)) * 100) : 0,
        lastExecution:
          bucket
            .map((row) => row.last_attempt_at)
            .filter(Boolean)
            .sort()
            .at(-1) ?? null,
        nextExecution:
          bucket
            .map((row) => row.next_attempt_at)
            .filter(Boolean)
            .sort()[0] ?? null,
      };
    });
    const exits = [
      "responded",
      "qualified",
      "demo_requested",
      "uses_system",
      "no_interest",
      "opted_out",
      "paused",
      "handed_off",
    ].map((status) => ({
      status,
      count:
        status === "uses_system"
          ? rows.filter(
              (row) => (row.lead?.metadata as Record<string, unknown> | undefined)?.usesSystem === true,
            ).length
          : status === "handed_off"
            ? rows.filter((row) => row.status === "qualified" || row.status === "handed_off").length
            : rows.filter((row) => row.status === status).length,
      rows: (status === "uses_system"
        ? rows.filter(
            (row) => (row.lead?.metadata as Record<string, unknown> | undefined)?.usesSystem === true,
          )
        : status === "handed_off"
          ? rows.filter((row) => row.status === "qualified" || row.status === "handed_off")
          : rows.filter((row) => row.status === status)
      ).slice(0, 100),
    }));
    const selectedRows = query.step
      ? active.filter((row) => Number(row.flow_step) === query.step)
      : query.status
        ? query.status === "uses_system"
          ? rows.filter(
              (row) => (row.lead?.metadata as Record<string, unknown> | undefined)?.usesSystem === true,
            )
          : query.status === "handed_off"
            ? rows.filter((row) => row.status === "qualified" || row.status === "handed_off")
            : rows.filter((row) => row.status === query.status)
        : active;
    const searchedRows = query.search
      ? selectedRows.filter((row) =>
          `${row.lead?.name ?? ""} ${row.lead?.phone ?? ""} ${row.lead?.company ?? ""}`
            .toLowerCase()
            .includes(query.search!.toLowerCase()),
        )
      : selectedRows;
    const rowStart = (query.page - 1) * query.pageSize;
    const pageRows = searchedRows.slice(rowStart, rowStart + query.pageSize);
    return {
      summary: {
        inFlow: active.length,
        dueToday: active.filter((row) => row.dueToday).length,
        overdue: due.length,
        responded: rows.filter((row) => row.status === "responded").length,
        qualified: rows.filter((row) => row.status === "qualified").length,
        noInterest: rows.filter((row) => row.status === "no_interest").length,
      },
      steps,
      exits,
      budget: {
        dueFollowups: due.length,
        newLeadSlots: dailyBudget,
        dailyBudget,
        usedBudget: Math.min(dailyBudget, steps[0]?.processedToday ?? 0),
        remainingBudget: Math.max(0, dailyBudget - (steps[0]?.processedToday ?? 0)),
        followUpPolicy: "unlimited_due",
        stageLimits,
      },
      settings: { newLeadsDailyLimit: dailyBudget, stageDailyLimits: stageLimits, cadenceDelaysDays: delays },
      rowsTotal: searchedRows.length,
      page: query.page,
      pageSize: query.pageSize,
      filter: { step: query.step ?? null, status: query.status ?? null, search: query.search ?? "" },
      rows: pageRows,
    };
  });
  app.get("/analytics/outreach-hours", { preHandler: requireAuth(authClient) }, async () =>
    repository.outreachAnalytics(),
  );
  app.post("/flow/leads/:leadId/pause", { preHandler: requireAuth(authClient) }, async (request) => {
    const leadId = z
      .string()
      .uuid()
      .parse((request.params as any).leadId);
    const reason = z
      .object({ reason: z.string().max(500).default("Pausado pelo operador.") })
      .parse(request.body ?? {}).reason;
    if (!serviceDb) {
      await repository.updateResource("leads", leadId, { automationPaused: true });
      await repository.audit("cadence.paused", "lead", leadId, { reason });
      return { leadId, status: "paused" };
    }
    const owner = await serverOwnerId(serviceDb);
    const now = new Date().toISOString();
    const [lead, cadence] = await Promise.all([
      serviceDb
        .from("leads")
        .update({ automation_paused: true })
        .eq("owner_id", owner)
        .eq("id", leadId)
        .select("id")
        .maybeSingle(),
      serviceDb
        .from("outreach_cadence_state")
        .update({ status: "paused", next_attempt_at: null, exit_reason: reason, updated_at: now })
        .eq("owner_id", owner)
        .eq("lead_id", leadId)
        .select("status")
        .maybeSingle(),
    ]);
    if (lead.error) throw lead.error;
    if (cadence.error) throw cadence.error;
    const cancelled = await serviceDb
      .from("outreach_queue")
      .update({ status: "cancelled", locked_at: null, locked_by: null, updated_at: now })
      .eq("owner_id", owner)
      .eq("lead_id", leadId)
      .in("status", ["pending", "scheduled", "retry"]);
    if (cancelled.error) throw cancelled.error;
    await serviceDb
      .from("follow_up_queue")
      .update({ status: "cancelled", locked_at: null, locked_by: null, updated_at: now })
      .eq("owner_id", owner)
      .eq("lead_id", leadId)
      .in("status", ["pending", "scheduled", "retry"]);
    await repository.audit("cadence.paused", "lead", leadId, { reason });
    return { leadId, status: "paused" };
  });
  app.post("/flow/leads/:leadId/resume", { preHandler: requireAuth(authClient) }, async (request) => {
    const leadId = z
      .string()
      .uuid()
      .parse((request.params as any).leadId);
    if (!serviceDb) {
      await repository.updateResource("leads", leadId, { automationPaused: false });
      await repository.audit("cadence.resumed", "lead", leadId);
      return { leadId, status: "active" };
    }
    const owner = await serverOwnerId(serviceDb);
    const now = new Date().toISOString();
    const cadence = await serviceDb
      .from("outreach_cadence_state")
      .select("flow_step,status")
      .eq("owner_id", owner)
      .eq("lead_id", leadId)
      .maybeSingle();
    if (cadence.error) throw cadence.error;
    if (["qualified", "no_interest", "opted_out", "demo_requested"].includes(String(cadence.data?.status)))
      return { leadId, status: cadence.data?.status };
    const [lead, updated] = await Promise.all([
      serviceDb
        .from("leads")
        .update({ automation_paused: false })
        .eq("owner_id", owner)
        .eq("id", leadId)
        .select("id")
        .maybeSingle(),
      serviceDb
        .from("outreach_cadence_state")
        .upsert(
          { owner_id: owner, lead_id: leadId, status: "active", next_attempt_at: now, updated_at: now },
          { onConflict: "lead_id" },
        )
        .select("status,next_attempt_at")
        .single(),
    ]);
    if (lead.error) throw lead.error;
    if (updated.error) throw updated.error;
    await repository.audit("cadence.resumed", "lead", leadId, { nextAttemptAt: now });
    return { leadId, status: "active", nextAttemptAt: now };
  });
  app.post("/flow/leads/:leadId/reschedule", { preHandler: requireAuth(authClient) }, async (request) => {
    const leadId = z
      .string()
      .uuid()
      .parse((request.params as any).leadId);
    const body = z
      .object({
        nextAttemptAt: z.string().datetime(),
        reason: z.string().max(500).default("Reagendado pelo operador."),
      })
      .parse(request.body);
    if (Date.parse(body.nextAttemptAt) <= Date.now())
      throw Object.assign(new Error("A próxima tentativa deve estar no futuro."), { statusCode: 400 });
    if (!serviceDb) {
      await repository.updateResource("leads", leadId, { automationPaused: false });
      await repository.audit("cadence.rescheduled", "lead", leadId, body);
      return { leadId, status: "active", nextAttemptAt: body.nextAttemptAt };
    }
    const owner = await serverOwnerId(serviceDb);
    const updated = await serviceDb
      .from("outreach_cadence_state")
      .update({
        status: "active",
        next_attempt_at: body.nextAttemptAt,
        exit_reason: body.reason,
        updated_at: new Date().toISOString(),
      })
      .eq("owner_id", owner)
      .eq("lead_id", leadId)
      .select("status,next_attempt_at")
      .single();
    if (updated.error) throw updated.error;
    const lead = await serviceDb
      .from("leads")
      .update({ automation_paused: false })
      .eq("owner_id", owner)
      .eq("id", leadId);
    if (lead.error) throw lead.error;
    await repository.audit("cadence.rescheduled", "lead", leadId, body);
    return { leadId, status: "active", nextAttemptAt: body.nextAttemptAt };
  });
  app.get("/conversations/inbox", { preHandler: requireAuth(authClient) }, async (request) => {
    const query = z
      .object({
        page: z.coerce.number().int().positive().default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(30),
        search: z.string().max(120).default(""),
      })
      .parse(request.query);
    if (!serviceDb) {
      const result = await repository.page("conversations", {
        page: query.page,
        pageSize: query.pageSize,
        search: query.search,
      });
      return {
        rows: result.rows.map((row) => ({
          conversationId: row.id,
          leadId: row.leadId,
          name: row.name ?? null,
          phone: row.phone ?? null,
          company: row.company ?? null,
          stage: row.stage,
          status: row.status,
          humanActive: row.humanActive,
          lastMessage: row.summary ?? null,
          lastMessageAt: row.lastMessageAt ?? null,
          unreadCount: 0,
          classification: row.stage ?? null,
          summary: row.summary ?? null,
        })),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      };
    }
    const owner = await serverOwnerId(serviceDb);
    const from = (query.page - 1) * query.pageSize;
    let conversations = serviceDb
      .from("conversations")
      .select(
        "id,lead_id,status,stage,human_active,takeover_state,last_message_at,summary,detected_intent,confidence,operational_summary,next_action,memories,updated_at,leads!inner(id,name,phone,company,source,stage,metadata)",
        { count: "exact" },
      )
      .eq("owner_id", owner)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .range(from, from + query.pageSize - 1);
    if (query.search.trim()) {
      const term = query.search.trim().replaceAll(",", " ");
      conversations = conversations.or(`name.ilike.%${term}%,phone.ilike.%${term}%,company.ilike.%${term}%`, {
        referencedTable: "leads",
      });
    }
    const result = await conversations;
    if (result.error) throw result.error;
    const rows = (result.data ?? []).map((row: any) => ({
      conversationId: row.id,
      leadId: row.lead_id,
      name: row.leads?.name ?? null,
      phone: row.leads?.phone ?? null,
      company: row.leads?.company ?? null,
      source: row.leads?.source ?? null,
      stage: row.stage ?? row.leads?.stage ?? null,
      status: row.status,
      humanActive: row.human_active,
      takeoverState: row.takeover_state,
      lastMessage: row.summary ?? null,
      lastMessageAt: row.last_message_at,
      unreadCount: Number(row.metadata?.unreadCount ?? 0),
      classification: row.detected_intent ?? null,
      summary: row.summary ?? null,
      confidence: row.confidence,
      operationalSummary: row.operational_summary,
      nextAction: row.next_action,
      memories: row.memories ?? [],
    }));
    return { rows, total: result.count ?? rows.length, page: query.page, pageSize: query.pageSize };
  });
  app.get(
    "/conversations/:conversationId/messages",
    { preHandler: requireAuth(authClient) },
    async (request, reply) => {
      const params = z.object({ conversationId: z.string().uuid() }).parse(request.params);
      const query = z
        .object({
          before: z.string().datetime({ offset: true }).optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        })
        .parse(request.query);
      if (!serviceDb) {
        const allMessages = (await repository.messages({ page: 1, pageSize: 5000 })).rows
          .filter((row) => String(row.conversationId) === params.conversationId)
          .sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));
        const before = query.before ? Date.parse(query.before) : Number.POSITIVE_INFINITY;
        const eligible = allMessages.filter((row) => Date.parse(String(row.createdAt ?? "")) < before);
        const rows = eligible.slice(-query.limit);
        const hasOlder = eligible.length > query.limit;
        return { rows, nextBefore: hasOlder ? (rows[0]?.createdAt ?? null) : null, hasOlder };
      }
      const owner = await serverOwnerId(serviceDb);
      const conversation = await serviceDb
        .from("conversations")
        .select("id")
        .eq("owner_id", owner)
        .eq("id", params.conversationId)
        .maybeSingle();
      if (conversation.error) throw conversation.error;
      if (!conversation.data) return reply.code(404).send({ message: "Conversa não encontrada." });
      let messages = serviceDb
        .from("messages")
        .select(
          "id,conversation_id,lead_id,direction,sender_type,content,message_type,transcription,status,received_at,sent_at,created_at,delivered_at,read_at,raw_data",
        )
        .eq("owner_id", owner)
        .eq("conversation_id", params.conversationId)
        .order("created_at", { ascending: false })
        .limit(query.limit + 1);
      if (query.before) messages = messages.lt("created_at", query.before);
      const result = await messages;
      if (result.error) throw result.error;
      const hasOlder = (result.data ?? []).length > query.limit;
      const rows = (result.data ?? []).slice(0, query.limit).reverse();
      return { rows, nextBefore: hasOlder ? (rows[0]?.created_at ?? null) : null, hasOlder };
    },
  );
  app.get("/leads", { preHandler: requireAuth(authClient) }, async (request) =>
    repository.leads(paginationSchema.parse(request.query)),
  );
  app.get("/imports", { preHandler: requireAuth(authClient) }, async (request) =>
    repository.page("batches", paginationSchema.parse(request.query)),
  );
  app.get("/batches", { preHandler: requireAuth(authClient) }, async (request) =>
    repository.page("batches", paginationSchema.parse(request.query)),
  );
  app.get("/queue", { preHandler: requireAuth(authClient) }, async (request) =>
    repository.page("queue", paginationSchema.parse(request.query)),
  );
  app.post("/queue/:queue/:id/cancel", { preHandler: requireAuth(authClient) }, async (request, reply) => {
    const params = z
      .object({
        queue: z.enum(["outreach_queue", "ai_response_queue", "follow_up_queue", "jobs"]),
        id: z.string().uuid(),
      })
      .parse(request.params);
    if (!serviceDb) {
      await repository.updateResource("queue", params.id, { status: "cancelled" });
      return { id: params.id, queue: params.queue, status: "cancelled" };
    }
    const owner = await serverOwnerId(serviceDb);
    const statuses = params.queue === "jobs" ? ["pending"] : ["pending", "scheduled", "retry"];
    const result = await serviceDb
      .from(params.queue)
      .update({ status: "cancelled", locked_at: null, locked_by: null })
      .eq("owner_id", owner)
      .eq("id", params.id)
      .in("status", statuses)
      .select("id,status")
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data)
      return reply.code(409).send({ message: "Item não encontrado ou já está em processamento/concluído." });
    await repository.audit("queue.cancelled", params.queue, params.id);
    return { id: result.data.id, queue: params.queue, status: result.data.status };
  });
  app.patch("/queue/:queue/:id", { preHandler: requireAuth(authClient) }, async (request, reply) => {
    const params = z
      .object({
        queue: z.enum(["outreach_queue", "ai_response_queue", "follow_up_queue", "jobs"]),
        id: z.string().uuid(),
      })
      .parse(request.params);
    const body = z
      .object({ status: z.enum(["pending", "cancelled"]), availableAt: z.string().datetime().optional() })
      .parse(request.body);
    const values =
      body.status === "pending"
        ? {
            status: "pending",
            available_at: body.availableAt ?? new Date().toISOString(),
            attempts: 0,
            last_error: null,
            locked_at: null,
            locked_by: null,
            completed_at: null,
          }
        : { status: "cancelled", locked_at: null, locked_by: null };
    if (!serviceDb) {
      await repository.updateResource("queue", params.id, {
        status: body.status,
        attempts: body.status === "pending" ? 0 : undefined,
        availableAt: body.availableAt,
        lastError: body.status === "pending" ? null : undefined,
      });
      return { id: params.id, queue: params.queue, status: body.status };
    }
    const owner = await serverOwnerId(serviceDb);
    const mutableStatuses =
      params.queue === "jobs"
        ? ["pending", "failed", "dead", "cancelled"]
        : ["pending", "scheduled", "retry", "failed", "dead_letter", "cancelled"];
    const result = await serviceDb
      .from(params.queue)
      .update(values)
      .eq("owner_id", owner)
      .eq("id", params.id)
      .in("status", mutableStatuses)
      .select("id,status")
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data)
      return reply
        .code(409)
        .send({ message: "Item não encontrado, está em processamento ou já foi concluído." });
    await repository.audit(
      body.status === "cancelled" ? "queue.cancelled" : "queue.retried",
      params.queue,
      params.id,
    );
    return { id: result.data.id, queue: params.queue, status: result.data.status };
  });
  app.get("/conversations", { preHandler: requireAuth(authClient) }, async (request) =>
    repository.page("conversations", paginationSchema.parse(request.query)),
  );
  app.post("/conversations/reset", { preHandler: requireAuth(authClient) }, async (request) => {
    const { phone } = z.object({ phone: z.string().regex(/^55\d{10,11}$/) }).parse(request.body);
    const removed = await repository.resetLeadSession(phone);
    await repository.audit("conversation.reset", "lead", null, { phoneSuffix: phone.slice(-4), ...removed });
    return removed;
  });
  app.get("/templates", { preHandler: requireAuth(authClient) }, async (request) =>
    repository.page("openers", paginationSchema.parse(request.query)),
  );
  app.get("/materials", { preHandler: requireAuth(authClient) }, async (request) =>
    repository.page("materials", paginationSchema.parse(request.query)),
  );
  app.get("/appointments", { preHandler: requireAuth(authClient) }, async (request) =>
    repository.page("demos", paginationSchema.parse(request.query)),
  );
  app.get("/handoffs", { preHandler: requireAuth(authClient) }, async (request) =>
    repository.page("handoffs", paginationSchema.parse(request.query)),
  );
  app.get("/logs", { preHandler: requireAuth(authClient) }, async (request) => {
    const page = await repository.page("logs", paginationSchema.parse(request.query));
    return { ...page, rows: page.rows.map((row) => redactRecord(row)) };
  });
  app.get("/agent", { preHandler: requireAuth(authClient) }, async () => ({
    profile: await repository.getSettings("mind"),
  }));
  app.get("/schedules", { preHandler: requireAuth(authClient) }, async () => ({
    outreach: await repository.getSettings("outreach"),
  }));
  app.get("/knowledge", { preHandler: requireAuth(authClient) }, async (request) => {
    const page = paginationSchema.parse(request.query);
    if (!serviceDb) return repository.page("knowledge", page);
    const owner = await serverOwnerId(serviceDb);
    const from = (page.page - 1) * page.pageSize;
    let query = serviceDb
      .from("knowledge_items")
      .select(
        "id,title,category,subject,tags,stages,source,content,active,archived_at,created_at,updated_at",
        { count: "exact" },
      )
      .eq("owner_id", owner)
      .is("archived_at", null);
    if (page.search)
      query = query.or(
        `title.ilike.%${safeApiSearch(page.search)}%,category.ilike.%${safeApiSearch(page.search)}%,subject.ilike.%${safeApiSearch(page.search)}%,content.ilike.%${safeApiSearch(page.search)}%`,
      );
    const result = await query
      .order("updated_at", { ascending: false })
      .range(from, from + page.pageSize - 1);
    if (result.error) throw result.error;
    return { rows: result.data ?? [], total: result.count ?? 0, page: page.page, pageSize: page.pageSize };
  });
  app.get("/notifications", { preHandler: requireAuth(authClient) }, async (request) =>
    repository.page("notifications", paginationSchema.parse(request.query)),
  );
  app.get("/messages", { preHandler: requireAuth(authClient) }, async (request) => {
    const page = paginationSchema.parse(request.query);
    return repository.messages(page);
  });
  app.get("/integrations", { preHandler: requireAuth(authClient) }, async () => {
    if (!serviceDb)
      return {
        rows: [
          { provider: "supabase", status: "mock" },
          { provider: "groq", status: config.MOCK_GROQ ? "mock" : "configured" },
          { provider: "evolution", status: config.MOCK_EVOLUTION ? "mock" : "configured" },
        ],
      };
    const result = await serviceDb
      .from("integration_connections")
      .select("id,provider,instance_name,status,capabilities,connected_at,last_seen_at,last_error,updated_at")
      .eq("owner_id", await serverOwnerId(serviceDb));
    if (result.error) throw result.error;
    return { rows: result.data ?? [] };
  });
  app.get("/pages/:key", { preHandler: requireAuth(authClient) }, async (request, reply) => {
    const key = z.string().parse((request.params as any).key) as PageKey;
    const allowed: PageKey[] = [
      "overview",
      "leads",
      "imports",
      "batches",
      "queue",
      "conversations",
      "interested",
      "qualified",
      "demos",
      "unanswered",
      "followups",
      "handoffs",
      "lost",
      "optouts",
      "materials",
      "knowledge",
      "notifications",
      "mind",
      "openers",
      "schedule",
      "groq",
      "whatsapp",
      "health",
      "logs",
      "settings",
    ];
    if (!allowed.includes(key)) return reply.code(404).send({ message: "Página desconhecida." });
    if (key === "health") {
      const whatsappStatus = await connectionWhatsapp
        .getConnectionStatus()
        .catch(() => ({ state: "unavailable" }));
      const rows = [
        { id: "api", name: "API local", status: "healthy", updatedAt: new Date().toISOString() },
        {
          id: "database",
          name: "Banco de negócio",
          status: config.MOCK_MODE ? "simulated" : "configured",
          updatedAt: new Date().toISOString(),
        },
        {
          id: "groq",
          name: "GroqCloud",
          status: config.GROQ_API_KEY ? "configured" : "not_configured",
          updatedAt: new Date().toISOString(),
        },
        {
          id: "evolution",
          name: "Evolution API",
          status: String(whatsappStatus.state),
          updatedAt: new Date().toISOString(),
        },
      ];
      return { rows, total: rows.length, page: 1, pageSize: rows.length };
    }
    return repository.page(key, paginationSchema.parse(request.query));
  });

  app.post("/imports/preview", { preHandler: requireAuth(authClient) }, async (request) => {
    const { content } = z.object({ content: z.string().max(2_000_000) }).parse(request.body);
    const parsed = parsePhoneList(content);
    const inspection = await repository.inspectPhones(
      parsed.flatMap((row) => (row.status === "valid" && row.phone ? [row.phone] : [])),
    );
    const rows = parsed.map((row) =>
      row.status === "valid" && row.phone && inspection[row.phone]
        ? { ...row, status: inspection[row.phone], reason: importReason(inspection[row.phone]!) }
        : row,
    );
    return {
      rows,
      summary: {
        total: rows.length,
        valid: rows.filter((row) => row.status === "valid").length,
        invalid: rows.filter((row) => row.status === "invalid").length,
        duplicateFile: rows.filter((row) => row.status === "duplicate_file").length,
        duplicateExisting: rows.filter((row) => row.status === "duplicate_existing").length,
        blocked: rows.filter((row) => row.status === "blocked").length,
        alreadyApproached: rows.filter((row) => row.status === "already_approached").length,
        inConversation: rows.filter((row) => row.status === "in_conversation").length,
      },
    };
  });

  app.post("/imports/commit", { preHandler: requireAuth(authClient) }, async (request) => {
    const body = z
      .object({
        batch: importBatchSchema,
        phones: z
          .array(z.string().regex(/^\d{7,15}$/))
          .min(1)
          .max(50_000),
      })
      .parse(request.body);
    const result = await repository.createBatch(body.batch, [...new Set(body.phones)]);
    await repository.audit("batch.imported", "lead_batch", result.batchId, {
      imported: result.imported,
      skipped: result.skipped,
    });
    return result;
  });

  app.get("/settings/:section", { preHandler: requireAuth(authClient) }, async (request) => {
    const section = z
      .string()
      .max(50)
      .parse((request.params as any).section);
    const values = await repository.getSettings(section);
    return section === "groq" ? sanitizeGroqSettings(values) : values;
  });
  app.put("/settings/:section", { preHandler: requireAuth(authClient) }, async (request) => {
    const section = z
      .string()
      .max(50)
      .parse((request.params as any).section);
    const values = z.record(z.unknown()).parse(request.body);
    if (section === "groq" && ("apiKey" in values || "apiKeyEncrypted" in values))
      throw Object.assign(new Error("Use o endpoint seguro de configuração da Groq."), { statusCode: 400 });
    if (section === "outreach") outreachSettingsSchema.parse(values);
    if (section === "general" && values.realSendingEnabled === true && values.simulationMode !== false)
      throw new Error("Desative o modo de simulação explicitamente antes de liberar envio real.");
    await repository.saveSettings(section, values);
    if (section === "outreach" && serviceDb) await syncAvailability(serviceDb, values);
    await repository.audit("settings.updated", "settings", section, { fields: Object.keys(values) });
    return { success: true };
  });

  app.get("/groq/status", { preHandler: requireAuth(authClient) }, async () => {
    const settings = await repository.getSettings("groq");
    const key = resolveGroqApiKey(settings);
    const provider = new GroqProvider({ apiKey: key, simulationMode: config.MOCK_GROQ });
    const health = await provider.healthCheck();
    const models = health.ok ? await provider.listModels() : [];
    const selectedModel = String(settings.model ?? config.GROQ_MODEL);
    const selectedWhisper = String(settings.transcriptionModel ?? "whisper-large-v3-turbo");
    const selectionMissing =
      health.ok &&
      (!models.some((item) => item.id === selectedModel && !item.transcription) ||
        !models.some((item) => item.id === selectedWhisper && item.transcription));
    if (selectionMissing)
      await repository.saveSettings("groq", {
        ...settings,
        model: null,
        processingPaused: true,
        lastFailure: "O modelo selecionado não está mais ativo nesta conta. Selecione um modelo disponível.",
      });
    return {
      configured: Boolean(key) || config.MOCK_GROQ,
      apiKeyMasked: String(settings.apiKeyMasked ?? (key ? maskSecret(key) : config.MOCK_GROQ ? "mock" : "")),
      model: selectionMissing ? "" : selectedModel,
      transcriptionModel: selectedWhisper,
      temperature: settings.temperature ?? 0.3,
      models,
      health,
      lastFailure: selectionMissing
        ? "O modelo selecionado não está mais ativo nesta conta. Selecione um modelo disponível."
        : (settings.lastFailure ?? null),
      processingPaused: selectionMissing || settings.processingPaused === true,
    };
  });
  app.get("/ai/status", { preHandler: requireAuth(authClient) }, async () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    let callsToday = 0;
    let fallbacksToday = 0;
    let finalFailuresToday = 0;
    let recentGroqFailures = 0;
    if (serviceDb) {
      const rows = await serviceDb
        .from("agent_executions")
        .select("provider,success,fallback_reason,created_at")
        .eq("owner_id", await serverOwnerId(serviceDb))
        .gte("created_at", today.toISOString());
      if (rows.error) throw rows.error;
      callsToday = rows.data?.length ?? 0;
      fallbacksToday = rows.data?.filter((row) => Boolean(row.fallback_reason)).length ?? 0;
      finalFailuresToday = rows.data?.filter((row) => row.success === false).length ?? 0;
      recentGroqFailures =
        rows.data?.filter(
          (row) =>
            row.provider === "groq" &&
            row.success === false &&
            Date.parse(String(row.created_at)) > Date.now() - 5 * 60_000,
        ).length ?? 0;
    }
    return {
      groq: recentGroqFailures >= 3 ? "cooldown" : recentGroqFailures > 0 ? "offline" : "online",
      gemini: config.MOCK_GEMINI || Boolean(config.GEMINI_API_KEY) ? "online" : "offline",
      callsToday,
      fallbacksToday,
      finalFailuresToday,
      cooldownUntil: null,
    };
  });
  app.post(
    "/groq/validate",
    { preHandler: requireAuth(authClient), config: { rateLimit: { max: 10, timeWindow: "5 minutes" } } },
    async (request, reply) => {
      const body = z.object({ apiKey: z.string().trim().min(20).max(500) }).parse(request.body);
      const result = await new GroqProvider({
        apiKey: body.apiKey,
        simulationMode: config.MOCK_GROQ,
      }).validateApiKey();
      if (!result.valid) return reply.code(400).send({ ...result, apiKeyMasked: maskSecret(body.apiKey) });
      return { ...result, apiKeyMasked: maskSecret(body.apiKey) };
    },
  );
  app.put("/groq/config", { preHandler: requireAuth(authClient) }, async (request) => {
    const body = z
      .object({
        apiKey: z.string().trim().min(20).max(500).optional(),
        model: z.string().min(2).max(200),
        transcriptionModel: z.string().min(2).max(200),
        temperature: z.number().min(0).max(1).default(0.3),
      })
      .parse(request.body);
    const current = await repository.getSettings("groq");
    const key = body.apiKey ?? resolveGroqApiKey(current);
    if (!key && !config.MOCK_GROQ)
      throw Object.assign(new Error("Informe e valide uma chave Groq."), { statusCode: 400 });
    const provider = new GroqProvider({ apiKey: key, simulationMode: config.MOCK_GROQ });
    const validation = await provider.validateApiKey();
    if (!validation.valid)
      throw Object.assign(new Error(validation.error ?? "Chave Groq inválida."), { statusCode: 400 });
    const chatModels = validation.models.filter((item) => !item.transcription).map((item) => item.id);
    const transcriptionModels = validation.models.filter((item) => item.transcription).map((item) => item.id);
    if (!chatModels.includes(body.model))
      throw Object.assign(new Error("O modelo principal selecionado não está ativo nesta conta."), {
        statusCode: 409,
      });
    if (!transcriptionModels.includes(body.transcriptionModel))
      throw Object.assign(new Error("O modelo Whisper selecionado não está ativo nesta conta."), {
        statusCode: 409,
      });
    const values = {
      ...current,
      model: body.model,
      transcriptionModel: body.transcriptionModel,
      temperature: body.temperature,
      configured: true,
      apiKeyMasked: key ? maskSecret(key) : "mock",
      ...(body.apiKey ? { apiKeyEncrypted: encryptSecret(body.apiKey, config.ENCRYPTION_KEY) } : {}),
      processingPaused: false,
      lastFailure: null,
      rateLimits: validation.rateLimits,
      validatedAt: new Date().toISOString(),
    };
    await repository.saveSettings("groq", values);
    await repository.audit("groq.configured", "integration", null, {
      model: body.model,
      transcriptionModel: body.transcriptionModel,
      keyChanged: Boolean(body.apiKey),
    });
    return { ...sanitizeGroqSettings(values), models: validation.models };
  });
  app.post("/groq/test", { preHandler: requireAuth(authClient) }, async () => {
    const settings = await repository.getSettings("groq");
    const key = resolveGroqApiKey(settings);
    const provider = new GroqProvider({ apiKey: key, simulationMode: config.MOCK_GROQ });
    const result = await provider.generateStructuredResponse({
      systemPrompt:
        "Você é Francisco. Responda com o schema JSON comercial solicitado e não invente informações.",
      userMessage: "Olá, gostaria de entender como a Renova 123 ajuda uma ótica.",
      model: String(settings.model ?? config.GROQ_MODEL),
      temperature: Number(settings.temperature ?? 0.3),
    });
    return {
      ok: true,
      replyText: result.decision.replyText,
      model: settings.model ?? config.GROQ_MODEL,
      rateLimits: result.rateLimits,
    };
  });

  app.post("/resources/:key", { preHandler: requireAuth(authClient) }, async (request, reply) => {
    const key = editableResourceKey((request.params as any).key);
    if (!creatableResources.has(key))
      return reply.code(405).send({ message: "Este recurso não pode ser criado por esta rota." });
    const values = validateResource(key, request.body, false);
    if (key === "demos") await ensureNoAppointmentConflict(repository, values);
    const created = await repository.createResource(key, values);
    await repository.audit(`${key}.created`, key, String(created.id ?? ""), { fields: Object.keys(values) });
    return reply.code(201).send(created);
  });

  app.patch("/resources/:key/:id", { preHandler: requireAuth(authClient) }, async (request) => {
    const key = editableResourceKey((request.params as any).key);
    const id = z
      .string()
      .min(1)
      .max(100)
      .parse((request.params as any).id);
    const values = validateResource(key, request.body, true);
    if (key === "demos" && (values.startsAt || values.endsAt))
      await ensureNoAppointmentConflict(repository, values, id);
    const updated = await repository.updateResource(key, id, values);
    if (key === "handoffs" && serviceDb && values.status) {
      const ownerId = await serverOwnerId(serviceDb);
      const handoff = await serviceDb
        .from("handoffs")
        .select("lead_id")
        .eq("owner_id", ownerId)
        .eq("id", id)
        .single();
      if (handoff.data?.lead_id) {
        const humanActive = values.status === "active";
        await Promise.all([
          serviceDb
            .from("leads")
            .update({
              human_active: humanActive,
              automation_paused: humanActive,
              stage: humanActive ? "human_handoff" : undefined,
            })
            .eq("owner_id", ownerId)
            .eq("id", handoff.data.lead_id),
          serviceDb
            .from("conversations")
            .update({ human_active: humanActive, status: humanActive ? "paused" : "active" })
            .eq("owner_id", ownerId)
            .eq("lead_id", handoff.data.lead_id),
        ]);
      }
    }
    await repository.audit(`${key}.updated`, key, id, { fields: Object.keys(values) });
    return updated;
  });

  app.post(
    "/conversations/:leadId/manual-message",
    { preHandler: requireAuth(authClient) },
    async (request) => {
      const leadId = z
        .string()
        .uuid()
        .parse((request.params as any).leadId);
      const { text } = z.object({ text: z.string().trim().min(1).max(4000) }).parse(request.body);
      if (config.MOCK_MODE || !serviceDb) {
        await repository.updateResource("leads", leadId, { humanActive: true, automationPaused: true });
        await repository.audit("message.manual.simulated", "lead", leadId, { length: text.length });
        return { status: "simulated" };
      }
      const ownerId = await serverOwnerId(serviceDb);
      const lead = await serviceDb
        .from("leads")
        .select("phone,stage")
        .eq("owner_id", ownerId)
        .eq("id", leadId)
        .single();
      if (lead.error || !lead.data?.phone)
        throw Object.assign(new Error("Lead não encontrado."), { statusCode: 404 });
      const suppression = await serviceDb
        .from("suppression_list")
        .select("id")
        .eq("phone", lead.data.phone)
        .eq("active", true)
        .maybeSingle();
      if (suppression.error) throw suppression.error;
      if (suppression.data || lead.data.stage === "opted_out")
        throw Object.assign(new Error("Envio bloqueado por opt-out."), { statusCode: 409 });
      if (
        !(config.SIMULATION_MODE || !config.REAL_SENDING_ENABLED) &&
        (await connectionWhatsapp.getConnectionStatus()).state !== "open"
      )
        throw Object.assign(new Error("WhatsApp não está conectado."), { statusCode: 409 });
      const idempotencyKey = `manual:${crypto.randomUUID()}`;
      const sent = await outboundWhatsapp.sendText(lead.data.phone, text, idempotencyKey);
      const conversation = await serviceDb
        .from("conversations")
        .upsert(
          {
            owner_id: ownerId,
            lead_id: leadId,
            status: "paused",
            human_active: true,
            takeover_state: "human_active",
            last_message_at: new Date().toISOString(),
          },
          { onConflict: "lead_id" },
        )
        .select("id")
        .single();
      await serviceDb
        .from("leads")
        .update({ human_active: true, automation_paused: true })
        .eq("owner_id", ownerId)
        .eq("id", leadId);
      await serviceDb.from("messages").insert({
        owner_id: ownerId,
        lead_id: leadId,
        conversation_id: conversation.data?.id,
        direction: "outbound",
        sender_type: "human",
        content: text,
        idempotency_key: idempotencyKey,
        status: config.SIMULATION_MODE || !config.REAL_SENDING_ENABLED ? "simulated" : "sent",
        raw_data: sent,
      });
      await serviceDb.from("conversation_takeovers").insert({
        owner_id: ownerId,
        lead_id: leadId,
        conversation_id: conversation.data?.id,
        state: "human_active",
        reason: "Mensagem manual enviada",
        actor_id: request.userId,
      });
      await repository.audit("message.manual.sent", "lead", leadId, {
        phoneSuffix: String(lead.data.phone).slice(-4),
        simulation: config.SIMULATION_MODE || !config.REAL_SENDING_ENABLED,
      });
      return sent;
    },
  );

  app.delete("/resources/:key/:id", { preHandler: requireAuth(authClient) }, async (request, reply) => {
    const key = editableResourceKey((request.params as any).key);
    if (!deletableResources.has(key))
      return reply.code(405).send({ message: "Este recurso não pode ser excluído por esta rota." });
    const id = z
      .string()
      .min(1)
      .max(100)
      .parse((request.params as any).id);
    await repository.deleteResource(key, id);
    await repository.audit(`${key}.deleted`, key, id);
    return reply.code(204).send();
  });

  app.post("/system/pause", { preHandler: requireAuth(authClient) }, async (request) => {
    const { paused } = z.object({ paused: z.boolean() }).parse(request.body);
    const current = await repository.getSettings("general");
    if (!paused) {
      if (!config.MOCK_MODE && !config.SIMULATION_MODE && !config.REAL_SENDING_ENABLED) {
        throw new Error("Francisco não pôde ser ligado: envio real não autorizado.");
      }
      if (current.globalPause === true) {
        throw new Error("Francisco não pôde ser ligado: parada global ativa.");
      }
      const whatsappState = await connectionWhatsapp
        .getConnectionStatus()
        .catch(() => ({ state: "unavailable" }));
      if (!config.MOCK_EVOLUTION && whatsappState.state !== "open") {
        throw new Error(`Francisco não pôde ser ligado: WhatsApp ${whatsappState.state}.`);
      }
      let workerOnline = false;
      if (serviceDb) {
        const heartbeat = await serviceDb
          .from("worker_heartbeats")
          .select("status,last_heartbeat_at,lock_expires_at")
          .order("last_heartbeat_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        workerOnline = Boolean(
          heartbeat.data &&
          heartbeat.data.status === "running" &&
          new Date(heartbeat.data.lock_expires_at).getTime() > Date.now(),
        );
      } else if (config.MOCK_MODE) {
        const configuredHeartbeat = `${process.env.MOCK_DB_PATH ?? ".runtime/mock-db.json"}.worker-heartbeat.json`;
        const candidates = [
          path.resolve(configuredHeartbeat),
          path.resolve(process.cwd(), "../..", configuredHeartbeat),
          path.resolve(process.cwd(), "../../..", configuredHeartbeat),
        ];
        const heartbeatPath = candidates.find((candidate) => existsSync(candidate));
        if (heartbeatPath) {
          try {
            const heartbeat = JSON.parse(readFileSync(heartbeatPath, "utf8")) as { lastHeartbeatAt?: string };
            workerOnline = Boolean(
              heartbeat.lastHeartbeatAt && Date.now() - Date.parse(heartbeat.lastHeartbeatAt) <= 30_000,
            );
          } catch {
            workerOnline = false;
          }
        }
      }
      if (!workerOnline) throw new Error("Francisco não pôde ser ligado: worker offline.");
    }
    await repository.saveSettings("general", {
      ...current,
      automationEnabled: !paused,
      ...(paused
        ? {
            scheduledResumeAt: null,
            scheduledResumeAppliedAt: null,
            scheduledResumeCancelledAt: new Date().toISOString(),
          }
        : {}),
    });
    await repository.audit(paused ? "system.paused" : "system.resumed", "system", null);
    await repository.audit(paused ? "automation.disabled" : "automation.enabled", "system", null);
    return { paused, automationEnabled: !paused, operation: !paused ? "started" : "paused" };
  });
  app.post("/system/schedule-resume", { preHandler: requireAuth(authClient) }, async (request) => {
    const { scheduledResumeAt } = z
      .object({ scheduledResumeAt: z.string().datetime({ offset: true }) })
      .parse(request.body);
    const resumeAt = Date.parse(scheduledResumeAt);
    if (resumeAt <= Date.now())
      throw Object.assign(new Error("A retomada programada deve estar no futuro."), { statusCode: 400 });
    const current = await repository.getSettings("general");
    const values = {
      ...current,
      globalPause: true,
      scheduledResumeAt: new Date(resumeAt).toISOString(),
      scheduledResumeAppliedAt: null,
      scheduledResumeCancelledAt: null,
    };
    await repository.saveSettings("general", values);
    await repository.audit("system.resume_scheduled", "system", null, {
      scheduledResumeAt: values.scheduledResumeAt,
      timezone: current.timezone ?? config.TIMEZONE,
    });
    return { scheduledResumeAt: values.scheduledResumeAt, paused: true };
  });
  app.post("/system/simulation", { preHandler: requireAuth(authClient) }, async (request) => {
    const body = z.object({ enabled: z.boolean() }).parse(request.body);
    const current = await repository.getSettings("general");
    await repository.saveSettings("general", { ...current, simulationMode: body.enabled });
    await repository.audit("simulation.changed", "system", null, {
      enabled: body.enabled,
      actor: request.userId,
    });
    return { simulationMode: body.enabled };
  });

  app.get("/agents", { preHandler: requireAuth(authClient) }, async () => ({
    agents: await Promise.all(Object.values(whatsappAgents).map((agent) => agentPairing(agent))),
  }));
  app.get("/agents/:agentSlug/whatsapp/pairing", { preHandler: requireAuth(authClient) }, async (request) =>
    agentPairing(agentForRequest(request)),
  );
  app.get("/agents/:agentSlug/whatsapp/qr", { preHandler: requireAuth(authClient) }, async (request) => {
    const agent = agentForRequest(request);
    if (config.MOCK_EVOLUTION)
      throw Object.assign(new Error("Evolution API real não configurada. Não existe QR para renovar."), {
        statusCode: 409,
      });
    return agentPairing(agent, true);
  });
  app.get(
    "/agents/:agentSlug/whatsapp/diagnostics",
    { preHandler: requireAuth(authClient) },
    async (request) => {
      const agent = agentForRequest(request);
      return {
        agent: agent.slug,
        name: agent.name,
        status: await agentConnectionStatus(agent),
        instanceName: agent.instanceName,
        connectionMode: config.MOCK_EVOLUTION ? "not_configured" : "evolution",
        webhookConfigured: Boolean(config.EVOLUTION_WEBHOOK_URL),
        apiKeyConfigured: Boolean(config.EVOLUTION_API_KEY),
        apiKeyExposed: false,
        automationEnabled: agent.slug === "pedro" ? config.PEDRO_AUTOMATION_ENABLED : false,
        globalPause: agent.slug === "pedro" ? config.PEDRO_GLOBAL_PAUSE : false,
        outreachEnabled: agent.slug === "pedro" ? config.PEDRO_OUTREACH_ENABLED : false,
        realSendingEnabled: agent.slug === "pedro" ? config.PEDRO_REAL_SENDING_ENABLED : false,
      };
    },
  );
  app.post("/agents/:agentSlug/whatsapp/instance", { preHandler: requireAuth(authClient) }, async (request) =>
    agentForRequest(request).provider.createInstance(),
  );
  app.post(
    "/agents/:agentSlug/whatsapp/connect",
    { preHandler: requireAuth(authClient) },
    async (request) => {
      const agent = agentForRequest(request);
      if (config.MOCK_EVOLUTION)
        throw Object.assign(new Error("Evolution API real não configurada. O QR fictício foi removido."), {
          statusCode: 409,
        });
      return agent.provider.connect();
    },
  );
  app.post(
    "/agents/:agentSlug/whatsapp/webhook/configure",
    { preHandler: requireAuth(authClient) },
    async (request) => {
      await agentForRequest(request).provider.configureWebhook();
      return { success: true };
    },
  );
  app.post("/agents/:agentSlug/whatsapp/restart", { preHandler: requireAuth(authClient) }, async (request) =>
    agentForRequest(request).provider.restart(),
  );
  app.post("/agents/:agentSlug/whatsapp/logout", { preHandler: requireAuth(authClient) }, async (request) => {
    await agentForRequest(request).provider.logout();
    return { success: true };
  });
  app.post("/agents/:agentSlug/whatsapp/test", { preHandler: requireAuth(authClient) }, async (request) => {
    const agent = agentForRequest(request);
    const body = z
      .object({
        phone: z.string().regex(/^55\d{10,11}$/),
        text: z.string().min(1).max(1000),
        idempotencyKey: z.string().uuid(),
      })
      .parse(request.body);
    const status = await agentConnectionStatus(agent);
    await repository.audit("whatsapp.test", "whatsapp", null, {
      agent: agent.slug,
      instanceName: agent.instanceName,
      phoneSuffix: body.phone.slice(-4),
      simulation: true,
      idempotencyKey: body.idempotencyKey,
      connectionState: status.state,
    });
    return {
      status: "simulated",
      agent: agent.slug,
      instanceName: agent.instanceName,
      realMessageSent: false,
      externalMessageId: null,
    };
  });

  app.get("/whatsapp/status", { preHandler: requireAuth(authClient) }, async () => publicConnectionStatus());
  app.get("/whatsapp/pairing", { preHandler: requireAuth(authClient) }, async () => {
    const status = await publicConnectionStatus();
    const qr = status.state === "connecting" ? await connectionWhatsapp.getQrCode() : null;
    return {
      evolution: status.state === "unavailable" ? "offline" : "online",
      instanceName: status.instanceName,
      state: status.state,
      number: status.number,
      available: status.available,
      circuit: status.circuit,
      simulation: status.simulation,
      lastConnectionAt: status.lastConnectionAt,
      lastEventAt: status.lastEventAt,
      webhook: config.EVOLUTION_WEBHOOK_URL ? "ok" : "error",
      qr: qr?.code ?? null,
      pairingCode: qr?.pairingCode ?? null,
      qrCount: qr?.count ?? null,
      qrExpiresAt: qr?.expiresAt ?? null,
      updatedAt: new Date().toISOString(),
    };
  });
  app.post("/whatsapp/instance", { preHandler: requireAuth(authClient) }, async () =>
    connectionWhatsapp.createInstance(),
  );
  app.delete("/whatsapp/instance", { preHandler: requireAuth(authClient) }, async (_request, reply) => {
    await connectionWhatsapp.deleteInstance();
    return reply.code(204).send();
  });
  app.post("/whatsapp/connect", { preHandler: requireAuth(authClient) }, async () => {
    if (config.MOCK_EVOLUTION && !overrides.whatsappProvider)
      throw Object.assign(new Error("Evolution API real não configurada. O QR Code fictício foi removido."), {
        statusCode: 409,
      });
    return connectionWhatsapp.connect();
  });
  app.get("/whatsapp/qr", { preHandler: requireAuth(authClient) }, async () => {
    if (config.MOCK_EVOLUTION && !overrides.whatsappProvider)
      throw Object.assign(new Error("Evolution API real não configurada. Não existe QR Code para renovar."), {
        statusCode: 409,
      });
    return connectionWhatsapp.getQrCode();
  });
  app.post("/whatsapp/restart", { preHandler: requireAuth(authClient) }, async () =>
    connectionWhatsapp.restart(),
  );
  app.post("/whatsapp/logout", { preHandler: requireAuth(authClient) }, async () => {
    await connectionWhatsapp.logout();
    return { success: true };
  });
  app.post("/whatsapp/webhook/configure", { preHandler: requireAuth(authClient) }, async () => {
    await connectionWhatsapp.configureWebhook();
    return { success: true };
  });
  app.get("/whatsapp/diagnostics", { preHandler: requireAuth(authClient) }, async () => ({
    status: await publicConnectionStatus(),
    instanceName: config.EVOLUTION_INSTANCE_NAME,
    connectionMode: config.MOCK_EVOLUTION ? "not_configured" : "evolution",
    webhookConfigured: Boolean(config.EVOLUTION_WEBHOOK_URL),
    apiKeyConfigured: Boolean(config.EVOLUTION_API_KEY),
    apiKeyExposed: false,
  }));
  app.post("/whatsapp/test", { preHandler: requireAuth(authClient) }, async (request) => {
    const body = z
      .object({
        phone: z.string().regex(/^55\d{10,11}$/),
        text: z.string().min(1).max(1000),
        confirmation: z.string().optional(),
        idempotencyKey: z.string().uuid(),
      })
      .parse(request.body);
    const general = await repository.getSettings("general");
    const normalized = normalizeBrazilianPhone(body.phone);
    const operationalTestMode =
      general.globalPause === true &&
      config.OUTREACH_ONLINE_ONLY &&
      config.OUTREACH_ONLINE_TEST_PHONE === "5582988543864";
    if (
      operationalTestMode &&
      (!normalized.valid || normalized.normalized !== config.OUTREACH_ONLINE_TEST_PHONE)
    ) {
      await repository.audit("TEST_MODE_BLOCKED_OUTBOUND", "whatsapp", null, {
        phone: normalized.normalized ?? body.phone,
        job: body.idempotencyKey,
        reason: "Destino fora da allowlist do modo de teste.",
        timestamp: new Date().toISOString(),
      });
      throw Object.assign(new Error("TEST_MODE_BLOCKED_OUTBOUND"), { statusCode: 409 });
    }
    const simulation = config.MOCK_EVOLUTION || config.SIMULATION_MODE || !config.REAL_SENDING_ENABLED;
    if (!simulation && body.confirmation !== "ENVIAR TESTE MANUAL")
      throw Object.assign(new Error("Confirme explicitamente o envio manual real."), { statusCode: 409 });
    if (!simulation && (await connectionWhatsapp.getConnectionStatus()).state !== "open")
      throw Object.assign(new Error("WhatsApp não está conectado."), { statusCode: 409 });
    if (serviceDb) {
      const blocked = await serviceDb
        .from("suppression_list")
        .select("id")
        .eq("phone", body.phone)
        .eq("active", true)
        .maybeSingle();
      if (blocked.error) throw blocked.error;
      if (blocked.data)
        throw Object.assign(new Error("Número consta na lista de supressão."), { statusCode: 409 });
    }
    const reserved = await repository.recordWebhook(`manual-send:${body.idempotencyKey}`, "manual_send", {
      phoneSuffix: body.phone.slice(-4),
    });
    if (!reserved) return { duplicate: true, status: "already_reserved" };
    const manualContext = await repository.ensureManualTestContext(normalized.normalized ?? body.phone);
    const messageKey = `manual:${body.idempotencyKey}`;
    await repository.recordMessage({
      direction: "outbound",
      senderType: "human",
      origin: "manual",
      messageType: "text",
      leadId: manualContext.leadId,
      conversationId: manualContext.conversationId,
      content: body.text,
      idempotencyKey: messageKey,
      status: "queued",
      createdAt: new Date().toISOString(),
    });
    let result;
    try {
      result = await outboundWhatsapp.sendText(body.phone, body.text, body.idempotencyKey);
    } catch (error) {
      await repository.recordMessage({
        direction: "outbound",
        senderType: "human",
        origin: "manual",
        messageType: "text",
        leadId: manualContext.leadId,
        conversationId: manualContext.conversationId,
        content: body.text,
        idempotencyKey: messageKey,
        status: "review_required",
        errorMessage: error instanceof Error ? error.message : "Resultado desconhecido",
      });
      throw error;
    }
    await repository.recordMessage({
      direction: "outbound",
      senderType: "human",
      origin: "manual",
      messageType: "text",
      leadId: manualContext.leadId,
      conversationId: manualContext.conversationId,
      content: body.text,
      idempotencyKey: messageKey,
      externalId: result.externalMessageId,
      status: simulation ? "simulated" : "sent",
      sentAt: new Date().toISOString(),
    });
    await repository.audit("whatsapp.test", "whatsapp", null, {
      phoneSuffix: body.phone.slice(-4),
      simulation: config.SIMULATION_MODE || !config.REAL_SENDING_ENABLED,
      idempotencyKey: body.idempotencyKey,
    });
    return result;
  });

  app.post("/materials", { preHandler: requireAuth(authClient) }, async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.code(400).send({ message: "Selecione um arquivo." });
    const allowed = /^(image\/|video\/|audio\/|application\/(pdf|vnd\.|msword|octet-stream))/.test(
      file.mimetype,
    );
    if (!allowed) return reply.code(415).send({ message: "Tipo de arquivo não permitido." });
    const buffer = await file.toBuffer();
    const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
    const fields = Object.fromEntries(
      Object.entries(file.fields).map(([key, value]: any) => [key, value.value]),
    );
    const metadata = z
      .object({
        name: z.string().min(2).max(200),
        description: z.string().max(2000).default(""),
        category: z.string().min(1).max(100),
        tags: z.string().default(""),
        allowedStages: z.string().default(""),
        relatedIntent: z.string().default(""),
        instruction: z.string().max(2000).default(""),
        active: z.string().default("true"),
        autoSendAllowed: z.string().default("false"),
        humanConfirmationRequired: z.string().default("true"),
      })
      .parse(fields);
    const materialValues = {
      name: metadata.name,
      description: metadata.description,
      category: metadata.category,
      tags: metadata.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      storagePath: `mock/${crypto.randomUUID()}/${sanitizeFileName(file.filename)}`,
      allowedStages: metadata.allowedStages
        .split(",")
        .map((stage) => stage.trim())
        .filter(Boolean),
      relatedIntent: metadata.relatedIntent || null,
      instruction: metadata.instruction,
      mimeType: file.mimetype,
      sizeBytes: buffer.length,
      checksum,
      active: metadata.active === "true",
      autoSendAllowed: metadata.autoSendAllowed === "true",
      humanConfirmationRequired: metadata.humanConfirmationRequired === "true",
    };
    if (config.MOCK_MODE || !serviceDb)
      return repository.createResource("materials", { ...materialValues, simulated: true });
    const objectPath = `${crypto.randomUUID()}/${sanitizeFileName(file.filename)}`;
    const uploaded = await serviceDb.storage
      .from("materials")
      .upload(objectPath, buffer, { contentType: file.mimetype, upsert: false });
    if (uploaded.error) throw uploaded.error;
    try {
      return await repository.createResource("materials", { ...materialValues, storagePath: objectPath });
    } catch (error) {
      await serviceDb.storage.from("materials").remove([objectPath]);
      throw error;
    }
  });

  app.patch("/materials/:id", { preHandler: requireAuth(authClient) }, async (request) => {
    const id = z
      .string()
      .min(1)
      .max(100)
      .parse((request.params as any).id);
    const values = validateResource("materials", request.body, true);
    const updated = await repository.updateResource("materials", id, values);
    await repository.audit("material.updated", "material", id, { fields: Object.keys(values) });
    return updated;
  });
  app.delete("/materials/:id", { preHandler: requireAuth(authClient) }, async (request, reply) => {
    const id = z
      .string()
      .min(1)
      .max(100)
      .parse((request.params as any).id);
    await repository.updateResource("materials", id, { active: false, archivedAt: new Date().toISOString() });
    await repository.audit("material.archived", "material", id);
    return reply.code(204).send();
  });
  app.get("/materials/:id/preview", { preHandler: requireAuth(authClient) }, async (request) => {
    const id = z
      .string()
      .min(1)
      .max(100)
      .parse((request.params as any).id);
    if (!serviceDb) return { id, url: null, simulated: true };
    const owner = await serverOwnerId(serviceDb);
    const material = await serviceDb
      .from("materials")
      .select("storage_path,mime_type,name")
      .eq("owner_id", owner)
      .eq("id", id)
      .is("archived_at", null)
      .single();
    if (material.error) throw material.error;
    const signed = await serviceDb.storage.from("materials").createSignedUrl(material.data.storage_path, 300);
    if (signed.error) throw signed.error;
    return {
      id,
      url: signed.data.signedUrl,
      mimeType: material.data.mime_type,
      name: material.data.name,
      expiresIn: 300,
    };
  });
  app.get("/materials/:id/history", { preHandler: requireAuth(authClient) }, async (request) => {
    const id = z
      .string()
      .min(1)
      .max(100)
      .parse((request.params as any).id);
    if (!serviceDb) return { rows: [] };
    const result = await serviceDb
      .from("material_send_history")
      .select("id,material_name,lead_id,conversation_id,mode,status,reason,created_at")
      .eq("owner_id", await serverOwnerId(serviceDb))
      .eq("material_id", id)
      .order("created_at", { ascending: false });
    if (result.error) throw result.error;
    return { rows: result.data ?? [] };
  });

  app.post("/knowledge", { preHandler: requireAuth(authClient) }, async (request, reply) => {
    const values = validateResource("knowledge", request.body, false);
    const created = await repository.createResource("knowledge", values);
    await repository.audit("knowledge.created", "knowledge", String(created.id), { source: values.source });
    return reply.code(201).send(created);
  });
  app.patch("/knowledge/:id", { preHandler: requireAuth(authClient) }, async (request) => {
    const id = z
      .string()
      .min(1)
      .max(100)
      .parse((request.params as any).id);
    return repository.updateResource("knowledge", id, validateResource("knowledge", request.body, true));
  });
  app.delete("/knowledge/:id", { preHandler: requireAuth(authClient) }, async (request, reply) => {
    const id = z
      .string()
      .min(1)
      .max(100)
      .parse((request.params as any).id);
    await repository.updateResource("knowledge", id, { active: false, archivedAt: new Date().toISOString() });
    await repository.audit("knowledge.archived", "knowledge", id);
    return reply.code(204).send();
  });
  app.post("/knowledge/upload", { preHandler: requireAuth(authClient) }, async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.code(400).send({ message: "Selecione um arquivo." });
    const accepted =
      /^(text\/|application\/(pdf|json|vnd\.ms-powerpoint|vnd\.openxmlformats-officedocument\.presentationml\.presentation))/.test(
        file.mimetype,
      );
    if (!accepted) return reply.code(415).send({ message: "Use texto, JSON, PDF ou apresentação." });
    const buffer = await file.toBuffer();
    const fields = Object.fromEntries(
      Object.entries(file.fields).map(([key, value]: any) => [key, value.value]),
    );
    const meta = z
      .object({
        title: z.string().min(2).max(200),
        category: z.string().min(1).max(100),
        subject: z.string().max(200).default(""),
        tags: z.string().default(""),
        stages: z.string().default(""),
      })
      .parse(fields);
    const extractable = file.mimetype.startsWith("text/") || file.mimetype === "application/json";
    const content = extractable ? buffer.toString("utf8").slice(0, 500_000) : "";
    const created = await repository.createResource("knowledge", {
      ...meta,
      tags: meta.tags
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      stages: meta.stages
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      source: file.mimetype,
      content,
      active: true,
    });
    await repository.audit("knowledge.file_uploaded", "knowledge", String(created.id), {
      mimeType: file.mimetype,
      extracted: extractable,
      sizeBytes: buffer.length,
    });
    return reply
      .code(201)
      .send({ ...created, extractionStatus: extractable ? "completed" : "manual_required" });
  });

  app.post("/appointments/:id/reschedule", { preHandler: requireAuth(authClient) }, async (request) => {
    const id = z
      .string()
      .min(1)
      .max(100)
      .parse((request.params as any).id);
    const body = z
      .object({
        startsAt: z.string().datetime(),
        endsAt: z.string().datetime(),
        notes: z.string().max(4000).optional(),
      })
      .refine((value) => value.endsAt > value.startsAt, { message: "O fim deve ser posterior ao início." })
      .parse(request.body);
    await ensureNoAppointmentConflict(repository, body, id);
    const updated = await repository.updateResource("demos", id, { ...body, status: "rescheduled" });
    await repository.audit("appointment.rescheduled", "appointment", id, {
      startsAt: body.startsAt,
      endsAt: body.endsAt,
    });
    return updated;
  });
  app.get("/appointments/:id/history", { preHandler: requireAuth(authClient) }, async (request) => {
    const id = z
      .string()
      .min(1)
      .max(100)
      .parse((request.params as any).id);
    if (!serviceDb) return { rows: [] };
    const result = await serviceDb
      .from("appointment_history")
      .select("id,action,previous_status,next_status,details,created_at")
      .eq("owner_id", await serverOwnerId(serviceDb))
      .eq("appointment_id", id)
      .order("created_at", { ascending: false });
    if (result.error) throw result.error;
    return { rows: result.data ?? [] };
  });
  app.get("/appointments/availability/slots", { preHandler: requireAuth(authClient) }, async () => ({
    rows: (await repository.getSettings("outreach")).demoSlots ?? [],
    blocks: (await repository.getSettings("outreach")).demoBlockedSlots ?? "",
  }));

  app.post("/conversations/:leadId/takeover", { preHandler: requireAuth(authClient) }, async (request) => {
    const leadId = z
      .string()
      .uuid()
      .parse((request.params as any).leadId);
    const body = z
      .object({
        state: z.enum([
          "ai_active",
          "human_requested",
          "human_active",
          "ai_paused",
          "returned_to_ai",
          "closed",
        ]),
        reason: z.string().max(1000).default(""),
        notes: z.string().max(2000).default(""),
      })
      .parse(request.body);
    const active = ["human_requested", "human_active", "ai_paused"].includes(body.state);
    if (!serviceDb) {
      await repository.updateResource("leads", leadId, {
        humanActive: body.state === "human_active",
        automationPaused: active,
      });
      await repository.createResource("handoffs", {
        leadId,
        reason: body.reason,
        result: body.notes,
        status: body.state,
      });
      return { ...body, leadId };
    }
    const owner = await serverOwnerId(serviceDb);
    const conversation = await serviceDb
      .from("conversations")
      .select("id")
      .eq("owner_id", owner)
      .eq("lead_id", leadId)
      .maybeSingle();
    await Promise.all([
      serviceDb
        .from("leads")
        .update({
          human_active: body.state === "human_active",
          automation_paused: active,
          stage: active ? "human_handoff" : undefined,
        })
        .eq("owner_id", owner)
        .eq("id", leadId),
      serviceDb
        .from("conversations")
        .update({
          human_active: body.state === "human_active",
          status: active ? "paused" : body.state === "closed" ? "closed" : "active",
          takeover_state: body.state,
        })
        .eq("owner_id", owner)
        .eq("lead_id", leadId),
      serviceDb.from("conversation_takeovers").insert({
        owner_id: owner,
        lead_id: leadId,
        conversation_id: conversation.data?.id ?? null,
        state: body.state,
        reason: body.reason,
        notes: body.notes,
        actor_id: request.userId,
      }),
    ]);
    await repository.audit("takeover.changed", "lead", leadId, { state: body.state, reason: body.reason });
    return { ...body, leadId };
  });
  app.get("/conversations/:leadId/takeover", { preHandler: requireAuth(authClient) }, async (request) => {
    const leadId = z
      .string()
      .uuid()
      .parse((request.params as any).leadId);
    if (!serviceDb) return { rows: [] };
    const result = await serviceDb
      .from("conversation_takeovers")
      .select("id,state,reason,notes,actor_id,created_at")
      .eq("owner_id", await serverOwnerId(serviceDb))
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false });
    if (result.error) throw result.error;
    return { rows: result.data ?? [] };
  });
  app.patch("/notifications/:id/read", { preHandler: requireAuth(authClient) }, async (request) => {
    const id = z
      .string()
      .min(1)
      .max(100)
      .parse((request.params as any).id);
    return repository.updateResource("notifications", id, { readAt: new Date().toISOString() });
  });

  app.post(
    "/webhooks/evolution",
    { config: { rateLimit: { max: 600, timeWindow: "1 minute" } }, bodyLimit: 512 * 1024 },
    async (request, reply) => {
      const payload = z.record(z.unknown()).parse(request.body);
      const instanceName = String(
        payload.instance ?? (payload.data as Record<string, unknown> | undefined)?.instance ?? "",
      );
      const agent = Object.values(whatsappAgents).find(
        (candidate) => candidate.instanceName === instanceName,
      );
      if (!agent) return reply.code(404).send({ message: "Instância Evolution desconhecida." });
      if (!agent.provider.validateWebhook(request.headers))
        return reply.code(401).send({ message: "Webhook não autorizado." });
      const event = agent.provider.normalizeEvent(payload);
      if (!(await repository.recordWebhook(event.eventId, event.sourceEvent, event.raw)))
        return reply.code(200).send({ duplicate: true });
      if (!event.relevant) return reply.code(202).send({ accepted: true, ignored: event.ignoreReason });
      await repository.enqueue(
        "evolution_event",
        { event, agent: agent.slug, agentId: agent.slug },
        new Date(),
        `evolution:${agent.slug}:${event.eventId}`,
      );
      return reply.code(202).send({
        accepted: true,
        eventId: event.eventId,
        agent: agent.slug,
        instanceName: agent.instanceName,
      });
    },
  );

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "request_failed");
    if (error instanceof z.ZodError)
      return reply.code(400).send({
        message: "Dados inválidos.",
        error: "INVALID_CALL_PAYLOAD",
        fields: Object.fromEntries(
          error.issues.map((issue) => [issue.path.join(".") || "body", issue.message]),
        ),
        issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
    const knownError = error as {
      statusCode?: number;
      status?: number;
      message?: string;
      code?: string;
      fields?: Record<string, string>;
    };
    const statusCode =
      error instanceof GroqProviderError ? error.status : (knownError.statusCode ?? knownError.status ?? 500);
    return reply.code(statusCode).send({
      ...(knownError.code ? { error: knownError.code } : {}),
      ...(knownError.fields ? { fields: knownError.fields } : {}),
      message:
        statusCode < 500
          ? (knownError.message ?? "Falha na solicitação.")
          : "Falha interna. Consulte os logs da API.",
    });
  });

  return app;
}

function requireAuth(authClient: SupabaseClient | null) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (config.MOCK_MODE && token === "mock-admin-token") {
      request.userId = "mock-admin";
      return;
    }
    if (!token || !authClient) return reply.code(401).send({ message: "Não autenticado." });
    const { data, error } = await authClient.auth.getUser(token);
    if (error || !data.user) return reply.code(401).send({ message: "Sessão inválida ou expirada." });
    request.userId = data.user.id;
  };
}

function requireWolfAuth(authClient: SupabaseClient | null) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const extensionToken = request.headers["x-wolf-extension-token"];
    if (extensionToken === wolfExtensionToken) {
      request.userId = "wolf-extension";
      return;
    }
    return requireAuth(authClient)(request, reply);
  };
}

function createAuthClient() {
  return !config.MOCK_MODE && config.SUPABASE_URL && config.SUPABASE_ANON_KEY
    ? createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, { auth: { persistSession: false } })
    : null;
}
function createServiceClient() {
  return !config.MOCK_MODE && config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    : null;
}
function sanitizeFileName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .slice(0, 160);
}
function safeApiSearch(value: string) {
  return value.replace(/[%(),]/g, "").slice(0, 80);
}
function resolveGroqApiKey(settings: Record<string, unknown>) {
  if (typeof settings.apiKeyEncrypted === "string" && settings.apiKeyEncrypted) {
    try {
      return decryptSecret(settings.apiKeyEncrypted, config.ENCRYPTION_KEY);
    } catch {
      return config.GROQ_API_KEY;
    }
  }
  return config.GROQ_API_KEY;
}
function sanitizeGroqSettings(settings: Record<string, unknown>) {
  const safe = Object.fromEntries(
    Object.entries(settings).filter(([key]) => key !== "apiKeyEncrypted" && key !== "apiKey"),
  );
  return {
    ...safe,
    configured: Boolean(settings.apiKeyEncrypted || config.GROQ_API_KEY || config.MOCK_GROQ),
    apiKeyMasked:
      settings.apiKeyMasked ??
      (config.GROQ_API_KEY ? maskSecret(config.GROQ_API_KEY) : config.MOCK_GROQ ? "mock" : ""),
  };
}
function redactRecord(value: Record<string, unknown>): Record<string, unknown> {
  const sensitive = /authorization|api.?key|service.?role|password|secret|token/i;
  const visit = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(visit);
    if (!input || typeof input !== "object")
      return typeof input === "string" && input.length > 4000 ? `${input.slice(0, 4000)}…` : input;
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>).map(([key, nested]) => [
        key,
        sensitive.test(key) ? "[REDACTED]" : visit(nested),
      ]),
    );
  };
  return visit(value) as Record<string, unknown>;
}
async function ensureNoAppointmentConflict(
  repository: Repository,
  values: Record<string, unknown>,
  ignoreId?: string,
) {
  if (!values.startsAt) return;
  const start = new Date(String(values.startsAt));
  const end = new Date(String(values.endsAt ?? new Date(start.getTime() + 45 * 60_000).toISOString()));
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start)
    throw Object.assign(new Error("Intervalo de agendamento inválido."), { statusCode: 400 });
  const page = await repository.page("demos", { page: 1, pageSize: 100 });
  const conflict = page.rows.find(
    (row) =>
      String(row.id) !== ignoreId &&
      !["cancelled", "completed", "no_show"].includes(String(row.status)) &&
      (!values.assignee || !row.assignee || row.assignee === values.assignee) &&
      start <
        new Date(
          String(
            row.endsAt ?? new Date(new Date(String(row.startsAt)).getTime() + 45 * 60_000).toISOString(),
          ),
        ) &&
      end > new Date(String(row.startsAt)),
  );
  if (conflict)
    throw Object.assign(new Error("Conflito de horário para o closer selecionado."), { statusCode: 409 });
}

const resourceSchemas = {
  leads: z.object({
    phone: z
      .string()
      .regex(/^55\d{10,11}$/)
      .optional(),
    name: z.string().max(160).nullable().optional(),
    company: z.string().max(200).nullable().optional(),
    source: z.string().max(200).optional(),
    stage: z.enum(leadStages).optional(),
    automationPaused: z.boolean().optional(),
    humanActive: z.boolean().optional(),
    lostReason: z.string().max(1000).nullable().optional(),
  }),
  batches: z.object({
    name: z.string().min(2).max(120).optional(),
    source: z.string().min(2).max(200).optional(),
    status: z.enum(["draft", "scheduled", "active", "paused", "completed", "cancelled"]).optional(),
    priority: z.number().int().min(1).max(10).optional(),
    startDate: z.string().optional(),
    dailyLimit: z.number().int().positive().max(10000).nullable().optional(),
  }),
  queue: z.object({
    status: z.enum(["pending", "processing", "completed", "failed", "dead", "cancelled"]).optional(),
    availableAt: z.string().datetime().optional(),
    lastError: z.string().max(2000).nullable().optional(),
    attempts: z.number().int().min(0).optional(),
  }),
  conversations: z.object({
    status: z.enum(["active", "paused", "closed"]).optional(),
    stage: z.enum(leadStages).optional(),
    humanActive: z.boolean().optional(),
    summary: z.string().max(4000).optional(),
  }),
  demos: z.object({
    leadId: z.string().uuid().optional(),
    conversationId: z.string().uuid().nullable().optional(),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    status: z
      .enum([
        "pending",
        "scheduled",
        "requested",
        "proposed",
        "confirmed",
        "completed",
        "cancelled",
        "no_show",
        "rescheduled",
      ])
      .optional(),
    assignee: z.string().max(200).optional(),
    notes: z.string().max(4000).optional(),
    origin: z.enum(["ai", "manual"]).optional(),
    reminderAt: z.string().datetime().nullable().optional(),
    cancelledAt: z.string().datetime().nullable().optional(),
  }),
  followups: z.object({
    leadId: z.string().uuid().optional(),
    scheduledAt: z.string().datetime().optional(),
    status: z.enum(["scheduled", "processing", "completed", "cancelled", "failed"]).optional(),
    attemptNumber: z.number().int().min(1).max(20).optional(),
    reason: z.string().max(1000).optional(),
  }),
  handoffs: z.object({
    leadId: z.string().uuid().optional(),
    reason: z.string().min(2).max(1000).optional(),
    status: z.enum(["pending", "active", "returned", "closed"]).optional(),
    assignedTo: z.string().max(200).nullable().optional(),
    result: z.string().max(2000).nullable().optional(),
    assumedAt: z.string().datetime().nullable().optional(),
    closedAt: z.string().datetime().nullable().optional(),
  }),
  optouts: z.object({
    phone: z
      .string()
      .regex(/^55\d{10,11}$/)
      .optional(),
    reason: z.string().min(2).max(1000).optional(),
    source: z.string().max(100).optional(),
    active: z.boolean().optional(),
  }),
  materials: z.object({
    name: z.string().min(2).max(200).optional(),
    description: z.string().max(2000).optional(),
    category: z.string().min(1).max(100).optional(),
    tags: z.array(z.string().max(80)).optional(),
    storagePath: z.string().max(500).optional(),
    allowedStages: z.array(z.string()).optional(),
    relatedIntent: z.string().max(100).nullable().optional(),
    instruction: z.string().max(2000).optional(),
    active: z.boolean().optional(),
    autoSendAllowed: z.boolean().optional(),
    humanConfirmationRequired: z.boolean().optional(),
    sizeBytes: z.number().int().positive().max(26214400).optional(),
    mimeType: z.string().max(200).optional(),
    checksum: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    simulated: z.boolean().optional(),
  }),
  knowledge: z.object({
    title: z.string().min(2).max(200).optional(),
    category: z.string().min(1).max(100).optional(),
    subject: z.string().max(200).optional(),
    tags: z.array(z.string().max(80)).optional(),
    stages: z.array(z.string().max(80)).optional(),
    source: z.string().max(200).optional(),
    content: z.string().max(500000).optional(),
    active: z.boolean().optional(),
    archivedAt: z.string().datetime().nullable().optional(),
  }),
  notifications: z.object({ readAt: z.string().datetime().nullable().optional() }),
  openers: z.object({
    name: z.string().min(2).max(160).optional(),
    content: z.string().min(10).max(2000).optional(),
    active: z.boolean().optional(),
  }),
  wolfCalls: z.object({
    leadId: z.string().uuid().nullable().optional(),
    operatorId: z.string().uuid().nullable().optional(),
    direction: z.enum(["inbound", "outbound"]).optional(),
    status: z.string().max(40).optional(),
    startedAt: z.string().datetime().nullable().optional(),
    endedAt: z.string().datetime().nullable().optional(),
    durationSeconds: z.number().int().min(0).optional(),
    result: z.string().max(100).nullable().optional(),
    summary: z.string().max(8000).nullable().optional(),
    transcript: z.array(z.record(z.unknown())).optional(),
    liveContext: z.record(z.unknown()).optional(),
  }),
  wolfTurns: z.object({
    callId: z.string().uuid(),
    speaker: z.enum(["operator", "client"]),
    text: z.string().min(1).max(4000),
    sequence: z.number().int().min(0),
    startedAt: z.string().datetime().optional(),
    endedAt: z.string().datetime().nullable().optional(),
    partial: z.boolean().optional(),
  }),
  wolfInsights: z.object({
    callId: z.string().uuid(),
    kind: z.string().min(1).max(80),
    value: z.string().min(1).max(2000),
    confidence: z.number().min(0).max(1).nullable().optional(),
  }),
  wolfLeadStates: z.object({
    leadId: z.string().uuid(),
    status: z.string().max(40),
    cohortDate: z.string().optional(),
    firstCallAt: z.string().datetime().nullable().optional(),
    lastCallAt: z.string().datetime().nullable().optional(),
    nextCallAt: z.string().datetime().nullable().optional(),
    totalAttempts: z.number().int().min(0).optional(),
    answeredAttempts: z.number().int().min(0).optional(),
    convertedAt: z.string().datetime().nullable().optional(),
    conversionType: z.string().max(100).nullable().optional(),
  }),
  wolfCallEvents: z.object({
    leadId: z.string().uuid(),
    callId: z.string().uuid().nullable().optional(),
    eventType: z.string().min(1).max(60),
    occurredAt: z.string().datetime().optional(),
    metadata: z.record(z.unknown()).optional(),
  }),
} satisfies Record<EditableResourceKey, z.ZodObject<any>>;
const creatableResources = new Set<EditableResourceKey>([
  "leads",
  "demos",
  "followups",
  "handoffs",
  "optouts",
  "knowledge",
  "openers",
]);
const deletableResources = new Set<EditableResourceKey>([
  "demos",
  "followups",
  "handoffs",
  "optouts",
  "openers",
]);
function editableResourceKey(value: unknown): EditableResourceKey {
  const key = z
    .enum([
      "leads",
      "batches",
      "queue",
      "conversations",
      "demos",
      "followups",
      "handoffs",
      "optouts",
      "materials",
      "knowledge",
      "notifications",
      "openers",
      "wolfCalls",
      "wolfTurns",
      "wolfInsights",
      "wolfLeadStates",
      "wolfCallEvents",
    ])
    .parse(value);
  return key;
}
function validateResource(key: EditableResourceKey, input: unknown, partial: boolean) {
  const values = resourceSchemas[key].parse(input) as Record<string, unknown>;
  if (!Object.keys(values).length)
    throw Object.assign(new Error("Informe ao menos um campo válido."), { statusCode: 400 });
  if (!partial) validateRequiredCreate(key, values);
  return values;
}
function validateRequiredCreate(key: EditableResourceKey, values: Record<string, unknown>) {
  const required: Partial<Record<EditableResourceKey, string[]>> = {
    leads: ["phone", "source"],
    demos: ["leadId", "startsAt", "endsAt"],
    followups: ["leadId", "scheduledAt", "reason"],
    handoffs: ["leadId", "reason"],
    optouts: ["phone", "reason"],
    knowledge: ["title", "category", "content"],
    openers: ["name", "content"],
  };
  const missing = (required[key] ?? []).filter(
    (field) => values[field] === undefined || values[field] === "",
  );
  if (missing.length)
    throw Object.assign(new Error(`Campos obrigatórios: ${missing.join(", ")}.`), { statusCode: 400 });
}
function importReason(status: string) {
  return (
    (
      {
        duplicate_existing: "Número já cadastrado.",
        blocked: "Número presente na lista de supressão.",
        already_approached: "Número já abordado anteriormente.",
        in_conversation: "Número possui conversa em andamento.",
      } as Record<string, string>
    )[status] ?? "Contato indisponível para importação."
  );
}
let serverOwnerCache: string | null = null;
async function serverOwnerId(client: SupabaseClient) {
  if (serverOwnerCache) return serverOwnerCache;
  const { data, error } = await client
    .from("profiles")
    .select("id")
    .eq("role", "admin")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (error || !data?.id)
    throw Object.assign(new Error("Administrador não encontrado. Execute o seed."), { statusCode: 503 });
  serverOwnerCache = data.id as string;
  return serverOwnerCache;
}
async function syncAvailability(client: SupabaseClient, values: Record<string, unknown>) {
  const ownerId = await serverOwnerId(client);
  const weekdays = parseWeekdays(values.demoDays);
  const start = String(values.demoStartTime ?? "09:00");
  const end = String(values.demoEndTime ?? "17:00");
  const duration = Math.max(15, Math.min(240, Number(values.demoDurationMinutes ?? 45)));
  const buffer = Math.max(0, Math.min(120, Number(values.demoBufferMinutes ?? 15)));
  const notice = Math.max(0, Math.min(720, Number(values.demoMinNoticeHours ?? 24)));
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end) || start >= end)
    throw Object.assign(new Error("Horários da agenda inválidos."), { statusCode: 400 });
  const blocked = String(values.demoBlockedSlots ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [from, to, reason = "Bloqueio manual"] = line.split("|").map((part) => part.trim());
      if (
        !from ||
        !to ||
        Number.isNaN(Date.parse(from)) ||
        Number.isNaN(Date.parse(to)) ||
        new Date(to) <= new Date(from)
      )
        throw Object.assign(
          new Error("Use uma linha por bloqueio no formato: início ISO | fim ISO | motivo."),
          { statusCode: 400 },
        );
      return {
        owner_id: ownerId,
        starts_at: new Date(from).toISOString(),
        ends_at: new Date(to).toISOString(),
        reason,
      };
    });
  const removed = await client.from("availability_rules").delete().eq("owner_id", ownerId);
  if (removed.error) throw removed.error;
  const inserted = await client.from("availability_rules").insert(
    weekdays.map((weekday) => ({
      owner_id: ownerId,
      weekday,
      start_time: start,
      end_time: end,
      duration_minutes: duration,
      buffer_minutes: buffer,
      min_notice_hours: notice,
      active: true,
    })),
  );
  if (inserted.error) throw inserted.error;
  const removedBlocks = await client.from("availability_blocks").delete().eq("owner_id", ownerId);
  if (removedBlocks.error) throw removedBlocks.error;
  if (blocked.length) {
    const insertedBlocks = await client.from("availability_blocks").insert(blocked);
    if (insertedBlocks.error) throw insertedBlocks.error;
  }
}
function parseWeekdays(value: unknown) {
  if (Array.isArray(value)) {
    const valid = value.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
    if (valid.length) return [...new Set(valid)];
  }
  const text = String(value ?? "").toLocaleLowerCase("pt-BR");
  if (text.includes("segunda") && text.includes("sexta")) return [1, 2, 3, 4, 5];
  const valid = text
    .split(/[^0-9]+/)
    .map(Number)
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  return valid.length ? [...new Set(valid)] : [1, 2, 3, 4, 5];
}
