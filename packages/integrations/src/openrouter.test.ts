import { describe, expect, it, vi } from "vitest";
import { providerDecisionJsonSchema } from "./ai-decision.js";
import { OpenRouterProvider, OpenRouterProviderError, OpenRouterRateLimitError } from "./openrouter.js";

const compactDecision = { reply: "Oi! Sou o Francisco, da Renova123. Como posso ajudar?", intent: "greeting", memories: [], action: "continue_discovery", material: null, appointment: null, handoff: null, consent: "not_asked", confidence: 0.92 };

describe("OpenRouter 1 gratuito", () => {
  it("usa o schema compacto, preço máximo zero e registra o modelo efetivo", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ model: "openai/gpt-oss-20b", choices: [{ message: { content: JSON.stringify(compactDecision) } }], usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140, cost: 0 } }), { status: 200, headers: { "x-ratelimit-remaining-requests": "49" } }));
    const result = await new OpenRouterProvider({ apiKey: "test", fetchImpl }).generateStructuredResponse({ systemPrompt: "contexto", userMessage: "Oi, sou eu", model: "openai/gpt-oss-20b:free" });
    expect(result).toMatchObject({ decision: { detectedIntent: "greeting" }, metrics: { provider: "openrouter", providerPool: "openrouter_1", model: "openai/gpt-oss-20b", freeModel: true, inputTokens: 100, outputTokens: 40, totalTokens: 140 }, rateLimits: { remainingRequests: 49 } });
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body));
    expect(body).toMatchObject({ model: "openai/gpt-oss-20b:free", max_tokens: 650, provider: { require_parameters: true, allow_fallbacks: false }, response_format: { type: "json_schema", json_schema: { strict: true, schema: providerDecisionJsonSchema } } });
    expect(body).not.toHaveProperty("max_completion_tokens");
  });

  it("bloqueia modelo pago antes de qualquer request", async () => {
    const fetchImpl = vi.fn();
    await expect(new OpenRouterProvider({ apiKey: "test", fetchImpl }).generateStructuredResponse({ systemPrompt: "s", userMessage: "u", model: "openai/gpt-oss-20b" })).rejects.toBeInstanceOf(OpenRouterProviderError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("respeita 429 sem retry interno", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { message: "rate limit" } }), { status: 429, headers: { "retry-after": "17" } }));
    await expect(new OpenRouterProvider({ apiKey: "test", fetchImpl }).generateStructuredResponse({ systemPrompt: "s", userMessage: "u", model: "openai/gpt-oss-20b:free" })).rejects.toMatchObject({ constructor: OpenRouterRateLimitError, retryAfterSeconds: 17 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
