import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { workerConfig } from "./config.js";

const workerRoot = fileURLToPath(new URL("..", import.meta.url));

const execFileAsync = promisify(execFile);

export const supervisorTiming = {
  startupGraceMs: workerConfig.WORKER_HEARTBEAT_MS * 3,
  staleAfterMs: workerConfig.WORKER_HEARTBEAT_MS * 4,
  restartBackoffMs: workerConfig.WORKER_HEARTBEAT_MS * 6,
  pollMs: workerConfig.WORKER_HEARTBEAT_MS,
} as const;

export type WorkerHeartbeat = { instance_id: string; status: string; last_heartbeat_at: string; lock_expires_at: string };

export function workerPidFromInstanceId(instanceId: string) {
  const match = /^([^:]+):(\d+):/.exec(instanceId);
  return match ? Number(match[2]) : null;
}

export function heartbeatAgeMs(heartbeat: Pick<WorkerHeartbeat, "last_heartbeat_at"> | null, now = Date.now()) {
  if (!heartbeat) return Number.POSITIVE_INFINITY;
  const timestamp = Date.parse(heartbeat.last_heartbeat_at);
  return Number.isFinite(timestamp) ? Math.max(0, now - timestamp) : Number.POSITIVE_INFINITY;
}

export function shouldRecoverWorker(heartbeat: WorkerHeartbeat | null, now = Date.now()) {
  if (!heartbeat) return true;
  return heartbeatAgeMs(heartbeat, now) > supervisorTiming.staleAfterMs;
}

export function canStartWorker(heartbeat: WorkerHeartbeat | null, now = Date.now()) {
  if (!heartbeat) return true;
  const lockExpiresAt = Date.parse(heartbeat.lock_expires_at);
  return Number.isFinite(lockExpiresAt) && lockExpiresAt <= now;
}

async function ownerId(db: SupabaseClient) {
  const result = await db.from("profiles").select("id").eq("role", "admin").order("created_at", { ascending: true }).limit(1).single() as { data: { id: string } | null; error: Error | null };
  if (result.error || !result.data?.id) throw result.error ?? new Error("Administrador não encontrado.");
  return String(result.data.id);
}

async function latestHeartbeat(db: SupabaseClient, owner: string) {
  const result = await db.from("worker_heartbeats").select("instance_id,status,last_heartbeat_at,lock_expires_at").eq("owner_id", owner).eq("worker_type", "main").order("last_heartbeat_at", { ascending: false }).limit(1).maybeSingle() as { data: WorkerHeartbeat | null; error: Error | null };
  if (result.error) throw result.error;
  return (result.data as WorkerHeartbeat | null) ?? null;
}

async function processExists(pid: number) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function terminateProcessTree(pid: number) {
  if (!(await processExists(pid))) return;
  if (process.platform === "win32") {
    await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"]);
    return;
  }
  process.kill(pid, "SIGTERM");
}

function spawnWorker(): ChildProcess {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const args = process.env.NODE_ENV === "production"
    ? ["--filter", "@renova123/worker", "start:child"]
    : ["--filter", "@renova123/worker", "exec", "tsx", "--conditions=development", "src/index.ts"];
  return spawn(command, args, { cwd: workerRoot, stdio: "inherit", windowsHide: true, shell: process.platform === "win32" });
}

export async function runSupervisor() {
  if (!workerConfig.SUPABASE_URL || !workerConfig.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supervisor requer Supabase persistente.");
  const db = createClient(workerConfig.SUPABASE_URL, workerConfig.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const owner = await ownerId(db);
  let child: ChildProcess | null = null;
  let lastRestartAt = 0;
  let stopping = false;
  const stop = () => { stopping = true; if (child?.pid) void terminateProcessTree(child.pid); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  const ensureWorker = async () => {
    const heartbeat = await latestHeartbeat(db, owner);
    const now = Date.now();
    if (!shouldRecoverWorker(heartbeat, now)) return;
    if (now - lastRestartAt < supervisorTiming.restartBackoffMs) return;
    if (heartbeat?.instance_id) {
      const stalePid = workerPidFromInstanceId(heartbeat.instance_id);
      if (stalePid) await terminateProcessTree(stalePid);
    }
    const afterStop = await latestHeartbeat(db, owner);
    if (!canStartWorker(afterStop, Date.now())) return;
    child = spawnWorker();
    lastRestartAt = Date.now();
    child.once("exit", () => { child = null; });
  };

  await new Promise((resolve) => setTimeout(resolve, supervisorTiming.startupGraceMs));
  while (!stopping) {
    try { await ensureWorker(); } catch (error) { console.error("worker_supervisor_cycle_failed", error); }
    await new Promise((resolve) => setTimeout(resolve, supervisorTiming.pollMs));
  }
}

if (process.argv[1]?.endsWith("supervisor.ts") || process.argv[1]?.endsWith("supervisor.js")) await runSupervisor();
