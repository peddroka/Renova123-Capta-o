import { describe, expect, it } from "vitest";
import { AgentContextBuilder, deriveConversationState, interpretBrazilianContext, withContextualHint, type AgentSnapshot } from "@renova123/core";
import { appendLatestLeadMessageIfMissing, currentLeadTurn, ensureActiveInboundReply, isGreetingOnly, naturalMessageParts, needsOutboundIdentityRepair, needsRecentQuestionRepair, protectConversationContinuity, removeRepeatedFormulations, roleFromStoredMessage } from "./conversation-style.js";

const snapshot = (messages: AgentSnapshot["messages"], questionsAsked: string[] = []): AgentSnapshot => ({ mind: {}, commercial: {}, lead: {}, batch: {}, stage: "engaged", summary: "", messages, memories: [], materials: [], availableSlots: [], followUps: [], questionsAsked, materialsSent: [], humanActive: false, automationPaused: false, blocked: false });

describe("deduplicação de sufixo agregado", () => {
  it("não reanexa o sufixo quando o inbound já foi persistido em linhas", () => {
    const messages = [{ role: "agent" as const, text: "Opa" }, { role: "lead" as const, text: "Bem..." }, { role: "lead" as const, text: "Quem você se chama??" }, { role: "lead" as const, text: "Eita falei errado kkkkkkkkkkk" }, { role: "lead" as const, text: "Qual seu nome?" }];
    const history = appendLatestLeadMessageIfMissing(messages, "Eita falei errado kkkkkkkkkkk\nQual seu nome?");
    expect(history).toHaveLength(messages.length);
    expect(currentLeadTurn(snapshot(history), "Qual seu nome?")).not.toContain("Qual seu nome?\nEita falei errado");
  });
});

describe("pós-processamento mínimo do Francisco", () => {
  it("agrupa o burst real do lead", () => {
    const state = snapshot([{ role: "agent", text: "Como funciona por aí?" }, { role: "lead", text: "Rapaz, às vezes eu lembro" }, { role: "lead", text: "Às vezes some" }, { role: "lead", text: "Por quê?" }]);
    expect(currentLeadTurn(state, "Por quê?")).toBe("Rapaz, às vezes eu lembro\nÀs vezes some\nPor quê?");
  });

  it("não duplica um burst que já foi persistido", () => {
    const messages = [{ role: "agent" as const, text: "Tudo bem? Você é o responsável pela ótica?" }, { role: "lead" as const, text: "Ué" }, { role: "lead" as const, text: "Quem é você" }];
    const history = appendLatestLeadMessageIfMissing(messages, "Ué\nQuem é você");
    expect(history).toHaveLength(3);
    expect(currentLeadTurn(snapshot(history), "Ué\nQuem é você")).toBe("Ué\nQuem é você");
  });

  it("usa a direção como fonte determinística do papel", () => {
    expect(roleFromStoredMessage("inbound", "agent")).toBe("lead");
    expect(roleFromStoredMessage("outbound", "lead")).toBe("agent");
    expect(roleFromStoredMessage("outbound", "human")).toBe("human");
  });

  it("rejeita resposta de identidade que inverte a prospecção", () => {
    const state = snapshot([{ role: "agent", text: "Tudo bem? Você é o responsável pela ótica?" }, { role: "lead", text: "Sou eu sim, quem fala?" }]);
    expect(needsOutboundIdentityRepair("Quem é você?", state, "Sou eu sim, quem fala?")).toBe(true);
    expect(needsOutboundIdentityRepair("Oi, sou Francisco, SDR da Renova123. Como posso ajudar hoje?", state, "Quem é você?")).toBe(true);
    expect(needsOutboundIdentityRepair("Aqui é Francisco, da Renova123, ligando sobre gestão para óticas.", state, "Quem é você?")).toBe(true);
    expect(needsOutboundIdentityRepair("Sou Francisco, da Renova123. Entrei em contato para apresentar nosso sistema para óticas.", state, "Quem é você?")).toBe(false);
  });

  it("não cria várias bolhas quando uma resolve", () => {
    expect(naturalMessageParts("kkkk aí a cabeça vira parte do sistema também. Dá para organizar isso sem complicar a rotina.")).toHaveLength(1);
  });

  it("respeita parágrafos deliberados sem fabricar um terceiro movimento", () => {
    expect(naturalMessageParts("Uma frase curta.\n\nOutra quando realmente ajuda.")).toEqual(["Uma frase curta.", "Outra quando realmente ajuda."]);
  });

  it("remove repetição objetiva, mas preserva fatos numéricos", () => {
    const state = snapshot([{ role: "agent", text: "Quero entender os orçamentos. O valor atual é R$ 159,90." }]);
    expect(removeRepeatedFormulations("Quero entender os orçamentos. O valor atual é R$ 159,90.", state)).toBe("O valor atual é R$ 159,90.");
  });

  it("não repete apresentação, função ou pergunta de quantidade respondida", () => {
    const introduced = snapshot([{ role: "agent", text: "Sou Francisco, da Renova123. Posso te fazer uma pergunta?" }, { role: "lead", text: "Pode sim" }]);
    expect(protectConversationContinuity("Oi! Sou Francisco, da Renova123. Vamos continuar.", introduced, "Pode sim")).toBe("Vamos continuar.");
    const role = snapshot([{ role: "agent", text: "Você é o dono ou responsável pela ótica?" }, { role: "lead", text: "Sou" }]);
    expect(protectConversationContinuity("Qual seu nome e sua função na ótica?", role, "Sou")).toBe("Qual é o seu nome?");
    const volume = { ...snapshot([]), memories: [{ key: "answered_questions", value: "volume informado sem quantidade exata", evidenceType: "explicit" as const }] };
    expect(protectConversationContinuity("Quantos orçamentos são por mês?", volume, "Não sei o número exato, muitos.")).toBeNull();
  });

  it("mantém pergunta direta boa e remove somente pedido indevido de WhatsApp", () => {
    expect(protectConversationContinuity("Como funciona para vocês hoje?", snapshot([]), "Pode falar")).toBe("Como funciona para vocês hoje?");
    expect(protectConversationContinuity("Legal. Qual é o seu número de WhatsApp atual?", snapshot([]), "Pode falar")).toBe("Legal.");
  });

  it("estado entende confirmação do responsável", () => {
    const state = snapshot([{ role: "agent", text: "Você cuida da operação da ótica?" }, { role: "lead", text: "Sou eu mesmo" }]);
    expect(deriveConversationState(state, "Sou eu mesmo").leadRoleKnown).toBe(true);
  });

  it("repara apresentação após confirmação do responsável, sem fixar a frase", () => {
    const state = snapshot([{ role: "agent", text: "Você é o dono ou responsável pela ótica?" }, { role: "lead", text: "Sou eu mesmo" }]);
    expect(needsOutboundIdentityRepair("Qual é a maior dificuldade que você enfrenta hoje?", state, "Sou eu mesmo")).toBe(true);
    expect(needsOutboundIdentityRepair("Sou Francisco, da Renova123. Entrei em contato para entender a rotina da ótica.", state, "Sou eu mesmo")).toBe(false);
  });

  it("prompt dá liberdade social e não exige pergunta ou quantidade fixa de bolhas", () => {
    const prompt = new AgentContextBuilder().build(snapshot([]), "Planilha e cabeça kkkkk").systemPrompt;
    expect(prompt).toContain("escolha livremente o próximo movimento");
    expect(prompt).toContain("Não existe obrigação de fazer pergunta");
    expect(prompt).toContain("humor");
    expect(prompt).not.toContain("Faça 2 a 4 perguntas");
  });

  it("não inventa esclarecimento quando o modelo não respondeu", () => {
    expect(ensureActiveInboundReply(null)).toBeNull();
    expect(ensureActiveInboundReply("Uma frase resolve.")).toBe("Uma frase resolve.");
  });
});

describe("repetição de pergunta após saudação", () => {
  it("detecta repetição imediata sem inferir decisor", () => {
    const state = snapshot([{ role: "agent", text: "Você cuida da operação da ótica por aí?" }, { role: "lead", text: "Oi" }]);
    expect(isGreetingOnly("Oi")).toBe(true);
    expect(isGreetingOnly("Boa tarde, sou eu")).toBe(false);
    expect(needsRecentQuestionRepair("Oi, tudo bem! Quem cuida da operação da ótica?", state, "Oi")).toBe(true);
    expect(needsRecentQuestionRepair("Sou o Francisco, da Renova123. Entrei em contato para explicar o motivo.", state, "Oi")).toBe(false);
    expect(deriveConversationState(state, "Oi").leadRoleKnown).toBe(false);
  });
});

describe("comportamento social e bolhas naturais", () => {
  const trace = (raw: string, state: AgentSnapshot, turn: string) => {
    const validated = raw;
    const final = protectConversationContinuity(removeRepeatedFormulations(validated, state), state, turn) ?? "";
    return { raw, validated, final, bubbles: naturalMessageParts(final) };
  };

  it("cenário 1 — retribui a saudação, apresenta-se e preserva duas unidades semânticas", () => {
    const turn = "Oi, tudo bem?\nSou eu mesmo\nSou o dono";
    const state = { ...snapshot([{ role: "agent", text: "É você quem cuida da operação da ótica?" }, { role: "lead", text: turn }]), memories: [{ key: "decision_maker", value: "É o dono da ótica", evidenceType: "explicit" as const }] };
    expect(withContextualHint(turn)).toContain("retribua naturalmente");
    expect(needsOutboundIdentityRepair("Qual é a maior dificuldade da ótica?", state, turn)).toBe(true);
    const result = trace("Tudo bem sim! Sou o Francisco, da Renova123.\n\nTe chamei porque a gente trabalha com gestão para óticas e queria entender rapidamente como vocês fazem isso hoje.", state, turn);
    expect(result).toEqual(expect.objectContaining({ raw: expect.any(String), validated: expect.any(String), final: expect.any(String), bubbles: expect.any(Array) }));
    expect(result.bubbles).toHaveLength(2);
    expect(result.final).toMatch(/tudo bem sim/i);
    expect(result.final).toMatch(/Francisco.*Renova123/is);
    expect(result.final).not.toMatch(/maior dificuldade/i);
  });

  it("cenário 2 — confirmação isolada pede apresentação, não small talk", () => {
    const state = snapshot([{ role: "agent", text: "Você é o responsável pela ótica?" }, { role: "lead", text: "Sou eu mesmo" }]);
    expect(needsOutboundIdentityRepair("Qual é sua maior dificuldade?", state, "Sou eu mesmo")).toBe(true);
    expect(interpretBrazilianContext("Sou eu mesmo").socialOpening).toBe(false);
  });

  it("cenário 3 — Ok continua acknowledgement, nunca clarification", () => {
    expect(interpretBrazilianContext("Ok").speechAct).toBe("acknowledgement");
    expect(ensureActiveInboundReply(null)).toBeNull();
  });

  it("cenário 4 — pergunta social explícita não é ignorada pelo contexto", () => {
    const prompt = new AgentContextBuilder().build(snapshot([]), "Oi, tudo bem?").systemPrompt;
    expect(prompt).toContain("retribua naturalmente");
    expect(withContextualHint("Oi, tudo bem?")).toContain("saudação ou pergunta social direta");
  });

  it("cenário 5 — resposta curta permanece em uma bolha", () => {
    const result = trace("Boa! Sou o Francisco, da Renova123.", snapshot([]), "Oi");
    expect(result.bubbles).toEqual([result.final]);
  });

  it("cenário 6 — apresentação e continuação comercial mantêm duas bolhas decididas pelo modelo", () => {
    const result = trace("Sou o Francisco, da Renova123.\n\nTe chamei porque trabalho com gestão para óticas.", snapshot([]), "Sou eu mesmo");
    expect(result.bubbles).toEqual(["Sou o Francisco, da Renova123.", "Te chamei porque trabalho com gestão para óticas."]);
  });

  it("cenário 7 — três unidades reais permanecem no máximo em três bolhas, sem microbolhas", () => {
    const result = trace("Tudo certo por aqui.\n\nSou o Francisco, da Renova123, e trabalho com gestão para óticas.\n\nQueria entender brevemente como vocês organizam a operação hoje.", snapshot([]), "Oi, tudo bem?");
    expect(result.bubbles).toHaveLength(3);
    expect(result.bubbles.every((bubble) => bubble.includes(" ") && /[.!?]$/.test(bubble))).toBe(true);
  });
});
