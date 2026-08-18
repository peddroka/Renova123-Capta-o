import "groq-sdk/shims/node";
import Groq, { toFile } from "groq-sdk";
import type { AiDecision } from "@renova123/shared";
import { AiStructuredOutputError, parseAiDecision, providerDecisionJsonSchema } from "./ai-decision.js";

export type GroqModel = { id: string; ownedBy: string; createdAt: string; transcription: boolean };
export type GroqRateLimits = { limitRequests: number | null; limitTokens: number | null; remainingRequests: number | null; remainingTokens: number | null; resetRequests: string | null; resetTokens: string | null; retryAfterSeconds: number | null; observedAt: string; quotaType?: "TPM" | "RPM" | "TPD" | "RPD" | "other"; quotaLimit?: number; quotaUsed?: number; quotaRequested?: number };
export type GroqHealth = { ok: boolean; latencyMs: number; modelCount: number; error: string | null; rateLimits: GroqRateLimits | null };
export type GroqCallMetrics = { provider: "groq"; model: string; inputTokens: number; outputTokens: number; totalTokens: number; latencyMs: number; success: boolean; error: string | null; rateLimited: boolean; cachedTokens?: number; systemTokens?: number; schemaTokens?: number; currentTurnTokens?: number };

const compactDecisionShapeInstruction = "Use o schema compacto e retorne todos os campos, mesmo quando o valor for null ou a lista estiver vazia: reply, intent, memories, action, material, appointment, handoff, consent e confidence. NÃ£o omita action, material, appointment, handoff, consent ou confidence.";

export { compactDecisionShapeInstruction };

export class GroqProvider {
  private readonly client: Groq | null;
  private lastRateLimits: GroqRateLimits | null = null;
  constructor(private readonly options: { apiKey?: string | undefined; simulationMode?: boolean; simulationModels?: GroqModel[]; fetchImpl?: typeof fetch }) { this.client = options.apiKey ? new Groq({ apiKey: options.apiKey, maxRetries: 0, timeout: 20_000 }) : null; }

  async listModels(): Promise<GroqModel[]> {
    if (this.options.simulationMode) return this.options.simulationModels ?? mockModels();
    try { const response = await this.request("/models"); const data = await response.json() as { data: Array<{ id: string; owned_by: string; created: number }> }; this.lastRateLimits = this.readRateLimitHeaders(response.headers); return data.data.map((model) => ({ id: model.id, ownedBy: model.owned_by, createdAt: new Date(model.created * 1000).toISOString(), transcription: isWhisper(model.id) })).sort((left, right) => left.id.localeCompare(right.id)); }
    catch (error) { throw this.normalizeError(error); }
  }
  async validateApiKey() { try { const models = await this.listModels(); return { valid: true, models, error: null, rateLimits: this.lastRateLimits }; } catch (error) { return { valid: false, models: [], error: error instanceof Error ? error.message : "Chave Groq inválida.", rateLimits: this.lastRateLimits }; } }

  async generateStructuredResponse(input: { systemPrompt: string; userMessage: string; model: string; temperature?: number }): Promise<{ decision: AiDecision; rateLimits: GroqRateLimits | null; metrics: GroqCallMetrics }> {
    const started = Date.now();
    if (this.options.simulationMode) this.assertSimulationModel(input.model, false);
    if (this.options.simulationMode) { const decision = mockDecision(input.userMessage); return { decision, rateLimits: null, metrics: callMetrics(input.model, estimateTokens(`${input.systemPrompt}\n${input.userMessage}`), estimateTokens(JSON.stringify(decision)), Date.now() - started, true, null, false) }; }
    try {
      const response = await this.request("/chat/completions", { method: "POST", body: JSON.stringify({ model: input.model, temperature: input.temperature ?? 0.3, max_completion_tokens: 1_200, response_format: { type: "json_schema", json_schema: { name: "ai_decision", strict: true, schema: providerDecisionJsonSchema } }, messages: [{ role: "system", content: `${input.systemPrompt}\n${compactDecisionShapeInstruction}` }, { role: "user", content: input.userMessage }] }) });
      const data = await response.json() as { choices: Array<{ message?: { content?: string | null } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } };
      this.lastRateLimits = this.readRateLimitHeaders(response.headers);
      const content = data.choices[0]?.message?.content;
      if (!content) throw new GroqProviderError("A Groq não retornou conteúdo estruturado.", 502, false);
      const decision = parseAiDecision("groq", content, input.userMessage);
      const inputTokens = Number(data.usage?.prompt_tokens ?? estimateTokens(`${input.systemPrompt}\n${input.userMessage}`));
      const outputTokens = Number(data.usage?.completion_tokens ?? estimateTokens(content));
      return { decision, rateLimits: this.lastRateLimits, metrics: { ...callMetrics(input.model, inputTokens, outputTokens, Date.now() - started, true, null, false, Number(data.usage?.total_tokens ?? inputTokens + outputTokens)), cachedTokens: Number(data.usage?.prompt_tokens_details?.cached_tokens ?? 0), systemTokens: estimateTokens(input.systemPrompt), currentTurnTokens: estimateTokens(input.userMessage), schemaTokens: estimateTokens(JSON.stringify(providerDecisionJsonSchema)) } };
    } catch (error) { throw this.normalizeError(error); }
  }

  async transcribeAudio(input: { bytes: Uint8Array; fileName: string; mimeType: string; model: string }): Promise<{ text: string; rateLimits: GroqRateLimits | null; metrics: GroqCallMetrics }> {
    const started = Date.now();
    if (this.options.simulationMode) this.assertSimulationModel(input.model, true);
    if (this.options.simulationMode) { const text = "Transcrição simulada do áudio recebido."; return { text, rateLimits: null, metrics: callMetrics(input.model, Math.max(1, Math.ceil(input.bytes.byteLength / 4)), estimateTokens(text), Date.now() - started, true, null, false) }; }
    const client = this.requiredClient();
    const form = new FormData();
    const audioBuffer = new ArrayBuffer(input.bytes.byteLength);
    new Uint8Array(audioBuffer).set(input.bytes);
    form.append("file", new Blob([audioBuffer], { type: input.mimeType }), input.fileName);
    form.append("model", input.model);
    form.append("language", "pt");
    form.append("response_format", "json");
    form.append("temperature", "0");
    try {
      const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", { method: "POST", headers: { authorization: `Bearer ${this.options.apiKey}` }, body: form, signal: AbortSignal.timeout(20_000) });
      const data = await response.json() as { text?: string; error?: { message?: string } };
      if (!response.ok) throw new GroqProviderError(data.error?.message ?? `Groq respondeu HTTP ${response.status}.`, response.status, response.status >= 500);
      if (!data.text?.trim()) throw new GroqProviderError("A Groq retornou uma transcrição vazia.", 502, false);
      const text = data.text.trim().slice(0, 16_000);
      this.lastRateLimits = this.readRateLimitHeaders(response.headers);
      return { text, rateLimits: this.lastRateLimits, metrics: callMetrics(input.model, Math.max(1, Math.ceil(input.bytes.byteLength / 4)), estimateTokens(text), Date.now() - started, true, null, false) };
    } catch (error) { throw this.normalizeError(error); }
    const buffer = new ArrayBuffer(input.bytes.byteLength); new Uint8Array(buffer).set(input.bytes);
    const upload = await toFile(input.bytes, input.fileName, { type: input.mimeType });
    try {
      const { data, response } = await client.audio.transcriptions.create({ file: upload, model: input.model, language: "pt", response_format: "json", temperature: 0 }).withResponse();
      this.lastRateLimits = this.readRateLimitHeaders(response.headers);
      if (!data.text?.trim()) throw new GroqProviderError("A Groq retornou uma transcrição vazia.", 502, false);
      const text = data.text.trim().slice(0, 16_000);
      return { text, rateLimits: this.lastRateLimits, metrics: callMetrics(input.model, Math.max(1, Math.ceil(input.bytes.byteLength / 4)), estimateTokens(text), Date.now() - started, true, null, false) };
    } catch (error) { throw this.normalizeError(error); }
    try { const { data, response } = await client.audio.transcriptions.create({ file: new File([buffer], input.fileName, { type: input.mimeType }), model: input.model, language: "pt", response_format: "json", temperature: 0 }).withResponse(); this.lastRateLimits = this.readRateLimitHeaders(response.headers); if (!data.text?.trim()) throw new GroqProviderError("A Groq retornou uma transcrição vazia.", 502, false); const text = data.text.trim().slice(0, 16_000); return { text, rateLimits: this.lastRateLimits, metrics: callMetrics(input.model, Math.max(1, Math.ceil(input.bytes.byteLength / 4)), estimateTokens(text), Date.now() - started, true, null, false) }; }
    catch (error) { throw this.normalizeError(error); }
  }

  async healthCheck(): Promise<GroqHealth> { const started = Date.now(); try { const models = await this.listModels(); return { ok: true, latencyMs: Date.now() - started, modelCount: models.length, error: null, rateLimits: this.lastRateLimits }; } catch (error) { return { ok: false, latencyMs: Date.now() - started, modelCount: 0, error: error instanceof Error ? error.message : "Groq indisponível.", rateLimits: this.lastRateLimits }; } }
  readRateLimitHeaders(headers: HeaderLike): GroqRateLimits { return { limitRequests: numberHeader(headers, "x-ratelimit-limit-requests"), limitTokens: numberHeader(headers, "x-ratelimit-limit-tokens"), remainingRequests: numberHeader(headers, "x-ratelimit-remaining-requests"), remainingTokens: numberHeader(headers, "x-ratelimit-remaining-tokens"), resetRequests: headerValue(headers, "x-ratelimit-reset-requests"), resetTokens: headerValue(headers, "x-ratelimit-reset-tokens"), retryAfterSeconds: retryAfter(headerValue(headers, "retry-after")), observedAt: new Date().toISOString() }; }
  private assertSimulationModel(model: string, transcription: boolean) { const models = this.options.simulationModels ?? mockModels(); const selected = models.find((item) => item.id === model); if (!selected || selected.transcription !== transcription) throw new GroqModelUnavailableError(model, models.map((item) => item.id)); }
  private requiredClient() { if (!this.client) throw new GroqProviderError("GROQ_API_KEY não configurada.", 503, false); return this.client; }
  private async request(path: string, init: RequestInit = {}) { if (!this.options.apiKey) throw new GroqProviderError("GROQ_API_KEY não configurada.", 503, false); const response = await (this.options.fetchImpl ?? fetch)(`https://api.groq.com/openai/v1${path}`, { ...init, signal: AbortSignal.timeout(20_000), headers: { authorization: `Bearer ${this.options.apiKey}`, "content-type": "application/json", ...init.headers } }); if (!response.ok) { const payload = await response.json().catch(() => ({})) as { error?: { message?: string; failed_generation?: unknown } }; throw { status: response.status, message: payload.error?.message ?? `Groq respondeu HTTP ${response.status}.`, failedGeneration: payload.error?.failed_generation, headers: response.headers }; } return response; }
  private normalizeError(error: unknown): Error { if (error instanceof AiStructuredOutputError || error instanceof GroqProviderError || error instanceof GroqModelUnavailableError || error instanceof GroqRateLimitError) return error; const value = error as { status?: number; message?: string; failedGeneration?: unknown; headers?: Headers }; if (value.headers) this.lastRateLimits = this.readRateLimitHeaders(value.headers); if (value.status === 429) { const message = value.message ?? "Limite da Groq atingido."; this.lastRateLimits = enrichQuotaDetails(this.lastRateLimits, message); return new GroqRateLimitError(message, this.lastRateLimits?.retryAfterSeconds ?? 30, this.lastRateLimits); } if (value.failedGeneration !== undefined) return new AiStructuredOutputError("groq", value.message ?? "falha ao gerar AiDecision conforme o schema.", JSON.stringify(value.failedGeneration).slice(0, 4_000)); if (value.status === 401 || value.status === 403) return new GroqProviderError("Chave Groq inválida ou sem permissão.", value.status, false); if (value.status === 404) return new GroqProviderError("Modelo Groq não encontrado ou removido.", 404, false); return new GroqProviderError(value.message ?? "Falha ao acessar a Groq.", value.status ?? 503, !value.status || value.status >= 500); }
}

export class GroqProviderError extends Error { constructor(message: string, public readonly status: number, public readonly recoverable: boolean) { super(message); } }
export class GroqRateLimitError extends GroqProviderError { constructor(message: string, public readonly retryAfterSeconds: number, public readonly rateLimits: GroqRateLimits | null) { super(message, 429, true); } }
export class GroqModelUnavailableError extends GroqProviderError { constructor(public readonly model: string, public readonly availableModels: string[]) { super(`O modelo Groq selecionado (${model}) não está ativo nesta conta.`, 409, false); } }
export class GroqStructuredClient { private readonly provider: GroqProvider; constructor(private readonly options: { apiKey: string | undefined; model: string; simulationMode: boolean }) { this.provider = new GroqProvider({ apiKey: options.apiKey, simulationMode: options.simulationMode }); } async decide(systemPrompt: string, userMessage: string) { return (await this.provider.generateStructuredResponse({ systemPrompt, userMessage, model: this.options.model })).decision; } }
export class GroqTranscriptionClient { private readonly provider: GroqProvider; constructor(private readonly options: { apiKey: string | undefined; model: string; enabled: boolean }) { this.provider = new GroqProvider({ apiKey: options.apiKey, simulationMode: !options.enabled }); } async transcribe(bytes: Uint8Array, fileName: string, mimeType: string) { if (!this.options.enabled) return null; return (await this.provider.transcribeAudio({ bytes, fileName, mimeType, model: this.options.model })).text; } }

type HeaderLike = { get?: (name: string) => string | null } | Record<string, unknown>;
function headerValue(headers: HeaderLike, name: string) { if ("get" in headers && typeof headers.get === "function") return headers.get(name); const record = headers as Record<string, unknown>; const value = record[name] ?? record[name.toLowerCase()]; return value == null ? null : String(value); }
function numberHeader(headers: HeaderLike, name: string) { const raw = headerValue(headers, name); if (!raw) return null; const value = Number(raw); return Number.isFinite(value) ? value : null; }
function retryAfter(value: string | null) { if (!value) return null; const seconds = Number(value); if (Number.isFinite(seconds)) return Math.max(0, seconds); const date = Date.parse(value); return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : null; }
function enrichQuotaDetails(rateLimits: GroqRateLimits | null, message: string): GroqRateLimits | null {
  if (!rateLimits) return null;
  const match = /on (?:tokens|requests) per (?:minute|day) \((TPM|RPM|TPD|RPD)\): Limit (\d+), Used (\d+), Requested (\d+)/i.exec(message);
  return match ? { ...rateLimits, quotaType: match[1]!.toUpperCase() as "TPM" | "RPM" | "TPD" | "RPD", quotaLimit: Number(match[2]), quotaUsed: Number(match[3]), quotaRequested: Number(match[4]) } : { ...rateLimits, quotaType: "other" };
}
function isWhisper(model: string) { return /(^|\/)whisper/i.test(model); }
function estimateTokens(value: string) { return Math.max(1, Math.ceil(value.length / 4)); }
function callMetrics(model: string, inputTokens: number, outputTokens: number, latencyMs: number, success: boolean, error: string | null, rateLimited: boolean, totalTokens = inputTokens + outputTokens): GroqCallMetrics { return { provider: "groq", model, inputTokens, outputTokens, totalTokens, latencyMs, success, error, rateLimited }; }
function mockModels(): GroqModel[] { return ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "whisper-large-v3", "whisper-large-v3-turbo"].map((id) => ({ id, ownedBy: "groq-mock", createdAt: "2025-01-01T00:00:00.000Z", transcription: isWhisper(id) })); }

export function mockDecision(message: string): AiDecision { const normalized = message.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, ""); const optOut = /\b(pare|parar|nao tenho interesse|nao me chame|retire meu numero|apague meu contato|nao mande mais|sair|cancelar contato)\b/.test(normalized); const noInterest = /\b(nao tenho interesse|sem interesse)\b/.test(normalized); const human = /\b(humano|pessoa|ligacao|ligar|me ligue|telefone|contrato)\b/.test(normalized); const demo = /\b(demo|demonstracao|apresentacao)\b/.test(normalized); const pricing = /\b(preco|valor|mensalidade|quanto custa)\b/.test(normalized); return { replyText: optOut ? "Entendido. Não enviaremos novas mensagens para este número." : noInterest ? "Tudo bem, agradeço pela resposta. Sucesso para vocês!" : human ? "Claro. Vou encaminhar seu pedido para uma pessoa da equipe." : demo ? "Ótimo. Posso verificar alguns horários disponíveis para uma demonstração?" : pricing ? "Posso confirmar as condições cadastradas para você. Quantas lojas sua ótica possui?" : "Obrigado pela mensagem! Qual é hoje o principal desafio na gestão da sua ótica?", leadStage: optOut ? "opted_out" : noInterest ? "no_interest" : human ? "handoff" : demo ? "demo_requested" : "engaged", detectedIntent: optOut ? "opt_out" : noInterest ? "no_interest" : human ? "call_request" : demo ? "demo" : pricing ? "pricing" : "information", sentiment: noInterest ? "negative" : "neutral", summaryUpdate: message.slice(0, 500), memoryUpdates: [], questionsAnswered: [], objectionsDetected: [], shouldSendMaterial: false, materialQuery: null, shouldProposeDemo: demo, suggestedSlots: [], shouldScheduleDemo: false, appointmentData: null, shouldHandoff: human, handoffReason: human ? "Lead solicitou contato humano." : null, shouldOptOut: optOut, followUpAction: { action: optOut || noInterest || human ? "cancel" : "schedule", delayHours: optOut || noInterest || human ? null : 48, reason: optOut ? "Opt-out confirmado." : noInterest ? "Lead sem interesse." : "Retomar se não houver resposta." }, confidence: 0.92, internalReasoningSummary: "Resposta segura baseada na mensagem recebida.", qualificationStatus: "discovering", handoffType: human ? "human_requested" : null, qualificationScore: 0, mariliaConsent: "not_asked" }; }
