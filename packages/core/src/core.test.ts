import { describe, expect, it } from "vitest";
import { normalizeBrazilianPhone, parsePhoneList, randomIntervalMs, isExplicitNoInterestText, isOptOutText } from "./index.js";

describe("telefone brasileiro", () => {
  it("normaliza celular com pontuação", () => {
    expect(normalizeBrazilianPhone("(11) 98765-4321").normalized).toBe("5511987654321");
  });
  it("rejeita valor repetitivo", () => expect(normalizeBrazilianPhone("11111111111").valid).toBe(false));
  it.each([
    ["+55 (11) 98765-4321", "5511987654321"],
    ["11987654321", "5511987654321"],
    ["11 8765-4321", "5511987654321"],
    ["11 3456-7890", "551134567890"],
    ["1.1987654321E10", "5511987654321"],
    ["'1.1987654321e10'", "5511987654321"],
    ["02111987654321", "5511987654321"],
  ])("normaliza %s para o formato da Evolution", (input, expected) => expect(normalizeBrazilianPhone(input).normalized).toBe(expected));
  it.each(["", "123", "5510999999999", "55118876543210", "1.2345E2", "5511111111111"])("rejeita número inválido %s", (input) => expect(normalizeBrazilianPhone(input).valid).toBe(false));
  it("reconhece opt-out", () => expect(isOptOutText("Por favor, não me chame mais")).toBe(true));
  it("não transforma desinteresse comercial em opt-out", () => expect(isOptOutText("Não tenho interesse")).toBe(false));
  it("separa desinteresse comercial de opt-out", () => {
    expect(isExplicitNoInterestText("Não tenho interesse")).toBe(true);
    expect(isExplicitNoInterestText("Não quero receber mais mensagens")).toBe(false);
  });
  it.each(["Não quero nenhum serviço", "Não quero agora", "Tchau"])("classifica %s como desinteresse sem opt-out", (text) => {
    expect(isExplicitNoInterestText(text)).toBe(true);
    expect(isOptOutText(text)).toBe(false);
  });
  it("classifica o burst 'Não' + 'Tchau' como perda comercial, sem supressão", () => {
    expect(isExplicitNoInterestText("Não\nTchau")).toBe(true);
    expect(isOptOutText("Não\nTchau")).toBe(false);
    expect(isOptOutText("Não me mande mais mensagens")).toBe(true);
  });
});

describe("importação", () => {
  it("aceita cabeçalho e marca duplicado", () => {
    const rows = parsePhoneList("telefone\n11987654321\n(11) 98765-4321\n21987654321");
    expect(rows.map((row) => row.status)).toEqual(["valid", "duplicate_file", "valid"]);
  });
  it("mantém intervalo dentro dos limites", () => expect(randomIntervalMs(30, 60, () => 0.5)).toBe(45_000));
});
  it("classifica recusa curta como desinteresse, nÃ£o opt-out", () => { expect(isExplicitNoInterestText("nao quero")).toBe(true); expect(isOptOutText("nao quero")).toBe(false); });
