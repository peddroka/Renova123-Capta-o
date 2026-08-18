import { describe, expect, it, vi } from "vitest";
import { aiDecisionJsonSchema, AiStructuredOutputError, parseAiDecision, providerDecisionJsonSchema } from "./ai-decision.js";
import { GeminiProvider } from "./gemini.js";
import { GroqProvider, mockDecision } from "./groq.js";
import { normalizeWhatsAppText } from "./whatsapp.js";

const validDecision = mockDecision("Tenho interesse");
const compactDecision = { reply: "Claro, posso te mostrar.", intent: "demo", memories: [], action: "offer_demo", material: null, appointment: null, handoff: null, consent: "pending", confidence: 0.92 };

describe("contrato único AiDecision", () => {
  it("fecha todos os objetos e exige todos os campos do schema Zod", () => {
    expect(aiDecisionJsonSchema.additionalProperties).toBe(false);
    expect(aiDecisionJsonSchema.required).toEqual(expect.arrayContaining(["replyText", "detectedIntent", "followUpAction", "qualificationStatus", "handoffType", "qualificationScore", "mariliaConsent"]));
    const followUp = (aiDecisionJsonSchema.properties as Record<string, any>).followUpAction;
    expect(followUp).toMatchObject({ additionalProperties: false, required: ["action", "delayHours", "reason"] });
    const signals = (aiDecisionJsonSchema.properties as Record<string, any>).conversationSignals;
    expect(signals.required).toEqual(expect.arrayContaining(["permissionToContinue", "commercialInterest", "currentTopic"]));
  });

  it.each([
    JSON.stringify({ ...validDecision, detectedIntent: "clarification_needed", followUpAction: { action: "await_response", delayHours: null, reason: "aguardar" } }),
    JSON.stringify({ replyText: "Posso ajudar?" }),
  ])("rejeita os formatos reais que falharam no último inbound", (raw) => {
    expect(() => parseAiDecision("groq", raw)).toThrow(AiStructuredOutputError);
  });

  it("distingue newline JSON válido de escape textual duplo e normaliza só na fronteira", () => {
    const validNewline = parseAiDecision("groq", JSON.stringify({ ...validDecision, replyText: "Oi\nQual é o seu nome?" }));
    const doubleEscaped = parseAiDecision("groq", JSON.stringify({ ...validDecision, replyText: "Oi\\nQual é o seu nome?" }));
    expect(validNewline.replyText).toBe("Oi\nQual é o seu nome?");
    expect(doubleEscaped.replyText).toBe("Oi\\nQual é o seu nome?");
    expect(normalizeWhatsAppText(doubleEscaped.replyText!)).toBe(validNewline.replyText);
  });

  it("não perde o inbound real quando o modelo devolve horário relativo no appointmentData", () => {
    const parsed = parseAiDecision("gemini", JSON.stringify({
      ...validDecision,
      replyText: "Terça às 16h faz sentido. Vou confirmar a disponibilidade.",
      detectedIntent: "demo",
      shouldScheduleDemo: true,
      appointmentData: { startsAt: "terça-feira 16:00", endsAt: "terça-feira 16:20", notes: "Demonstração" },
    }));
    expect(parsed.appointmentData).toBeNull();
    expect(parsed.shouldScheduleDemo).toBe(true);
    expect(parsed.replyText).toMatch(/terça/i);
  });

  it("não perde o inbound quando o Gemini excede apenas limites mecânicos de memória", () => {
    const longQuestion = "contexto interno ".repeat(30);
    const parsed = parseAiDecision("gemini", JSON.stringify({
      ...validDecision,
      replyText: "Terça às 16h. Vou confirmar a disponibilidade.",
      questionsAnswered: [longQuestion],
    }));
    expect(parsed.questionsAnswered).toHaveLength(1);
    expect(parsed.questionsAnswered[0]).toHaveLength(300);
    expect(parsed.replyText).toBe("Terça às 16h. Vou confirmar a disponibilidade.");
  });

  it("aceita apenas um objeto JSON íntegro mesmo quando o provedor adiciona uma cerca", () => {
    const parsed = parseAiDecision("gemini", `\`\`\`json\n${JSON.stringify(validDecision)}\n\`\`\``);
    expect(parsed.replyText).toBe(validDecision.replyText);
  });

  it("rebaixa agendamento sem fuso para confirmação em vez de perder o inbound", () => {
    const parsed = parseAiDecision("gemini", JSON.stringify({
      ...validDecision,
      shouldScheduleDemo: true,
      appointmentData: { startsAt: "2026-08-11T16:00:00", endsAt: "2026-08-11T16:30:00", notes: "Demo" },
    }));
    expect(parsed.appointmentData).toBeNull();
    expect(parsed.shouldScheduleDemo).toBe(true);
  });

  it("aceita agendamento ISO com offset brasileiro conforme o contrato", () => {
    const parsed = parseAiDecision("gemini", JSON.stringify({
      ...validDecision,
      shouldScheduleDemo: true,
      suggestedSlots: ["2026-08-11T16:00:00-03:00"],
      appointmentData: { startsAt: "2026-08-11T16:00:00-03:00", endsAt: "2026-08-11T16:30:00-03:00", notes: "Demo" },
    }));
    expect(parsed.appointmentData?.startsAt).toBe("2026-08-11T16:00:00-03:00");
    expect(parsed.suggestedSlots).toEqual(["2026-08-11T16:00:00-03:00"]);
  });

  it("Groq envia JSON Schema strict para GPT-OSS e valida imediatamente", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(compactDecision) } }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }), { status: 200 }));
    const provider = new GroqProvider({ apiKey: "test", fetchImpl });
    await expect(provider.generateStructuredResponse({ systemPrompt: "s", userMessage: "u", model: "openai/gpt-oss-120b" })).resolves.toMatchObject({ decision: { replyText: compactDecision.reply, detectedIntent: "demo" } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body));
    expect(body.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "ai_decision", strict: true, schema: providerDecisionJsonSchema } });
    expect(body.max_completion_tokens).toBe(1_200);
  });

  it("Gemini recebe o mesmo JSON Schema nativo e valida imediatamente", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(compactDecision) }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 } }), { status: 200 }));
    const provider = new GeminiProvider({ apiKey: "test", fetchImpl });
    await expect(provider.generateStructuredResponse({ systemPrompt: "s", userMessage: "u", model: "gemini-3.5-flash" })).resolves.toMatchObject({ decision: { replyText: compactDecision.reply, detectedIntent: "demo" } });
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body));
    expect(body.generationConfig).toMatchObject({ responseMimeType: "application/json", responseJsonSchema: providerDecisionJsonSchema });
    expect(body.generationConfig.maxOutputTokens).toBe(1200);
  });

  it("classifica resposta Gemini truncada sem aceitar conteúdo parcial", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: '{"reply":"cortado' }] } }] }), { status: 200 }));
    const provider = new GeminiProvider({ apiKey: "test", fetchImpl });
    await expect(provider.generateStructuredResponse({ systemPrompt: "s", userMessage: "u", model: "gemini-3.5-flash" })).rejects.toThrow(/MAX_TOKENS/);
  });

  it("reduz materialmente o schema enviado ao provider e expande para AiDecision compatível", () => {
    expect(JSON.stringify(providerDecisionJsonSchema).length).toBeLessThan(JSON.stringify(aiDecisionJsonSchema).length * 0.45);
    expect(parseAiDecision("groq", JSON.stringify(compactDecision), "Quero ver uma demo")).toMatchObject({ detectedIntent: "demo", shouldProposeDemo: true, qualificationStatus: "discovering" });
  });
});
