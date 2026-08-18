import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnv({ path: [resolve(repositoryRoot, ".env.local"), resolve(repositoryRoot, ".env")], override: false, quiet: true });

const booleanString = (defaultValue: boolean) => z.string().default(String(defaultValue)).transform((value) => value.toLowerCase() === "true");
const hostedAppUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://127.0.0.1:5173";

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
  API_PORT: z.coerce.number().int().positive().default(Number(process.env.PORT ?? 3333)),
  LOCAL_API_PORT: z.coerce.number().int().positive().optional(),
  API_HOST: z.string().default(process.env.VERCEL || process.env.PORT ? "0.0.0.0" : "127.0.0.1"),
  LOCAL_API_URL: z.string().url().default("http://127.0.0.1:3333"),
  APP_URL: z.string().url().default(hostedAppUrl),
  MOCK_MODE: booleanString(true),
  MOCK_GROQ: booleanString(true),
  MOCK_GEMINI: booleanString(true),
  MOCK_EVOLUTION: booleanString(true),
  OUTREACH_ENABLED: booleanString(false),
  OUTREACH_ONLINE_ONLY: booleanString(false),
  OUTREACH_ONLINE_TEST_PHONE: z.preprocess((value) => value === "" ? undefined : value, z.string().regex(/^55\d{10,11}$/).optional()),
  SIMULATION_MODE: booleanString(true),
  REAL_SENDING_ENABLED: booleanString(false),
  WEBHOOK_SECRET: z.string().min(16).default("development-only-secret-change-me"),
  ENCRYPTION_KEY: z.string().min(16).default("development-encryption-key-change-me"),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  WOLF_AI_MODEL: z.string().default("gpt-5.6-luna"),
  WOLF_REASONING_EFFORT: z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]).default("medium"),
  WOLF_TRANSCRIPTION_MODEL: z.string().default("gpt-live-transcribe"),
  WOLF_TRANSCRIPTION_DELAY: z.enum(["minimal", "low", "medium", "high"]).default("low"),
  WOLF_TRANSCRIPTION_PROVIDER: z.enum(["local", "openai"]).default("local"),
  WOLF_LOCAL_TRANSCRIPTION_URL: z.string().url().default("http://127.0.0.1:8765"),
  WOLF_LOCAL_TRANSCRIPTION_MODEL: z.string().default("small"),
  WOLF_LOCAL_TRANSCRIPTION_LANGUAGE: z.string().default("pt"),
  WOLF_AI_PROVIDER: z.enum(["ollama", "openai"]).default("ollama"),
  WOLF_OLLAMA_BASE_URL: z.string().url().default("http://127.0.0.1:11434"),
  WOLF_OLLAMA_MODEL: z.string().default("qwen3.5:9b"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-3.5-flash"),
  GROQ_MODEL: z.string().default("openai/gpt-oss-120b"),
  GROQ_FALLBACK_MODEL: z.string().default("openai/gpt-oss-20b"),
  EVOLUTION_API_URL: z.string().default("http://127.0.0.1:8080"),
  EVOLUTION_BASE_URL: z.string().optional(),
  EVOLUTION_API_KEY: z.string().optional().default(""),
  AUTHENTICATION_API_KEY: z.string().optional().default(""),
  EVOLUTION_INSTANCE_NAME: z.string().default("renova123-francisco"),
  EVOLUTION_WEBHOOK_URL: z.string().url().default("http://host.docker.internal:3333/webhooks/evolution"),
  EVOLUTION_WEBHOOK_SECRET: z.string().min(16).optional(),
  TIMEZONE: z.string().default("America/Sao_Paulo"),
  LOG_LEVEL: z.string().default("info"),
});

const parsed = schema.parse(process.env);
if (parsed.NODE_ENV === "production" && parsed.ENCRYPTION_KEY === "development-encryption-key-change-me") throw new Error("ENCRYPTION_KEY deve ser um segredo próprio em produção.");
const supabaseUrl = optionalHttpUrl(parsed.SUPABASE_URL, "SUPABASE_URL", parsed.MOCK_MODE);
const evolutionUrl = optionalHttpUrl(
  parsed.EVOLUTION_BASE_URL ?? parsed.EVOLUTION_API_URL,
  "EVOLUTION_BASE_URL/EVOLUTION_API_URL",
  parsed.MOCK_MODE || parsed.MOCK_EVOLUTION,
);
export const config = {
  ...parsed,
  OUTREACH_ONLINE_TEST_PHONE: parsed.NODE_ENV === "test" ? (parsed.OUTREACH_ONLINE_TEST_PHONE ?? "5582988543864") : parsed.OUTREACH_ONLINE_TEST_PHONE,
  MOCK_MODE: parsed.NODE_ENV === "test" ? true : parsed.MOCK_MODE,
  MOCK_GROQ: parsed.NODE_ENV === "test" ? true : parsed.MOCK_GROQ,
  MOCK_GEMINI: parsed.NODE_ENV === "test" ? true : parsed.MOCK_GEMINI,
  MOCK_EVOLUTION: parsed.NODE_ENV === "test" ? true : parsed.MOCK_EVOLUTION,
  OUTREACH_ENABLED: parsed.NODE_ENV === "test" ? false : parsed.OUTREACH_ENABLED,
  SIMULATION_MODE: parsed.NODE_ENV === "test" ? true : parsed.SIMULATION_MODE,
  REAL_SENDING_ENABLED: parsed.NODE_ENV === "test" ? false : parsed.REAL_SENDING_ENABLED,
  API_PORT: process.env.VERCEL ? parsed.API_PORT : (parsed.LOCAL_API_PORT ?? parsed.API_PORT),
  SUPABASE_URL: supabaseUrl,
  EVOLUTION_API_URL: evolutionUrl ?? "http://127.0.0.1:8080",
  EVOLUTION_BASE_URL: evolutionUrl ?? "http://127.0.0.1:8080",
  EVOLUTION_API_KEY: parsed.EVOLUTION_API_KEY || parsed.AUTHENTICATION_API_KEY,
  WEBHOOK_SECRET: parsed.EVOLUTION_WEBHOOK_SECRET ?? parsed.WEBHOOK_SECRET,
};
