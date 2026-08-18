import { describe, expect, it } from "vitest";
import { AgentDecisionValidator, type AgentSnapshot } from "@renova123/core";
import { parseAiDecision } from "@renova123/integrations";
import { conversationalBubbleDelayMs, naturalMessageParts, protectConversationContinuity, removeRepeatedFormulations } from "./conversation-style.js";

const base: AgentSnapshot = { mind: {}, commercial: {}, lead: {}, batch: {}, stage: "engaged", summary: "", messages: [], memories: [], materials: [], availableSlots: [], followUps: [], questionsAsked: [], materialsSent: [], humanActive: false, automationPaused: false, blocked: false };
const validator = new AgentDecisionValidator();

function raw(reply: string, intent: "information" | "pricing" | "no_interest" = "information", action: "answer_question" | "continue_discovery" | "close_disinterest" = "answer_question") {
  return JSON.stringify({ reply, intent, memories: [], action, material: null, appointment: null, handoff: null, consent: "not_asked", confidence: 0.92 });
}

function offlineTurn(inbound: string, rawOutput: string) {
  const rawDecision = parseAiDecision("groq", rawOutput, inbound);
  const validated = validator.validate(rawDecision, { ...base, messages: [{ role: "lead", text: inbound }] }).decision;
  const guarded = protectConversationContinuity(removeRepeatedFormulations(validated.replyText, { ...base, messages: [{ role: "lead", text: inbound }] }), base, inbound);
  const finalBubbles = naturalMessageParts(guarded ?? "");
  return { inbound, rawDecision, validated, guarded, finalBubbles, delayMs: conversationalBubbleDelayMs(finalBubbles, inbound) };
}

describe("simulação offline do acabamento conversacional", () => {
  it("mantém uma decisão observável em A-G sem chamar provider", () => {
    const cases = [
      offlineTurn("Do que se trata?", raw("Prazer! Sou o Francisco, da Renova123. É um sistema de gestão feito pra óticas, pra centralizar vendas, estoque e a operação da loja.\n\nHoje vocês já usam algum sistema pra isso ou ainda controlam parte no manual?")),
      offlineTurn("Bacana", raw("Hoje vocês usam algum sistema pra tocar a ótica ou ainda fica parte no manual?")),
      offlineTurn("Tô correndo aqui, fala rápido", raw("É um sistema de gestão para óticas que centraliza vendas, estoque e operação.")),
      offlineTurn("Já uso sistema", raw("Boa. Ele é próprio de vocês ou usam um sistema de outra empresa?")),
      offlineTurn("Uso planilha", raw("Entendi. A Renova123 organiza vendas, estoque e o histórico da loja dentro do sistema. Hoje o orçamento também fica na planilha?")),
      offlineTurn("Não tenho interesse, obrigado", raw("Tudo bem, obrigado pelo retorno.", "no_interest", "close_disinterest")),
      offlineTurn("Quanto custa?", raw("Consigo confirmar o valor certinho, porque não tenho uma condição cadastrada aqui.", "pricing")),
    ];
    expect(cases[0]!.finalBubbles).toHaveLength(2);
    expect(cases[0]!.delayMs).toBeGreaterThanOrEqual(4000);
    expect(cases[1]!.finalBubbles[0]).not.toMatch(/legal|bacana|show|perfeito/i);
    expect(cases[2]!.finalBubbles).toHaveLength(1);
    expect(cases[3]!.guarded).toMatch(/próprio|outra empresa/i);
    expect(cases[4]!.guarded).toMatch(/orçamento/i);
    expect(cases[5]!.validated.followUpAction.action).toBe("cancel");
    expect(cases[6]!.guarded).toMatch(/confirmar o valor/i);
    for (const item of cases) expect(item.rawDecision.replyText).toBeTruthy();
  });
});
