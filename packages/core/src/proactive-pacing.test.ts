import { describe, expect, it } from "vitest";
import {
  proactiveBlockReason,
  proactiveIntervalMinutes,
  proactivePacingWindow,
  randomProactiveIntervalMinutes,
  requiresProactivePacing,
} from "./proactive-pacing.js";

type SlotState = { nextProactiveSendAt: number | null };
const SAFE = { proactiveHardFloorMinutes: 6, proactiveJitterMinMinutes: 1, proactiveJitterMaxMinutes: 10 };

function reserve(state: SlotState, now: number, random: number) {
  if (state.nextProactiveSendAt !== null && state.nextProactiveSendAt > now)
    return { allowed: false, retryAt: state.nextProactiveSendAt };
  const interval = randomProactiveIntervalMinutes(SAFE, () => random);
  state.nextProactiveSendAt = now + interval * 60_000;
  return { allowed: true, interval, retryAt: state.nextProactiveSendAt };
}

describe("pacing seguro de prospecção", () => {
  it("impõe seis minutos de piso e só depois adiciona jitter de 1-10 minutos", () => {
    const window = proactivePacingWindow(SAFE);
    expect(window).toEqual({
      hardFloorMinutes: 6,
      jitterMinMinutes: 1,
      jitterMaxMinutes: 10,
      minTotalMinutes: 7,
      maxTotalMinutes: 16,
    });
    expect(randomProactiveIntervalMinutes(SAFE, () => 0)).toBe(7);
    expect(randomProactiveIntervalMinutes(SAFE, () => 0.999)).toBe(16);
  });

  it("distribui 50 leads elegíveis sem rajada", () => {
    const state: SlotState = { nextProactiveSendAt: null };
    const first = reserve(state, 0, 0);
    expect(first.allowed).toBe(true);
    expect(first.interval).toBe(7);
    for (let index = 1; index < 50; index += 1) {
      expect(reserve(state, 0, index / 50).allowed).toBe(false);
    }
    expect(reserve(state, first.retryAt, 0.9).allowed).toBe(true);
  });

  it("mantém o relógio após restart e nunca permite intervalo menor que 7 minutos", () => {
    const state: SlotState = { nextProactiveSendAt: null };
    const first = reserve(state, 1_000, 0.1);
    const restartedState = { nextProactiveSendAt: state.nextProactiveSendAt };
    expect(reserve(restartedState, 1_000, 0.9).allowed).toBe(false);
    expect(first.interval).toBeGreaterThanOrEqual(7);
    expect(first.interval).toBeLessThanOrEqual(16);
  });

  it("permite somente um reservation entre dois workers concorrentes", () => {
    const state: SlotState = { nextProactiveSendAt: null };
    const results = [reserve(state, 0, 0), reserve(state, 0, 0.5)];
    expect(results.filter((result) => result.allowed)).toHaveLength(1);
  });

  it("não aplica pacing a respostas inbound", () => {
    expect(requiresProactivePacing("inbound_reply")).toBe(false);
    expect(requiresProactivePacing("ai_send")).toBe(false);
    expect(requiresProactivePacing("outreach")).toBe(true);
    expect(requiresProactivePacing("follow_up")).toBe(true);
  });

  it("bloqueia com razão explícita após disconnect e mantém defaults 7-16", () => {
    expect(proactiveBlockReason({
      workerHealthy: true,
      whatsappOpen: false,
      globalPause: true,
      automationEnabled: false,
      outreachEnabled: false,
      withinWindow: true,
      dailyUsage: 1,
      dailyLimit: 50,
      eligibleLeads: 50,
    })).toBe("WHATSAPP_OFFLINE");
    expect(proactiveIntervalMinutes({})).toEqual({ min: 7, max: 16 });
  });
});
