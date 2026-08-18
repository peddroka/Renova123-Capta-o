import { describe, expect, it } from "vitest";
import { buildFranciscoSystemPrompt } from "./prompts.js";

const context = { mind: {}, lead: {}, batch: {}, history: [{ role: "agent" as const, text: "É você quem cuida da operação?" }, { role: "lead" as const, text: "Sou eu" }], memories: [], availableMaterials: [], availableSlots: [] };

describe("estratégia inicial de pesquisa", () => {
  it("prioriza pesquisa antes do pitch", () => {
    const prompt = buildFranciscoSystemPrompt(context);
    expect(prompt).toContain("PESQUISA COM ÓTICAS");
    expect(prompt).toContain("Não faça pitch institucional imediatamente após");
    expect(prompt.indexOf("PESQUISA COM ÓTICAS")).toBeLessThan(prompt.indexOf("MENTE COMERCIAL"));
  });
  it("orienta linguagem simples e transparente", () => {
    const prompt = buildFranciscoSystemPrompt(context);
    expect(prompt).toContain("Use a palavra \"pesquisa\"");
    expect(prompt).toContain("a pesquisa é real");
    expect(prompt).toContain("Não invente percentuais");
  });
  it("não fixa uma abertura única nem jargão corporativo", () => {
    const prompt = buildFranciscoSystemPrompt(context);
    expect(prompt).not.toContain("levantamento de mercado");
    expect(prompt).not.toContain("benchmark de mercado");
    expect(prompt).toContain("varie a frase");
  });
});
