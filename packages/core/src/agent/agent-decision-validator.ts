import type { AiDecision } from "@renova123/shared";
import { SalesStageService } from "./sales-stage-service.js";
import { MaterialRecommendationService } from "./material-recommendation-service.js";
import { AppointmentTool } from "./appointment-tool.js";
import { HandoffTool } from "./handoff-tool.js";
import type { AgentSnapshot } from "./types.js";
import { QualificationService } from "./qualification-service.js";
import { enforceProductGrounding } from "./product-grounding.js";
import { enforceCommercialFactuality } from "./commercial-factuality.js";
import { deriveConversationState } from "./conversation-state.js";
export class AgentDecisionValidator {
  constructor(private readonly stages = new SalesStageService(), private readonly materials = new MaterialRecommendationService(), private readonly appointments = new AppointmentTool(), private readonly handoff = new HandoffTool(), private readonly qualification = new QualificationService()) {}
  validate(input: AiDecision, snapshot: AgentSnapshot, userMessage = snapshot.messages.at(-1)?.text ?? "") {
    let decision = reconcileAction(this.handoff.enforce(input));
    const state = deriveConversationState(snapshot, userMessage);
    if (state.permissionToContinue && state.commercialInterest === "low" && !state.productCuriosity && !state.demoInterest) {
      decision = { ...decision, shouldProposeDemo: false, shouldScheduleDemo: false, appointmentData: null, action: decision.action === "offer_demo" || decision.action === "confirm_demo" ? "continue_discovery" : decision.action };
    }
    decision = this.qualification.evaluate(decision, snapshot, snapshot.messages.at(-1)?.text ?? "");
    const noInterest = decision.detectedIntent === "no_interest";
    decision = { ...decision, leadStage: this.stages.resolve(snapshot.stage, decision.leadStage, { optOut: decision.shouldOptOut, handoff: decision.shouldHandoff, noInterest }) };
    if (snapshot.blocked || snapshot.humanActive || snapshot.automationPaused) decision = { ...decision, replyText: null, shouldSendMaterial: false, shouldScheduleDemo: false, appointmentData: null, followUpAction: { action: "cancel", delayHours: null, reason: "Conversa bloqueada, pausada ou em takeover." } };
    if (decision.shouldOptOut) decision = { ...decision, replyText: decision.replyText ?? "Entendido. Não enviaremos novas mensagens para este número.", shouldSendMaterial: false, materialQuery: null, shouldScheduleDemo: false, appointmentData: null, followUpAction: { action: "cancel", delayHours: null, reason: "Opt-out confirmado." } };
    const material = decision.shouldSendMaterial ? this.materials.recommend(decision.materialQuery, snapshot.materials, decision.leadStage) : null;
    if (!material) decision = { ...decision, shouldSendMaterial: false, materialQuery: null };
    const appointment = this.appointments.validate(decision, snapshot.availableSlots);
    if (!appointment.valid) decision = { ...decision, shouldScheduleDemo: false, appointmentData: null, replyText: safeSlotReply(decision.replyText) };
    decision = enforceProductGrounding(enforceCommercialFactuality(validateCommercialClaims(decision, snapshot.commercial), snapshot.commercial));
    return { decision, material, appointmentValid: appointment.valid };
  }
}
function reconcileAction(decision: AiDecision): AiDecision {
  if (decision.action === "offer_demo" && !decision.shouldProposeDemo) return { ...decision, shouldProposeDemo: true };
  if (decision.action === "confirm_demo" && !decision.shouldScheduleDemo) return { ...decision, shouldScheduleDemo: true };
  if (decision.action === "handoff" && !decision.shouldHandoff) return { ...decision, shouldHandoff: true };
  if (decision.action === "close_disinterest" && decision.detectedIntent !== "no_interest") return { ...decision, detectedIntent: "no_interest", leadStage: "no_interest", qualificationStatus: "disqualified" };
  return decision;
}
function validateCommercialClaims(decision: AiDecision, commercial: Record<string, unknown>) { const reply = decision.replyText ?? ""; const citesMoney = /R\$\s*\d|\b\d+[.,]?\d*\s*(reais|por mês|mensal)/i.test(reply); const citesDiscount = /\bdesconto\b|\b\d+%/i.test(reply); if ((citesMoney && !commercial.prices) || (citesDiscount && !commercial.discounts && !commercial.multiStoreDiscount)) return { ...decision, replyText: "Vou confirmar essa condição com o responsável para não te passar uma informação incorreta.", shouldHandoff: true, handoffType: "pricing" as const, handoffReason: "Condição comercial citada sem cadastro validado." }; return decision; }
function safeSlotReply(reply: string | null) { return reply ? `${reply}\nVou confirmar a disponibilidade antes de agendar.`.slice(0, 4000) : "Esse horário precisa ser confirmado. Posso te mostrar outras opções disponíveis?"; }
