export const PROACTIVE_HARD_FLOOR_MINUTES = 6;
export const PROACTIVE_JITTER_MIN_MINUTES = 1;
export const PROACTIVE_JITTER_MAX_MINUTES = 10;
export const DEFAULT_PROACTIVE_MIN_INTERVAL_MINUTES = PROACTIVE_HARD_FLOOR_MINUTES + PROACTIVE_JITTER_MIN_MINUTES;
export const DEFAULT_PROACTIVE_MAX_INTERVAL_MINUTES = PROACTIVE_HARD_FLOOR_MINUTES + PROACTIVE_JITTER_MAX_MINUTES;

export type ProactivePacingSettings = {
  minIntervalMinutes?: unknown;
  maxIntervalMinutes?: unknown;
  proactiveHardFloorMinutes?: unknown;
  proactiveJitterMinMinutes?: unknown;
  proactiveJitterMaxMinutes?: unknown;
};

export type ProactivePacingWindow = {
  hardFloorMinutes: number;
  jitterMinMinutes: number;
  jitterMaxMinutes: number;
  minTotalMinutes: number;
  maxTotalMinutes: number;
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

export function proactivePacingWindow(settings: ProactivePacingSettings): ProactivePacingWindow {
  const hardFloorMinutes = finiteInteger(settings.proactiveHardFloorMinutes, PROACTIVE_HARD_FLOOR_MINUTES, 6, 180);
  const jitterMinMinutes = finiteInteger(settings.proactiveJitterMinMinutes, PROACTIVE_JITTER_MIN_MINUTES, 1, 60);
  const jitterMaxMinutes = finiteInteger(settings.proactiveJitterMaxMinutes, PROACTIVE_JITTER_MAX_MINUTES, jitterMinMinutes, 60);
  return {
    hardFloorMinutes,
    jitterMinMinutes,
    jitterMaxMinutes,
    minTotalMinutes: hardFloorMinutes + jitterMinMinutes,
    maxTotalMinutes: hardFloorMinutes + jitterMaxMinutes,
  };
}

/** Compatibility helper for older UI/settings code. */
export function proactiveIntervalMinutes(settings: ProactivePacingSettings) {
  const pacing = proactivePacingWindow(settings);
  return { min: pacing.minTotalMinutes, max: pacing.maxTotalMinutes };
}

export function randomProactiveIntervalMinutes(settings: ProactivePacingSettings, random = Math.random) {
  const pacing = proactivePacingWindow(settings);
  const jitter = pacing.jitterMinMinutes + Math.floor(random() * (pacing.jitterMaxMinutes - pacing.jitterMinMinutes + 1));
  return pacing.hardFloorMinutes + jitter;
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
