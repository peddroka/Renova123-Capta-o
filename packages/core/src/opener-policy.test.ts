import { describe, expect, it } from "vitest";
import { isHumanAttentionOpener } from "./opener-policy.js";

const HUMAN_OPENERS = [
  "Oi, peguei seu contato no Instagram. Falo com o dono da ótica?",
  "Oi, tudo bem? Vi o contato da ótica no Instagram. É você que é o dono?",
  "Bom dia! Peguei esse contato no Instagram. Consigo falar com o dono da ótica por aqui?",
  "Boa tarde! Achei o contato de vocês no Instagram. Falo com o proprietário da ótica?",
  "Oi! Peguei seu contato pelo Instagram. Você é o dono da ótica?",
];

describe("política dos openers", () => {
  it.each(HUMAN_OPENERS)("abre atenção, revela a origem e confirma o dono antes do pitch: %s", (opener) => {
    expect(isHumanAttentionOpener(opener)).toBe(true);
  });
  it("rejeita apresentação e pitch no primeiro contato", () => {
    expect(isHumanAttentionOpener("Oi! Sou o Francisco da Renova123. Quer automatizar suas vendas?")).toBe(false);
  });
});
