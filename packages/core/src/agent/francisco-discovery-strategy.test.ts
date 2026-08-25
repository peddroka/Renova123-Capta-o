import { describe, expect, it } from "vitest";
import { franciscoDiscoveryStrategy } from "./francisco-discovery-strategy.js";
import type { AgentSnapshot } from "./types.js";

const base: AgentSnapshot = {
  mind: {},
  commercial: {},
  lead: {},
  batch: {},
  stage: "engaged",
  summary: "",
  messages: [],
  memories: [],
  materials: [],
  availableSlots: [],
  followUps: [],
  questionsAsked: [],
  materialsSent: [],
  humanActive: false,
  automationPaused: false,
  blocked: false,
};

function after(question: string, answer: string): AgentSnapshot {
  return {
    ...base,
    messages: [
      { role: "agent", text: question },
      { role: "lead", text: answer },
    ],
  };
}

describe("estratégia conversacional do Francisco", () => {
  it("1. confirma ótica e pergunta sobre simulador sem apresentação precoce", () => {
    const result = franciscoDiscoveryStrategy(
      after("Você cuida da operação da ótica?", "Sou eu. Como posso ajudar?"),
      "Sou eu. Como posso ajudar?",
    );
    expect(result.phase).toBe("simulator");
    expect(result.preferredQuestions[0]).toMatch(/simulador de lentes/i);
    expect(result.avoid.join(" ")).toMatch(/apresentar|pitch/i);
  });

  it("2. sem simulador, pergunta por teste de visão", () => {
    expect(
      franciscoDiscoveryStrategy(
        after("Você tem simulador de lentes aí na ótica?", "Não temos."),
        "Não temos.",
      ).phase,
    ).toBe("vision_test");
  });

  it("3. sem teste de visão, pergunta por simulador de grossura", () => {
    const result = franciscoDiscoveryStrategy(after("E teste de visão?", "Também não."), "Também não.");
    expect(result.phase).toBe("thickness_simulator");
    expect(result.preferredQuestions[0]).toMatch(/grossura da lente/i);
  });

  it("4. sem nenhum recurso, investiga a barreira", () => {
    expect(
      franciscoDiscoveryStrategy(
        after("E algum simulador pra mostrar a grossura da lente?", "Não temos nada."),
        "Não temos nada.",
      ).phase,
    ).toBe("barrier");
  });

  it("5. se já possui o recurso, adapta sem perguntar de novo", () => {
    const result = franciscoDiscoveryStrategy(
      after("Você tem simulador de lentes aí na ótica?", "Sim, temos."),
      "Sim, temos.",
    );
    expect(result.phase).toBe("adapt");
    expect(result.avoid.join(" ")).toMatch(/não perguntar novamente/i);
  });

  it("6. responde identidade quando perguntam quem é", () => {
    const result = franciscoDiscoveryStrategy(base, "Quem é você?");
    expect(result.phase).toBe("identity");
    expect(result.objective).toMatch(/quem é/i);
  });

  it("7. interesse conduz para demonstração sem nova entrevista", () => {
    const result = franciscoDiscoveryStrategy(base, "Tenho interesse, pode me mostrar?");
    expect(result.phase).toBe("demo");
    expect(result.preferredQuestions[0]).toMatch(/mostr/i);
  });

  it("8. desinteresse encerra a sequência", () => {
    const result = franciscoDiscoveryStrategy(base, "Não tenho interesse.");
    expect(result.phase).toBe("disinterest");
    expect(result.preferredQuestions).toHaveLength(0);
  });

  it("9. resposta fora do roteiro preserva o contexto do recurso mencionado", () => {
    const result = franciscoDiscoveryStrategy(
      after(
        "Você tem simulador de lentes aí na ótica?",
        "A gente mostra no computador quando o cliente pergunta.",
      ),
      "A gente mostra no computador quando o cliente pergunta.",
    );
    expect(result.phase).toBe("adapt");
    expect(result.objective).toMatch(/simulador/);
  });
});
