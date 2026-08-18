export type QualifiedNotificationData = {
  name?: unknown; phone?: unknown; company?: unknown; city?: unknown; stores?: unknown; role?: unknown; currentScenario?: unknown; mainPain?: unknown;
  interest?: unknown; relatedCapability?: unknown; observations?: unknown; consent?: unknown; nextStep?: unknown;
};
export type StalledNotificationData = {
  name?: unknown; phone?: unknown; company?: unknown; firstContactAt?: unknown; lastResponseAt?: unknown; responseCount?: unknown;
  averageResponseTime?: unknown; perceivedInterest?: unknown; knownInformation?: unknown; missingForQualification?: unknown; summary?: unknown;
};

export function qualificationDeadlineAt(firstInboundAt: string | null | undefined, firstApproachAt: string | null | undefined, hours = 72) {
  const source = firstInboundAt ?? firstApproachAt;
  return source ? new Date(Date.parse(source) + hours * 3_600_000).toISOString() : null;
}
export function shouldMarkStalled(input: { deadlineReached: boolean; inboundMessages: number; hasCommercialEngagement: boolean; explicitNoInterest: boolean; qualificationStatus?: string | null; stage?: string | null; humanActive?: boolean; automationPaused?: boolean; takeoverState?: string | null }) {
  const terminal = new Set(["opted_out", "blocked", "invalid", "no_interest", "demo_scheduled", "converted", "won", "lost"]);
  return input.deadlineReached && input.inboundMessages >= 3 && input.hasCommercialEngagement && !input.explicitNoInterest && !terminal.has(String(input.stage)) && !["qualified", "disqualified"].includes(String(input.qualificationStatus)) && !input.humanActive && !input.automationPaused && !["human_active", "human_requested"].includes(String(input.takeoverState));
}
export function groupNotificationDedupKey(type: "lead_interested" | "lead_stalled" | "lead_disqualified", leadId: string) { return `${type}:${leadId}`; }
export function canAttemptGroupDelivery(status: string | null | undefined) { return status !== "sent" && status !== "blocked"; }

function field(label: string, value: unknown) { const text = typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value); return text ? `${label}: ${text}` : null; }
function format(title: string, entries: Array<[string, unknown]>) { return [title, ...entries.map(([label, value]) => field(label, value)).filter((value): value is string => Boolean(value))].join("\n"); }
export function formatQualifiedGroupMessage(data: QualifiedNotificationData) {
  return qualifiedMessage({ name: data.name, phone: data.phone, company: data.company, region: data.city, context: data.currentScenario ?? data.observations, mainInterest: data.interest ?? data.mainPain ?? data.relatedCapability, nextStep: data.nextStep });
}
export function formatHumanQualifiedGroupMessage(data: { name?: unknown; phone?: unknown; company?: unknown; region?: unknown; context?: unknown; mainInterest?: unknown; nextStep?: unknown }) {
  return qualifiedMessage(data);
}
function qualifiedMessage(data: { name?: unknown; phone?: unknown; company?: unknown; region?: unknown; context?: unknown; mainInterest?: unknown; nextStep?: unknown }) {
  return [
    "🔥 LEAD QUALIFICADO",
    "",
    `👤 Nome: ${cleanValue(data.name)}`,
    `📱 WhatsApp: ${cleanValue(data.phone)}`,
    `🏪 Ótica: ${cleanValue(data.company)}`,
    `📍 Região: ${cleanValue(data.region)}`,
    "",
    "💬 CONTEXTO DA CONVERSA",
    cleanValue(data.context),
    "",
    "🎯 PRINCIPAL INTERESSE",
    humanInterest(data.mainInterest),
    "",
    "➡️ PRÓXIMO PASSO",
    String(data.nextStep || "Pedro entrará em contato para dar continuidade ao atendimento."),
  ].join("\n");
}
export function formatStalledGroupMessage(data: StalledNotificationData) { return format("🟡 LEAD SEM AVANÇO — CONTATO HUMANO", [["Nome", data.name], ["Telefone", data.phone], ["Ótica", data.company], ["Primeiro contato", data.firstContactAt], ["Última resposta", data.lastResponseAt], ["Quantidade de respostas", data.responseCount], ["Tempo médio aproximado entre respostas", data.averageResponseTime], ["Interesse percebido", data.perceivedInterest], ["Informações já obtidas", data.knownInformation], ["O que faltou para qualificar", data.missingForQualification], ["Resumo", data.summary], ["Sugestão", "avaliar ligação/contato manual."]]); }
export function formatDisqualifiedGroupMessage(data: { name?: unknown; phone?: unknown; company?: unknown; city?: unknown; region?: unknown; role?: unknown; mainPain?: unknown; scenario?: unknown; context?: unknown; whatHappened?: unknown; reason?: unknown }) {
  return disqualifiedMessage(data);
}
export function formatDisqualifiedGroupMessageClean(data: { name?: unknown; phone?: unknown; company?: unknown; city?: unknown; region?: unknown; role?: unknown; mainPain?: unknown; scenario?: unknown; context?: unknown; whatHappened?: unknown; reason?: unknown }) {
  return disqualifiedMessage(data);
}

function disqualifiedMessage(data: { name?: unknown; phone?: unknown; company?: unknown; city?: unknown; region?: unknown; mainPain?: unknown; scenario?: unknown; context?: unknown; whatHappened?: unknown; reason?: unknown }) {
  const context = data.context ?? [data.scenario, data.mainPain, data.whatHappened].filter(Boolean).join(". ");
  return [
    "❌ LEAD DESQUALIFICADO", "",
    `👤 Nome: ${cleanValue(data.name)}`, `📱 WhatsApp: ${cleanValue(data.phone)}`, `🏪 Ótica: ${cleanValue(data.company)}`, `📍 Região: ${cleanValue(data.region ?? data.city)}`, "",
    "💬 CONTEXTO DA CONVERSA", cleanValue(context), "",
    "❌ MOTIVO DA PERDA", cleanValue(data.reason), "",
    "➡️ SITUAÇÃO", "Desqualificado.",
  ].join("\n");
}

function cleanValue(value: unknown) { const text = value === null || value === undefined ? "" : String(value).trim(); return text || "Não informado"; }
function humanInterest(value: unknown) { const text = cleanValue(value); if (/^(?:high|medium|low|owner_responsible|generic|unknown)$/i.test(text)) return "Conhecer melhor o Renova123 conforme o contexto da ótica."; return text.replace(/_/g, " "); }
