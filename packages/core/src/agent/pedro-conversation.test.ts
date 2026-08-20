import { describe, expect, it } from "vitest";
import { AgentContextBuilder } from "./agent-context-builder.js";
import {
  PEDRO_OPERATIONAL_POLICY,
  PEDRO_PERSONA,
  detectPedroOwnerIntent,
  groundPedroClaims,
  isPedroInboundAllowed,
  isPedroProactiveWindow,
  pedroInitialApproach,
  planPedroReply,
  selectPedroAudioTemplate,
  splitPedroMessages,
  toPedroAiDecision,
} from "./pedro-conversation.js";
import type { AgentSnapshot } from "./types.js";

const snapshot = (overrides: Partial<AgentSnapshot> = {}): AgentSnapshot => ({
  agentSlug: "pedro", mind: {}, commercial: {}, lead: {}, batch: {}, stage: "engaged", summary: "", messages: [], memories: [], materials: [], availableSlots: [], followUps: [], questionsAsked: [], materialsSent: [], humanActive: false, automationPaused: false, blocked: false, ...overrides,
});

describe("inteligência conversacional do Pedro", () => {
  it("define persona, abordagem inicial em mensagens separadas e intenção de ligação", () => {
    expect(PEDRO_PERSONA.name).toBe("Pedro");
    expect(PEDRO_PERSONA.company).toBe("Paralelo Digital");
    expect(pedroInitialApproach().messages).toEqual(["Oi, tudo bem?", "Vou te ligar daqui a uns 15 minutinhos, beleza?"]);
    expect(pedroInitialApproach().callIntent).toBe(true);
  });

  it("não responde inbound desconhecido e separa campanha do Pedro", () => {
    expect(isPedroInboundAllowed({ initiatedByPedro: false, belongsToPedroCampaign: false })).toBe("blocked_unknown");
    expect(isPedroInboundAllowed({ initiatedByPedro: false, belongsToPedroCampaign: true })).toBe("pedro_campaign");
  });

  it("detecta responsável e conduz contato errado sem inventar contexto", () => {
    expect(detectPedroOwnerIntent("não sou eu, quem cuida é meu sócio")).toBe("not_responsible");
    expect(detectPedroOwnerIntent("sou eu mesmo, pode falar")).toBe("responsible");
    expect(planPedroReply({ text: "não sou eu" }).messages[0]).toContain("contato");
    expect(planPedroReply({ text: "sou eu mesmo" }).messages[0]).toContain("Me conta");
  });

  it("responde quem é de forma curta e limita bolhas", () => {
    const plan = planPedroReply({ text: "quem é?" });
    expect(plan.messages[0]).toContain("Pedro");
    expect(splitPedroMessages("Oi!\nTudo bem?\nPosso explicar?")).toHaveLength(3);
  });

  it("faz grounding de fatos e remove alegações não comprovadas", () => {
    expect(groundPedroClaims("Vi que a Ótica Sol tem uma dor no atendimento. Vocês não têm site.", { company: "Ótica Sol", currentProblem: "dor no atendimento" })).toBe("Vi que a Ótica Sol tem uma dor no atendimento.");
    expect(groundPedroClaims("Posso explicar sites e automações.", {})).toContain("Posso explicar");
  });

  it("encerra desinteresse sem perseguir", () => {
    const plan = planPedroReply({ text: "não tenho interesse" });
    expect(plan.action).toBe("close_disinterest");
    expect(toPedroAiDecision(plan).followUpAction.action).toBe("cancel");
  });

  it("gera READY_FOR_CALL, qualifica e cancela follow-ups", () => {
    const plan = planPedroReply({ text: "sim, pode me ligar hoje", facts: { company: "Ótica Sol", currentProblem: "atendimento" }, now: new Date("2026-08-19T12:00:00-03:00") });
    expect(plan.action).toBe("ready_for_call");
    expect(plan.handoff).toMatchObject({ event: "READY_FOR_CALL", agentSlug: "pedro", qualified: true, stopAutomation: true, cancelFollowUps: true });
    expect(toPedroAiDecision(plan)).toMatchObject({ shouldHandoff: true, qualificationStatus: "qualified", handoffType: "sales_qualified" });
  });

  it("mantém contexto Pedro separado no prompt e não contamina Francisco", () => {
    const pedro = new AgentContextBuilder().build(snapshot(), "oi");
    const francisco = new AgentContextBuilder().build(snapshot({ agentSlug: "francisco" }), "oi");
    expect(pedro.systemPrompt).toContain("Paralelo Digital");
    expect(pedro.systemPrompt).not.toContain("Você é Francisco");
    expect(francisco.systemPrompt).toContain("Você é Francisco");
  });

  it("respeita janela operacional e não repete áudio aprovado", () => {
    expect(PEDRO_OPERATIONAL_POLICY).toMatchObject({ timezone: "America/Sao_Paulo", start: "08:00", end: "17:00" });
    expect(isPedroProactiveWindow(new Date("2026-08-19T12:00:00Z"))).toBe(true);
    expect(isPedroProactiveWindow(new Date("2026-08-19T21:00:00Z"))).toBe(false);
    const first = selectPedroAudioTemplate("intro");
    expect(first).not.toBeNull();
    expect(selectPedroAudioTemplate("intro", [first!.id])).toBeNull();
  });
});
