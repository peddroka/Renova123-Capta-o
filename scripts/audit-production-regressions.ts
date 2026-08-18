import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { resolve } from "node:path";

loadEnv({ path: [resolve(".env.local"), resolve(".env")], override: false, quiet: true });

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.");

const db = createClient(url, key, { auth: { persistSession: false } });
const targets = ["5511992468815", "5511974442893"];

function pick<T extends Record<string, unknown>>(row: T | null | undefined, keys: string[]) {
  if (!row) return null;
  return Object.fromEntries(keys.filter((key) => key in row).map((key) => [key, row[key]]));
}

async function one<T>(promise: PromiseLike<{ data: T; error: unknown }>, label: string): Promise<T> {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${JSON.stringify(error)}`);
  return data;
}

let ownerId = "";

async function auditLead(leadId: string) {
  const lead = await one(db.from("leads").select("*").eq("owner_id", ownerId).eq("id", leadId).maybeSingle(), "lead");
  const phone = String((lead as { phone?: string } | null)?.phone ?? "");
  const [conversation, messages, jobsByLead, jobsByPhone, aiQueue, handoffs, notifications, suppression, takeovers, audits] = await Promise.all([
    one(db.from("conversations").select("*").eq("owner_id", ownerId).eq("lead_id", leadId).maybeSingle(), "conversation"),
    one(db.from("messages").select("id,lead_id,direction,sender_type,origin,content,external_id,status,created_at,sent_at,received_at,idempotency_key,error_message,metadata").eq("owner_id", ownerId).eq("lead_id", leadId).order("created_at"), "messages"),
    one(db.from("jobs").select("id,type,status,payload,available_at,locked_at,locked_by,attempts,max_attempts,last_error,idempotency_key,created_at,completed_at").eq("owner_id", ownerId).eq("payload->>leadId", leadId).order("created_at"), "jobs by lead"),
    phone ? one(db.from("jobs").select("id,type,status,payload,available_at,locked_at,locked_by,attempts,max_attempts,last_error,idempotency_key,created_at,completed_at").eq("owner_id", ownerId).eq("payload->>phone", phone).order("created_at"), "jobs by phone") : Promise.resolve([]),
    one(db.from("ai_response_queue").select("*").eq("owner_id", ownerId).eq("lead_id", leadId).order("created_at"), "ai_response_queue"),
    one(db.from("handoffs").select("*").eq("owner_id", ownerId).eq("lead_id", leadId).order("created_at"), "handoffs"),
    one(db.from("notifications").select("*").eq("owner_id", ownerId).eq("lead_id", leadId).order("created_at"), "notifications"),
    phone ? one(db.from("suppression_list").select("*").eq("owner_id", ownerId).eq("phone", phone), "suppression") : Promise.resolve([]),
    one(db.from("conversation_takeovers").select("*").eq("owner_id", ownerId).eq("lead_id", leadId).order("created_at"), "takeovers"),
    one(db.from("audit_logs").select("id,action,entity_type,entity_id,details,created_at").eq("owner_id", ownerId).eq("entity_id", leadId).order("created_at"), "audits"),
  ]);
  const jobs = [...new Map([...(jobsByLead as Array<{ id: string }>), ...(jobsByPhone as Array<{ id: string }>)].map((job) => [job.id, job])).values()];
  return {
    lead: pick(lead as Record<string, unknown>, ["id", "phone", "name", "company", "stage", "human_active", "automation_paused", "qualified_at", "stalled_at", "last_contact_at", "metadata"]),
    conversation: pick(conversation as Record<string, unknown>, ["id", "status", "stage", "human_active", "takeover_state", "qualification_status", "qualification_score", "handoff_type", "marilia_consent", "summary", "memories", "questions_asked", "first_inbound_at", "last_inbound_at", "last_message_at"]),
    messages,
    jobs,
    aiResponseQueue: aiQueue,
    handoffs,
    notifications,
    suppression,
    takeovers,
    audits,
  };
}

async function main() {
  const owner = await one(db.from("profiles").select("id").eq("role", "admin").order("created_at").limit(1).single(), "owner");
  ownerId = String((owner as { id: string }).id);
  const phraseMessages = await one(db.from("messages")
    .select("id,lead_id,direction,sender_type,content,external_id,status,created_at,sent_at,received_at,idempotency_key")
    .eq("owner_id", ownerId)
    .or("content.ilike.%Campo Grande%,content.ilike.%17:30%,content.ilike.%17h30%")
    .order("created_at", { ascending: true }), "real conversation messages");
  const realLeadIds = [...new Set((phraseMessages as Array<{ lead_id: string }>).map((row) => row.lead_id))];
  const targetLeads = await one(db.from("leads").select("id,phone").eq("owner_id", ownerId).in("phone", targets), "target leads");
  const output: Record<string, unknown> = { realConversationCandidates: {}, targetContacts: {} };
  for (const leadId of realLeadIds) (output.realConversationCandidates as Record<string, unknown>)[leadId] = await auditLead(leadId);
  for (const lead of targetLeads as Array<{ id: string; phone: string }>) (output.targetContacts as Record<string, unknown>)[lead.phone] = await auditLead(lead.id);
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
