import { isExplicitNoInterestText, isOptOutText } from "../phone.js";
import { asksAgentIdentity, deriveConversationState } from "./conversation-state.js";
import { isStrongCommercialIntent } from "./strong-commercial-intent.js";
import type { AgentSnapshot } from "./types.js";

export type FranciscoDiscoveryPhase =
  | "simulator"
  | "vision_test"
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

const SIMULATOR_QUESTION = "Você tem simulador de lentes aí na ótica?";
const VISION_TEST_QUESTION = "E teste de visão?";
const THICKNESS_QUESTION =
  "Vocês têm pelo menos algum simulador pra mostrar pro cliente como fica a grossura da lente?";

export function franciscoDiscoveryStrategy(
  snapshot: AgentSnapshot,
  currentLeadTurn: string,
): FranciscoDiscoveryStrategy {
  const state = deriveConversationState(snapshot, currentLeadTurn);
  const current = fold(currentLeadTurn);
  const previousAgent =
    [...snapshot.messages].reverse().find((message) => message.role === "agent" || message.role === "human")
      ?.text ?? "";
  const previousQuestion = extractLastQuestion(previousAgent);
  const transcript = fold(
    [
      ...snapshot.messages.filter((message) => message.role === "lead"),
      { role: "lead" as const, text: currentLeadTurn },
    ]
      .map((message) => message.text)
      .join(" "),
  );

  if (isOptOutText(currentLeadTurn)) return simple("opt_out", "encerrar e respeitar o opt-out");
  if (isExplicitNoInterestText(currentLeadTurn)) return simple("disinterest", "encerrar sem insistir");
  if (asksAgentIdentity(currentLeadTurn)) {
    return {
      phase: "identity",
      objective: "responder quem é, de onde fala e o motivo do contato em poucas palavras",
      preferredQuestions: [],
      avoid: ["não devolver a pergunta", "não inventar cargo, vínculo ou detalhe da ótica"],
    };
  }
  if (isStrongCommercialIntent(currentLeadTurn) || state.demoInterest) {
    return {
      phase: "demo",
      objective: "reconhecer o interesse e conduzir para demonstração ou ligação, sem nova entrevista",
      preferredQuestions: ["Quer que eu te mostre como isso funciona na prática?"],
      avoid: [
        "não citar preço espontaneamente",
        "não despejar funcionalidades",
        "não forçar perguntas de descoberta",
      ],
    };
  }

  const previousTopic = resourceQuestion(previousQuestion);
  const currentResource = resourceSignal(current);
  if (previousTopic === "simulator") {
    if (currentResource === "negative")
      return question("vision_test", "descobrir se a ótica tem teste de visão", VISION_TEST_QUESTION);
    if (currentResource === "positive" || mentionsResource(current)) return adapt("simulador de lentes");
    if (current.trim()) return adapt("resposta do lead sobre o simulador");
  }
  if (previousTopic === "vision_test") {
    if (currentResource === "negative")
      return question(
        "thickness_simulator",
        "descobrir se existe uma alternativa visual para a grossura da lente",
        THICKNESS_QUESTION,
      );
    if (currentResource === "positive" || mentionsResource(current)) return adapt("teste de visão");
    if (current.trim()) return adapt("resposta do lead sobre teste de visão");
  }
  if (previousTopic === "thickness_simulator") {
    if (currentResource === "negative")
      return {
        phase: "barrier",
        objective: "descobrir a barreira real sem presumir uma dor",
        preferredQuestions: [
          "Por que vocês ainda não colocaram isso aí?",
          "O que falta hoje pra vocês terem isso?",
          "É mais questão de custo, sistema, tempo...?",
        ],
        avoid: ["não fazer pitch ainda", "não afirmar que a ótica precisa da solução"],
      };
    if (currentResource === "positive" || mentionsResource(current))
      return adapt("simulador para mostrar a grossura da lente");
    if (current.trim()) return adapt("resposta do lead sobre a grossura da lente");
  }

  if (state.leadRoleKnown || roleConfirmationTurn(snapshot, current)) {
    return question(
      "simulator",
      "começar a descoberta sobre recursos da ótica sem apresentação precoce",
      SIMULATOR_QUESTION,
    );
  }
  if (mentionsResource(transcript)) return adapt("recurso mencionado espontaneamente pelo lead");
  return {
    phase: "simulator",
    objective:
      "confirmar o recurso com uma pergunta curta quando a abertura já confirmou a ótica ou o responsável",
    preferredQuestions: [SIMULATOR_QUESTION],
    avoid: ["não se apresentar novamente", "não fazer pitch antes de descobrir contexto"],
  };
}

function question(
  phase: FranciscoDiscoveryPhase,
  objective: string,
  preferredQuestion: string,
): FranciscoDiscoveryStrategy {
  return {
    phase,
    objective,
    preferredQuestions: [preferredQuestion],
    avoid: [
      "não repetir perguntas já respondidas",
      "não apresentar a Renova123 antes de haver motivo ou pergunta de identidade",
    ],
  };
}

function adapt(resource: string): FranciscoDiscoveryStrategy {
  return {
    phase: "adapt",
    objective: `acolher o que o lead informou sobre ${resource}, usar esse contexto e escolher a próxima pergunta sem repetir`,
    preferredQuestions: [],
    avoid: [
      "não perguntar novamente se já tem o recurso",
      "não fingir que não ouviu",
      "não presumir uma dificuldade",
    ],
  };
}

function simple(phase: "disinterest" | "opt_out", objective: string): FranciscoDiscoveryStrategy {
  return { phase, objective, preferredQuestions: [], avoid: ["não continuar a sequência de descoberta"] };
}

function roleConfirmationTurn(snapshot: AgentSnapshot, current: string) {
  const previousAgent =
    [...snapshot.messages].reverse().find((message) => message.role === "agent" || message.role === "human")
      ?.text ?? "";
  return (
    /(?:dono|respons[aá]vel|quem cuida|gest[aã]o|opera[cç][aã]o).*(?:[?]|ótica|otica)/i.test(previousAgent) &&
    /^(?:sim|sou eu|sou eu mesmo|eu cuido|eu que cuido|como posso ajudar|pode falar|fala|manda)/.test(current)
  );
}

function resourceQuestion(value: string): "simulator" | "vision_test" | "thickness_simulator" | null {
  const normalized = fold(value);
  if (/simulador/.test(normalized) && /grossura|espessura/.test(normalized)) return "thickness_simulator";
  if (/teste de visao|test(e|ar) a visao/.test(normalized)) return "vision_test";
  if (/simulador/.test(normalized)) return "simulator";
  return null;
}

function resourceSignal(value: string): "positive" | "negative" | null {
  if (
    /^(?:nao|nunca|ainda nao)\b/.test(value) ||
    /(?:^| )(?:nao|nunca|ainda nao|tambem nao)(?:\s+(?:tem|temos|possuo|possui|uso|usamos))?\b/.test(value)
  )
    return "negative";
  if (/^(?:sim|ss|temos|tenho|tem|possuo|possui|uso|usamos|ja temos|ja uso)\b/.test(value)) return "positive";
  return null;
}

function mentionsResource(value: string) {
  return /simulador|teste de visao|teste da visao|grossura|espessura da lente/.test(value);
}

function extractLastQuestion(value: string) {
  return (
    value
      .match(/[^?]*\?/g)
      ?.at(-1)
      ?.trim() ?? ""
  );
}

function fold(value: string) {
  return value
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9?\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
