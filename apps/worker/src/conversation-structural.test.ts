import { describe, expect, it } from "vitest";
import { AgentContextBuilder, type AgentSnapshot } from "@renova123/core";
import { conversationalBubbleDelayMs, naturalMessageParts, protectConversationContinuity } from "./conversation-style.js";

const base: AgentSnapshot = { mind: {}, commercial: {}, lead: {}, batch: {}, stage: "engaged", summary: "", messages: [], memories: [], materials: [], availableSlots: [], followUps: [], questionsAsked: [], materialsSent: [], humanActive: false, automationPaused: false, blocked: false };

describe("regressões reais de naturalidade", () => {
  it.each(["Planilha e cabeça kkkkk", "Tudo", "Interessante", "Como funciona?"])("contextualiza sem prescrever uma frase para: %s", (message) => {
    const context = new AgentContextBuilder().build(base, message);
    expect(context.selected.conversation).not.toHaveProperty("recommendedMove");
    expect(context.systemPrompt).toContain("não um roteiro");
  });

  it("uma resposta crua natural sobrevive intacta aos guards", () => {
    const raw = "kkkk aí a cabeça vira parte do sistema também";
    const guarded = protectConversationContinuity(raw, base, "Planilha e cabeça kkkkk");
    expect(guarded).toBe(raw);
    expect(naturalMessageParts(guarded!)).toEqual([raw]);
  });

  it("preserva resposta e continuação como duas unidades semânticas", () => {
    const reply = "Prazer! Sou o Francisco, da Renova123. É um sistema de gestão feito pra óticas, pra centralizar vendas, estoque e a operação da loja.\n\nHoje vocês já usam algum sistema pra isso ou ainda controlam parte no manual?";
    const parts = naturalMessageParts(reply);
    expect(parts).toHaveLength(2);
    expect(conversationalBubbleDelayMs(parts, "Do que se trata?")).toBeGreaterThanOrEqual(4000);
    expect(conversationalBubbleDelayMs(parts, "Tô correndo aqui, fala rápido")).toBe(0);
  });

  it("não cria pausa artificial para uma resposta simples", () => {
    const parts = naturalMessageParts("Claro, o sistema centraliza as informações da loja.");
    expect(conversationalBubbleDelayMs(parts, "Quanto custa?")).toBe(0);
  });
});
