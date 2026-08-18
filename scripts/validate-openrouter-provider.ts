import { config as loadEnv } from "dotenv";
import { AgentExecutionService } from "../packages/core/src/agent/agent-execution-service.js";
import type { AgentSnapshot } from "../packages/core/src/agent/types.js";
import { createRepository } from "../packages/database/src/index.js";
import { OpenRouterProvider, OpenRouterProviderError } from "../packages/integrations/src/openrouter.js";

loadEnv({ path: ".env.local", quiet: true });

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const apiKey = process.env.OPENROUTER_API_KEY_1;
if (!url || !serviceKey || !apiKey) throw new Error("Configuração obrigatória ausente.");
const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };

async function rows(table: string, query: string) {
  const response = await fetch(`${url}/rest/v1/${table}?${query}`, { headers });
  if (!response.ok) throw new Error(`${table}: HTTP ${response.status}`);
  return await response.json() as Array<Record<string, any>>;
}

async function main() {
  const [settings, knowledge] = await Promise.all([
    rows("system_settings", "select=section,values&section=in.(mind,commercial)"),
    rows("knowledge_items", "select=title,category,subject,tags,stages,source,content,active&active=eq.true&archived_at=is.null&limit=100"),
  ]);
  const setting = (section: string) => settings.find((item) => item.section === section)?.values ?? {};
  const snapshot: AgentSnapshot = {
    mind: setting("mind"), commercial: { ...setting("mind"), ...setting("commercial") }, knowledgeItems: knowledge,
    lead: {}, batch: {}, stage: "qualifying", summary: "", messages: [{ role: "agent", text: "Tudo bem? Você é o responsável pela ótica?" }], memories: [], materials: [], availableSlots: [], followUps: [], questionsAsked: [], materialsSent: [],
    humanActive: false, automationPaused: false, blocked: false, qualificationStatus: "discovering", qualificationScore: 0, handoffType: null, mariliaConsent: "not_asked",
  };
  const model = process.env.OPENROUTER_MODEL ?? "openai/gpt-oss-20b:free";
  const message = "Oi, sou eu";
  const started = Date.now();
  try {
    const result = await new AgentExecutionService(new OpenRouterProvider({ apiKey })).execute({ snapshot, userMessage: message, model, temperature: 0.3 });
    const reply = result.decision.replyText ?? "";
    const repository = createRepository({ mock: false, supabaseUrl: url, serviceRoleKey: serviceKey });
    const observedAt = new Date().toISOString();
    await repository.saveSettings("openrouter_1", { model, providerPool: "openrouter_1", enabled: true, freeModel: true, actualModel: result.metrics?.model ?? model, circuit: "online", cooldownUntil: null, eligibleAt: observedAt, lastHealth: { status: "healthy", observedAt }, rateLimits: result.rateLimits, lastSuccessAt: observedAt, lastFailure: null });
    console.log(JSON.stringify({
      providerPool: "openrouter_1", http: 200, requestedModel: model, actualModel: result.metrics?.model ?? model, free: result.metrics?.freeModel === true,
      usageCost: result.metrics?.usageCost ?? null, latencyMs: result.metrics?.latencyMs ?? Date.now() - started,
      inputTokens: result.metrics?.inputTokens ?? 0, outputTokens: result.metrics?.outputTokens ?? 0, totalTokens: result.metrics?.totalTokens ?? 0,
      rateLimitMetadata: result.rateLimits, remaining: result.rateLimits && typeof result.rateLimits === "object" ? (result.rateLimits as Record<string, unknown>).remainingRequests ?? "UNKNOWN" : "UNKNOWN",
      structuredOutputValid: true,
      quality: { natural: reply.length > 0 && reply.length <= 1_600, portuguese: /\b(?:oi|sou|você|sua|ótica|posso|claro|tudo)\b/i.test(reply), grounded: !/30%|5 minutos|follow-up automático de orçamento/i.test(reply), compactContext: result.context.estimatedTokens <= 2_000, currentTurnNotDuplicated: !result.context.systemPrompt.includes(message) },
    }));
  } catch (error) {
    console.log(JSON.stringify({ providerPool: "openrouter_1", http: error instanceof OpenRouterProviderError ? error.status : 0, requestedModel: model, actualModel: null, free: true, latencyMs: Date.now() - started, inputTokens: 0, outputTokens: 0, totalTokens: 0, rateLimitMetadata: null, remaining: "UNKNOWN", structuredOutputValid: false, error: error instanceof Error ? error.message.slice(0, 500) : "Falha desconhecida" }));
    process.exitCode = 1;
  }
}

void main();
