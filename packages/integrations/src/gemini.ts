import type { AiDecision } from "@renova123/shared";
import { AiStructuredOutputError, parseAiDecision, providerDecisionJsonSchema } from "./ai-decision.js";
import { mockDecision } from "./groq.js";
type AgentCallMetrics = { provider: string; model: string; inputTokens: number; outputTokens: number; totalTokens: number; latencyMs: number; success: boolean; error: string | null; rateLimited: boolean; cachedTokens?: number; systemTokens?: number; schemaTokens?: number; currentTurnTokens?: number; timestamp?: string };

export class GeminiProviderError extends Error { constructor(message: string, public readonly status: number, public readonly recoverable = true) { super(message); } }
export class GeminiRateLimitError extends GeminiProviderError { constructor(message: string, public readonly retryAfterSeconds = 30) { super(message, 429, true); } }

export class GeminiProvider {
  constructor(private readonly options: { apiKey?: string; model?: string; simulationMode?: boolean; fetchImpl?: typeof fetch }) {}
  async generateStructuredResponse(input: { systemPrompt: string; userMessage: string; model: string; temperature?: number }): Promise<{ decision: AiDecision; rateLimits: null; metrics: AgentCallMetrics }> {
    const started = Date.now();
    if (this.options.simulationMode) {
      const decision = mockDecision(input.userMessage);
      return { decision, rateLimits: null, metrics: metrics(input.model, input.systemPrompt, JSON.stringify(decision), Date.now() - started, true, null, false) };
    }
    if (!this.options.apiKey) throw new GeminiProviderError("GEMINI_API_KEY não configurada.", 503, false);
    try {
      const systemPrompt = input.systemPrompt;
      const response = await (this.options.fetchImpl ?? fetch)(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent?key=${encodeURIComponent(this.options.apiKey)}`, { method: "POST", signal: AbortSignal.timeout(45_000), headers: { "content-type": "application/json" }, body: JSON.stringify({ systemInstruction: { parts: [{ text: systemPrompt }] }, contents: [{ role: "user", parts: [{ text: input.userMessage }] }], generationConfig: { responseMimeType: "application/json", responseJsonSchema: providerDecisionJsonSchema, temperature: input.temperature ?? 0.3, maxOutputTokens: 1200 } }) });
      if (!response.ok) { const retry = response.headers.get("retry-after"); const payload = await response.json().catch(() => ({})) as { error?: { message?: string } }; const message = payload.error?.message ?? `Gemini respondeu HTTP ${response.status}.`; const retryFromMessage = Number(message.match(/retry in\s+([\d.]+)s/i)?.[1] ?? 0); if (response.status === 429) throw new GeminiRateLimitError(message, retry ? Math.max(1, Number(retry) || 30) : Math.max(1, Math.ceil(retryFromMessage || 30))); throw new GeminiProviderError(message, response.status, response.status >= 500); }
      const data = await response.json() as { candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number; cachedContentTokenCount?: number } };
      const finishReason = data.candidates?.[0]?.finishReason ?? null;
      const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
      if (!text) throw new GeminiProviderError("Gemini não retornou conteúdo estruturado.", 502, true);
      let decision;
      try { decision = parseAiDecision("gemini", text, input.userMessage); }
      catch (error) {
        if (error instanceof AiStructuredOutputError) throw new AiStructuredOutputError("gemini", `${error.message}${finishReason ? ` (finishReason=${finishReason})` : ""}`, error.rawOutput);
        throw error;
      }
      const inputTokens = Number(data.usageMetadata?.promptTokenCount ?? estimate(systemPrompt + input.userMessage));
      const outputTokens = Number(data.usageMetadata?.candidatesTokenCount ?? estimate(text));
      return { decision, rateLimits: null, metrics: { provider: "gemini", model: input.model, inputTokens, outputTokens, totalTokens: Number(data.usageMetadata?.totalTokenCount ?? inputTokens + outputTokens), latencyMs: Date.now() - started, success: true, error: null, rateLimited: false, cachedTokens: Number(data.usageMetadata?.cachedContentTokenCount ?? 0), systemTokens: estimate(systemPrompt), currentTurnTokens: estimate(input.userMessage), schemaTokens: estimate(JSON.stringify(providerDecisionJsonSchema)), timestamp: new Date().toISOString() } };
    } catch (error) {
      if (error instanceof AiStructuredOutputError || error instanceof GeminiProviderError) throw error;
      throw new GeminiProviderError(error instanceof Error ? error.message : "Falha ao acessar Gemini.", 503, true);
    }
  }
}
function estimate(value: string) { return Math.max(1, Math.ceil(value.length / 4)); }
function metrics(model: string, input: string, output: string, latencyMs: number, success: boolean, error: string | null, rateLimited: boolean): AgentCallMetrics { const inputTokens = estimate(input); const outputTokens = estimate(output); return { provider: "gemini", model, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, latencyMs, success, error, rateLimited, timestamp: new Date().toISOString() }; }
