import { config as loadEnv } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

loadEnv({ path: [".env.local", ".env"], override: false, quiet: true });

type Status = "READY" | "BLOCKED";
type Check = { name: string; status: Status; detail: string };
const checks: Check[] = [];
const root = process.cwd();
const localMigrations = fs.readdirSync(path.join(root, "supabase", "migrations"))
  .filter((file) => file.endsWith(".sql"))
  .map((file) => file.split("_", 1)[0]!)
  .sort();
const requiredMigrationVersions = new Set([
  "20260810000600",
  "20260810000700",
  "20260816000100",
  "20260816000200",
  "20260816000300",
]);

function add(name: string, ready: boolean, detail: string) {
  checks.push({ name, status: ready ? "READY" : "BLOCKED", detail });
}

function psql(query: string): string | null {
  const databaseUrl = process.env.SUPABASE_DATABASE_URL;
  if (!databaseUrl) return null;
  const result = spawnSync("psql", [databaseUrl, "-X", "-qAt", "-F", "|", "-c", query], {
    cwd: root,
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 ? String(result.stdout ?? "").trim() : null;
}

async function getJson(url: string, init?: RequestInit) {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(8_000) });
    return { response, body: await response.json().catch(() => null) };
  } catch {
    return null;
  }
}

function placeholder(value: string | undefined) {
  return !value || /replace-with|troque-por|change-before-production|development-only/i.test(value);
}

async function main() {
  const supabaseConfigured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const migrationText = psql("select version from supabase_migrations.schema_migrations order by version;");
  const appliedMigrations = migrationText ? migrationText.split(/\r?\n/).filter(Boolean).sort() : [];
  const pendingMigrations = localMigrations.filter((version) => !appliedMigrations.includes(version));
  const requiredPendingMigrations = pendingMigrations.filter((version) => requiredMigrationVersions.has(version));
  const intentionalPendingMigrations = pendingMigrations.filter((version) => !requiredMigrationVersions.has(version));
  const remoteOnly = appliedMigrations.filter((version) => !localMigrations.includes(version));
  add("SUPABASE", supabaseConfigured && Boolean(migrationText), supabaseConfigured ? (migrationText ? "conectado" : "migration table indisponível") : "credenciais ausentes");
  add("MIGRATIONS", requiredPendingMigrations.length === 0 && remoteOnly.length === 0, requiredPendingMigrations.length ? "Francisco pendentes=" + requiredPendingMigrations.join(",") : "Francisco current; The Wolf pendente intencionalmente");

  const api = await getJson("http://127.0.0.1:3333/health");
  const apiReady = Boolean(api?.response.ok && api.body?.status === "ok");
  add("API", apiReady, apiReady ? "healthy" : "indisponível em 127.0.0.1:3333");
  const workerStatus = String(api?.body?.services?.worker?.status ?? "offline");
  const schedulerStatus = String(api?.body?.services?.scheduler?.status ?? "offline");
  const workerReady = workerStatus === "online" || workerStatus === "running";
  const schedulerReady = schedulerStatus === "online" || schedulerStatus === "running";
  add("WORKER", workerReady, workerStatus);
  add("SCHEDULER", schedulerReady, schedulerStatus);

  const evolutionBase = (process.env.EVOLUTION_BASE_URL ?? process.env.EVOLUTION_API_URL ?? "").replace(/\/$/, "");
  const evolutionKey = process.env.EVOLUTION_API_KEY ?? process.env.AUTHENTICATION_API_KEY ?? "";
  const instance = process.env.EVOLUTION_INSTANCE_NAME ?? "renova123-francisco";
  const keyFormatWarning = placeholder(evolutionKey);
  const evolutionConfigured = Boolean(evolutionBase && evolutionKey);
  const stateResult = evolutionConfigured
    ? await getJson(evolutionBase + "/instance/connectionState/" + encodeURIComponent(instance), { headers: { apikey: evolutionKey } })
    : null;
  const evolutionState = String(stateResult?.body?.instance?.state ?? stateResult?.body?.state ?? stateResult?.body?.data?.state ?? "unavailable");
  const evolutionAuthValid = Boolean(stateResult?.response.ok);
  const evolutionReady = Boolean(evolutionBase && evolutionAuthValid);
  const whatsappReady = evolutionState === "open" || evolutionState === "connecting";
  add("EVOLUTION API KEY", evolutionAuthValid, evolutionAuthValid ? (keyFormatWarning ? "VALID via endpoint autenticado; KEY_FORMAT_WARNING" : "VALID") : "não validada por endpoint autenticado");
  add("EVOLUTION", evolutionReady, evolutionReady ? "HTTP/auth READY; instance=" + instance + " state=" + evolutionState : "Evolution indisponível ou autenticação inválida");
  add("WHATSAPP", whatsappReady, evolutionState === "connecting" ? "QR_REQUIRED/connecting" : evolutionState);
  const webhookResult = evolutionConfigured
    ? await getJson(evolutionBase + "/webhook/find/" + encodeURIComponent(instance), { headers: { apikey: evolutionKey } })
    : null;
  const webhookBody = webhookResult?.body;
  const webhookEnabled = Boolean(webhookBody?.enabled ?? webhookBody?.webhook?.enabled ?? webhookBody?.data?.webhook?.enabled);
  const webhookUrl = webhookBody?.url ?? webhookBody?.webhook?.url ?? webhookBody?.data?.webhook?.url;
  const webhookReady = Boolean(webhookResult?.response.ok && webhookEnabled && webhookUrl);
  add("WEBHOOK INBOUND", webhookReady, webhookResult?.response.ok ? "enabled=" + webhookEnabled + " urlConfigured=" + Boolean(webhookUrl) : "Evolution indisponível; não testado com evento");

  const general = psql("select coalesce(values->>'automationEnabled','false'), coalesce(values->>'globalPause','false'), coalesce(values->>'authorizedTestPhone',''), coalesce(values->>'salesCloserName',''), coalesce(values->>'salesCloserPhone','') from public.system_settings where section='general' limit 1;")?.split("|") ?? [];
  const outreach = psql("select coalesce(values->>'dailyProactiveLimit',values->>'dailyLimit','') from public.system_settings where section='outreach' limit 1;")?.split("|") ?? [];
  const handoffConfigured = psql("select length(coalesce(values->>'handoffCriteria','')) > 0 from public.system_settings where section='mind' limit 1;")?.trim() === "t";
  const pedroConfigured = (general[3] ?? "").trim().toLowerCase() === "pedro" && (general[4] ?? "").trim() === "5582988543864" || Number(psql("select count(*) from public.profiles where lower(display_name) like '%pedro%';") ?? 0) > 0 || Number(psql("select count(*) from public.app_settings where section='general' and coalesce(values->>'salesCloserName','') <> '';" ) ?? 0) > 0;
  const automationEnabled = general[0] === "true";
  const globalPause = general[1] === "true";
  const dailyLimit = Number(outreach[0] || 0);
  const allowlistEmpty = !(general[2] ?? "").trim();
  const realConfig = process.env.REAL_SENDING_ENABLED === "true" && process.env.SIMULATION_MODE !== "true" && process.env.MOCK_MODE !== "true" && process.env.MOCK_EVOLUTION !== "true";
  const realSendingReady = realConfig && evolutionState === "open" && automationEnabled && !globalPause && !allowlistEmpty;
  const automationSafe = !automationEnabled && globalPause;
  const infrastructureReady = supabaseConfigured && requiredPendingMigrations.length === 0 && pedroConfigured && dailyLimit === 50 && apiReady && workerReady && schedulerReady && evolutionReady && webhookReady;
  add("PEDRO", pedroConfigured && handoffConfigured, pedroConfigured && handoffConfigured ? "destino e handoff configurados" : "Pedro/destino de handoff não configurado");
  add("AUTOMATION", automationSafe, automationSafe ? "OFF; automationEnabled=false e globalPause=true" : "estado inseguro: automationEnabled=" + automationEnabled + " globalPause=" + globalPause);
  add("REAL SENDING", realSendingReady, realSendingReady ? "habilitado" : "BLOCKED por proteção, allowlist ou infraestrutura");
  add("GLOBAL PAUSE", globalPause, "globalPause=" + globalPause);
  add("DAILY LIMIT", dailyLimit === 50, "persistido=" + (dailyLimit || "ausente") + "; inbound/replies não entram no contador");
  add("PILOT ALLOWLIST", allowlistEmpty, allowlistEmpty ? "EMPTY" : "NON_EMPTY");
  add("PILOT MODE", realSendingReady && !globalPause && dailyLimit === 50 && allowlistEmpty, "somente após preflight verde e allowlist explícita");
  add("INFRASTRUCTURE", infrastructureReady, infrastructureReady ? "ready for pilot" : "Evolution, serviços ou configuração ainda bloqueados");

  const allReady = checks.every((check) => check.status === "READY");
  console.log("FRANCISCO PREFLIGHT");
  for (const check of checks) console.log(check.name.padEnd(18) + " " + check.status.padEnd(7) + " " + check.detail);
  console.log("MIGRATIONS_APPLIED  " + (appliedMigrations.length ? appliedMigrations.join(",") : "UNKNOWN"));
  console.log("MIGRATIONS_PENDING  " + (pendingMigrations.length ? pendingMigrations.join(",") : "NONE"));
  console.log("MIGRATIONS_REQUIRED_PENDING  " + (requiredPendingMigrations.length ? requiredPendingMigrations.join(",") : "NONE"));
  console.log("MIGRATIONS_INTENTIONAL_PENDING  " + (intentionalPendingMigrations.length ? intentionalPendingMigrations.join(",") : "NONE"));
  console.log("MIGRATIONS_REMOTE_ONLY " + (remoteOnly.length ? remoteOnly.join(",") : "NONE"));
  console.log("SEND_ENDPOINT       " + (evolutionBase && evolutionConfigured ? "CONFIGURED (not called)" : "BLOCKED"));
  console.log("PILOT_ALLOWLIST     " + (allowlistEmpty ? "EMPTY" : "NON_EMPTY"));
  console.log("OUTREACH_ONLINE_ONLY " + (process.env.OUTREACH_ONLINE_ONLY ?? "MISSING"));
  console.log("TEST_PHONE          " + (process.env.OUTREACH_ONLINE_TEST_PHONE ? "CONFIGURED" : "EMPTY"));
  console.log("GLOBAL_DB_PUSH      " + (intentionalPendingMigrations.length ? "UNSAFE — The Wolf drift" : "SAFE"));
  console.log("INFRASTRUCTURE_READY " + (infrastructureReady ? "SIM" : "NÃO"));
  console.log("OPERATION_AUTHORIZED " + (realSendingReady ? "SIM" : "NÃO — safety flags/allowlist"));
  console.log("READY_FOR_1_NUMBER  " + (allReady ? "SIM" : "NÃO"));
  console.log("REAL_EXTERNAL_MESSAGES 0");
  console.log("SUPABASE_REAL_CHANGES 0");
  process.exitCode = allReady ? 0 : 1;
}

void main().catch((error) => {
  console.error("FRANCISCO PREFLIGHT BLOCKED: " + (error instanceof Error ? error.message : "erro desconhecido"));
  process.exitCode = 1;
});
