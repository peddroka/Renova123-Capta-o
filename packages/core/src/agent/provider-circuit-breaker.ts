export type CircuitState = "online" | "offline" | "cooldown";

export class ProviderCircuitBreaker {
  private failures = 0;
  private cooldownUntil = 0;
  private probeInFlight = false;

  constructor(private readonly options: { failureThreshold?: number; cooldownMs?: number; now?: () => number } = {}) {}

  private now() { return this.options.now?.() ?? Date.now(); }
  state(): CircuitState {
    if (this.cooldownUntil > this.now()) return "cooldown";
    return this.failures > 0 ? "offline" : "online";
  }
  canAttempt(): boolean {
    if (this.cooldownUntil <= this.now()) {
      if (this.cooldownUntil > 0 && this.probeInFlight) return false;
      if (this.cooldownUntil > 0) this.probeInFlight = true;
      return true;
    }
    return false;
  }
  recordSuccess() { this.failures = 0; this.cooldownUntil = 0; this.probeInFlight = false; }
  recordFailure(retryAfterSeconds?: number | null, forceCooldown = false) {
    this.failures += 1;
    this.probeInFlight = false;
    if (forceCooldown || this.failures >= (this.options.failureThreshold ?? 3)) this.cooldownUntil = this.now() + Math.max(this.options.cooldownMs ?? 60_000, (retryAfterSeconds ?? 0) * 1000);
  }
  cooldownUntilIso() { return this.cooldownUntil > this.now() ? new Date(this.cooldownUntil).toISOString() : null; }
}
