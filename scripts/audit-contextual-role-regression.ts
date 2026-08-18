import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { resolve } from "node:path";

loadEnv({ path: [resolve(".env.local"), resolve(".env")], override: false, quiet: true });
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Configuração Supabase ausente.");
const db = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const inbound = await db.from("messages").select("lead_id,content,external_id,created_at").eq("direction", "inbound").ilike("content", "%sou eu%").order("created_at", { ascending: false }).limit(30);
  if (inbound.error) throw inbound.error;
  const candidates = (inbound.data ?? []).filter((row) => /boa\s+tarde[,.! ]+sou\s+eu/i.test(row.content));
  const output = [];
  for (const candidate of candidates) {
    const [lead, conversation, memories, messages, jobs, audits] = await Promise.all([
      db.from("leads").select("id,phone,stage,human_active,automation_paused,metadata").eq("id", candidate.lead_id).single(),
      db.from("conversations").select("id,status,stage,qualification_status,qualification_score,marilia_consent,questions_asked,summary").eq("lead_id", candidate.lead_id).maybeSingle(),
      db.from("lead_memories").select("key,value,evidence_type,confidence,created_at,updated_at").eq("lead_id", candidate.lead_id).order("created_at"),
      db.from("messages").select("direction,sender_type,content,external_id,status,created_at,sent_at,received_at,idempotency_key").eq("lead_id", candidate.lead_id).order("created_at"),
      db.from("jobs").select("id,type,status,payload,last_error,created_at,completed_at").or(`payload->>leadId.eq.${candidate.lead_id},payload->>messageId.eq.${candidate.external_id}`).order("created_at"),
      db.from("audit_logs").select("action,details,created_at").eq("entity_id", candidate.lead_id).in("action", ["agent.reply.pipeline", "message.inbound.saved", "message.sent", "inbound.latency"]).order("created_at"),
    ]);
    for (const result of [lead, conversation, memories, messages, jobs, audits]) if (result.error) throw result.error;
    output.push({ candidate, lead: lead.data, conversation: conversation.data, memories: memories.data, messages: messages.data, jobs: jobs.data, audits: audits.data });
  }
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
