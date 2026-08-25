import { deriveConversationState, isSelfIntroduction, type AgentSnapshot } from "@renova123/core";

export function roleFromStoredMessage(direction: unknown, senderType: unknown): "lead" | "agent" | "human" {
  if (direction === "inbound") return "lead";
  return senderType === "human" ? "human" : "agent";
}

export function appendLatestLeadMessageIfMissing(
  messages: AgentSnapshot["messages"],
  latestText: string,
  createdAt = new Date().toISOString(),
  latestId?: string,
) {
  const text = latestText.trim();
  if (!text) return messages;
  if (latestId && messages.some((message) => message.externalId === latestId || message.id === latestId))
    return messages;
  let start = messages.length - 1;
  while (start >= 0 && messages[start]?.role === "lead") start -= 1;
  const persistedTurn = messages
    .slice(start + 1)
    .map((message) => message.text.trim())
    .filter(Boolean)
    .join("\n");
  const persistedNormalized = normalizeComparable(persistedTurn);
  const textNormalized = normalizeComparable(text);
  if (
    persistedNormalized === textNormalized ||
    (textNormalized.length > 0 && persistedNormalized.endsWith(textNormalized))
  )
    return messages;
  return [...messages, { role: "lead" as const, text, createdAt }];
}

export function currentLeadTurn(snapshot: AgentSnapshot, fallback: string) {
  const messages = snapshot.messages;
  let start = messages.length - 1;
  while (start >= 0 && messages[start]?.role !== "agent" && messages[start]?.role !== "human") start -= 1;
  const texts = messages
    .slice(start + 1)
    .filter((message) => message.role === "lead")
    .map((message) => message.text.trim())
    .filter(Boolean);
  if (
    texts.length > 1 &&
    normalizeComparable(texts.at(-1)!) === normalizeComparable(texts.slice(0, -1).join("\n"))
  )
    return texts.at(-1)!;
  const compact = texts.filter(
    (text, index) => index === 0 || normalizeComparable(text) !== normalizeComparable(texts[index - 1]!),
  );
  return compact.join("\n").trim() || fallback.trim();
}

export function needsOutboundIdentityRepair(
  replyText: string | null,
  snapshot: AgentSnapshot,
  leadTurn: string,
) {
  const state = deriveConversationState(snapshot, leadTurn);
  if (!state.explicitIdentityQuestion || !startedAsOutboundProspecting(snapshot)) return false;
  const reply = normalizeComparable(replyText ?? "");
  const identifiesFrancisco = /\bfrancisco\b/.test(reply);
  const identifiesCompany = /\brenova123\b/.test(reply);
  const explainsReason =
    /\b(?:entrei em contato|falei com voce|chamei voce|motivo|otica|sistema|gestao)\b/.test(reply);
  const asksIdentityBack = /\bquem (?:e voce|e vc|fala|esta falando)\b/.test(reply);
  const exposesInternalRole = /\b(?:sdr|lead|pipeline|handoff|qualificacao|follow up)\b/.test(reply);
  const actsLikeInboundSupport = /\bcomo posso (?:te )?ajudar(?: hoje)?\b/.test(reply);
  const inventsVoiceCall = /\b(?:ligando|ligacao|telefonema)\b/.test(reply);
  return (
    !identifiesFrancisco ||
    !identifiesCompany ||
    !explainsReason ||
    asksIdentityBack ||
    exposesInternalRole ||
    actsLikeInboundSupport ||
    inventsVoiceCall
  );
}

export function needsRecentQuestionRepair(
  replyText: string | null,
  snapshot: AgentSnapshot,
  leadTurn: string,
) {
  if (!replyText || !startedAsOutboundProspecting(snapshot) || !isGreetingOnly(leadTurn)) return false;
  const previousAgent = [...snapshot.messages]
    .reverse()
    .find((message) => message.role === "agent" || message.role === "human");
  if (!previousAgent) return false;
  const previousQuestions = sentenceParts(previousAgent.text).filter((sentence) => sentence.includes("?"));
  const replyQuestions = sentenceParts(replyText).filter((sentence) => sentence.includes("?"));
  return previousQuestions.some((previous) =>
    replyQuestions.some(
      (current) => similarity(normalizeComparable(previous), normalizeComparable(current)) >= 0.55,
    ),
  );
}

export function isGreetingOnly(text: string) {
  const normalized = normalizeComparable(text)
    .replace(/[.!?]+$/g, "")
    .trim();
  return /^(?:oi|ola|opa|fala|bom dia|boa tarde|boa noite)(?: tudo bem| tudo certo)?$/.test(normalized);
}

function startedAsOutboundProspecting(snapshot: AgentSnapshot) {
  const firstConversationalMessage = snapshot.messages.find(
    (message) => message.role === "lead" || message.role === "agent" || message.role === "human",
  );
  return firstConversationalMessage?.role === "agent" || firstConversationalMessage?.role === "human";
}

export function naturalMessageParts(text: string) {
  const normalized = text.trim();
  if (!normalized) return [];
  const paragraphs = normalized
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (paragraphs.length <= 1) return [normalized];
  return paragraphs.length <= 3
    ? paragraphs
    : [paragraphs[0]!, paragraphs[1]!, paragraphs.slice(2).join(" ")];
}

export function conversationalBubbleDelayMs(parts: string[], leadTurn: string) {
  if (parts.length !== 2) return 0;
  const all = normalizeComparable(`${leadTurn} ${parts.join(" ")}`);
  if (
    /(?:correndo|rapido|urgente|nao tenho interesse|obrigado|nao me chame|para de perguntar|direto ao ponto)/.test(
      all,
    )
  )
    return 0;
  const first = normalizeComparable(parts[0]!);
  const second = normalizeComparable(parts[1]!);
  const hasExplanation = first.split(" ").length >= 8;
  const hasContinuation = /\?|(?:se quiser|posso te mostrar|me conta|hoje voces|voces usam|fica no)/.test(
    second,
  );
  return hasExplanation && hasContinuation ? Math.min(7000, Math.max(4000, 3500 + parts[0]!.length * 8)) : 0;
}

export function removeRepeatedFormulations(replyText: string | null, snapshot: AgentSnapshot) {
  if (!replyText) return replyText;
  const prior = snapshot.messages
    .filter((message) => message.role === "agent")
    .flatMap((message) => sentenceParts(message.text))
    .concat(snapshot.questionsAsked)
    .map(normalizeComparable);
  const kept = paragraphParts(replyText)
    .map((paragraph) =>
      sentenceParts(paragraph)
        .filter((sentence) => {
          const candidate = normalizeComparable(sentence);
          const repeated = prior.some((previous) => similarity(previous, candidate) >= 0.88);
          return !repeated || containsBusinessFact(sentence);
        })
        .join(" ")
        .trim(),
    )
    .filter(Boolean);
  return kept.join("\n\n").trim() || null;
}

export function protectConversationContinuity(
  replyText: string | null,
  snapshot: AgentSnapshot,
  leadTurn: string,
) {
  if (!replyText) return replyText;
  const state = deriveConversationState(snapshot, leadTurn);
  const identificationAllowed = state.explicitIdentityQuestion || state.resumedAfterLongPause;
  let paragraphs = paragraphParts(replyText).map(sentenceParts);
  if (state.hasIntroduced && !identificationAllowed) {
    paragraphs = paragraphs.map((parts) => parts.map(stripSelfIntroduction).filter(Boolean));
  }
  if (state.conversationEstablished) {
    while (paragraphs[0]?.length && isRestartGreeting(paragraphs[0][0]!)) paragraphs[0].shift();
  }
  if (state.leadRoleKnown) {
    paragraphs = paragraphs.map((parts) =>
      parts.map((part) => removeAnsweredRoleQuestion(part, state.leadNameKnown)).filter(Boolean),
    );
  }
  paragraphs = paragraphs.map((parts) => parts.map(removeCurrentWhatsAppQuestion).filter(Boolean));
  if (volumeAlreadyAnswered(snapshot, leadTurn))
    paragraphs = paragraphs.map((parts) => parts.map(removeQuantityQuestion).filter(Boolean));
  return (
    paragraphs
      .map((parts) =>
        parts
          .join(" ")
          .replace(/\s+([,.!?;:])/g, "$1")
          .trim(),
      )
      .filter(Boolean)
      .join("\n\n") || null
  );
}

export function isIrritatedTurn(text: string) {
  const normalized = normalizeComparable(text);
  return /(?:pq tantas perguntas|por que tantas perguntas|de novo a mesma pergunta|ja falei|ja respondi|para de perguntar|nao enche|direto ao ponto|sem enrolacao|cara{2,}|complicad[oa]|e ruim mesmo)/.test(
    normalized,
  );
}

export function ensureActiveInboundReply(
  replyText: string | null,
  options: { shouldHandoff?: boolean; shouldOptOut?: boolean; noInterest?: boolean } = {},
) {
  if (replyText?.trim()) return replyText.trim();
  if (options.shouldOptOut) return "Entendido. Não enviaremos novas mensagens para este número.";
  if (options.noInterest) return "Tudo bem, não continuo a conversa por aqui.";
  if (options.shouldHandoff)
    return "Essa parte eu vou confirmar certinho com o Pedro para não te passar algo errado.";
  return null;
}

function removeCurrentWhatsAppQuestion(value: string) {
  return value
    .replace(/[^.!?]*(?:qual|confirma|me passa)[^?]{0,80}(?:whatsapp|número|numero)[^?]*\?/gi, "")
    .trim();
}

function removeQuantityQuestion(value: string) {
  return value
    .replace(/[^.!?]*\b(?:quantos?|quantas?|quanto|volume|n[uú]mero exato|por dia|por m[eê]s)\b[^?]*\?/gi, "")
    .trim();
}

function volumeAlreadyAnswered(snapshot: AgentSnapshot, leadTurn: string) {
  const all = `${leadTurn} ${snapshot.memories
    .filter((item) => ["answered_questions", "impact"].includes(item.key))
    .map((item) => item.value)
    .join(" ")}`;
  return /(?:n[aã]o sei (?:o )?n[uú]mero exato|muitos?|bastante|volume (?:alto|n[aã]o quantificado))/.test(
    normalizeComparable(all),
  );
}

function sentenceParts(text: string) {
  return text
    .trim()
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function paragraphParts(text: string) {
  return text
    .trim()
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function stripSelfIntroduction(value: string) {
  if (!isSelfIntroduction(value)) return value;
  return value
    .replace(
      /^(?:(?:oi|olá)[,! ]*)?(?:prazer[,! ]*)?(?:(?:eu )?sou(?: o)?|me chamo|meu nome é|aqui é o?) francisco(?:,? (?:aqui|da renova123|aqui da renova123))?\s*(?:[;.!,-]\s*|$)/i,
      "",
    )
    .replace(/^francisco (?:aqui|da renova123)\s*(?:[;.!,-]\s*|$)/i, "")
    .trim();
}

function isRestartGreeting(value: string) {
  const normalized = normalizeComparable(value);
  return /^(?:oi|ola)(?: tudo bem)?$/.test(normalized);
}

function removeAnsweredRoleQuestion(value: string, leadNameKnown: boolean) {
  if (!value.includes("?")) return value;
  const questionStart = value.search(/\b(?:qual|você|voce|vc)\b[^?]*\?\s*$/i);
  const question = questionStart >= 0 ? value.slice(questionStart) : value;
  const normalizedQuestion = normalizeComparable(question);
  if (!/\b(?:funcao|cargo|dono|responsavel|decisor)\b/.test(normalizedQuestion)) return value;
  const prefix = questionStart > 0 ? value.slice(0, questionStart).trim() : "";
  const replacement = /\bnome\b/.test(normalizedQuestion) && !leadNameKnown ? "Qual é o seu nome?" : "";
  return [prefix, replacement].filter(Boolean).join(" ");
}

function normalizeComparable(text: string) {
  return text
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function similarity(left: string, right: string) {
  const a = new Set(left.split(" ").filter(Boolean));
  const b = new Set(right.split(" ").filter(Boolean));
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((word) => b.has(word)).length;
  return intersection / Math.max(a.size, b.size);
}

function containsBusinessFact(text: string) {
  return /(?:R\$|\d|%|reais?|horas?|dias?|meses?)/i.test(text);
}
