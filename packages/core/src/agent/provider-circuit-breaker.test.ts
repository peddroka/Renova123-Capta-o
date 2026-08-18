import { describe, expect, it } from "vitest";
import { ProviderCircuitBreaker } from "./provider-circuit-breaker.js";

describe("provider circuit breaker", () => {
  it("opens after repeated failures and permits a controlled probe after cooldown", () => {
    let now = 0;
    const circuit = new ProviderCircuitBreaker({ failureThreshold: 2, cooldownMs: 1000, now: () => now });
    circuit.recordFailure(); circuit.recordFailure();
    expect(circuit.state()).toBe("cooldown"); expect(circuit.canAttempt()).toBe(false);
    now = 1001; expect(circuit.canAttempt()).toBe(true); circuit.recordSuccess(); expect(circuit.state()).toBe("online");
  });
});
