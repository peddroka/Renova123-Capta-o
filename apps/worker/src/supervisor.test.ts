import { describe, expect, it } from "vitest";
import { canStartWorker, heartbeatAgeMs, shouldRecoverWorker, supervisorTiming, workerPidFromInstanceId, type WorkerHeartbeat } from "./supervisor.js";

const heartbeat = (overrides: Partial<WorkerHeartbeat> = {}): WorkerHeartbeat => ({ instance_id: "JORDAN:37268:instance", status: "running", last_heartbeat_at: "2026-08-10T04:00:00.000Z", lock_expires_at: "2026-08-10T04:00:30.000Z", ...overrides });

describe("worker supervisor", () => {
  it("deriva o PID do instance_id sem confiar apenas na existência do processo", () => expect(workerPidFromInstanceId("JORDAN:37268:abc")).toBe(37268));
  it("considera stale após quatro heartbeats e respeita o lock antes de iniciar", () => {
    const now = Date.parse("2026-08-10T04:00:40.001Z");
    expect(heartbeatAgeMs(heartbeat(), now)).toBeGreaterThan(supervisorTiming.staleAfterMs);
    expect(shouldRecoverWorker(heartbeat(), now)).toBe(true);
    expect(canStartWorker(heartbeat(), now)).toBe(true);
  });
  it("não reinicia worker saudável nem antes do TTL expirar", () => {
    const now = Date.parse("2026-08-10T04:00:10.000Z");
    expect(shouldRecoverWorker(heartbeat(), now)).toBe(false);
    expect(canStartWorker(heartbeat(), now)).toBe(false);
  });
  it("trata ausência de heartbeat como recuperação necessária", () => {
    expect(shouldRecoverWorker(null)).toBe(true);
    expect(canStartWorker(null)).toBe(true);
  });
  it("reinicia imediatamente quando o worker marcou o lock como stopped", () => {
    const stopped = heartbeat({ status: "stopped", last_heartbeat_at: "2026-08-10T04:00:09.000Z", lock_expires_at: "2026-08-10T04:00:09.000Z" });
    const now = Date.parse("2026-08-10T04:00:10.000Z");
    expect(shouldRecoverWorker(stopped, now)).toBe(true);
    expect(canStartWorker(stopped, now)).toBe(true);
  });
});
