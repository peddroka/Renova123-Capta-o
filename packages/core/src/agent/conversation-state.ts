import type { AgentSnapshot } from "./types.js";

export type ConversationState = {
  openerSent: boolean;
  hasIntroduced: boolean;
  conversationEstablished: boolean;
  leadNameKnown: boolean;
  storeNameKnown: boolean;
  currentSystemKnown: boolean;
  leadRoleKnown: boolean;
  lastSubject: string | null;
  lastQuestion: string | null;
  answerToQuestion: string | null;
  lastQuestionAnswered: boolean;
  answeredTopics: string[];
  explicitIdentityQuestion: boolean;
  resumedAfterLongPause: boolean;
  painConfirmed: boolean;
  interestConfirmed: boolean;
  handoffCompleted: boolean;
  origin: "outbound_prospecting" | "inbound_contact";
  permissionToContinue: boolean;
  commercialInterest: "low" | "medium" | "high";
  productCuriosity: boolean;
  demoInterest: boolean;
  demoConsent: boolean;
  handoffConsent: boolean;
  irritation: boolean;
  humor: boolean;
  directQuestion: string | null;
  currentTopic: string;
};

export function deriveConversationState(snapshot: AgentSnapshot, currentLeadTurn: string): ConversationState {
  const agentMessages = snapshot.messages.filter((message) => message.role === "agent" || message.role === "human");
  const leadMessages = snapshot.messages.filter((message) => message.role === "lead");
  const previousAgentMessage = [...snapshot.messages].reverse().find((message) => message.role === "agent" || message.role === "human");
  const lastSubject = previousAgentMessage?.text.trim().slice(0, 500) || null;
  const recentQuestions = agentMessages.flatMap((message) => extractQuestions(message.text));
  const lastQuestion = recentQuestions.at(-1) ?? null;
  const affirmativeAnswer = isContextualAffirmative(currentLeadTurn);
  const roleQuestion = [...recentQuestions].reverse().find(isOwnerOrRoleQuestion) ?? null;
  const answerToQuestion = affirmativeAnswer
    ? (roleQuestion && isOwnerRoleAnswer(currentLeadTurn, roleQuestion) ? roleQuestion : lastQuestion)
    : null;
  const roleMemory = snapshot.memories.some((memory) => ["decision_maker", "professional_category"].includes(memory.key) && memory.value.trim());
  const answeredTopics = new Set<string>();
  for (const memory of snapshot.memories) {
    if (memory.key === "answered_questions") for (const item of memory.value.split(/[;|\n]+/)) if (item.trim()) answeredTopics.add(item.trim());
    if (["decision_maker", "professional_category"].includes(memory.key) && memory.value.trim()) answeredTopics.add("função de dono ou responsável");
  }
  if (answerToQuestion && isOwnerOrRoleQuestion(answerToQuestion)) answeredTopics.add("função de dono ou responsável");
  const explicitIdentityQuestion = asksAgentIdentity(currentLeadTurn);
  const firstConversationalMessage = snapshot.messages.find((message) => message.role === "lead" || message.role === "agent" || message.role === "human");
  const origin = firstConversationalMessage?.role === "agent" || firstConversationalMessage?.role === "human" ? "outbound_prospecting" : "inbound_contact";
  const normalizedTurn = normalize(currentLeadTurn);
  const speechAct = contextualSpeechAct(normalizedTurn);
  const permissionToContinue = speechAct === "continue" || /^(?:certo,?\s+)?(?:pode falar|pode dizer|pode continuar|fala|manda)(?:[.! ]|$)/.test(normalizedTurn);
  const directQuestion = extractQuestions(currentLeadTurn).at(-1) ?? null;
  const productCuriosity = Boolean(directQuestion && /como funciona|o que (?:é|e)|sistema|recurso|funcionalidade|preço|valor|demonstra/.test(normalizedTurn));
  const demoInterest = hasExplicitMemory(snapshot, "demo_discussed") || /\b(?:quero ver|me mostra|pode mostrar|demonstração|demonstracao|demo)\b/.test(normalizedTurn);
  const demoConsent = snapshot.mariliaConsent === "granted" || (demoInterest && /^(?:sim|pode|pode ser|vamos|fechado|quero)/.test(normalizedTurn));
  const handoffConsent = snapshot.mariliaConsent === "granted" || /(?:pode passar|pode encaminhar|fala com ela|me chama)/.test(normalizedTurn);
  const commercialInterest = hasExplicitMemory(snapshot, "interest") || /\b(?:quero ver|me mostra|gostei|interessante|isso ajudaria|tenho interesse)\b/.test(normalizedTurn)
    ? "high" : "low";
  const currentTopic = /(?:demonstração|demonstracao|demo|marilia)/.test(normalizedTurn) ? "demonstração"
    : /(?:sistema|software|planilha|papel)/.test(normalizedTurn) ? "sistema atual"
      : directQuestion ? "pergunta direta" : lastSubject ? "continuação da conversa" : "abertura";
  const lastAgentAt = parseTime(previousAgentMessage?.createdAt);
  const lastLeadAt = parseTime(leadMessages.at(-1)?.createdAt);
  const resumedAfterLongPause = Boolean(lastAgentAt && lastLeadAt && lastLeadAt - lastAgentAt >= 7 * 24 * 60 * 60_000);
  return {
    openerSent: agentMessages.length > 0,
    hasIntroduced: agentMessages.some((message) => isSelfIntroduction(message.text)),
    conversationEstablished: agentMessages.length > 0 && leadMessages.length > 0,
    leadNameKnown: snapshot.memories.some((memory) => memory.key === "informed_name" && memory.evidenceType !== "hypothesis" && memory.value.trim().length > 0),
    storeNameKnown: hasExplicitMemory(snapshot, "store_name"),
    currentSystemKnown: hasExplicitMemory(snapshot, "current_system"),
    leadRoleKnown: roleMemory || Boolean(answerToQuestion && isOwnerOrRoleQuestion(answerToQuestion)),
    lastSubject,
    lastQuestion,
    answerToQuestion,
    lastQuestionAnswered: Boolean(answerToQuestion),
    answeredTopics: [...answeredTopics],
    explicitIdentityQuestion,
    resumedAfterLongPause,
    painConfirmed: hasExplicitMemory(snapshot, "main_pain"),
    interestConfirmed: hasExplicitMemory(snapshot, "interest"),
    handoffCompleted: snapshot.qualificationStatus === "qualified" && snapshot.mariliaConsent === "granted",
    origin,
    permissionToContinue,
    commercialInterest,
    productCuriosity,
    demoInterest,
    demoConsent,
    handoffConsent,
    irritation: /(?:muita pergunta|já falei|ja falei|direto ao ponto|sem enrolação|sem enrolacao|não enche|nao enche)/.test(normalizedTurn),
    humor: /(?:kkkk|haha|rsrs|😂|😅)/i.test(currentLeadTurn),
    directQuestion,
    currentTopic,
  };
}

function contextualSpeechAct(normalized: string) {
  if (/^(?:certo,?\s+)?(?:pode falar|pode dizer|pode continuar|fala|manda)(?:[.! ]|$)/.test(normalized)) return "continue";
  if (/^(?:sim|ss|beleza|blz|pode|isso|isso mesmo|correto|certo)(?:[.! ]|$)/.test(normalized)) return "affirmative";
  return "other";
}

function hasExplicitMemory(snapshot: AgentSnapshot, key: string) {
  return snapshot.memories.some((memory) => memory.key === key && memory.evidenceType !== "hypothesis" && memory.value.trim());
}

export function isContextualAffirmative(value: string) {
  const normalized = withoutSocialOpening(normalize(value));
  return /^(?:sim|ss|blz|beleza|pode|fala|manda|sou|sou eu|sou eu mesmo|eu sou|eu mesmo|isso|isso mesmo|correto|certo)(?:[.! ]|$)/.test(normalized);
}

export function isOwnerRoleAnswer(value: string, previousQuestion = "") {
  const normalized = withoutSocialOpening(normalize(value));
  if (/^(?:nao|nunca|negativo)(?:[.! ]|$)/.test(normalized)) return false;
  if (/^(?:dono|proprietario|responsavel|decisor)(?:[.! ]|$)/.test(normalized)) return true;
  if (/\b(?:dono|proprietario|responsavel|decisor)\b/.test(normalized) && /^(?:sim\s+)?(?:sou|eu sou|sou eu|eu mesmo|sou eu mesmo|eu que|eu cuido)(?:\s|$)/.test(normalized)) return true;
  if (!isOwnerOrRoleQuestion(previousQuestion)) return false;
  return /^(?:sim|ss|isso|correto|sou|sou eu|eu sou|eu mesmo|sou eu mesmo|sim eu|sim sou eu)(?:\s|$)/.test(normalized)
    || /^(?:sim[, ]+)?eu\s+(?:que\s+)?(?:cuido|respondo|toco|gerencio)(?:\s|$)/.test(normalized);
}

export function isOwnerOrRoleQuestion(value: string) {
  const normalized = normalize(value);
  return /\b(?:dono|responsavel|funcao|cargo|decisor|decisao|operacao|gestao)\b/.test(normalized)
    || /\b(?:cuida|responde)\b[\s\S]{0,40}\b(?:otica|loja|operacao)\b/.test(normalized);
}

export function asksAgentIdentity(value: string) {
  const normalized = normalize(value);
  return /\bquem (?:e voce|e vc|esta falando|fala)\b/.test(normalized)
    || /\bcom quem (?:eu )?(?:falo|estou falando)\b/.test(normalized)
    || /\bqual e (?:o )?seu nome\b/.test(normalized)
    || /\bde onde (?:voce|vc) fala\b/.test(normalized)
    || /\b(?:por que|porque) entrou em contato\b/.test(normalized)
    || /\b(?:qual|que) (?:o )?(?:intuito|motivo) do contato\b/.test(normalized);
}

export function isSelfIntroduction(value: string) {
  const normalized = normalize(value);
  return /\b(?:sou(?: o)?|me chamo|meu nome e|aqui e o?) francisco\b/.test(normalized) || /\bfrancisco (?:aqui|da renova123)\b/.test(normalized);
}

export function extractExplicitLeadName(value: string) {
  return value.match(/\b(?:me chamo|meu nome (?:é|e)|pode me chamar de)\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ'-]{1,30}(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'-]{1,30})?)/i)?.[1]?.trim() ?? null;
}

function extractQuestions(value: string) {
  return value.match(/[^?]*\?/g)?.map((question) => question.trim()).filter(Boolean) ?? [];
}

function parseTime(value?: string) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function normalize(value: string) {
  return value.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function withoutSocialOpening(value: string) {
  return value.replace(/^(?:(?:oi|ola|bom dia|boa tarde|boa noite|e ai)(?:\s+(?:tudo bem|tudo certo))?\s*)+/, "").trim();
}
