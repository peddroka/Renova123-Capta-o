export type ScheduledResumeState = {
  globalPause: boolean;
  scheduledResumeAt?: string | null;
  scheduledResumeAppliedAt?: string | null;
};

export type ScheduledResumeDecision =
  | { action: "wait"; reason: "not-scheduled" | "not-due" | "outside-window" | "preflight-failed" | "already-applied" }
  | { action: "activate"; appliedAt: string; reason?: never };

export function evaluateScheduledResume(
  state: ScheduledResumeState,
  now: Date,
  windowOpen: boolean,
  preflightOk: boolean,
): ScheduledResumeDecision {
  if (state.scheduledResumeAppliedAt) return { action: "wait", reason: "already-applied" };
  if (!state.scheduledResumeAt) return { action: "wait", reason: "not-scheduled" };
  const scheduledAt = Date.parse(state.scheduledResumeAt);
  if (!Number.isFinite(scheduledAt) || now.getTime() < scheduledAt) return { action: "wait", reason: "not-due" };
  if (!windowOpen) return { action: "wait", reason: "outside-window" };
  if (!preflightOk) return { action: "wait", reason: "preflight-failed" };
  return { action: "activate", appliedAt: now.toISOString() };
}
