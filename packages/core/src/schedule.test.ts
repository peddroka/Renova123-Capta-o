import { describe, expect, it } from "vitest";
import { canStartOutreach } from "./schedule.js";

const settings = {
  dailyLimit: 50, hourlyLimit: 8, weekdays: [0, 1, 2, 3, 4, 5, 6],
  startTime: "08:00", endTime: "23:00", minIntervalSeconds: 5, maxIntervalSeconds: 5,
  timezone: "America/Sao_Paulo", maxConsecutiveFailures: 5, autoPause: true,
  followUpsEnabled: true, maxFollowUps: 3, followUpIntervalHours: 48, batchPriority: "priority" as const,
  dailyProactiveLimit: 50, cadenceDelaysDays: [0, 1, 2, 4, 8, 16] as [number, number, number, number, number, number],
};

describe("janela operacional do Francisco", () => {
  it("permite 08:00 e bloqueia 23:00 na virada local", () => {
    expect(canStartOutreach(new Date("2026-08-18T11:00:00.000Z"), settings)).toBe(true);
    expect(canStartOutreach(new Date("2026-08-19T02:00:00.000Z"), settings)).toBe(false);
  });
  it("respeita America/Sao_Paulo em vez do fuso do servidor", () => {
    expect(canStartOutreach(new Date("2026-08-18T10:59:59.000Z"), settings)).toBe(false);
    expect(canStartOutreach(new Date("2026-08-18T11:00:00.000Z"), settings)).toBe(true);
  });
});
