/* global console */
import fs from "node:fs";
import path from "node:path";

const directory = path.resolve("supabase/migrations");
const files = fs.readdirSync(directory).filter((file) => file.endsWith(".sql")).sort();
if (!files.length) throw new Error("Nenhuma migration encontrada.");
let previous = "";
let combined = "";
for (const file of files) {
  if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(file)) throw new Error(`Nome de migration inválido: ${file}`);
  if (file <= previous) throw new Error(`Ordem inválida: ${file}`);
  const sql = fs.readFileSync(path.join(directory, file), "utf8");
  if (!/\bbegin;[\s\S]*\bcommit;/i.test(sql)) throw new Error(`${file} deve ser transacional.`);
  if (/service_role_key|groq_api_key|authentication_api_key\s*=\s*[^$\s]/i.test(sql)) throw new Error(`${file} parece conter segredo.`);
  combined += `\n${sql}`;
  previous = file;
}

const requiredTables = [
  "app_settings", "system_secrets_metadata", "agent_profiles", "agent_instructions", "knowledge_items", "knowledge_files",
  "message_templates", "materials", "lead_batches", "leads", "lead_batch_members", "lead_events", "conversations", "messages",
  "conversation_memories", "outreach_queue", "ai_response_queue", "follow_up_queue", "appointments", "availability_rules",
  "availability_blocks", "handoffs", "suppression_list", "daily_usage", "integration_connections", "integration_events",
  "worker_heartbeats", "audit_logs", "failed_jobs",
];
for (const table of requiredTables) if (!new RegExp(`create\\s+table\\s+public\\.${table}\\b`, "i").test(combined)) throw new Error(`Tabela obrigatória ausente: ${table}`);
for (const queue of ["outreach_queue", "ai_response_queue", "follow_up_queue"]) {
  if (!new RegExp(`alter\\s+table\\s+public\\.${queue}\\s+enable\\s+row\\s+level\\s+security`, "i").test(combined) && !/foreach[\s\S]*enable row level security/i.test(combined)) throw new Error(`RLS ausente na fila ${queue}.`);
}
if (!/for\s+update\s+skip\s+locked/i.test(combined)) throw new Error("Claim transacional precisa usar FOR UPDATE SKIP LOCKED.");
if (!/deduplication_key/i.test(combined) || !/idempotency_key/i.test(combined)) throw new Error("Constraints de deduplicação/idempotência ausentes.");
for (const bucket of ["materials", "knowledge", "message-media", "temporary"]) if (!combined.includes(`'${bucket}'`)) throw new Error(`Bucket obrigatório ausente: ${bucket}`);
console.log(`${files.length} migrations validadas: ordem, schema, RLS, filas, idempotência e Storage.`);
