import { describe, expect, it } from "vitest";
import { AgentDecisionValidator } from "./agent/agent-decision-validator.js";
import type { AgentSnapshot } from "./agent/types.js";
import type { AiDecision } from "@renova123/shared";

const snapshot: AgentSnapshot = { mind: {}, commercial: {}, lead: {}, batch: {}, stage: "engaged", summary: "", messages: [], memories: [], materials: [], availableSlots: [], followUps: [], questionsAsked: [], materialsSent: [], humanActive: false, automationPaused: false, blocked: false };
const makeDecision = (overrides: Partial<AiDecision> = {}): AiDecision => ({ replyText: "Tudo bem?", leadStage: "engaged", detectedIntent: "information", sentiment: "neutral", summaryUpdate: null, memoryUpdates: [], questionsAnswered: [], objectionsDetected: [], shouldSendMaterial: false, materialQuery: null, shouldProposeDemo: false, suggestedSlots: [], shouldScheduleDemo: false, appointmentData: null, shouldHandoff: false, handoffReason: null, shouldOptOut: false, followUpAction: { action: "none", delayHours: null, reason: "aguardar" }, confidence: 0.9, internalReasoningSummary: "simulação", qualificationStatus: "discovering", handoffType: null, qualificationScore: 0, mariliaConsent: "not_asked", ...overrides });
const facts = [{ key: "professional_category" as const, value: "owner_responsible", evidenceType: "explicit" as const, confidence: 1 }, { key: "main_pain" as const, value: "dor", evidenceType: "explicit" as const, confidence: 1 }];

describe("qualificação comercial e consentimento", () => {
  const validator = new AgentDecisionValidator();
  it("A autoriza Marília, transfere e envia o contato em texto", () => {
    const result = validator.validate(makeDecision({ detectedIntent: "demo", mariliaConsent: "granted", memoryUpdates: facts }), snapshot).decision;
    expect(result).toMatchObject({ qualificationStatus: "qualified", handoffType: "sales_qualified", shouldHandoff: true });
    expect(result.replyText).toContain("Vou repassar seu interesse");
    expect(result.replyText).not.toMatch(/horário confirmado|está confirmado/i);
  });
  it("B não autoriza, C curiosidade e E técnica não transferem", () => {
    expect(validator.validate(makeDecision({ detectedIntent: "demo", mariliaConsent: "denied", memoryUpdates: facts }), snapshot).decision.shouldHandoff).toBe(false);
    expect(validator.validate(makeDecision(), snapshot).decision.shouldHandoff).toBe(false);
    expect(validator.validate(makeDecision({ handoffType: "technical" }), snapshot).decision.handoffType).not.toBe("sales_qualified");
  });
  it("D baixa confiança e F desinteresse são separados", () => {
    expect(validator.validate(makeDecision({ confidence: 0.2 }), snapshot).decision).toMatchObject({ qualificationStatus: "stalled", handoffType: "low_confidence" });
    expect(validator.validate(makeDecision({ detectedIntent: "no_interest", leadStage: "no_interest" }), snapshot).decision).toMatchObject({ qualificationStatus: "disqualified", shouldHandoff: false });
  });
  it("G aceita demonstração como intenção forte quando decisor e dor já estão claros", () => {
    const pending = validator.validate(makeDecision({ detectedIntent: "demo", shouldProposeDemo: true, mariliaConsent: "pending", memoryUpdates: [{ key: "interest", value: "sim", evidenceType: "explicit", confidence: 1 }, ...facts] }), snapshot).decision;
    expect(pending.mariliaConsent).toBe("granted");
    expect(pending).toMatchObject({ qualificationStatus: "qualified", shouldHandoff: true });
  });
});
