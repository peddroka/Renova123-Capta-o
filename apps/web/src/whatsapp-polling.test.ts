import { describe, expect, it, vi } from "vitest";
import {
  DIAGNOSTICS_POLL_INTERVAL_MS,
  PAIRING_POLL_INTERVAL_MS,
  createWhatsAppPoller,
  shouldPollWhatsApp,
} from "./whatsapp-polling.js";

describe("WhatsApp polling", () => {
  it("uses bounded intervals and stops when connected or hidden", () => {
    expect(PAIRING_POLL_INTERVAL_MS).toBe(4_000);
    expect(DIAGNOSTICS_POLL_INTERVAL_MS).toBe(15_000);
    expect(shouldPollWhatsApp("close", true)).toBe(true);
    expect(shouldPollWhatsApp("connecting", true)).toBe(true);
    expect(shouldPollWhatsApp("open", true)).toBe(false);
    expect(shouldPollWhatsApp("close", false)).toBe(false);
  });

  it("has one chain, cleans up its timer, and does not poll after open", async () => {
    let nextTimer = 1;
    const timers = new Map<number, () => void>();
    const setTimer = vi.fn((callback: () => void, _delay: number) => { const id = nextTimer++; timers.set(id, callback); return id; });
    const clearTimer = vi.fn((id: number) => timers.delete(id));
    let state: "close" | "open" = "close";
    const readPairing = vi.fn(async () => ({ state }));
    const readDiagnostics = vi.fn(async () => undefined);
    const poller = createWhatsAppPoller({ readPairing, readDiagnostics, onPairing: () => undefined, onDiagnostics: () => undefined, setTimer, clearTimer, isVisible: () => true });
    poller.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(readPairing).toHaveBeenCalledTimes(1);
    expect(setTimer).toHaveBeenCalledTimes(1);
    expect(setTimer.mock.calls[0]?.[1]).toBe(PAIRING_POLL_INTERVAL_MS);
    const timer = [...timers.keys()][0]!;
    poller.stop();
    expect(clearTimer).toHaveBeenCalledWith(timer);
    state = "open";
    poller.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(readPairing).toHaveBeenCalledTimes(2);
    expect(setTimer).toHaveBeenCalledTimes(1);
    poller.stop();
  });
});
