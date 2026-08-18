import type { AiDecision } from "@renova123/shared";
export class HandoffTool {
  enforce(decision: AiDecision) { if (decision.confidence >= 0.55) return decision; return { ...decision, shouldHandoff: true, handoffType: "low_confidence" as const, handoffReason: decision.handoffReason ?? "Baixa confiança para responder com segurança.", replyText: decision.replyText ?? "Vou confirmar isso com uma pessoa da equipe para não te passar uma informação incorreta.", followUpAction: { action: "cancel" as const, delayHours: null, reason: "Transferência por baixa confiança." } }; }
}
