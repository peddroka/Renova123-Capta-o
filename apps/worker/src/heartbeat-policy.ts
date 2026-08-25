export class WorkerLeaseLostError extends Error {
  constructor(message = "Lock do worker expirou ou foi transferido.") {
    super(message);
    this.name = "WorkerLeaseLostError";
  }
}

export const heartbeatRetryDelaysMs = [250, 750, 1_500] as const;

export function heartbeatLeaseTtlMs(heartbeatIntervalMs: number) {
  return Math.max(10_000, heartbeatIntervalMs * 3);
}

export function isTransientHeartbeatError(error: unknown) {
  if (error instanceof WorkerLeaseLostError) return false;
  const candidate = error as { code?: unknown; message?: unknown; cause?: unknown } | null;
  const code = String(
    candidate?.code ?? (candidate?.cause as { code?: unknown } | undefined)?.code ?? "",
  ).toUpperCase();
  const message = String(candidate?.message ?? error ?? "").toLowerCase();
  return (
    [
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "EAI_AGAIN",
      "UND_ERR_SOCKET",
      "UND_ERR_CONNECT_TIMEOUT",
    ].includes(code) ||
    /fetch failed|socket|network|connection reset|timed out|timeout|econnreset|econnrefused/.test(message)
  );
}

export function shouldStopAfterHeartbeatFailure(input: {
  error: unknown;
  lastSuccessAtMs: number;
  nowMs: number;
  heartbeatIntervalMs: number;
}) {
  if (input.error instanceof WorkerLeaseLostError) return true;
  if (!isTransientHeartbeatError(input.error)) return true;
  return input.nowMs - input.lastSuccessAtMs >= heartbeatLeaseTtlMs(input.heartbeatIntervalMs);
}
