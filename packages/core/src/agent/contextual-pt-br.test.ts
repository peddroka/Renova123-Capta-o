import { describe, expect, it } from "vitest";
import { interpretBrazilianContext, withContextualHint } from "./contextual-pt-br.js";
import { isContextualAffirmative, isOwnerRoleAnswer } from "./conversation-state.js";

describe("contexto curto pt-BR", () => {
  it("reconhece confirmação de identidade com papel na mesma frase", () => expect(isOwnerRoleAnswer("Sou eu mesmo, o dono")).toBe(true));
  it("1. registra Dono como resposta de função", () => expect(isOwnerRoleAnswer("Dono")).toBe(true));
  it("2. entende pq como motivo", () => expect(interpretBrazilianContext("Pq?").speechAct).toBe("why"));
  it("3. trata e como continuidade", () => expect(interpretBrazilianContext("E?").speechAct).toBe("continue"));
  it("4. blz é confirmação contextual", () => expect(isContextualAffirmative("blz")).toBe(true));
  it("5. ss é sim", () => expect(isContextualAffirmative("ss")).toBe(true));
  it("6. nn é negação sem ser ambígua", () => expect(interpretBrazilianContext("nn").speechAct).toBe("negative"));
  it("7. fala pede continuidade", () => expect(interpretBrazilianContext("fala").speechAct).toBe("affirmative"));
  it("8. manda pede continuidade", () => expect(interpretBrazilianContext("manda").speechAct).toBe("affirmative"));
  it("9. eu mesmo confirma identidade", () => expect(interpretBrazilianContext("eu mesmo").speechAct).toBe("identity"));
  it("10. texto realmente curto e desconhecido permanece ambíguo", () => expect(interpretBrazilianContext("x").speechAct).toBe("ambiguous"));
  it("11. não fixa uma resposta pronta: injeta apenas contexto interno", () => expect(withContextualHint("Pq?")).toContain("motivo"));
  it("12. acentos são preservados no texto original", () => expect(withContextualHint("Tá")).toContain("Tá"));
  it("13. como assim é pedido de esclarecimento", () => expect(interpretBrazilianContext("Como assim?").speechAct).toBe("clarification"));
  it("14. entendi é reconhecimento", () => expect(interpretBrazilianContext("Entendi").speechAct).toBe("acknowledgement"));
  it("15. reconhecimentos curtos não viram nova intenção", () => {
    for (const value of ["Ok", "Beleza", "Certo", "Show", "Tranquilo"]) expect(interpretBrazilianContext(value).speechAct).toBe("acknowledgement");
  });
  it("16. não inventa contexto para frase normal", () => expect(withContextualHint("Minha dor é o estoque")).toBe("Minha dor é o estoque"));
  it("17. reconhece saudação social dentro de um burst sem perder os outros sinais", () => {
    const turn = "Oi, tudo bem?\nSou eu mesmo\nSou o dono";
    expect(interpretBrazilianContext(turn).socialOpening).toBe(true);
    expect(withContextualHint(turn)).toContain("retribua naturalmente");
  });
  it("18. não inventa small talk para confirmação isolada", () => {
    expect(interpretBrazilianContext("Sou eu mesmo").socialOpening).toBe(false);
    expect(withContextualHint("Sou eu mesmo")).not.toContain("saudação");
  });
  it.each(["Oi, tudo bem?", "Bom dia, tudo bem?", "Boa noite", "E aí, tudo certo?", "Como você tá?"])("19. reconhece ato social: %s", (value) => {
    expect(interpretBrazilianContext(value).socialOpening).toBe(true);
  });
  it("20. compõe saudação com confirmação de identidade", () => expect(interpretBrazilianContext("Boa tarde, sou eu")).toMatchObject({ socialOpening: true, speechAct: "identity" }));
});
