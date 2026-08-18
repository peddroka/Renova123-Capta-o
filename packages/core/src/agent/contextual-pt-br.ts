export type ContextualSpeechAct = "why" | "continue" | "affirmative" | "negative" | "identity" | "acknowledgement" | "clarification" | "ambiguous" | "other";

export type ContextualInterpretation = { normalizedText: string; speechAct: ContextualSpeechAct; hint: string | null; socialOpening: boolean };

const fold = (value: string) => value.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s?]/g, " ").replace(/\s+/g, " ").trim();

export function interpretBrazilianContext(value: string): ContextualInterpretation {
  const normalized = fold(value);
  const socialOpening = hasSocialOpening(value);
  const semantic = stripSocialOpening(normalized);
  let speechAct: ContextualSpeechAct = semantic.length <= 3 ? "ambiguous" : "other";
  let hint: string | null = null;
  if (!semantic && socialOpening) { speechAct = "acknowledgement"; hint = "O lead cumprimentou; retribua naturalmente e continue o assunto sem pedir para completar a mensagem."; }
  else if (/^(?:pq|por que|porque)\??$/.test(semantic)) { speechAct = "why"; hint = "O lead está perguntando o motivo do ponto imediatamente anterior; responda esse motivo antes de avançar."; }
  else if (/^(?:e|e ai|e dai|continua|prossegue)\??$/.test(semantic)) { speechAct = "continue"; hint = "O lead pede continuidade da explicação ou do assunto anterior; continue sem reiniciar o questionário."; }
  else if (/^(?:ok|okay|aham|entendi|blz|beleza|certo|correto|show|tranquilo)\.?$/.test(semantic)) { speechAct = "acknowledgement"; hint = "Reconhecimento breve; mantenha o assunto atual e não trate como nova pergunta."; }
  else if (/^(?:ss|sim|pode|fala|manda|isso|isso mesmo)\.?$/.test(semantic)) { speechAct = "affirmative"; hint = "Confirmação/aceite contextual; use a pergunta ou assunto anterior como referência."; }
  else if (/^(?:nn|nao|negativo)\.?$/.test(semantic)) { speechAct = "negative"; hint = "Negação contextual; responda ao ponto anterior sem pedir que o lead repita a palavra."; }
  else if (/^(?:sou|sou eu|eu mesmo|sou o dono|sou dono|sou responsavel)(?:\b[\s\S]*)?$/.test(semantic)) { speechAct = "identity"; hint = "Confirmação de identidade/função do lead; registre como resposta à pergunta de função/dono."; }
  else if (/^(?:sei|ta)\.?$/.test(semantic)) { speechAct = "acknowledgement"; hint = "Reconhecimento breve; mantenha o assunto atual e não trate como nova pergunta."; }
  else if (/^(?:como assim|nao entendi)\??$/.test(semantic)) { speechAct = "clarification"; hint = "Pedido de esclarecimento sobre o ponto anterior; explique-o de forma curta e concreta."; }
  return { normalizedText: value, speechAct, hint, socialOpening };
}

export function withContextualHint(value: string) {
  const interpretation = interpretBrazilianContext(value);
  const hints = [interpretation.hint, interpretation.socialOpening ? "O lead fez uma saudação ou pergunta social direta; retribua naturalmente antes ou junto da continuação, sem prolongar small talk." : null].filter(Boolean);
  return hints.length ? `${value}\n[Contexto conversacional interno: ${hints.join(" ")}]` : value;
}

function hasSocialOpening(value: string) {
  return value.split(/\r?\n/).map(fold).some((line) => /^(?:(?:oi|ola|bom dia|boa tarde|boa noite|e ai)(?:\s+(?:tudo bem|tudo certo))?|tudo bem|tudo certo|como (?:voce|vc) (?:ta|esta)|como (?:ta|esta))(?:\b|$)/.test(line));
}

function stripSocialOpening(value: string) {
  return value.replace(/^(?:(?:oi|ola|bom dia|boa tarde|boa noite|e ai)(?:\s+(?:tudo bem|tudo certo))?\s*)+/, "").trim();
}
