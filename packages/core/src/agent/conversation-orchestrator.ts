import { interpretBrazilianContext } from "./contextual-pt-br.js";
import { deriveConversationState, isOwnerRoleAnswer, isOwnerOrRoleQuestion } from "./conversation-state.js";
import type { AgentSnapshot } from "./types.js";
import type { AiDecision } from "@renova123/shared";
import { extractRequestedDemoSchedule, isContextualDemoAcceptance, isStrongCommercialIntent } from "./strong-commercial-intent.js";

export type InterpretationConfidence = "UNDERSTOOD" | "LIKELY_INTENT" | "AMBIGUOUS";
export type SystemType = "none" | "generic" | "optical_specific" | "unknown";
export type ConversationPlan = {
  knownFacts: Record<string, string>;
  unansweredUserQuestion: string | null;
  currentTopic: string;
  askedTopics: string[];
  answeredTopics: string[];
  interestLevel: "low" | "medium" | "high";
  irritation: boolean;
  interpretation: InterpretationConfidence;
  currentSystemType: SystemType;
  commercialStage: AgentSnapshot["stage"];
  forbiddenActions: string[];
  deterministicMemoryUpdates: AiDecision["memoryUpdates"];
};

type MemoryUpdate = NonNullable<AiDecision["memoryUpdates"]>[number];
type MemoryKey = MemoryUpdate["key"];

export function planConversation(snapshot: AgentSnapshot, leadTurn: string): ConversationPlan {
  const state = deriveConversationState(snapshot, leadTurn);
  const known = new Map(snapshot.memories.filter((item) => item.evidenceType !== "hypothesis" && item.value.trim()).map((item) => [item.key, item.value.trim()]));
  const previousQuestion = [...snapshot.messages].reverse().find((message) => message.role !== "lead" && message.text.includes("?"))?.text ?? "";
  const updates = extractDeterministicFacts(leadTurn, previousQuestion, known);
  for (const update of updates) known.set(update.key, update.value);
  const interpretation = interpretationConfidence(leadTurn);
  const currentSystemType = normalizeSystemType(known.get("current_system_type"), known.get("current_system"));
  const askedTopics = unique([...snapshot.questionsAsked.flatMap(questionTopics), ...snapshot.messages.filter((item) => item.role !== "lead").flatMap((item) => questionTopics(item.text))]);
  const answeredTopics = unique([...state.answeredTopics, ...memoryAnsweredTopics(known)]);
  const unansweredUserQuestion = extractLastQuestion(leadTurn);
  const currentTopic = inferCurrentTopic(leadTurn, known, previousQuestion);
  const interestLevel = inferInterest(leadTurn, known);
  const forbiddenActions = ["inventar fatos ausentes", "despejar uma lista de recursos", "perguntar o WhatsApp atual do lead"];

  if (interpretation === "AMBIGUOUS") {
    forbiddenActions.push("criar memória comercial", "assumir intenção", "mudar de assunto");
  }
  if (unansweredUserQuestion) forbiddenActions.push("ignorar a pergunta direta do cliente");
  if (state.handoffCompleted) forbiddenActions.push("repetir handoff", "repetir contato do Pedro", "pedir novo consentimento");
  if (known.has("decision_maker")) forbiddenActions.push("perguntar novamente se é dono, gerente ou responsável");
  if (currentSystemType === "generic") forbiddenActions.push("atacar o sistema atual", "assumir que o sistema é ruim");
  if (currentSystemType === "optical_specific") forbiddenActions.push("atacar concorrente", "presumir insatisfação");
  if (known.has("main_pain")) forbiddenActions.push("repetir perguntas de dor que já foi explicada");
  if (isStrongCommercialIntent(leadTurn) || known.has("demo_accepted") || known.has("availability")) forbiddenActions.push("continuar entrevista comercial", "voltar a explicações genéricas");

  return { knownFacts: Object.fromEntries(known), unansweredUserQuestion, currentTopic, askedTopics, answeredTopics, interestLevel, irritation: /direct/.test(known.get("preferred_tone") ?? "") || /muita pergunta|vai direto|ja falei|não enche/i.test(fold(leadTurn)), interpretation, currentSystemType, commercialStage: snapshot.stage, forbiddenActions: unique(forbiddenActions), deterministicMemoryUpdates: interpretation === "AMBIGUOUS" ? [] : updates };
}

function extractDeterministicFacts(text: string, previousQuestion: string, known: Map<string, string>): AiDecision["memoryUpdates"] {
  const value = text.trim();
  const normalized = fold(value);
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const firstUseful = lines.find((line) => !/^(?:oi|ola|pode falar|fala|manda)$/i.test(fold(line))) ?? value;
  const updates: AiDecision["memoryUpdates"] = [];
  const add = (key: MemoryKey, itemValue: string) => { if (itemValue.trim()) updates.push({ key, value: itemValue.trim(), evidenceType: "explicit", confidence: 1 }); };
  if (isOwnerOrRoleQuestion(previousQuestion) && lines.some((line) => isOwnerRoleAnswer(line, previousQuestion))) {
    add("decision_maker", "É dono ou responsável pela ótica"); add("professional_category", /dono/.test(normalized) ? "owner" : "owner_responsible"); add("answered_questions", "função de dono ou responsável");
  }
  if (isOwnerOrRoleQuestion(previousQuestion) && /\bnao\b[\s\S]{0,60}\b(?:socio|socia|gerente|responsavel)\b/i.test(normalized)) {
    add("answered_questions", "função de dono ou responsável");
    add("next_action", value.slice(0, 500));
  }
  if (/\b(?:agora|no momento)\b[\s\S]{0,30}\b(?:ocupad[oa]|sem tempo|correndo)\b|\b(?:ocupad[oa]|sem tempo|correndo)\b[\s\S]{0,30}\b(?:agora|no momento)\b/i.test(normalized)) add("availability", "Indisponível no momento");
  const explicitName = value.match(/\b(?:me chamo|meu nome (?:é|e)|pode me chamar de)\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ'-]{1,30}(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'-]{1,30})?)/i)?.[1];
  if (explicitName) add("informed_name", explicitName);
  else if (/como posso te chamar|qual (?:é|e) (?:o )?seu nome/i.test(previousQuestion) && validShortAnswer(firstUseful)) add("informed_name", firstUseful);
  if (/nome da (?:sua )?(?:ótica|otica|loja)|como chama a (?:sua )?(?:ótica|otica|loja)/i.test(previousQuestion) && firstUseful.length <= 100) add("store_name", firstUseful);
  const generic = /\b(?:uso|usamos|temos|tenho)\b[\s\S]{0,40}\bsistema\b[\s\S]{0,80}\b(?:nao e|não é)\s+(?:especifico|específico)(?:\s+para|\s+pra)?\s+(?:otica|ótica)|\bsistema generico\b/i.test(normalized);
  const optical = !generic && /\b(?:sistema|software)\b[\s\S]{0,50}\b(?:especifico|específico|proprio|próprio)\b[\s\S]{0,30}\b(?:otica|ótica)\b/i.test(normalized);
  const none = /\b(?:nao usamos|não usamos|nao uso|não uso|sem sistema|nenhum sistema)\b/i.test(normalized);
  if (generic) { add("current_system", "Usa um sistema genérico, não específico para óticas"); add("current_system_type", "generic"); add("answered_questions", "sistema atual"); }
  else if (optical) { add("current_system", "Usa um sistema específico para óticas"); add("current_system_type", "optical_specific"); add("answered_questions", "sistema atual"); }
  else if (none) { add("current_system", "Não usa sistema"); add("current_system_type", "none"); add("answered_questions", "sistema atual"); }
  else if (/\b(?:uso|usamos|temos|tenho)\b[\s\S]{0,30}\bsistema\b/i.test(normalized)) { add("current_system", "Usa um sistema"); add("current_system_type", "unknown"); add("answered_questions", "sistema atual"); }
  if (!known.has("interest") && /\b(?:gostei|interessante|quero ver|pode mostrar|tenho interesse|vamos ver)\b/i.test(normalized)) add("interest", "Quer conhecer o Renova123 na prática");
  if (!known.has("main_pain") && /\b(?:toma|consome|gasta|perco|perdemos)\b[\s\S]{0,30}\b(?:muito )?tempo\b|\b(?:muito manual|trabalho manual|fa[cç]o tudo|sobrecarregad[oa])\b/i.test(normalized)) add("main_pain", "O processo manual toma muito tempo do responsável");
  if (/\b(?:anoto|pego (?:o )?contato|chamo no whatsapp|qualifico)\b/i.test(normalized)) add("current_process", value.slice(0, 500));
  const schedule = extractRequestedDemoSchedule(value, previousQuestion);
  if (schedule) {
    add("availability", schedule.summary);
    add("demo_status", "Demonstração solicitada; horário aguardando confirmação");
    add("demo_accepted", "Aceitou a demonstração e informou disponibilidade");
    add("next_action", "Encaminhar para Pedro confirmar disponibilidade");
    if (schedule.location) add("city", schedule.location);
  } else if (isStrongCommercialIntent(value) || isContextualDemoAcceptance(value, previousQuestion)) {
    add("interest", "Demonstrou intenção comercial forte");
    if (/demo|demonstra/i.test(`${value} ${previousQuestion}`)) add("demo_accepted", "Aceitou explicitamente uma demonstração");
  }
  return deduplicateUpdates(updates);
}

function interpretationConfidence(text: string): InterpretationConfidence {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length || (lines.length === 1 && /^[a-zà-ÿ]$/i.test(lines[0]!))) return "AMBIGUOUS";
  const acts = lines.map((line) => interpretBrazilianContext(line).speechAct);
  if (acts.every((act) => act === "ambiguous")) return "AMBIGUOUS";
  if (acts.some((act) => ["affirmative", "negative", "identity", "continue", "why", "acknowledgement", "clarification"].includes(act))) return "LIKELY_INTENT";
  return "UNDERSTOOD";
}
function memoryAnsweredTopics(known: Map<string, string>) { return [["decision_maker", "responsável"], ["informed_name", "nome da pessoa"], ["store_name", "nome da ótica"], ["current_system", "sistema atual"], ["main_pain", "dor principal"]].flatMap(([key, topic]) => known.has(key!) ? [topic!] : []); }
function questionTopics(text: string) { const n = fold(text); return [["nome", /nome|chamar/], ["ótica", /otica|loja/], ["responsável", /dono|gerente|responsavel|operacao/], ["sistema atual", /sistema|papel|planilha/], ["dor", /dificuldade|problema|falta|pesa/]].flatMap(([topic, regex]) => (regex as RegExp).test(n) && text.includes("?") ? [topic as string] : []); }
function inferCurrentTopic(text: string, known: Map<string, string>, previous: string) { const n = fold(`${text} ${previous}`); if (/demonstracao|demo|marilia/.test(n)) return "demonstração"; if (/sistema|software|planilha|papel/.test(n)) return "sistema atual"; if (/nome|chamar/.test(n)) return "identificação"; if (/otica|loja/.test(n)) return "ótica"; return known.get("current_topic") ?? "conversa comercial"; }
function inferInterest(text: string, known: Map<string, string>): "low" | "medium" | "high" { const n = fold(text); if (known.has("interest") || /quero ver|pode mostrar|tenho interesse|gostei|interessante|como funciona/.test(n)) return "high"; return "low"; }
function normalizeSystemType(explicit?: string, system?: string): SystemType { if (["none", "generic", "optical_specific", "unknown"].includes(explicit ?? "")) return explicit as SystemType; const n = fold(system ?? ""); return !n ? "unknown" : /nao usa/.test(n) ? "none" : /generico|nao especifico/.test(n) ? "generic" : /especifico.*otica/.test(n) ? "optical_specific" : "unknown"; }
function extractLastQuestion(text: string) {
  const end = text.lastIndexOf("?");
  if (end < 0) return null;
  const start = Math.max(text.lastIndexOf(".", end - 1), text.lastIndexOf("!", end - 1), text.lastIndexOf("\n", end - 1));
  return text.slice(start + 1, end + 1).trim() || null;
}
function validShortAnswer(value: string) { return /^[A-Za-zÀ-ÿ'-]{2,30}(?:\s+[A-Za-zÀ-ÿ'-]{2,30})?$/.test(value); }
function deduplicateUpdates(items: AiDecision["memoryUpdates"]): AiDecision["memoryUpdates"] { return [...new Map(items.map((item) => [item.key, item])).values()]; }
function unique<T>(items: T[]) { return [...new Set(items)]; }
function fold(value: string) { return value.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s?]/g, " ").replace(/\s+/g, " ").trim(); }
