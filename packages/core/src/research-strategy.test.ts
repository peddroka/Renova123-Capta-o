import { describe, expect, it } from "vitest";
import { buildFranciscoSystemPrompt } from "./prompts.js";

const context = {
  mind: {},
  lead: {},
  batch: {},
  history: [
    { role: "agent" as const, text: "É você quem cuida da operação?" },
    { role: "lead" as const, text: "Sou eu" },
  ],
  memories: [],
  availableMaterials: [],
  availableSlots: [],
};

describe("estratégia inicial de descoberta", () => {
  it("prioriza descoberta de recursos antes da apresentação", () => {
    const prompt = buildFranciscoSystemPrompt(context);
    expect(prompt).toContain("ESTRATÉGIA DE DESCOBERTA");
    expect(prompt).toContain("Você tem simulador de lentes aí na ótica?");
    expect(prompt).toContain("não faça apresentação precoce");
    expect(prompt.indexOf("ESTRATÉGIA DE DESCOBERTA")).toBeLessThan(prompt.indexOf("MENTE COMERCIAL"));
  });
  it("orienta linguagem simples e transparente", () => {
    const prompt = buildFranciscoSystemPrompt(context);
    expect(prompt).toContain("responda antes de continuar");
    expect(prompt).toContain("Não invente equipamentos");
    expect(prompt).toContain("quem é");
  });
  it("não fixa uma abertura única nem jargão corporativo", () => {
    const prompt = buildFranciscoSystemPrompt(context);
    expect(prompt).toContain("Varie as frases");
    expect(prompt).not.toContain("levantamento de mercado");
    expect(prompt).not.toContain("benchmark de mercado");
  });
});
