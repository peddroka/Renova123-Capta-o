import { describe, expect, it } from "vitest";
import { GroqProvider, GroqRateLimitError } from "./groq.js";

describe("Groq GPT-OSS e métricas", () => {
  it("usa os modelos GPT-OSS e registra tokens/latência", async () => {
    const provider = new GroqProvider({ simulationMode: true });
    const models = await provider.listModels();
    expect(models.map((model) => model.id)).toEqual(expect.arrayContaining(["openai/gpt-oss-120b", "openai/gpt-oss-20b"]));
    const result = await provider.generateStructuredResponse({ systemPrompt: "Contexto compacto", userMessage: "Tenho interesse", model: "openai/gpt-oss-120b" });
    expect(result.metrics).toMatchObject({ provider: "groq", model: "openai/gpt-oss-120b", success: true, rateLimited: false });
    expect(result.metrics.totalTokens).toBeGreaterThan(0);
  });

  it("preserva o fluxo áudio → transcrição com métricas", async () => {
    const result = await new GroqProvider({ simulationMode: true }).transcribeAudio({ bytes: new Uint8Array([1, 2, 3]), fileName: "lead.ogg", mimeType: "audio/ogg", model: "whisper-large-v3-turbo" });
    expect(result.text).toContain("Transcrição");
    expect(result.metrics).toMatchObject({ model: "whisper-large-v3-turbo", success: true });
  });

  it("mantém Retry-After como limite controlado para 429", () => expect(new GroqRateLimitError("limite", 17, null).retryAfterSeconds).toBe(17));

  it("registra o tipo e a conta exata de uma quota Groq", async () => {
    const message = "Rate limit reached on tokens per day (TPD): Limit 200000, Used 198518, Requested 2199.";
    const provider = new GroqProvider({ apiKey: "test", fetchImpl: async () => new Response(JSON.stringify({ error: { message } }), { status: 429, headers: { "retry-after": "310", "x-ratelimit-limit-tokens": "8000" } }) });
    await expect(provider.generateStructuredResponse({ systemPrompt: "s", userMessage: "u", model: "openai/gpt-oss-120b" })).rejects.toMatchObject({ rateLimits: { quotaType: "TPD", quotaLimit: 200000, quotaUsed: 198518, quotaRequested: 2199 } });
  });
});
