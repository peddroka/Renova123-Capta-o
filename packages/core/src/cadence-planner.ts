export const DEFAULT_CADENCE_DELAYS_DAYS = [0, 1, 2, 4, 8, 16] as const;

export type CadenceCandidate = {
  id: string;
  flowStep: number;
  nextAttemptAt: Date | null;
  createdAt: Date;
};

export function planDailyCadence(
  candidates: CadenceCandidate[],
  newLeads: CadenceCandidate[],
  dailyBudget = 50,
  now = new Date(),
) {
  const due = candidates
    .filter((item) => item.nextAttemptAt && item.nextAttemptAt.getTime() <= now.getTime())
    .sort((a, b) => (a.nextAttemptAt!.getTime() - b.nextAttemptAt!.getTime()) || a.createdAt.getTime() - b.createdAt.getTime());
  const selectedDue = due.slice(0, Math.max(0, dailyBudget));
  const remainingBudget = Math.max(0, dailyBudget - selectedDue.length);
  const selectedNew = newLeads
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .slice(0, remainingBudget);
  return {
    dueFollowups: due.length,
    plannedFollowups: selectedDue,
    newLeadSlots: remainingBudget,
    plannedNewLeads: selectedNew,
    dailyBudget,
    usedBudget: selectedDue.length + selectedNew.length,
    remainingBudget: dailyBudget - selectedDue.length - selectedNew.length,
  };
}

export function nextCadenceAttempt(lastAttemptAt: Date, flowStep: number, delaysDays: readonly number[] = DEFAULT_CADENCE_DELAYS_DAYS) {
  const delayDays = delaysDays[Math.min(Math.max(flowStep, 0), delaysDays.length - 1)] ?? 0;
  return new Date(lastAttemptAt.getTime() + delayDays * 86_400_000);
}
