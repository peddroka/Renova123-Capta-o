export type RequestedDemoSchedule = {
  localTime: string;
  location: string | null;
  brasiliaTime: string | null;
  summary: string;
};

export function isStrongCommercialIntent(text: string) {
  const value = fold(text);
  return /\b(?:quero (?:uma )?(?:demonstracao|demo)|quero ver|pode marcar|pode agendar|tenho interesse|me interessa|como (?:faco|faz) para contratar|quero contratar|quanto custa|qual (?:e )?o preco|qual (?:e )?o valor)\b/.test(value);
}

export function isContextualDemoAcceptance(text: string, previousAgentText: string | null | undefined) {
  const answer = fold(text);
  const previous = fold(previousAgentText ?? "");
  return /^(?:sim|ss|claro|com certeza|sem duvidas|pode|pode ser|vamos|fechado)(?:\s|$)/.test(answer)
    && /(?:quer|gostaria|posso).{0,50}(?:demonstracao|demo)|(?:demonstracao|demo).{0,50}(?:quer|gostaria)/.test(previous);
}

export function extractRequestedDemoSchedule(text: string, previousAgentText: string | null | undefined): RequestedDemoSchedule | null {
  const normalized = fold(text);
  const previous = fold(previousAgentText ?? "");
  const timeMatch = normalized.match(/\b([01]?\d|2[0-3])\s*(?::|h)\s*([0-5]\d)\b/);
  if (!timeMatch || !/(?:horario|hora|quando|agenda|demo|demonstracao|disponibilidade)/.test(previous)) return null;
  const hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  if (hours < 9 || hours > 21) return null;
  const localTime = formatTime(hours, minutes);
  const cityState = text.match(/\b(Campo\s+Grande)\s*(?:[,/-]?\s*(MS))?\b/i);
  const location = cityState ? `${title(cityState[1]!)}${cityState[2] ? `/${cityState[2]!.toUpperCase()}` : ""}` : null;
  const behindMatch = normalized.match(/\b(\d{1,2})\s*h(?:ora)?s?\s+a\s+menos\s+que\s+brasilia\b/);
  const aheadMatch = normalized.match(/\b(\d{1,2})\s*h(?:ora)?s?\s+a\s+mais\s+que\s+brasilia\b/);
  const brasiliaTime = behindMatch
    ? addHours(hours, minutes, Number(behindMatch[1]))
    : aheadMatch ? addHours(hours, minutes, -Number(aheadMatch[1])) : null;
  const localLabel = location ? `${localTime} ${location}` : localTime;
  const summary = [`Horário solicitado: ${localLabel}`, brasiliaTime ? `equivalente Brasília: ${brasiliaTime}` : null, "ainda não confirmado"].filter(Boolean).join("; ");
  return { localTime, location, brasiliaTime, summary };
}

function addHours(hours: number, minutes: number, delta: number) {
  return formatTime((hours + delta + 24) % 24, minutes);
}

function formatTime(hours: number, minutes: number) {
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function title(value: string) {
  return value.toLocaleLowerCase("pt-BR").replace(/(^|\s)\p{L}/gu, (letter) => letter.toLocaleUpperCase("pt-BR"));
}

function fold(value: string) {
  return value.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s:?]/g, " ").replace(/\s+/g, " ").trim();
}
