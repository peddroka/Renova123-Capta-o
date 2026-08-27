import { config as loadEnv } from "dotenv";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createRepository, type Repository } from "../packages/database/src/index.js";

loadEnv({ path: ".env.local", quiet: true });
const root = process.cwd();
const secret = "qa-francisco-secret-2026";
const apiPort = 3393;
const baseUrl = `http://127.0.0.1:${apiPort}`;
const commonEnv = {
  ...process.env,
  NODE_ENV: "development",
  MOCK_MODE: "true",
  MOCK_GROQ: "true",
  MOCK_GEMINI: "true",
  MOCK_EVOLUTION: "true",
  SIMULATION_MODE: "true",
  REAL_SENDING_ENABLED: "false",
  OUTREACH_ENABLED: "true",
  OUTREACH_ONLINE_ONLY: "false",
  OUTREACH_ONLINE_TEST_PHONE: undefined,
  EVOLUTION_WEBHOOK_SECRET: secret,
  WEBHOOK_SECRET: secret,
  API_PORT: String(apiPort),
  LOCAL_API_PORT: String(apiPort),
  WORKER_POLL_MS: "200",
  WORKER_HEARTBEAT_MS: "5000",
};
type State = {
  leads?: Array<Record<string, unknown>>;
  jobs?: Array<Record<string, unknown>>;
  messages?: Array<Record<string, unknown>>;
  resources?: Record<string, Array<Record<string, unknown>>>;
  settings?: Record<string, Record<string, unknown>>;
};
type Event = { time: number; msg?: string; conversationKey?: string; jobId?: string; [key: string]: unknown };

function dbPath(label: string) {
  return path.join(os.tmpdir(), `renova123-francisco-${label}-${process.pid}-${Date.now()}.json`);
}
function repository(file: string) {
  return createRepository({
    mock: true,
    supabaseUrl: undefined,
    serviceRoleKey: undefined,
    mockFilePath: file,
  });
}
function readState(file: string): State {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as State;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40);
    }
  }
  return {};
}
function child(args: string[], file: string, overrides: Record<string, string | undefined> = {}) {
  return spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", ...args], {
    cwd: root,
    env: { ...commonEnv, MOCK_DB_PATH: file, ...overrides },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}
function parseEvents(process: ChildProcess) {
  const events: Event[] = [];
  const raw: string[] = [];
  const consume = (chunk: unknown) =>
    (raw.push(String(chunk)), String(chunk)).split(/\r?\n/).forEach((line) => {
      try {
        const value = JSON.parse(line) as Event;
        if (value.msg) events.push(value);
      } catch {
        /* fragmento de log */
      }
    });
  process.stdout?.on("data", consume);
  process.stderr?.on("data", consume);
  (events as Event[] & { raw?: string[] }).raw = raw;
  return events as Event[] & { raw?: string[] };
}
async function waitForWorkerReady(process: ChildProcess, events: Event[], timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (events.some((event) => event.msg === "worker_ready")) return true;
    if (process.exitCode !== null) return false;
    await delay(50);
  }
  return false;
}
async function waitFor(url: string, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* iniciando */
    }
    await delay(200);
  }
  throw new Error(`Timeout aguardando ${url}`);
}
async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
async function waitState(file: string, predicate: (state: State) => boolean, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate(readState(file))) return readState(file);
    await delay(100);
  }
  return readState(file);
}
async function stop(process: ChildProcess) {
  if (process.exitCode === null && !process.killed) {
    if (process.pid && process.platform === "win32")
      await new Promise<void>((resolve) => {
        const killer = spawn("taskkill", ["/PID", String(process.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
        killer.once("close", () => resolve());
        killer.once("error", () => resolve());
      });
    else process.kill();
  }
  await new Promise<void>((resolve) => {
    if (process.exitCode !== null) return resolve();
    process.once("exit", () => resolve());
    setTimeout(resolve, 2_000);
  });
}
async function killPid(pid: number) {
  if (process.platform === "win32")
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.once("close", () => resolve());
      killer.once("error", () => resolve());
    });
  else {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* processo já encerrado */
    }
  }
}
async function waitForPidGone(pid: number, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await delay(100);
  }
  return false;
}
async function seedLead(repo: Repository, phone: string, name = "Lead QA") {
  return repo.createResource("leads", {
    phone,
    name,
    company: "Ótica QA",
    stage: "queued",
    source: "qa-francisco",
  });
}
async function enableTestOutreach(repo: Repository) {
  const general = await repo.getSettings("general");
  await repo.saveSettings("general", {
    ...general,
    automationEnabled: true,
    globalPause: false,
    globalPauseReason: null,
  });
  const settings = await repo.getSettings("outreach");
  await repo.saveSettings("outreach", {
    ...settings,
    enabled: true,
    startTime: "00:00",
    endTime: "23:59",
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    dailyProactiveLimit: 1000,
    hourlyLimit: 1000,
  });
}
function scenarioSnapshot(file: string, events: Event[]) {
  const state = readState(file);
  const jobs = state.jobs ?? [];
  const count = (status: string) => jobs.filter((job) => String(job.status) === status).length;
  const now = Date.now();
  const eligibleNow = jobs.filter((job) => ["pending", "scheduled", "retry"].includes(String(job.status)) && Date.parse(String(job.availableAt ?? "")) <= now);
  const future = jobs.filter((job) => ["pending", "scheduled", "retry"].includes(String(job.status)) && Date.parse(String(job.availableAt ?? "")) > now);
  const latest = events.at(-1);
  return {
    jobsByStatus: { pending: count("pending"), processing: count("processing"), completed: count("completed"), failed: count("failed"), dead_letter: count("dead_letter"), dead: count("dead"), cancelled: count("cancelled"), superseded: count("superseded") },
    activeJobs: events.filter((event) => event.msg === "conversation_lane_started" || event.msg === "conversation_lane_reused").length - events.filter((event) => event.msg === "conversation_lane_finished").length,
    activeUniqueConversations: laneMetrics(events).maxUnique,
    activeKeys: events.filter((event) => event.msg === "conversation_lane_started" || event.msg === "conversation_lane_reused").map((event) => event.conversationKey),
    waitingSameConversation: events.filter((event) => event.msg === "conversation_lane_busy_requeued").length,
    automationEnabled: state.settings?.general?.automationEnabled ?? null,
    globalPause: state.settings?.general?.globalPause ?? null,
    globalPauseReason: state.settings?.general?.globalPauseReason ?? null,
    workerHeartbeat: fs.existsSync(`${file}.worker-heartbeat.json`) ? readState(`${file}.worker-heartbeat.json`) : null,
    eligibleNow: eligibleNow.length,
    future: future.length,
    latestEvent: latest?.msg ?? null,
  };
}
async function seedOutreach(repo: Repository, lead: Record<string, unknown>, count = 1) {
  for (let index = 0; index < count; index += 1)
    await repo.enqueue(
      "outreach",
      {
        leadId: String(lead.id),
        phone: String(lead.phone),
        text: `Mensagem QA ${index + 1}`,
        templateStrategy: "qa",
      },
      new Date(),
    );
}
async function runWorkerScenario(
  label: string,
  setup: (repo: Repository) => Promise<{
    wait: (state: State) => boolean;
    env?: Record<string, string | undefined>;
    timeout?: number;
    expected?: Record<string, unknown>;
  }>,
) {
  const file = dbPath(label);
  const repo = repository(file);
  await enableTestOutreach(repo);
  const config = await setup(repo);
  const worker = child(["apps/worker/src/index.ts"], file, config.env);
  const events = parseEvents(worker);
  try {
    const started = Date.now();
    let lastSignature = "";
    let lastProgressAt = started;
    while (Date.now() - started < (config.timeout ?? 45_000)) {
      const state = readState(file);
      const signature = JSON.stringify({ jobs: state.jobs, settings: state.settings?.general });
      if (signature !== lastSignature) {
        lastSignature = signature;
        lastProgressAt = Date.now();
      }
      if (config.wait(state)) break;
      if (Date.now() - lastProgressAt >= 3_000) {
        console.error(`[qa] ${label}:no-progress ${JSON.stringify(scenarioSnapshot(file, events))}`);
        lastProgressAt = Date.now();
      }
      await delay(100);
    }
    const finalState = readState(file);
    if (!config.wait(finalState)) console.error(`[qa] ${label}:timeout ${JSON.stringify(scenarioSnapshot(file, events))}`);
    await delay(300);
    return { file, state: readState(file), events };
  } finally {
    await stop(worker);
  }
}
async function runOneLeadFailureScenario() {
  return runWorkerScenario("one-failure", async (repo) => {
    const leads = [];
    for (const [letter, index] of [
      ["A", 1],
      ["B", 2],
      ["C", 3],
      ["D", 4],
      ["E", 5],
    ] as const) {
      const lead = await seedLead(repo, `551196${String(index).padStart(7, "0")}`, `Failure ${letter}`);
      await seedOutreach(repo, lead);
      leads.push(lead);
    }
    return {
      wait: (state: State) => queueSummary(state).completed >= 4 && queueSummary(state).dead >= 1,
      env: { QA_FAIL_PHONE: String(leads[0]!.phone), QA_FAIL_SEND: "true", QA_FAIL_NON_RETRYABLE: "true" },
      timeout: 30_000,
    };
  });
}
async function runRestartCase(label: string, count: number, killAfter: number) {
  const file = dbPath(`restart-${label}`);
  const repo = repository(file);
  await enableTestOutreach(repo);
  for (let index = 0; index < count; index += 1) {
    const lead = await seedLead(
      repo,
      `551198${String(index + 1).padStart(7, "0")}`,
      `Restart ${label} ${index + 1}`,
    );
    await seedOutreach(repo, lead);
  }
  const first = child(["apps/worker/src/index.ts"], file);
  const firstEvents = parseEvents(first);
  const firstReady = await waitForWorkerReady(first, firstEvents);
  await waitState(file, (state) => queueSummary(state).completed >= killAfter, 20_000);
  const firstReadyEvent = firstEvents.find((event) => event.msg === "worker_ready");
  const firstWorkerPid = Number(firstReadyEvent?.workerPid ?? first.pid);
  await killPid(firstWorkerPid);
  await stop(first);
  await waitForPidGone(firstWorkerPid);
  try {
    fs.unlinkSync(`${file}.lock`);
  } catch {
    /* liberado normalmente */
  }
  const afterKillState = readState(file);
  const afterKill = { ...queueSummary(afterKillState), ...pendingSnapshot(afterKillState) };
  const second = child(["apps/worker/src/index.ts"], file);
  const secondEvents = parseEvents(second);
  const secondReady = await waitForWorkerReady(second, secondEvents);
  await waitState(file, (state) => queueSummary(state).completed >= count, 45_000);
  await stop(second);
  const finalState = readState(file);
  const keys = (finalState.messages ?? [])
    .filter((row) => row.direction === "outbound")
    .map((row) => String(row.idempotencyKey ?? row.id));
  const result = {
    pass:
      queueSummary(finalState).completed >= count &&
      new Set(keys).size === keys.length &&
      queueSummary(finalState).processing === 0,
    processed: queueSummary(finalState).completed,
    duplicates: keys.length - new Set(keys).size,
    lost: count - queueSummary(finalState).completed,
    stuck: queueSummary(finalState).processing,
    afterKill,
    worker1Pid: first.pid ?? null,
    worker2Pid: second.pid ?? null,
    worker1EffectivePid: firstWorkerPid,
    worker2EffectivePid:
      Number(secondEvents.find((event) => event.msg === "worker_ready")?.workerPid ?? 0) || null,
    differentProcesses: first.pid !== second.pid,
    worker1Ready: firstReady,
    worker2Ready: secondReady,
    workerDatabase: { worker1: file, worker2: file },
    worker2ReadyEvent: secondEvents.find((event) => event.msg === "worker_ready") ?? null,
    worker2PollDiagnostics: secondEvents
      .filter((event) => event.msg === "worker_poll_diagnostic")
      .slice(0, 10),
    worker2ClaimDiagnostics: secondEvents
      .filter((event) => event.msg === "worker_claim_diagnostic")
      .slice(0, 10),
    worker2Output: (secondEvents as Event[] & { raw?: string[] }).raw?.slice(-10) ?? [],
  };
  cleanup(file);
  return result;
}
async function injectInbound(phone: string, text: string, sequence: string) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${baseUrl}/webhooks/evolution`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": secret },
      body: JSON.stringify({
        event: "MESSAGES_UPSERT",
        instance: "renova123-francisco-qa",
        data: {
          key: { id: `qa-inbound-${sequence}`, remoteJid: `${phone}@s.whatsapp.net`, fromMe: false },
          message: { conversation: text },
        },
      }),
    });
    if (response.ok) return;
    if (response.status >= 500 && attempt < 3) {
      await delay(100 * (attempt + 1));
      continue;
    }
    throw new Error(`Inbound rejeitado: ${response.status} ${await response.text()}`);
  }
}
function cleanup(file: string) {
  for (const candidate of [file, `${file}.lock`, `${file}.worker.lock`])
    try {
      if (fs.existsSync(candidate)) fs.unlinkSync(candidate);
    } catch {
      /* best effort */
    }
}
function queueSummary(state: State) {
  const jobs = state.jobs ?? [];
  return {
    completed: jobs.filter((j) => j.status === "completed").length,
    pending: jobs.filter((j) => ["pending", "scheduled", "retry"].includes(String(j.status))).length,
    processing: jobs.filter((j) => j.status === "processing").length,
    dead: jobs.filter((j) => ["dead", "dead_letter"].includes(String(j.status))).length,
    staleLocks: jobs.filter((j) => j.status === "processing" && j.lockedAt).length,
  };
}
function pendingSnapshot(state: State) {
  const now = Date.now();
  const pending = (state.jobs ?? []).filter((job) =>
    ["pending", "scheduled", "retry"].includes(String(job.status)),
  );
  return {
    pendingAvailableNow: pending.filter((job) => Date.parse(String(job.availableAt ?? "")) <= now).length,
    pendingFuture: pending.filter((job) => Date.parse(String(job.availableAt ?? "")) > now).length,
    pendingByType: pending.reduce<Record<string, number>>((counts, job) => {
      const type = String(job.type ?? "unknown");
      counts[type] = (counts[type] ?? 0) + 1;
      return counts;
    }, {}),
    pendingWindow: pending
      .slice(0, 10)
      .map((job) => ({ id: job.id, status: job.status, type: job.type, availableAt: job.availableAt })),
  };
}
function laneMetrics(events: Event[]) {
  const active = new Map<string, number>();
  let maxUnique = 0;
  let maxJobs = 0;
  let waitingSame = 0;
  for (const event of events.sort((a, b) => a.time - b.time)) {
    if (event.msg === "conversation_lane_started" || event.msg === "conversation_lane_reused") {
      const key = String(event.conversationKey ?? "unknown");
      if (active.has(key)) waitingSame += 1;
      active.set(key, (active.get(key) ?? 0) + 1);
    }
    if (event.msg === "conversation_lane_busy_requeued") waitingSame += 1;
    if (event.msg === "conversation_lane_finished") {
      const key = String(event.conversationKey ?? "unknown");
      active.delete(key);
    }
    maxUnique = Math.max(maxUnique, active.size);
    maxJobs = Math.max(
      maxJobs,
      [...active.values()].reduce((sum, value) => sum + value, 0),
    );
  }
  return { maxUnique, maxJobs, waitingSame };
}

async function main() {
  const mark = (label: string) => console.error(`[qa] ${label}`);
  const results: Record<string, unknown> = {
    evolution: "MOCK",
    realExternalMessages: 0,
    supabaseRealChanges: 0,
  };
  const restartOnly = process.argv.includes("--restart-only");
  const oneLeadFailureOnly = process.argv.includes("--one-lead-failure");
  if (oneLeadFailureOnly) {
    mark("oneLeadFailure:start");
    const failure = await runOneLeadFailureScenario();
    const summary = queueSummary(failure.state);
    const result = {
      pass: summary.completed >= 4 && summary.dead >= 1 && failure.state.settings?.general?.globalPause !== true,
      completed: summary.completed,
      dead: summary.dead,
      globalPause: failure.state.settings?.general?.globalPause ?? false,
      events: failure.events.filter((event) => ["worker_ready", "worker_poll_diagnostic", "worker_claim_diagnostic", "conversation_lane_started", "conversation_lane_finished", "job_failed"].includes(String(event.msg))),
    };
    console.log(JSON.stringify({ isolatedFailure: result, evolution: "MOCK", realExternalMessages: 0, supabaseRealChanges: 0 }, null, 2));
    cleanup(failure.file);
    if (!result.pass) process.exitCode = 1;
    return;
  }
  if (!restartOnly) {
    mark("base:start");
    const baseFile = dbPath("base");
    const api = child(["apps/api/src/server.ts"], baseFile);
    const worker = child(["apps/worker/src/index.ts"], baseFile, { OUTREACH_ENABLED: "false" });
    try {
      await waitFor(`${baseUrl}/health`);
      const phones = Array.from({ length: 50 }, (_, index) => `551199${String(index + 1).padStart(7, "0")}`);
      for (let offset = 0; offset < phones.length; offset += 10)
        await Promise.all(
          phones
            .slice(offset, offset + 10)
            .map((phone, index) => injectInbound(phone, "Oi", String(offset + index))),
        );
      const baseState = await waitState(
        baseFile,
        (state) => (state.messages ?? []).filter((row) => row.direction === "outbound").length >= 50,
        60_000,
      );
      const baseMessages = baseState.messages ?? [];
      const outboundKeys = baseMessages
        .filter((row) => row.direction === "outbound")
        .map((row) => String(row.idempotencyKey ?? row.id));
      results["50Leads"] = baseMessages.filter((row) => row.direction === "inbound").length;
      results["50LeadsDuplicates"] = outboundKeys.length - new Set(outboundKeys).size;
    } finally {
      await stop(worker);
      await stop(api);
      mark("base:done");
    }

    mark("starvation:start");
    const starvation = await runWorkerScenario("starvation", async (repo) => {
      const leads = [];
      for (const [letter, count, index] of [
        ["A", 15, 1],
        ["B", 1, 2],
        ["C", 1, 3],
        ["D", 1, 4],
        ["E", 1, 5],
      ] as const) {
        const lead = await seedLead(repo, `551198${String(index).padStart(7, "0")}`, `Lead ${letter}`);
        await seedOutreach(repo, lead, count);
        leads.push(lead);
      }
      return {
        wait: (state) => queueSummary(state).completed >= 19,
        env: { QA_SLOW_PHONE: String(leads[0]!.phone), QA_SLOW_MS: "350" },
        timeout: 45_000,
      };
    });
    const eventByKey = (events: Event[], key: string, msg: string) =>
      events.find((event) => event.msg === msg && event.conversationKey === `phone:${key}`);
    const starvationPhones = ["5511980000002", "5511980000003", "5511980000004", "5511980000005"];
    const aPhone = "5511980000001";
    const aStart = eventByKey(starvation.events, aPhone, "conversation_lane_started");
    const aFinish = starvation.events
      .filter((e) => e.msg === "conversation_lane_finished" && e.conversationKey === `phone:${aPhone}`)
      .at(-1);
    const others = starvationPhones.map((phone) => ({
      phone,
      started: eventByKey(starvation.events, phone, "conversation_lane_started")?.time ?? null,
    }));
    const metrics = laneMetrics(starvation.events);
    results["starvation"] = {
      pass: others.every((item) => item.started !== null && (!aFinish || item.started < aFinish.time)),
      A_first_started_at: aStart?.time ?? null,
      A_last_finished_at: aFinish?.time ?? null,
      B_C_D_E: others,
      maxActiveUniqueConversations: metrics.maxUnique,
      maxActiveJobs: metrics.maxJobs,
      waitingSameConversation: metrics.waitingSame,
      queue: queueSummary(starvation.state),
    };
    cleanup(starvation.file);

    mark("slow:start");
    const slow = await runWorkerScenario("slow", async (repo) => {
      const leads = [];
      for (const [letter, index] of [
        ["A", 1],
        ["B", 2],
        ["C", 3],
        ["D", 4],
        ["E", 5],
      ] as const) {
        const lead = await seedLead(repo, `551197${String(index).padStart(7, "0")}`, `Slow ${letter}`);
        await seedOutreach(repo, lead);
        leads.push(lead);
      }
      return {
        wait: (state) => queueSummary(state).completed >= 5,
        env: { QA_SLOW_PHONE: String(leads[0]!.phone), QA_SLOW_MS: "15000" },
        timeout: 25_000,
      };
    });
    const slowEvents = slow.events.filter((event) => event.msg === "conversation_lane_finished");
    const slowLead = slowEvents.find((event) => event.conversationKey === "phone:5511970000001");
    const otherFinish = slowEvents
      .filter((event) => event.conversationKey !== "phone:5511970000001")
      .map((e) => e.time);
    results["slowLead"] = {
      pass: Boolean(slowLead && otherFinish.length && Math.max(...otherFinish) < slowLead.time),
      slowLeadDurationMs:
        slowLead &&
        slow.events.find(
          (e) => e.msg === "conversation_lane_started" && e.conversationKey === slowLead.conversationKey,
        )
          ? slowLead.time -
            slow.events.find(
              (e) => e.msg === "conversation_lane_started" && e.conversationKey === slowLead.conversationKey,
            )!.time
          : null,
      otherLeadsDurationMs: otherFinish.length ? Math.max(...otherFinish) - Math.min(...otherFinish) : null,
    };
    cleanup(slow.file);

    mark("failure:start");
    const failure = await runOneLeadFailureScenario();
    results["oneLeadFailure"] = {
      pass: queueSummary(failure.state).completed >= 4 && queueSummary(failure.state).dead >= 1,
      leadAStatus: queueSummary(failure.state).dead,
      globalPause: failure.state.settings?.general?.globalPause ?? false,
      globalPauseReason: failure.state.settings?.general?.globalPauseReason ?? null,
    };
    cleanup(failure.file);

    const systemic = await runWorkerScenario("system-failure", async (repo) => {
      for (let index = 0; index < 4; index += 1) {
        const lead = await seedLead(repo, `551195${String(index + 1).padStart(7, "0")}`);
        await seedOutreach(repo, lead);
      }
      return {
        wait: (state) => queueSummary(state).dead >= 1,
        env: { QA_FAIL_ALL: "true", QA_FAIL_SEND: "true", QA_FAIL_NON_RETRYABLE: "true" },
        timeout: 15_000,
      };
    });
    results["systemFailure"] = {
      pass: systemic.state.settings?.general?.globalPause === true,
      globalPause: systemic.state.settings?.general?.globalPause ?? false,
      reason: systemic.state.settings?.general?.globalPauseReason ?? null,
    };
    cleanup(systemic.file);
  }

  const minimalRuns = [];
  for (let index = 0; index < 10; index += 1)
    minimalRuns.push(await runRestartCase(`minimal-${index + 1}`, 5, 1));
  results["restartMinimal"] = minimalRuns[0];
  results["restartMinimalX10"] = {
    pass: minimalRuns.every((run) => run.pass),
    passed: minimalRuns.filter((run) => run.pass).length,
    total: minimalRuns.length,
    runs: minimalRuns.map((run) => ({
      processed: run.processed,
      duplicates: run.duplicates,
      lost: run.lost,
    })),
  };
  results["restartEarly"] = await runRestartCase("early", 50, 2);
  results["restartMid"] = await runRestartCase("mid", 50, 25);
  results["restart"] = await runRestartCase("late", 50, 45);

  if (restartOnly) {
    console.log("FRANCISCO QA");
    console.log(
      JSON.stringify(
        { evolution: "MOCK", realExternalMessages: 0, supabaseRealChanges: 0, ...results },
        null,
        2,
      ),
    );
    process.exit(
      results.restart.pass &&
        results.restartEarly.pass &&
        results.restartMid.pass &&
        results.restartMinimalX10.pass
        ? 0
        : 1,
    );
  }

  const volumeFile = dbPath("volume");
  const volumeRepo = repository(volumeFile);
  const longLead = await seedLead(volumeRepo, "5511930000001", "Conversa Longa");
  const longConversation = await volumeRepo.createResource("conversations", {
    leadId: longLead.id,
    name: "Conversa Longa",
    phone: longLead.phone,
    status: "active",
    stage: "engaged",
    humanActive: false,
  });
  for (let index = 0; index < 500; index += 1)
    await volumeRepo.recordMessage({
      id: `qa-message-${index}`,
      leadId: longLead.id,
      conversationId: longConversation.id,
      direction: index % 2 ? "outbound" : "inbound",
      senderType: index % 4 ? "agent" : "human",
      content: `Mensagem ${index}`,
      messageType: "text",
      status: "sent",
      createdAt: new Date(Date.now() - (500 - index) * 1000).toISOString(),
    });
  for (let index = 0; index < 149; index += 1) {
    const lead = await seedLead(
      volumeRepo,
      `551192${String(index + 1).padStart(7, "0")}`,
      index === 72 ? "Lead Especial Francisco" : `Inbox ${index}`,
    );
    await volumeRepo.createResource("conversations", {
      leadId: lead.id,
      name: index === 72 ? "Lead Especial Francisco" : `Inbox ${index}`,
      phone: lead.phone,
      status: "active",
      stage: "engaged",
      lastMessageAt: new Date(Date.now() - index * 1000).toISOString(),
      summary: `Resumo ${index}`,
    });
  }
  const volumeApi = child(["apps/api/src/server.ts"], volumeFile);
  try {
    await waitFor(`${baseUrl}/health`);
    const headers = { authorization: "Bearer mock-admin-token" };
    let before: string | null = null;
    const seen = new Set<string>();
    let pages = 0;
    while (true) {
      const response = await fetch(
        `${baseUrl}/conversations/${longConversation.id}/messages?limit=50${before ? `&before=${encodeURIComponent(before)}` : ""}`,
        { headers },
      );
      const body = (await response.json()) as {
        rows: Array<{ id: string }>;
        nextBefore: string | null;
        hasOlder: boolean;
      };
      for (const row of body.rows) seen.add(row.id);
      pages += 1;
      if (!body.hasOlder) break;
      before = body.nextBefore;
      if (pages > 20) break;
    }
    const inbox = await fetch(`${baseUrl}/conversations/inbox?page=1&pageSize=100`, { headers });
    const inboxBody = (await inbox.json()) as { rows: Array<Record<string, unknown>>; total: number };
    const inbox2 = await fetch(`${baseUrl}/conversations/inbox?page=2&pageSize=100`, { headers });
    const inbox2Body = (await inbox2.json()) as { rows: Array<Record<string, unknown>> };
    const special = await fetch(
      `${baseUrl}/conversations/inbox?page=1&pageSize=30&search=Especial%20Francisco`,
      { headers },
    );
    const specialBody = (await special.json()) as { rows: Array<Record<string, unknown>> };
    results["500Messages"] = {
      count: seen.size,
      duplicates: 500 - seen.size,
      missing: 500 - seen.size,
      cursor: seen.size === 500 && pages === 10,
    };
    results["150Conversations"] = {
      count: inboxBody.total,
      pagination: inboxBody.total === 150 && inboxBody.rows.length + inbox2Body.rows.length === 150,
      search: specialBody.rows.some((row) => row.name === "Lead Especial Francisco"),
    };
  } finally {
    await stop(volumeApi);
    cleanup(volumeFile);
  }

  console.log("FRANCISCO QA\n" + JSON.stringify(results, null, 2));
  const failures = Object.entries(results).filter(
    ([key, value]) =>
      [
        "starvation",
        "slowLead",
        "oneLeadFailure",
        "systemFailure",
        "restart",
        "500Messages",
        "150Conversations",
      ].includes(key) && (value as any)?.pass === false,
  );
  if (failures.length) process.exitCode = 1;
}
void main().catch((error) => {
  console.error(
    `FRANCISCO QA\nFAIL\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
  );
  process.exitCode = 1;
});
