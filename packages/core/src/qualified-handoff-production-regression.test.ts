import { describe, expect, it } from "vitest";
import type { AiDecision } from "@renova123/shared";
import { AgentDecisionValidator } from "./agent/agent-decision-validator.js";
import { extractRequestedDemoSchedule } from "./agent/strong-commercial-intent.js";
import type { AgentSnapshot } from "./agent/types.js";
import { formatHumanQualifiedGroupMessage, groupNotificationDedupKey } from "./group-notifications.js";

const facts = [
  { key: "decision_maker", value: "É responsável pela ótica", evidenceType: "explicit", confidence: 1 },
  { key: "main_pain", value: "Faz a qualificação manual e perde muito tempo", evidenceType: "explicit", confidence: 1 },
  { key: "interest", value: "Aceitou demonstração", evidenceType: "explicit", confidence: 1 },
] satisfies AiDecision["memoryUpdates"];
const base: AgentSnapshot = { mind: {}, commercial: {}, lead: { phone: "5567981098066" }, batch: {}, stage: "demo_scheduling", summary: "", messages: [], memories: facts, materials: [], availableSlots: [], followUps: [], questionsAsked: [], materialsSent: [], humanActive: false, automationPaused: false, blocked: false, qualificationStatus: "discovering", qualificationScore: 65, mariliaConsent: "pending" };
const decision = (overrides: Partial<AiDecision> = {}): AiDecision => ({ replyText: "Vou agendar e confirmar.", leadStage: "demo_scheduling", detectedIntent: "demo", sentiment: "positive", summaryUpdate: null, memoryUpdates: [], questionsAnswered: [], objectionsDetected: [], shouldSendMaterial: false, materialQuery: null, shouldProposeDemo: true, suggestedSlots: [], shouldScheduleDemo: true, appointmentData: null, shouldHandoff: false, handoffReason: null, shouldOptOut: false, followUpAction: { action: "schedule", delayHours: 48, reason: "retomar" }, confidence: .95, internalReasoningSummary: "demo", qualificationStatus: "discovering", handoffType: null, qualificationScore: 65, mariliaConsent: "pending", ...overrides });

describe("regressão real de demo, fuso e handoff", () => {
  const turn = "As 17:30 lembrando que estou Campo Grande MS, aqui é 1h a menos que Brasília";
  const snapshot = { ...base, messages: [{ role: "agent" as const, text: "Qual horário funciona melhor para a demo? Vou confirmar a disponibilidade." }, { role: "lead" as const, text: turn }] };
  it("A qualifica, faz handoff e para de entrevistar", () => { const result = new AgentDecisionValidator().validate(decision(), snapshot).decision; expect(result).toMatchObject({ qualificationStatus: "qualified", handoffType: "sales_qualified", shouldHandoff: true }); expect(result.replyText).not.toContain("?"); });
  it("B preserva 17:30 Campo Grande e calcula 18:30 Brasília no contexto do grupo", () => { const schedule = extractRequestedDemoSchedule(turn, "Qual horário funciona melhor para a demo?")!; expect(schedule).toMatchObject({ localTime: "17:30", location: "Campo Grande/MS", brasiliaTime: "18:30" }); const body = formatHumanQualifiedGroupMessage({ phone: "5567981098066", region: schedule.location, context: schedule.summary, nextStep: schedule.summary }); expect(body).toMatch(/17:30 Campo Grande\/MS/); expect(body).toContain("18:30"); });
  it("C não confirma horário solicitado sem disponibilidade", () => { const reply = new AgentDecisionValidator().validate(decision(), snapshot).decision.replyText!; expect(reply).toContain("horário solicitado"); expect(reply).toContain("confirmar a disponibilidade"); expect(reply).not.toMatch(/está confirmado|confirmado para/i); });
  it("D handoff anterior não é repetido", () => { const result = new AgentDecisionValidator().validate(decision(), { ...snapshot, qualificationStatus: "qualified", qualificationScore: 100, mariliaConsent: "granted" }).decision; expect(result.shouldHandoff).toBe(false); expect(groupNotificationDedupKey("lead_interested", "lead-1")).toBe("lead_interested:lead-1"); });
});
