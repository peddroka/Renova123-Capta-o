import { describe, expect, it } from "vitest";
import {
  WorkerLeaseLostError,
  heartbeatLeaseTtlMs,
  isTransientHeartbeatError,
  shouldStopAfterHeartbeatFailure,
} from "./heartbeat-policy.js";

describe("worker heartbeat policy", () => {
  it("não derruba o worker por um ECONNRESET transitório antes do TTL", () => {
    const error = Object.assign(new Error("fetch failed"), { cause: { code: "ECONNRESET" } });
    expect(isTransientHeartbeatError(error)).toBe(true);
    expect(
      shouldStopAfterHeartbeatFailure({
        error,
        lastSuccessAtMs: 100_000,
        nowMs: 110_000,
        heartbeatIntervalMs: 10_000,
      }),
    ).toBe(false);
  });

  it("falha fechado quando a comunicação não volta antes do TTL", () => {
    const error = Object.assign(new Error("fetch failed"), { cause: { code: "ECONNRESET" } });
    expect(heartbeatLeaseTtlMs(10_000)).toBe(30_000);
    expect(
      shouldStopAfterHeartbeatFailure({
        error,
        lastSuccessAtMs: 100_000,
        nowMs: 130_001,
        heartbeatIntervalMs: 10_000,
      }),
    ).toBe(true);
  });

  it("encerra imediatamente quando o servidor confirma perda do lock", () => {
    expect(
      shouldStopAfterHeartbeatFailure({
        error: new WorkerLeaseLostError(),
        lastSuccessAtMs: 100_000,
        nowMs: 100_001,
        heartbeatIntervalMs: 10_000,
      }),
    ).toBe(true);
  });
});
