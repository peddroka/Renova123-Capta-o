import { describe, expect, it, vi } from "vitest";
import { eligibleProviderOrder, groqAttemptModels, isSharedGroqQuotaError, providerPoolRetrySeconds } from "./ai-fallback-policy.js";

describe("política de fallback inbound", () => {
  it("tenta cada modelo Groq no máximo uma vez e não repete o primário", () => {
    expect(groqAttemptModels({ primaryModel: "groq-120b", fallbackModel: "groq-20b", circuitOpen: false })).toEqual(["groq-120b", "groq-20b"]);
    expect(groqAttemptModels({ primaryModel: "groq-120b", fallbackModel: "groq-120b", circuitOpen: false })).toEqual(["groq-120b"]);
  });

  it("pula Groq imediatamente quando o circuit breaker está aberto", () => {
    expect(groqAttemptModels({ primaryModel: "groq-120b", fallbackModel: "groq-20b", circuitOpen: true })).toEqual([]);
  });

  it("não tenta o 20b quando o 429 informa quota compartilhada da organização", () => {
    const error = new Error("Rate limit reached for model openai/gpt-oss-120b in organization org_x on tokens per day (TPD)");
    expect(isSharedGroqQuotaError(error)).toBe(true);
    expect(groqAttemptModels({ primaryModel: "groq-120b", fallbackModel: "groq-20b", circuitOpen: false, sharedQuotaBlocked: true })).toEqual([]);
  });

  it("pula diretamente ao próximo provider em qualquer 429 Groq", () => {
    expect(groqAttemptModels({ primaryModel: "groq-120b", fallbackModel: "groq-20b", circuitOpen: false, sharedQuotaBlocked: true })).toEqual([]);
  });

  it("agenda o pool para o primeiro provider realmente elegível", () => {
    expect(providerPoolRetrySeconds(310, 45, 120, 90)).toBe(45);
    expect(providerPoolRetrySeconds(310, 0, 0, 0)).toBe(310);
    expect(providerPoolRetrySeconds(0, 0, 0, 0)).toBe(60);
  });

  it.each([
    ["Groq saudável", [], ["groq", "openrouter_1", "gemini"]],
    ["Groq 429", ["groq"], ["openrouter_1", "gemini"]],
    ["Groq em cooldown", ["groq"], ["openrouter_1", "gemini"]],
    ["Groq e OpenRouter em cooldown", ["groq", "openrouter_1"], ["gemini"]],
    ["todos indisponíveis", ["groq", "openrouter_1", "gemini"], []],
  ])("roteia sem duplicação: %s", (_case, blocked, expected) => {
    const order = ["groq", "openrouter_1", "gemini"] as const;
    expect(eligibleProviderOrder(order.map((provider) => ({ provider, eligible: !blocked.includes(provider) })))).toEqual(expected);
  });

  it.each([
    ["A", { groq: "healthy", openrouter_1: "healthy", gemini: "healthy" }, "groq", [1, 0, 0]],
    ["B", { groq: "failed", openrouter_1: "healthy", gemini: "healthy" }, "openrouter_1", [1, 1, 0]],
    ["C", { groq: "cooldown", openrouter_1: "healthy", gemini: "healthy" }, "openrouter_1", [0, 1, 0]],
    ["D", { groq: "cooldown", openrouter_1: "failed", gemini: "healthy" }, "gemini", [0, 1, 1]],
    ["E", { groq: "cooldown", openrouter_1: "cooldown", gemini: "healthy" }, "gemini", [0, 0, 1]],
    ["F", { groq: "cooldown", openrouter_1: "cooldown", gemini: "cooldown" }, "defer", [0, 0, 0]],
  ] as const)("executa o plano mock do caso %s", async (_case, states, expected, callCounts) => {
    const calls = { groq: vi.fn(), openrouter_1: vi.fn(), gemini: vi.fn(), openrouter_2: vi.fn(), openrouter_3: vi.fn() };
    let selected = "defer";
    for (const provider of ["groq", "openrouter_1", "gemini"] as const) {
      if (states[provider] === "cooldown") continue;
      calls[provider]();
      if (states[provider] === "healthy") { selected = provider; break; }
    }
    expect(selected).toBe(expected);
    expect([calls.groq.mock.calls.length, calls.openrouter_1.mock.calls.length, calls.gemini.mock.calls.length]).toEqual(callCounts);
    expect(calls.openrouter_2).not.toHaveBeenCalled();
    expect(calls.openrouter_3).not.toHaveBeenCalled();
  });
});
