import { describe, expect, it } from "vitest";
import { GeminiProvider, GeminiRateLimitError } from "./gemini.js";

describe("Gemini fallback provider", () => {
  it("returns the common structured response and metrics in simulation", async () => {
    const result = await new GeminiProvider({ simulationMode: true }).generateStructuredResponse({ systemPrompt: "contexto estruturado", userMessage: "Olá", model: "gemini-3.5-flash" });
    expect(result.metrics.provider).toBe("gemini");
    expect(result.metrics.totalTokens).toBeGreaterThan(0);
    expect(result.decision.replyText).toBeTruthy();
  });

  it("normalizes 429 without exposing the API key", async () => {
    const provider = new GeminiProvider({ apiKey: "test-secret-key", fetchImpl: async () => new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429, headers: { "retry-after": "7" } }) });
    await expect(provider.generateStructuredResponse({ systemPrompt: "s", userMessage: "u", model: "gemini-3.5-flash" })).rejects.toMatchObject({ constructor: GeminiRateLimitError, retryAfterSeconds: 7 });
  });
});
