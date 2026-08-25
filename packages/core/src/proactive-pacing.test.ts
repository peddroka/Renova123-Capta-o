import { describe, expect, it } from "vitest";
import {
  proactiveBlockReason,
  proactiveIntervalMinutes,
  randomProactiveIntervalMinutes,
  requiresProactivePacing,
} from "./proactive-pacing.js";

type SlotState = { nextProactiveSendAt: number | null };

function reserve(state: SlotState, now: number, random: number) {
  if (state.nextProactiveSendAt !== null && state.nextProactiveSendAt > now)
    return { allowed: false, retryAt: state.nextProactiveSendAt };
  const interval = randomProactiveIntervalMinutes({ minIntervalMinutes: 12, maxIntervalMinutes: 24 }, () => random);
  state.nextProactiveSendAt = now + interval * 60_000;
  return { allowed: true, interval, retryAt: state.nextProactiveSendAt };
}

describe("pacing humano de prospecção", () => {
  it("distribui 50 leads elegíveis sem rajada", () => {
    const state: SlotState = { nextProactiveSendAt: null };
    const first = reserve(state, 0, 0);
    expect(first.allowed).toBe(true);
    expect(first.interval).toBe(12);
    for (let index = 1; index < 50; index += 1) {
      const blocked = reserve(state, 0, index / 50);
      expect(blocked.allowed).toBe(false);
    }
    expect(reserve(state, first.retryAt, 0.9).allowed).toBe(true);
  });

  it("mantém o relógio após restart e varia o jitter entre 12 e 24 minutos", () => {
    const state: SlotState = { nextProactiveSendAt: null };
    const first = reserve(state, 1_000, 0.1);
    const persistedNext = state.nextProactiveSendAt;
    const restartedState = { nextProactiveSendAt: persistedNext };
    expect(reserve(restartedState, 1_000, 0.9).allowed).toBe(false);
    expect(first.interval).toBeGreaterThanOrEqual(12);
    expect(first.interval).toBeLessThanOrEqual(24);
    expect(randomProactiveIntervalMinutes({ minIntervalMinutes: 12, maxIntervalMinutes: 24 }, () => 0)).not.toBe(
      randomProactiveIntervalMinutes({ minIntervalMinutes: 12, maxIntervalMinutes: 24 }, () => 0.99),
    );
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

  it("bloqueia com razão explícita após disconnect e não antecipa no reconnect", () => {
    const disconnected = proactiveBlockReason({
      workerHealthy: true,
      whatsappOpen: false,
      globalPause: true,
      automationEnabled: false,
      outreachEnabled: false,
      withinWindow: true,
      dailyUsage: 1,
      dailyLimit: 50,
      eligibleLeads: 50,
    });
    expect(disconnected).toBe("WHATSAPP_OFFLINE");
    expect(proactiveIntervalMinutes({})).toEqual({ min: 12, max: 24 });
  });
});
