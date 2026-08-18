import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { parsePhoneList } from "@renova123/core";

const root = process.cwd();
const env = Object.fromEntries(fs.readFileSync(`${root}/.env.local`, "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1)]; }));
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const sourceDir = "C:/Users/peddroka/OneDrive/Renova123 Informações/Grupos WhatsApp Leads";
const imports = [
  { sourceGroup: "grupo_1_donos_oticas", sourceLabel: "Grupo 1 — Donos de Óticas", sourceFile: "DONOS-DE-ÓTICAS.csv", file: `${sourceDir}/DONOS-DE-ÓTICAS.csv` },
  { sourceGroup: "grupo_2_seu_consultor_optico", sourceLabel: "Grupo 2 — Seu Consultor Óptico", sourceFile: "SEU-CONSULTOR-OPTICO.csv", file: `${sourceDir}/SEU-CONSULTOR-OPTICO.csv` },
];

function read(path: string) {
  const content = fs.readFileSync(path, "utf8");
  const rows = parsePhoneList(content);
  if (rows.length === 0 || content.split(/\r?\n/)[0]?.trim().toLocaleLowerCase() !== "phone") throw new Error(`CSV inválido: ${path}`);
  return rows;
}

async function main() {
const profile = await supabase.from("profiles").select("id").eq("role", "admin").limit(1).maybeSingle();
if (profile.error) throw profile.error;
if (!profile.data?.id) throw new Error("Nenhum perfil administrador disponível para importação.");
const owner = profile.data.id;

const outreach = {
  dailyLimit: 50, dailyProactiveLimit: 50, hourlyLimit: 8, weekdays: [0, 1, 2, 3, 4, 5, 6], startTime: "08:00", endTime: "23:00",
  minIntervalSeconds: 5, maxIntervalSeconds: 5, timezone: "America/Sao_Paulo", campaignStartAt: "2026-08-10T08:00:00-03:00", enabled: false,
  maxConsecutiveFailures: 5, autoPause: true, followUpsEnabled: true, maxFollowUps: 3, followUpIntervalHours: 48, batchPriority: "priority",
};
const settings = await supabase.from("app_settings").upsert({ owner_id: owner, section: "outreach", values: outreach }, { onConflict: "owner_id,section" });
if (settings.error) throw settings.error;

for (const item of imports) {
  const rows = read(item.file);
  const valid = rows.filter((row) => row.status === "valid" && row.phone);
  const phoneRecords = Object.fromEntries(valid.map((row) => [row.phone!, { originalPhone: row.input }]));
  const batch = {
    name: `2026-08-10-${item.sourceGroup}`,
    source: item.sourceLabel, sourceLabel: item.sourceLabel, sourceGroup: item.sourceGroup, sourceFile: item.sourceFile,
    context: `${item.sourceLabel} — origem de lista/prospecção; não representa confirmação de cargo pelo lead.`, notes: "Importação auditada pelo Codex; OUTREACH_ENABLED permanece false durante o setup.",
    initialStrategy: "", authorized: true, priority: 5, startDate: "2026-08-10", dailyLimit: null, phoneRecords,
  };
  const result = await supabase.rpc("import_lead_batch", { p_owner: owner, batch_input: batch, normalized_phones: [...new Set(valid.map((row) => row.phone!))] });
  if (result.error) throw result.error;
  console.log(JSON.stringify({ sourceGroup: item.sourceGroup, rows: rows.length, valid: valid.length, result: result.data }));
}

console.log(JSON.stringify({ outreach, outreachEnabled: false, messagesSent: 0 }));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
