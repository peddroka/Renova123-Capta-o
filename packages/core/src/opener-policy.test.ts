import { describe, expect, it } from "vitest";
import { isHumanAttentionOpener } from "./opener-policy.js";

const HUMAN_OPENERS = [
  "Opa, tudo bem? Você é o dono ou responsável pela ótica?",
  "Oi! É você quem cuida da operação da ótica por aí?",
  "Opa, posso falar com quem toca a gestão da ótica?",
  "Tudo bem? Você é o responsável pela ótica?",
  "Oi! Falo com o dono ou responsável pela ótica?",
  "Opa! É com você que eu falo sobre a gestão da ótica?",
  "Tudo certo? Você é o responsável pela ótica por aí?",
];

describe("política dos openers", () => {
  it.each(HUMAN_OPENERS)("abre atenção e confirma a pessoa antes do pitch: %s", (opener) => {
    expect(isHumanAttentionOpener(opener)).toBe(true);
  });

  it("rejeita apresentação e pitch no primeiro contato", () => {
    expect(isHumanAttentionOpener("Oi! Sou o Francisco da Renova123. Quer automatizar suas vendas?")).toBe(false);
  });
});
