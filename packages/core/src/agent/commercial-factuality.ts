import type { AiDecision } from "@renova123/shared";

export function enforceCommercialFactuality(decision: AiDecision, commercial: Record<string, unknown>): AiDecision {
  const reply = decision.replyText;
  if (!reply) return decision;
  const officialText = JSON.stringify(commercial);
  const percentages = [...reply.matchAll(/\b\d+(?:[.,]\d+)?\s*%/g)].map((match) => match[0]!.replace(/\s/g, ""));
  const unsupportedPercentage = percentages.some((value) => !new RegExp(value.replace("%", "\\s*%"), "i").test(officialText));
  const duration = reply.match(/\b(\d+)\s*minutos?\b/i);
  const configuredDuration = typeof commercial.demoDuration === "string" ? commercial.demoDuration : typeof commercial.duration === "string" ? commercial.duration : "";
  const unsupportedDuration = Boolean(duration && (!configuredDuration || !configuredDuration.includes(duration[1]!)));
  if (!unsupportedPercentage && !unsupportedDuration) return decision;
  let grounded = reply;
  if (unsupportedPercentage) grounded = grounded.replace(/\b(?:em até\s*)?\d+(?:[.,]\d+)?\s*%/gi, "").replace(/\s{2,}/g, " ").trim();
  if (unsupportedDuration) grounded = grounded.replace(/\s*de?\s*\d+\s*minutos?/gi, "").replace(/\s{2,}/g, " ").trim();
  return { ...decision, replyText: grounded };
}
