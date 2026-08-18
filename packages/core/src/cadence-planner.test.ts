import { describe, expect, it } from "vitest";
import { nextCadenceAttempt, planDailyCadence } from "./cadence-planner.js";

describe("cadence planner", () => {
  it("prioritizes due cadence before new leads within the daily budget", () => {
    const now = new Date("2026-08-16T08:00:00.000Z");
    const due = Array.from({ length: 20 }, (_, index) => ({ id: `due-${index}`, flowStep: 1, nextAttemptAt: new Date("2026-08-15T08:00:00.000Z"), createdAt: now }));
    const fresh = Array.from({ length: 30 }, (_, index) => ({ id: `new-${index}`, flowStep: 0, nextAttemptAt: now, createdAt: now }));
    const plan = planDailyCadence(due, fresh, 30, now);
    expect(plan.dueFollowups).toBe(20);
    expect(plan.plannedFollowups).toHaveLength(20);
    expect(plan.plannedNewLeads).toHaveLength(10);
    expect(plan.usedBudget).toBe(30);
  });

  it("uses configurable cadence delays", () => {
    const last = new Date("2026-08-16T08:00:00.000Z");
    expect(nextCadenceAttempt(last, 3, [0, 1, 2, 4]).toISOString()).toBe("2026-08-20T08:00:00.000Z");
  });
});
