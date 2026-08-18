import { describe, expect, it } from "vitest";
import { planConversation } from "./conversation-orchestrator.js";
import type { AgentSnapshot } from "./types.js";

const snapshot = (overrides: Partial<AgentSnapshot> = {}): AgentSnapshot => ({
  mind: {}, commercial: {}, lead: {}, batch: {}, stage: "engaged", summary: "", messages: [], memories: [], materials: [], availableSlots: [],
  followUps: [], questionsAsked: [], materialsSent: [], humanActive: false, automationPaused: false, blocked: false,
  qualificationStatus: "discovering", qualificationScore: 0, mariliaConsent: "not_asked", ...overrides,
});

describe("orquestrador adicional", () => {
  it("reconhece papel quando a confirmaÃ§Ã£o vem com pontuaÃ§Ã£o e complemento", () => {
    const plan = planConversation(snapshot({ messages: [{ role: "agent", text: "Posso falar com quem toca a gestão da ótica?" }] }), "Oi, tudo bem?\nSou eu mesmo, o dono");
    expect(plan.knownFacts.decision_maker).toContain("responsável");
  });
  const roleQuestion = "É você quem cuida da operação da ótica por aí?";
  it.each(["Boa tarde, sou eu.", "Sim sou eu", "Eu mesmo", "Sou"])("reconhece responsável contextualmente: %s", (answer) => {
    const plan = planConversation(snapshot({ messages: [{ role: "agent", text: roleQuestion }] }), answer);
    expect(plan.knownFacts.decision_maker).toContain("responsável");
    expect(plan.forbiddenActions).toContain("perguntar novamente se é dono, gerente ou responsável");
  });
  it("saudação isolada não vira decisor", () => expect(planConversation(snapshot({ messages: [{ role: "agent", text: roleQuestion }] }), "Boa tarde").knownFacts).not.toHaveProperty("decision_maker"));
  it("negação com sócio preserva a informação sem marcar o lead como decisor", () => { const plan = planConversation(snapshot({ messages: [{ role: "agent", text: roleQuestion }] }), "Não, quem cuida é meu sócio"); expect(plan.knownFacts).not.toHaveProperty("decision_maker"); expect(plan.knownFacts.next_action).toContain("sócio"); });
  it("reconhece decisor e indisponibilidade no mesmo turno", () => { const plan = planConversation(snapshot({ messages: [{ role: "agent", text: roleQuestion }] }), "Sim, eu cuido, mas agora tô ocupado"); expect(plan.knownFacts.decision_maker).toContain("responsável"); expect(plan.knownFacts.availability).toContain("Indisponível"); });
});

describe("orquestrador informativo, não prescritivo", () => {
  it("confirma o responsável em burst e impede repetir a pergunta", () => {
    const plan = planConversation(snapshot({ messages: [{ role: "agent", text: "Você cuida da operação da ótica?" }] }), "Oi\nSou eu mesmo\nPode falar");
    expect(plan.knownFacts.decision_maker).toContain("responsável");
    expect(plan.deterministicMemoryUpdates).toContainEqual(expect.objectContaining({ key: "decision_maker" }));
    expect(plan.forbiddenActions).toContain("perguntar novamente se é dono, gerente ou responsável");
  });

  it("persiste o nome da ótica informado como resposta", () => {
    const plan = planConversation(snapshot({ messages: [{ role: "agent", text: "Qual é o nome da sua ótica?" }] }), "Ótica Fric");
    expect(plan.knownFacts.store_name).toBe("Ótica Fric");
  });

  it("mensagem ambígua não cria memória nem prescreve movimento comercial", () => {
    const plan = planConversation(snapshot(), "M");
    expect(plan.interpretation).toBe("AMBIGUOUS");
    expect(plan.deterministicMemoryUpdates).toEqual([]);
    expect(plan.forbiddenActions).toEqual(expect.arrayContaining(["criar memória comercial", "assumir intenção", "mudar de assunto"]));
    expect(plan).not.toHaveProperty("recommendedMove");
    expect(plan).not.toHaveProperty("nextAllowedMoves");
  });

  it.each([
    ["Uso um sistema, mas não é específico para ótica", "generic", "atacar o sistema atual"],
    ["Uso um sistema específico para ótica", "optical_specific", "atacar concorrente"],
    ["Não uso nenhum sistema", "none", null],
  ] as const)("informa o tipo de sistema sem escrever a conversa: %s", (answer, type, forbidden) => {
    const plan = planConversation(snapshot({ messages: [{ role: "agent", text: "Você usa algum sistema hoje?" }] }), answer);
    expect(plan.currentSystemType).toBe(type);
    expect(plan).not.toHaveProperty("recommendedMove");
    if (forbidden) expect(plan.forbiddenActions).toContain(forbidden);
  });

  it("expõe interesse e pergunta pendente como contexto, sem CTA obrigatório", () => {
    const plan = planConversation(snapshot(), "Interessante. Como funciona?");
    expect(plan.interestLevel).toBe("high");
    expect(plan.unansweredUserQuestion).toBe("Como funciona?");
    expect(plan.forbiddenActions).toContain("ignorar a pergunta direta do cliente");
    expect(plan).not.toHaveProperty("recommendedMove");
  });
});
