export const DEFAULT_PROACTIVE_MIN_INTERVAL_MINUTES = 12;
export const DEFAULT_PROACTIVE_MAX_INTERVAL_MINUTES = 24;

export type ProactivePacingSettings = {
  minIntervalMinutes?: unknown;
  maxIntervalMinutes?: unknown;
};

export type ProactiveBlockReason =
  | "WAITING_FOR_PACING"
  | "DAILY_QUOTA_REACHED"
  | "OUTSIDE_WINDOW"
  | "WHATSAPP_OFFLINE"
  | "NO_ELIGIBLE_LEADS"
  | "ACTIVE"
  | "GLOBAL_PAUSE"
  | "AUTOMATION_DISABLED"
  | "OUTREACH_DISABLED"
  | "WORKER_OFFLINE";

export function proactiveIntervalMinutes(settings: ProactivePacingSettings) {
  const min = finiteInteger(settings.minIntervalMinutes, DEFAULT_PROACTIVE_MIN_INTERVAL_MINUTES, 1, 180);
  const max = finiteInteger(settings.maxIntervalMinutes, DEFAULT_PROACTIVE_MAX_INTERVAL_MINUTES, min, 180);
  return { min, max };
}

export function randomProactiveIntervalMinutes(
  settings: ProactivePacingSettings,
  random = Math.random,
) {
  const { min, max } = proactiveIntervalMinutes(settings);
  return min + Math.floor(random() * (max - min + 1));
}

export function requiresProactivePacing(jobType: string) {
  return jobType === "outreach" || jobType === "follow_up";
}

export function proactiveBlockReason(input: {
  workerHealthy: boolean;
  whatsappOpen: boolean;
  globalPause: boolean;
  automationEnabled: boolean;
  outreachEnabled: boolean;
  withinWindow: boolean;
  dailyUsage: number;
  dailyLimit: number;
  nextProactiveSendAt?: string | null;
  now?: Date;
  eligibleLeads: number;
}): ProactiveBlockReason {
  if (!input.workerHealthy) return "WORKER_OFFLINE";
  if (!input.whatsappOpen) return "WHATSAPP_OFFLINE";
  if (input.globalPause) return "GLOBAL_PAUSE";
  if (!input.automationEnabled) return "AUTOMATION_DISABLED";
  if (!input.outreachEnabled) return "OUTREACH_DISABLED";
  if (input.dailyUsage >= input.dailyLimit) return "DAILY_QUOTA_REACHED";
  if (!input.withinWindow) return "OUTSIDE_WINDOW";
  const now = (input.now ?? new Date()).getTime();
  if (input.nextProactiveSendAt && Date.parse(input.nextProactiveSendAt) > now) return "WAITING_FOR_PACING";
  if (input.eligibleLeads <= 0) return "NO_ELIGIBLE_LEADS";
  return "ACTIVE";
}

function finiteInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}
