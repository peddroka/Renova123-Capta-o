import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { profileServices } from "./dev-manager-profiles.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runtime = join(root, ".runtime");
const stateFile = join(runtime, "dev-processes.json");
const ports = { web: 5173, api: 3333 };
const pnpmCli = process.platform === "win32" ? join(process.env.APPDATA ?? "", "npm", "node_modules", "pnpm", "bin", "pnpm.cjs") : null;
const command = process.platform === "win32" ? process.execPath : "pnpm";
const pnpmArgs = (args) => (process.platform === "win32" ? [pnpmCli, ...args] : args);
const argsFor = {
  web: pnpmArgs(["--silent", "--filter", "@renova123/web", "dev"]),
  api: pnpmArgs(["--silent", "--filter", "@renova123/api", "dev"]),
  // Always run the worker through its supervisor. Any unexpected child exit
  // must fail the managed profile so systemd can recover it.
  worker: pnpmArgs(["--silent", "--filter", "@renova123/worker", "supervisor"]),
};

function portPid(port) {
  if (process.platform !== "win32") return null;
  try {
    const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue).OwningProcess`], { encoding: "utf8" }).trim();
    const pid = Number(output.split(/\s+/).find(Boolean));
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch { return null; }
}
async function getJson(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return { ok: response.ok, body: await response.json().catch(() => null) };
  } catch { return { ok: false, body: null }; }
}
function readState() { try { return JSON.parse(readFileSync(stateFile, "utf8")); } catch { return null; } }
function saveState(state) { mkdirSync(runtime, { recursive: true }); writeFileSync(stateFile, JSON.stringify(state, null, 2)); }
function removeState() { try { unlinkSync(stateFile); } catch { /* already stopped */ } }
function processExists(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function killTree(pid) {
  if (!pid || !processExists(pid)) return;
  if (process.platform === "win32") await new Promise((done) => {
    const child = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true, shell: false });
    child.once("exit", done);
  });
  else process.kill(pid, "SIGTERM");
}
async function health() {
  const api = await getJson("http://127.0.0.1:3333/health");
  return {
    web: await fetch("http://127.0.0.1:5173/", { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false),
    api,
    liveApi: await getJson("http://127.0.0.1:3333/health/live"),
  };
}
function printStatus(result, state = readState()) {
  const profile = state?.profile ?? "none";
  console.log(profile === "francisco" ? "FRANCISCO" : "RENOVA123 CAPTAÇÃO");
  console.log(`API       ${ports.api}   ${result.liveApi.ok ? "READY" : "STOPPED"}   PID ${portPid(ports.api) ?? "-"}`);
  if (profile === "francisco") {
    const body = result.api.body ?? {};
    const services = body.services ?? {};
    console.log(`DATABASE  ${services.database ?? "UNKNOWN"}`);
    console.log(`WHATSAPP  ${services.whatsapp ?? services.evolution ?? "UNKNOWN"}`);
    console.log(`WORKER    ${services.worker?.status ?? "OFFLINE"}   PID ${state?.children?.worker ?? "-"}`);
    console.log(`SCHEDULER ${services.scheduler?.status ?? services.worker?.status ?? "OFFLINE"}`);
    console.log(`AUTOMAÇÃO ${body.automationActive ? "LIGADA" : "DESLIGADA"}`);
    console.log(`ENVIO REAL ${body.simulationMode ? "BLOQUEADO" : "ATIVO"}`);
    console.log(`FILA      ${body.queue?.pending ?? "?"} PENDENTES`);
  } else {
    console.log(`WEB       ${ports.web}   ${result.web ? "READY" : "STOPPED"}   PID ${portPid(ports.web) ?? "-"}`);
    console.log(`WORKER    ${state?.children?.worker && processExists(state.children.worker) ? "RUNNING" : "NOT STARTED"}   PID ${state?.children?.worker ?? "-"}`);
  }
}
async function checkOccupiedBeforeStart(services) {
  const blockers = Object.entries(ports).filter(([name, port]) => services.includes(name) && portPid(port));
  if (blockers.length) throw new Error(blockers.map(([name, port]) => `Porta ${port} (${name}) ocupada pelo PID ${portPid(port)}.`).join("\n"));
}
function assertRealOutreachOptIn(profile) {
  const real = process.env.REAL_SENDING_ENABLED === "true" && process.env.SIMULATION_MODE === "false" && process.env.OUTREACH_ENABLED === "true";
  if (profile === "full" && real && process.env.ALLOW_REAL_OUTREACH_DEV !== "true") throw new Error("Worker real bloqueado: defina ALLOW_REAL_OUTREACH_DEV=true explicitamente.");
}
async function start(profile) {
  const services = profileServices(profile);
  assertRealOutreachOptIn(profile);
  const realFranciscoOutreach = process.env.REAL_SENDING_ENABLED === "true" && process.env.SIMULATION_MODE === "false" && process.env.MOCK_EVOLUTION === "false";
  if (profile === "francisco" && realFranciscoOutreach && process.env.ALLOW_REAL_OUTREACH_DEV !== "true") throw new Error("FRANCISCO inicia bloqueado enquanto envio real estiver ativo sem ALLOW_REAL_OUTREACH_DEV=true.");
  const existing = readState();
  if (existing?.managerPid && processExists(existing.managerPid)) { printStatus(await health(), existing); return; }
  await checkOccupiedBeforeStart(services);
  const children = {};
  const state = { profile, managerPid: process.pid, root, children, startedAt: new Date().toISOString() };
  saveState(state);
  const stopping = { value: false };
  const stopManaged = async (code = 0) => {
    if (stopping.value) return;
    stopping.value = true;
    for (const key of ["web", "worker", "api"]) if (services.includes(key)) await killTree(children[key]);
    removeState();
    process.exitCode = code;
  };
  process.on("SIGINT", () => void stopManaged());
  process.on("SIGTERM", () => void stopManaged());
  for (const key of services) {
    const child = spawn(command, argsFor[key], { cwd: root, stdio: "inherit", windowsHide: true, shell: false });
    children[key] = child.pid;
    saveState(state);
    child.once("exit", (code, signal) => {
      if (stopping.value) return;
      console.error(`Serviço gerenciado ${key} encerrou inesperadamente (code=${code ?? "null"}, signal=${signal ?? "none"}).`);
      void stopManaged(code && code !== 0 ? code : 1);
    });
  }
  const started = Date.now();
  let ready = false;
  while (!stopping.value && Date.now() - started < 45_000) {
    const result = await health();
    ready = result.liveApi.ok && (!services.includes("web") || result.web) && (profile !== "francisco" || ["online", "running", "mock"].includes(result.api.body?.services?.worker?.status));
    if (ready) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  if (!ready) { printStatus(await health(), state); await stopManaged(1); return; }
  console.log(profile === "francisco" ? "\nFRANCISCO\nAPI              READY\nWORKER           READY\nSCHEDULER        EMBUTIDO NO WORKER\nSTATUS:          OPERACIONAL\n" : "\nRENOVA123 CAPTAÇÃO PRONTO");
  await new Promise((resolveWait) => { const timer = setInterval(() => { if (stopping.value) { clearInterval(timer); resolveWait(); } }, 250); });
}
async function stop() {
  const state = readState();
  if (!state) { console.log("Nenhuma instância gerenciada encontrada; nenhum processo foi encerrado."); return; }
  for (const key of state.children ? Object.keys(state.children) : []) await killTree(state.children[key]);
  if (state.managerPid && state.managerPid !== process.pid) await killTree(state.managerPid);
  removeState();
  console.log("Instância gerenciada encerrada.");
}
async function status() { printStatus(await health()); }
const action = process.argv[2] ?? "start";
const profile = process.argv[3] ?? (action === "start" ? "dev" : "dev");
if ((action === "start" || action === "restart") && readState()?.managerPid && processExists(readState().managerPid) && readState().profile !== profile) {
  console.error(`Já existe uma instância gerenciada no perfil ${readState().profile ?? "legacy"}. Execute npm run dev:stop antes de trocar para ${profile}.`);
  process.exitCode = 2;
}
if (action === "start" && process.exitCode !== 2) await start(profile);
else if (action === "stop") await stop();
else if (action === "status") await status();
else if (action === "restart" && process.exitCode !== 2) { await stop(); await start(profile); }
else if (!['start','stop','status','restart'].includes(action)) throw new Error(`Ação desconhecida: ${action}`);
