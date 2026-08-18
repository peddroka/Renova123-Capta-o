import { describe, expect, it } from "vitest";
import { compareOutboundText, materializeOutreachTemplate } from "./outbound-text-integrity.js";

describe("integridade Unicode do outbound", () => {
  it("preserva texto brasileiro no roundtrip do template", () => {
    const samples = [
      "Tudo certo? Você é o responsável pela ótica por aí?",
      "Atenção: orçamento, condições, observações e Marília.",
      "João, São José, Ótica Visão, orçamento, você, aí, Marília",
    ];
    for (const sample of samples) expect(compareOutboundText(sample, JSON.parse(JSON.stringify(sample))).equal).toBe(true);
  });

  it("não trata interrogação legítima como corrupção", () => {
    const sample = materializeOutreachTemplate("Você já usa papel?", "Teste autorizado");
    expect(compareOutboundText(sample, sample).equal).toBe(true);
    expect(compareOutboundText(sample, "Voce ja usa papel?").equal).toBe(false);
  });
});
