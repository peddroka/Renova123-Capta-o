import type { AiDecision } from "@renova123/shared";
import { AiStructuredOutputError, parseAiDecision, providerDecisionJsonSchema } from "./ai-decision.js";

export type OpenRouterRateLimits = {
  limitRequests: number | null;
  remainingRequests: number | null;
  resetRequests: string | null;
  retryAfterSeconds: number | null;
  observedAt: string;
};

export type OpenRouterCallMetrics = {
  provider: "openrouter";
  providerPool: "openrouter_1";
  model: string;
  openRouterModel: string;
  freeModel: true;
  usageCost?: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
  success: boolean;
  error: string | null;
  rateLimited: boolean;
  cachedTokens?: number;
  cooldownUntil?: string | null;
};

export class OpenRouterProviderError extends Error {
  constructor(message: string, public readonly status: number, public readonly recoverable = true) {
    super(message);
    this.name = "OpenRouterProviderError";
  }
}

export class OpenRouterRateLimitError extends OpenRouterProviderError {
  constructor(message: string, public readonly retryAfterSeconds: number, public readonly rateLimits: OpenRouterRateLimits) {
    super(message, 429, true);
    this.name = "OpenRouterRateLimitError";
  }
}

export class OpenRouterProvider {
  private readonly baseUrl: string;
  private lastRateLimits: OpenRouterRateLimits | null = null;

  constructor(private readonly options: { apiKey?: string; baseUrl?: string; fetchImpl?: typeof fetch }) {
    this.baseUrl = (options.baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
  }

  async generateStructuredResponse(input: { systemPrompt: string; userMessage: string; model: string; temperature?: number }): Promise<{ decision: AiDecision; rateLimits: OpenRouterRateLimits | null; metrics: OpenRouterCallMetrics }> {
    assertFreeModel(input.model);
    const started = Date.now();
    try {
      const response = await this.request("/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          model: input.model,
          temperature: input.temperature ?? 0.3,
          max_tokens: 650,
          provider: { require_parameters: true, allow_fallbacks: false },
          response_format: { type: "json_schema", json_schema: { name: "ai_decision", strict: true, schema: providerDecisionJsonSchema } },
          messages: [{ role: "system", content: input.systemPrompt }, { role: "user", content: input.userMessage }],
        }),
      });
      const payload = await response.json() as {
        model?: string;
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number; prompt_tokens_details?: { cached_tokens?: number } };
      };
      if (typeof payload.usage?.cost === "number" && payload.usage.cost > 0) throw new OpenRouterProviderError("OpenRouter retornou custo não zero para um modelo gratuito.", 409, false);
      const content = payload.choices?.[0]?.message?.content?.trim();
      if (!content) throw new OpenRouterProviderError("OpenRouter não retornou conteúdo estruturado.", 502, true);
      const decision = parseAiDecision("openrouter", content, input.userMessage);
      const actualModel = payload.model ?? input.model;
      const inputTokens = payload.usage?.prompt_tokens ?? estimateTokens(input.systemPrompt) + estimateTokens(input.userMessage);
      const outputTokens = payload.usage?.completion_tokens ?? estimateTokens(content);
      return {
        decision,
        rateLimits: this.lastRateLimits,
        metrics: {
          provider: "openrouter",
          providerPool: "openrouter_1",
          model: actualModel,
          openRouterModel: actualModel,
          freeModel: true,
          usageCost: payload.usage?.cost ?? 0,
          inputTokens,
          outputTokens,
          totalTokens: payload.usage?.total_tokens ?? inputTokens + outputTokens,
          latencyMs: Date.now() - started,
          success: true,
          error: null,
          rateLimited: false,
          cachedTokens: payload.usage?.prompt_tokens_details?.cached_tokens ?? 0,
          cooldownUntil: null,
        },
      };
    } catch (error) {
      if (error instanceof AiStructuredOutputError || error instanceof OpenRouterProviderError) throw error;
      throw new OpenRouterProviderError(error instanceof Error ? error.message : "Falha ao acessar OpenRouter.", 503, true);
    }
  }

  private async request(path: string, init: RequestInit) {
    if (!this.options.apiKey) throw new OpenRouterProviderError("OPENROUTER_API_KEY_1 não configurada.", 503, false);
    const response = await (this.options.fetchImpl ?? fetch)(`${this.baseUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(20_000),
      headers: { authorization: `Bearer ${this.options.apiKey}`, "content-type": "application/json", ...init.headers },
    });
    this.lastRateLimits = readRateLimits(response.headers);
    if (response.ok) return response;
    const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
    const message = payload.error?.message ?? `OpenRouter respondeu HTTP ${response.status}.`;
    if (response.status === 429) throw new OpenRouterRateLimitError(message, retrySeconds(this.lastRateLimits), this.lastRateLimits);
    if (response.status === 401 || response.status === 403) throw new OpenRouterProviderError("Credencial OpenRouter 1 inválida ou sem permissão.", response.status, false);
    if (response.status === 402) throw new OpenRouterProviderError("Billing/crédito indisponível em openrouter_1.", 402, false);
    if (response.status === 404) throw new OpenRouterProviderError(`Modelo gratuito OpenRouter não disponível: ${message}`, 404, false);
    throw new OpenRouterProviderError(message, response.status, response.status >= 500);
  }
}

export function assertFreeModel(model: string) {
  if (!model.endsWith(":free")) throw new OpenRouterProviderError("OpenRouter bloqueou modelo sem garantia explícita de gratuidade.", 400, false);
}

function readRateLimits(headers: Headers): OpenRouterRateLimits {
  return {
    limitRequests: numericHeader(headers, "x-ratelimit-limit-requests") ?? numericHeader(headers, "x-ratelimit-limit"),
    remainingRequests: numericHeader(headers, "x-ratelimit-remaining-requests") ?? numericHeader(headers, "x-ratelimit-remaining"),
    resetRequests: headers.get("x-ratelimit-reset-requests") ?? headers.get("x-ratelimit-reset"),
    retryAfterSeconds: numericHeader(headers, "retry-after"),
    observedAt: new Date().toISOString(),
  };
}

function retrySeconds(limits: OpenRouterRateLimits) { return Math.max(1, Math.ceil(limits.retryAfterSeconds ?? 60)); }
function numericHeader(headers: Headers, name: string) { const raw = headers.get(name); if (raw === null || raw.trim() === "") return null; const value = Number(raw); return Number.isFinite(value) && value >= 0 ? value : null; }
function estimateTokens(value: string) { return Math.max(1, Math.ceil(value.length / 4)); }
