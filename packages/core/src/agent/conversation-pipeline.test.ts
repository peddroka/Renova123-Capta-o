import { describe, expect, it } from "vitest";
import { AgentContextBuilder } from "./agent-context-builder.js";
import { deriveConversationState } from "./conversation-state.js";
import { interpretBrazilianContext } from "./contextual-pt-br.js";
import { planConversation } from "./conversation-orchestrator.js";
import type { AgentSnapshot } from "./types.js";

const base = (messages: AgentSnapshot["messages"] = []): AgentSnapshot => ({
  mind: {}, commercial: {}, lead: {}, batch: {}, stage: "engaged", summary: "", messages, memories: [],
  materials: [], availableSlots: [], followUps: [], questionsAsked: [], materialsSent: [], humanActive: false,
  automationPaused: false, blocked: false,
});

describe("pipeline conversacional do Francisco", () => {
  it.each(["oi", "sim", "não", "ok", "legal", "show", "pode falar", "quem é você?", "qual seu nome?", "de onde fala?", "por quê?", "não entendi", "como assim?"]) ("interpreta entrada curta: %s", (text) => {
    expect(interpretBrazilianContext(text).speechAct).not.toBe("ambiguous");
  });

  it("responde identidade diretamente e sabe quando o contato foi outbound", () => {
    const snapshot = base([{ role: "agent", text: "Oi, tudo bem? Sou Francisco, da Renova123." }, { role: "lead", text: "Quem é você?" }]);
    const state = deriveConversationState(snapshot, "Quem é você?");
    expect(state.origin).toBe("outbound_prospecting");
    expect(state.explicitIdentityQuestion).toBe(true);
    expect(planConversation(snapshot, "Quem é você?").unansweredUserQuestion).toBe("Quem é você?");
  });

  it("não transforma legal em interesse e mantém histórico sem hint fingindo ser lead", () => {
    const messages = Array.from({ length: 24 }, (_, index) => ({ role: (index % 2 ? "agent" : "lead") as "agent" | "lead", text: `Turno ${index}: contexto da ótica` }));
    const built = new AgentContextBuilder().build(base(messages), "legal");
    expect(planConversation(base(messages), "legal").interestLevel).toBe("low");
    expect(built.selected.recentMessages).toHaveLength(6);
    expect(built.systemPrompt).not.toContain("[Contexto conversacional interno");
  });
});
