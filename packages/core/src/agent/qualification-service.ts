import type { AiDecision } from "@renova123/shared";
import type { AgentSnapshot } from "./types.js";
import { extractRequestedDemoSchedule, isContextualDemoAcceptance, isStrongCommercialIntent } from "./strong-commercial-intent.js";

export class QualificationService {
  evaluate(input: AiDecision, snapshot: AgentSnapshot, userMessage: string): AiDecision {
    const facts = new Map(snapshot.memories.filter((m) => m.evidenceType === "explicit").map((m) => [m.key, m.value]));
    for (const memory of input.memoryUpdates) if (memory.evidenceType === "explicit" && memory.confidence >= 0.7) facts.set(memory.key, memory.value);
    const role = facts.has("decision_maker") || facts.has("professional_category");
    const pain = facts.has("main_pain");
    const previousAgentText = [...snapshot.messages].reverse().find((message) => message.role === "agent" || message.role === "human")?.text ?? null;
    const requestedSchedule = extractRequestedDemoSchedule(userMessage, previousAgentText) ?? scheduleFromFacts(facts.get("availability"));
    const directStrongIntent = isStrongCommercialIntent(userMessage) || ["pricing", "demo", "multi_store", "referral"].includes(input.detectedIntent);
    const contextualDemoAcceptance = isContextualDemoAcceptance(userMessage, previousAgentText);
    const interest = directStrongIntent || contextualDemoAcceptance || Boolean(requestedSchedule) || facts.has("interest") || facts.has("demo_accepted") || /\b(quero|gosto|legal isso|pode mostrar|tenho interesse|me interessa|faz sentido|vamos avançar|quero ver|demonstra[cç][aã]o)\b/i.test(userMessage);
    const score = Math.min(100, (role ? 25 : 0) + (pain ? 35 : 0) + (interest ? 40 : 0));
    const previousConsent = snapshot.mariliaConsent ?? "not_asked";
    const explicitDenial = previousConsent === "pending" && /\b(n[aã]o|prefiro n[aã]o)\b/i.test(userMessage);
    const explicitConsent = explicitDenial ? "denied" : previousConsent === "pending" && (/\b(sim|pode|claro|autorizo)\b/i.test(userMessage) || Boolean(requestedSchedule)) ? "granted" : null;
    const consent = explicitConsent ?? (input.mariliaConsent !== "not_asked" ? input.mariliaConsent : previousConsent);
    const handoffAlreadyCompleted = snapshot.qualificationStatus === "qualified" && previousConsent === "granted";
    if (input.shouldOptOut || input.detectedIntent === "no_interest") return { ...input, qualificationStatus: "disqualified", qualificationScore: 0, handoffType: null, mariliaConsent: "not_asked", shouldHandoff: false };
    if (input.shouldHandoff && input.confidence < 0.55) return { ...input, qualificationStatus: "stalled", qualificationScore: score, handoffType: "low_confidence", mariliaConsent: consent };
    if (input.shouldHandoff && ["human", "call_request"].includes(input.detectedIntent)) return { ...input, qualificationStatus: "stalled", qualificationScore: score, handoffType: "human_requested", mariliaConsent: consent };
    if (handoffAlreadyCompleted) return { ...input, replyText: postHandoffReply(input.replyText, requestedSchedule), qualificationStatus: "qualified", qualificationScore: Math.max(score, snapshot.qualificationScore ?? 100), handoffType: "sales_qualified", shouldHandoff: false, mariliaConsent: "granted", shouldScheduleDemo: false, appointmentData: null };
    if (consent === "denied") return { ...input, qualificationStatus: "discovering", qualificationScore: score, handoffType: null, shouldHandoff: false, mariliaConsent: consent };
    const commerciallyAuthorized = consent === "granted" || directStrongIntent || contextualDemoAcceptance || Boolean(requestedSchedule) || facts.has("demo_accepted");
    if (commerciallyAuthorized) return { ...input, qualificationStatus: "qualified", qualificationScore: score, handoffType: "sales_qualified", shouldHandoff: true, handoffReason: input.handoffReason ?? "Lead qualificado e demonstrou intenção comercial forte.", mariliaConsent: "granted", replyText: qualifiedReply(requestedSchedule), shouldScheduleDemo: false, appointmentData: null, followUpAction: { action: "cancel", delayHours: null, reason: "Lead encaminhado para confirmação humana." } };
    if (!role || !pain) return { ...input, qualificationStatus: "discovering", qualificationScore: score, handoffType: input.handoffType ?? (input.shouldHandoff ? "other" : null), mariliaConsent: consent };
    return { ...input, qualificationStatus: "discovering", qualificationScore: score, handoffType: null, shouldHandoff: false, mariliaConsent: input.shouldProposeDemo || input.mariliaConsent === "pending" ? "pending" : consent };
  }
}

function postHandoffReply(reply: string | null, schedule: ReturnType<typeof extractRequestedDemoSchedule>) {
  if (schedule) return scheduleReply(schedule);
  if (!reply) return reply;
  const kept = reply.split(/\n\s*\n|(?<=[.!?])\s+/).filter((part) => !/(?:posso passar|autoriza|consent|vou repassar|vou encaminhar|mar[ií]lia rios|99126-3914|marcar uma demonstra[cç][aã]o)/i.test(part));
  return kept.join(" ").trim() || "Seu contato já foi encaminhado. Se surgir alguma dúvida sobre o Renova123, continuo por aqui.";
}

function qualifiedReply(schedule: ReturnType<typeof extractRequestedDemoSchedule>) {
  if (schedule) return scheduleReply(schedule);
  return "Perfeito. Vou repassar seu interesse e o contexto da conversa para o Pedro dar continuidade e confirmar o valor, sem confirmar um horário antes de validar a disponibilidade.";
}

function scheduleReply(schedule: NonNullable<ReturnType<typeof extractRequestedDemoSchedule>>) {
  const place = schedule.location ? ` em ${schedule.location}` : "";
  const brasilia = schedule.brasiliaTime ? `, equivalente a ${schedule.brasiliaTime} no horário de Brasília` : "";
  return `Perfeito. Registrei ${schedule.localTime}${place}${brasilia} como horário solicitado. Vou encaminhar para o Pedro confirmar a disponibilidade.`;
}

function scheduleFromFacts(value: string | undefined): ReturnType<typeof extractRequestedDemoSchedule> {
  if (!value?.startsWith("Horário solicitado:")) return null;
  const match = value.match(/^Horário solicitado:\s*(\d{2}:\d{2})(?:\s+([^;]+))?(?:; equivalente Brasília:\s*(\d{2}:\d{2}))?/);
  if (!match) return null;
  return { localTime: match[1]!, location: match[2]?.trim() ?? null, brasiliaTime: match[3] ?? null, summary: value };
}
