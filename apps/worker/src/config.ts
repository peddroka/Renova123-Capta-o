import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { assertWorkerStartupAllowed } from "./startup-safety.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnv({ path: [resolve(repositoryRoot, ".env.local"), resolve(repositoryRoot, ".env")], override: false, quiet: true });

const bool = (fallback: boolean) => z.string().default(String(fallback)).transform((value) => value.toLowerCase() === "true");

function optionalHttpUrl(value: string | undefined, name: string, allowInvalid: boolean) {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  try {
    const url = new URL(normalized);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported protocol");
    return url.toString().replace(/\/$/, "");
  } catch {
    if (allowInvalid) return undefined;
    throw new Error(`${name} deve ser uma URL HTTP(S) válida fora do modo mock.`);
  }
}

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  BUILD_VERSION: z.string().default("local"),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-3.5-flash"),
  OPENROUTER_API_KEY_1: z.string().optional(),
  OPENROUTER_MODEL: z.string().default("openai/gpt-oss-20b:free"),
  ENCRYPTION_KEY: z.string().min(16).default("development-encryption-key-change-me"),
  GROQ_MODEL: z.string().default("openai/gpt-oss-120b"),
  GROQ_FALLBACK_MODEL: z.string().default("openai/gpt-oss-20b"),
  GROQ_WHISPER_MODEL: z.string().default("whisper-large-v3-turbo"),
  TRANSCRIBE_AUDIO_ENABLED: bool(false),
  EVOLUTION_BASE_URL: z.string().optional(),
  EVOLUTION_API_URL: z.string().default("http://127.0.0.1:8080"),
  EVOLUTION_API_KEY: z.string().default(""),
  AUTHENTICATION_API_KEY: z.string().optional().default(""),
  EVOLUTION_INSTANCE_NAME: z.string().default("renova123-francisco"),
  EVOLUTION_WEBHOOK_URL: z.string().url().default("http://host.docker.internal:3333/webhooks/evolution"),
  EVOLUTION_WEBHOOK_SECRET: z.string().min(16).optional(),
  WHATSAPP_QUALIFIED_GROUP_ID: z.preprocess((value) => value === "" ? undefined : value, z.string().trim().min(1).optional()),
  WHATSAPP_STALLED_GROUP_ID: z.preprocess((value) => value === "" ? undefined : value, z.string().trim().min(1).optional()),
  SALES_CLOSER_NAME: z.string().trim().min(1).default("Pedro"),
  SALES_CLOSER_PHONE: z.string().regex(/^55\d{10,11}$/).default("5582988543864"),
  QUALIFICATION_DEADLINE_HOURS: z.coerce.number().int().positive().default(72),
  LOCAL_API_PORT: z.coerce.number().int().positive().default(3333),
  LOCAL_API_URL: z.string().url().default("http://127.0.0.1:3333"),
  APP_URL: z.string().url().default("http://127.0.0.1:5173"),
  TIMEZONE: z.string().default("America/Sao_Paulo"),
  MOCK_MODE: bool(true),
  MOCK_GROQ: bool(true),
  MOCK_GEMINI: bool(true),
  MOCK_EVOLUTION: bool(true),
  OUTREACH_ENABLED: bool(false),
  OUTREACH_ONLINE_ONLY: bool(false),
  OUTREACH_ONLINE_FRESHNESS_SECONDS: z.coerce.number().int().positive().default(15),
  OUTREACH_ONLINE_TEST_PHONE: z.preprocess((value) => value === "" ? undefined : value, z.string().regex(/^55\d{10,11}$/).optional()),
  OUTREACH_PRESENCE_PROBE_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),
  OUTREACH_PRESENCE_PROBE_INTERVAL_SECONDS: z.coerce.number().int().min(15).max(900).default(60),
  SIMULATION_MODE: bool(true),
  REAL_SENDING_ENABLED: bool(false),
  ALLOW_REAL_OUTREACH_DEV: bool(false),
  MOCK_DB_PATH: z.string().optional(),
  LOG_LEVEL: z.string().default("info"),
  WORKER_POLL_MS: z.coerce.number().int().min(200).max(60000).default(1500),
  WORKER_HEARTBEAT_MS: z.coerce.number().int().min(5000).max(120000).default(10000),
  WORKER_RUN_ONCE: bool(false),
  JOB_LEASE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(300_000),
});

const parsed = schema.parse(process.env);
assertWorkerStartupAllowed(parsed);
if (parsed.NODE_ENV === "production" && parsed.ENCRYPTION_KEY === "development-encryption-key-change-me") throw new Error("ENCRYPTION_KEY deve ser um segredo próprio em produção.");
const supabaseUrl = optionalHttpUrl(parsed.SUPABASE_URL, "SUPABASE_URL", parsed.MOCK_MODE);
const evolutionUrl = optionalHttpUrl(
  parsed.EVOLUTION_BASE_URL ?? parsed.EVOLUTION_API_URL,
  "EVOLUTION_BASE_URL/EVOLUTION_API_URL",
  parsed.MOCK_MODE || parsed.MOCK_EVOLUTION,
);
export const workerConfig = {
  ...parsed,
  SUPABASE_URL: supabaseUrl,
  EVOLUTION_BASE_URL: evolutionUrl ?? "http://127.0.0.1:8080",
  EVOLUTION_API_URL: evolutionUrl ?? "http://127.0.0.1:8080",
  EVOLUTION_API_KEY: parsed.EVOLUTION_API_KEY || parsed.AUTHENTICATION_API_KEY,
  simulation: parsed.SIMULATION_MODE || !parsed.REAL_SENDING_ENABLED,
};
export type WorkerConfig = typeof workerConfig;
