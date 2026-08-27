import { isExplicitNoInterestText, isOptOutText } from "../phone.js";
import { asksAgentIdentity, deriveConversationState } from "./conversation-state.js";
import { isStrongCommercialIntent } from "./strong-commercial-intent.js";
import type { AgentSnapshot } from "./types.js";

export type FranciscoDiscoveryPhase =
  | "simulator"
  | "vision_test"
  | "digital_measurement"
  | "thickness_simulator"
  | "barrier"
  | "adapt"
  | "identity"
  | "demo"
  | "disinterest"
  | "opt_out";

export type FranciscoDiscoveryStrategy = {
  phase: FranciscoDiscoveryPhase;
  objective: string;
  preferredQuestions: string[];
  avoid: string[];
};

const QUESTIONS = {
  simulator: "Vocês têm um simulador de lentes aí na ótica?",
  vision_test: "E teste de visão, vocês têm?",
  digital_measurement: "E algum medidor digital pra ajudar nas medições, vocês usam?",
  thickness_simulator: "Vocês têm algum simulador pra mostrar pro cliente como fica a grossura da lente?",
} as const;

type ResourceTopic = keyof typeof QUESTIONS;
const ORDER: ResourceTopic[] = ["simulator", "vision_test", "digital_measurement", "thickness_simulator"];

export function franciscoDiscoveryStrategy(
  snapshot: AgentSnapshot,
  currentLeadTurn: string,
): FranciscoDiscoveryStrategy {
  const state = deriveConversationState(snapshot, currentLeadTurn);
  const current = fold(currentLeadTurn);

  if (isOptOutText(currentLeadTurn)) return simple("opt_out", "encerrar e respeitar o opt-out");
  if (isExplicitNoInterestText(currentLeadTurn) && !/^(?:não|nao|tchau)$/i.test(current.trim())) return simple("disinterest", "encerrar sem insistir");
  if (asksAgentIdentity(currentLeadTurn)) {
    return {
      phase: "identity",
      objective: "responder com transparência quem é, de onde fala e o motivo real do contato, de forma curta",
      preferredQuestions: [],
      avoid: ["não se passar por cliente", "não devolver a pergunta", "não inventar cargo ou detalhe da ótica"],
    };
  }
  if (isStrongCommercialIntent(currentLeadTurn) || state.demoInterest) {
    return {
      phase: "demo",
      objective: "reconhecer o interesse e conduzir para demonstração ou ligação, sem voltar à entrevista",
      preferredQuestions: ["Quer que eu te mostre como isso funciona na prática?"],
      avoid: ["não citar preço espontaneamente", "não despejar funcionalidades", "não reiniciar a descoberta"],
    };
  }

  const asked = askedResources(snapshot);
  const previousTopic = resourceQuestion(lastAgentMessage(snapshot));
  const signal = resourceSignal(current);
  const nextTopic = ORDER.find((topic) => !asked.has(topic));

  // Depois de uma resposta sobre um recurso, reconheça o que a pessoa disse e
  // avance para o próximo item ainda não perguntado. Tanto "sim" quanto "não"
  // são informação útil; nunca repita a mesma pergunta.
  if (previousTopic && (signal || current.trim())) {
    if (nextTopic) return resource(nextTopic, signal === "positive" ? "reconhecer que já possui o recurso e avançar" : "avançar a descoberta sem presumir dor");
    return barrier(signal);
  }

  if (state.leadRoleKnown || roleConfirmationTurn(snapshot, current)) {
    return resource(nextTopic ?? "simulator", "mapear rapidamente a tecnologia disponível na ótica sem apresentação precoce");
  }

  if (nextTopic && asked.size > 0) return resource(nextTopic, "continuar a descoberta sem repetir perguntas");

  return {
    phase: "simulator",
    objective: "depois de confirmar que fala com o dono da ótica, começar a descoberta com uma pergunta curta",
    preferredQuestions: [QUESTIONS.simulator],
    avoid: [
      "não se apresentar antes da hora",
      "não fingir ser cliente",
      "não fazer pitch antes de descobrir contexto",
      "não afirmar que o Renova123 possui simulador de lentes sem capacidade confirmada no catálogo",
    ],
  };
}

function resource(topic: ResourceTopic, objective: string): FranciscoDiscoveryStrategy {
  const labels: Record<ResourceTopic, string> = {
    simulator: "simulador de lentes",
    vision_test: "teste de visão",
    digital_measurement: "medição digital",
    thickness_simulator: "simulação da grossura da lente",
  };
  return {
    phase: topic,
    objective: `${objective}: descobrir ${labels[topic]}`,
    preferredQuestions: [QUESTIONS[topic]],
    avoid: [
      "não repetir perguntas já respondidas",
      "não transformar uma pergunta de descoberta em afirmação sobre funcionalidades do Renova123",
      "não apresentar a Renova123 antes de haver motivo, pergunta de identidade ou ponte comercial natural",
    ],
  };
}

function barrier(signal: "positive" | "negative" | null): FranciscoDiscoveryStrategy {
  return {
    phase: "barrier",
    objective: signal === "positive"
      ? "entender o que ainda poderia melhorar mesmo com tecnologia já presente, sem desmerecer o que a ótica usa"
      : "descobrir por que a ótica ainda não adotou esses recursos, sem presumir a resposta",
    preferredQuestions: signal === "positive"
      ? ["Boa. E hoje tem alguma parte dessa experiência que vocês ainda queriam melhorar?"]
      : ["Mas o que falta hoje pra vocês terem esse tipo de tecnologia aí?", "É mais questão de custo, sistema, tempo...?"],
    avoid: ["não pressionar", "não afirmar ROI ou resultado sem evidência", "não inventar dor"],
  };
}

function askedResources(snapshot: AgentSnapshot) {
  const set = new Set<ResourceTopic>();
  for (const message of snapshot.messages) {
    if (message.role !== "agent" && message.role !== "human") continue;
    const topic = resourceQuestion(message.text);
    if (topic) set.add(topic);
  }
  return set;
}

function lastAgentMessage(snapshot: AgentSnapshot) {
  return [...snapshot.messages].reverse().find((message) => message.role === "agent" || message.role === "human")?.text ?? "";
}

function simple(phase: "disinterest" | "opt_out", objective: string): FranciscoDiscoveryStrategy {
  return { phase, objective, preferredQuestions: [], avoid: ["não continuar a sequência de descoberta"] };
}

function roleConfirmationTurn(snapshot: AgentSnapshot, current: string) {
  const previousAgent = lastAgentMessage(snapshot);
  return (
    /(?:dono|propriet[aá]rio).*(?:[?]|ótica|otica)/i.test(previousAgent) &&
    /^(?:sim|sou eu|sou eu mesmo|eu|como posso ajudar|pode falar|fala|manda)/.test(current)
  );
}

function resourceQuestion(value: string): ResourceTopic | null {
  const normalized = fold(value);
  if (/simulador/.test(normalized) && /grossura|espessura/.test(normalized)) return "thickness_simulator";
  if (/medidor|medicao digital|medir/.test(normalized)) return "digital_measurement";
  if (/teste de visao|test(e|ar) a visao/.test(normalized)) return "vision_test";
  if (/simulador/.test(normalized) && /lente/.test(normalized)) return "simulator";
  return null;
}

function resourceSignal(value: string): "positive" | "negative" | null {
  if (/^(?:nao|nunca|ainda nao)\b/.test(value) || /(?:^| )(?:nao|nunca|ainda nao|tambem nao)(?:\s+(?:tem|temos|possuo|possui|uso|usamos))?\b/.test(value)) return "negative";
  if (/^(?:sim|ss|temos|tenho|tem|possuo|possui|uso|usamos|ja temos|ja uso)\b/.test(value)) return "positive";
  return null;
}

function fold(value: string) {
  return value.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9?\s]/g, " ").replace(/\s+/g, " ").trim();
}
