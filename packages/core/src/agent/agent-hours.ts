import type { AgentSlug } from "./agent-config.js";

export type AgentHoursConfig = {
  slug: AgentSlug;
  timezone: string;
  outreachStart: string;
  outreachEnd: string;
};

export type ActiveConversation = {
  inboundValid?: boolean;
  previouslyAddressed?: boolean;
  humanActive?: boolean;
  automationPaused?: boolean;
  blocked?: boolean;
};

export const FRANCISCO_HOURS: AgentHoursConfig = {
  slug: "francisco", timezone: "America/Sao_Paulo", outreachStart: "08:00", outreachEnd: "23:00",
};

export const PEDRO_HOURS: AgentHoursConfig = {
  slug: "pedro", timezone: "America/Sao_Paulo", outreachStart: "08:00", outreachEnd: "17:00",
};

/** Janela exclusiva para outbound iniciado pelo sistema. Nunca use para inbound. */
export function isProactiveWindow(agent: AgentHoursConfig, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: agent.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const current = hour * 60 + minute;
  return current >= toMinutes(agent.outreachStart) && current < toMinutes(agent.outreachEnd);
}

/** Respostas a inbound são 24/7; Pedro apenas exige que a conversa seja dele. */
export function canProcessInboundReply(agent: AgentHoursConfig, conversation: ActiveConversation) {
  if (conversation.inboundValid === false || conversation.humanActive || conversation.automationPaused || conversation.blocked) return false;
  return agent.slug === "pedro" ? conversation.previouslyAddressed === true : true;
}

export function canSendConversationReply(agent: AgentHoursConfig, conversation: ActiveConversation) {
  return canProcessInboundReply(agent, conversation);
}

export function canSendProactive(agent: AgentHoursConfig, now = new Date()) {
  return isProactiveWindow(agent, now);
}

/** Um inbound válido torna follow-up de silêncio obsoleto imediatamente, sem esperar a janela abrir. */
export function shouldInvalidateFollowUpsOnInbound(conversation: ActiveConversation) {
  return conversation.inboundValid !== false;
}

function toMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}
