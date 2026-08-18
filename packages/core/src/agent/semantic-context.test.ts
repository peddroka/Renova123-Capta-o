import { describe, expect, it } from "vitest";
import { AgentContextBuilder } from "./agent-context-builder.js";
import { deriveConversationState } from "./conversation-state.js";
import type { AgentSnapshot } from "./types.js";

const snapshot = (overrides: Partial<AgentSnapshot> = {}): AgentSnapshot => ({
  mind: {}, commercial: {}, lead: {}, batch: {}, stage: "engaged", summary: "", messages: [], memories: [],
  materials: [], availableSlots: [], followUps: [], questionsAsked: [], materialsSent: [], humanActive: false,
  automationPaused: false, blocked: false, ...overrides,
});

describe("contexto semântico comercial", () => {
  it("separa permissão para continuar de interesse e demo", () => {
    const state = deriveConversationState(snapshot(), "Certo, pode falar.");
    expect(state.permissionToContinue).toBe(true);
    expect(state.commercialInterest).toBe("low");
    expect(state.productCuriosity).toBe(false);
    expect(state.demoInterest).toBe(false);
  });

  it("faz a Mente da IA chegar ao prompt real", () => {
    const built = new AgentContextBuilder().build(snapshot({
      mind: { personality: "observador e informal", mission: "entender antes de oferecer", primaryGoal: "gerar curiosidade" },
    }), "oi");
    expect(built.selected.mind).toMatchObject({ voice: "observador e informal", identity: "entender antes de oferecer", sales: "gerar curiosidade" });
    expect(built.systemPrompt).toContain("MENTE_DA_IA");
  });

  it("não duplica o texto atual dentro do contexto de sistema", () => {
    const built = new AgentContextBuilder().build(snapshot({ messages: [{ role: "lead", text: "Certo, pode falar." }] }), "Certo, pode falar.");
    expect(built.selected).not.toHaveProperty("currentMessage");
    expect(built.selected.recentMessages ?? []).toHaveLength(0);
    expect(built.systemPrompt).not.toContain("Certo, pode falar.");
  });

  it("não envia demo nem catálogo completo na permissão breve", () => {
    const built = new AgentContextBuilder().build(snapshot({ knowledgeItems: [
      { title: "Demo", category: "DEMO", content: "Marília demonstra tudo", active: true },
      { title: "Estoque", category: "ESTOQUE", content: "Estoque em tempo real", active: true },
    ] }), "Certo, pode falar.");
    expect(built.selected.conversation).toMatchObject({ interest: "low", signals: { permissionToContinue: true } });
    expect(built.selected).not.toHaveProperty("relevantKnowledge");
    expect(built.selected).not.toHaveProperty("productBase");
    expect(built.selected).not.toHaveProperty("confirmedProductCatalog");
  });
});
