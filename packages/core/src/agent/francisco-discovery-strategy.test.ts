import { describe, expect, it } from "vitest";
import { franciscoDiscoveryStrategy } from "./francisco-discovery-strategy.js";
import type { AgentSnapshot } from "./types.js";

const base: AgentSnapshot = {
  leadId: "lead-1", phone: "5582988543864", stage: "contacted",
  lead: {}, mind: {}, commercial: {}, memories: [], messages: [], knowledgeItems: [], materials: [], slots: [],
} as unknown as AgentSnapshot;

function after(agent: string, lead: string, earlier: AgentSnapshot["messages"] = []): AgentSnapshot {
  return { ...base, messages: [...earlier, { role: "agent", text: agent }, { role: "lead", text: lead }] } as unknown as AgentSnapshot;
}

describe("Francisco discovery strategy", () => {
  it("começa pelo simulador depois que o dono confirma", () => {
    const result = franciscoDiscoveryStrategy(after("Falo com o dono da ótica?", "Sou eu mesmo."), "Sou eu mesmo.");
    expect(result.phase).toBe("simulator");
    expect(result.preferredQuestions[0]).toMatch(/simulador de lentes/i);
  });

  it("avança para teste de visão mesmo quando a resposta anterior foi positiva", () => {
    const result = franciscoDiscoveryStrategy(after("Vocês têm um simulador de lentes aí na ótica?", "Sim, temos."), "Sim, temos.");
    expect(result.phase).toBe("vision_test");
    expect(result.preferredQuestions[0]).toMatch(/teste de visão/i);
  });

  it("avança para medição digital depois do teste de visão", () => {
    const earlier: AgentSnapshot["messages"] = [
      { role: "agent", text: "Vocês têm um simulador de lentes aí na ótica?" },
      { role: "lead", text: "Não." },
    ];
    const result = franciscoDiscoveryStrategy(after("E teste de visão, vocês têm?", "Também não.", earlier), "Também não.");
    expect(result.phase).toBe("digital_measurement");
    expect(result.preferredQuestions[0]).toMatch(/medidor digital/i);
  });

  it("pergunta grossura depois de medição digital", () => {
    const earlier: AgentSnapshot["messages"] = [
      { role: "agent", text: "Vocês têm um simulador de lentes aí na ótica?" }, { role: "lead", text: "Não" },
      { role: "agent", text: "E teste de visão, vocês têm?" }, { role: "lead", text: "Não" },
    ];
    const result = franciscoDiscoveryStrategy(after("E algum medidor digital pra ajudar nas medições, vocês usam?", "Não.", earlier), "Não.");
    expect(result.phase).toBe("thickness_simulator");
    expect(result.preferredQuestions[0]).toMatch(/grossura da lente/i);
  });

  it("depois de mapear recursos investiga a barreira", () => {
    const messages: AgentSnapshot["messages"] = [
      { role: "agent", text: "Vocês têm um simulador de lentes aí na ótica?" }, { role: "lead", text: "Não" },
      { role: "agent", text: "E teste de visão, vocês têm?" }, { role: "lead", text: "Não" },
      { role: "agent", text: "E algum medidor digital pra ajudar nas medições, vocês usam?" }, { role: "lead", text: "Não" },
      { role: "agent", text: "Vocês têm algum simulador pra mostrar pro cliente como fica a grossura da lente?" }, { role: "lead", text: "Não" },
    ];
    const result = franciscoDiscoveryStrategy({ ...base, messages } as unknown as AgentSnapshot, "Não");
    expect(result.phase).toBe("barrier");
    expect(result.preferredQuestions.join(" ")).toMatch(/falta|custo|sistema|tempo/i);
  });

  it("responde identidade quando perguntam quem é", () => {
    const result = franciscoDiscoveryStrategy(base, "Quem é você?");
    expect(result.phase).toBe("identity");
    expect(result.avoid.join(" ")).toMatch(/não se passar por cliente/i);
  });

  it("interesse conduz para demonstração sem reiniciar descoberta", () => {
    const result = franciscoDiscoveryStrategy(base, "Tenho interesse, pode me mostrar?");
    expect(result.phase).toBe("demo");
  });

  it("desinteresse encerra a sequência", () => {
    const result = franciscoDiscoveryStrategy(base, "Não tenho interesse.");
    expect(result.phase).toBe("disinterest");
    expect(result.preferredQuestions).toHaveLength(0);
  });
});
