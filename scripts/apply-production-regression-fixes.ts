import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { resolve } from "node:path";
import { formatHumanQualifiedGroupMessage, groupNotificationDedupKey } from "@renova123/core";

loadEnv({ path: [resolve(".env.local"), resolve(".env")], override: false, quiet: true });

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Configuração Supabase ausente.");

const apply = process.argv.includes("--apply");
const db = createClient(url, key, { auth: { persistSession: false } });
const qualifiedLeadId = "340d96f3-54ca-4de6-be20-27330c73102c";
const roleLeadId = "3e91dae6-f6c6-4e6c-903d-f2a77a8dcc6c";
const qualifiedInboundId = "AC8736D63088EA08BC5AD138F8533FC5";
const roleInboundId = "ACA0485541627114B7CC319AE7077210";

async function must<T>(promise: PromiseLike<{ data: T; error: unknown }>, label: string): Promise<T> {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${JSON.stringify(error)}`);
  return data;
}

async function upsertMemories(ownerId: string, leadId: string, conversationId: string, memories: Array<{ key: string; value: string; confidence: number }>) {
  await must(db.from("lead_memories").upsert(memories.map((memory) => ({ owner_id: ownerId, lead_id: leadId, ...memory, source: "ai", evidence_type: "explicit", active: true })), { onConflict: "lead_id,key" }), "lead memories");
  await must(db.from("conversation_memories").upsert(memories.map((memory) => ({ owner_id: ownerId, lead_id: leadId, conversation_id: conversationId, ...memory, source: "system", evidence_type: "explicit", active: true })), { onConflict: "conversation_id,key" }), "conversation memories");
}

async function main() {
  const owner = await must(db.from("profiles").select("id").eq("role", "admin").order("created_at").limit(1).single(), "owner");
  const ownerId = String((owner as { id: string }).id);
  const [qualifiedLead, qualifiedConversation, qualifiedInbound, roleLead, roleConversation, roleInbound] = await Promise.all([
    must(db.from("leads").select("id,phone,name,company,stage,human_active,automation_paused,metadata").eq("owner_id", ownerId).eq("id", qualifiedLeadId).single(), "qualified lead"),
    must(db.from("conversations").select("id,qualification_status,marilia_consent,handoff_type").eq("owner_id", ownerId).eq("lead_id", qualifiedLeadId).single(), "qualified conversation"),
    must(db.from("messages").select("external_id,direction,content").eq("owner_id", ownerId).eq("lead_id", qualifiedLeadId).eq("external_id", qualifiedInboundId).single(), "qualified inbound"),
    must(db.from("leads").select("id,phone,metadata").eq("owner_id", ownerId).eq("id", roleLeadId).single(), "role lead"),
    must(db.from("conversations").select("id").eq("owner_id", ownerId).eq("lead_id", roleLeadId).single(), "role conversation"),
    must(db.from("messages").select("external_id,direction,content").eq("owner_id", ownerId).eq("lead_id", roleLeadId).eq("external_id", roleInboundId).single(), "role inbound"),
  ]);

  const qLead = qualifiedLead as Record<string, unknown>;
  const qConversation = qualifiedConversation as Record<string, unknown>;
  const qInbound = qualifiedInbound as Record<string, unknown>;
  const rLead = roleLead as Record<string, unknown>;
  const rConversation = roleConversation as Record<string, unknown>;
  const rInbound = roleInbound as Record<string, unknown>;
  if (qInbound.direction !== "inbound" || !/17:30.*campo\s+grande.*1h.*bras[ií]lia/i.test(String(qInbound.content))) throw new Error("A mensagem real de disponibilidade não corresponde ao caso auditado.");
  if (rInbound.direction !== "inbound" || !/boa\s+tarde[!. ]+sou\s+eu/i.test(String(rInbound.content))) throw new Error("A mensagem real de identidade não corresponde ao caso auditado.");
  if (qLead.human_active || qLead.automation_paused) throw new Error("O lead qualificado entrou em atendimento humano; correção interrompida.");

  const schedule = "Horário solicitado: 17:30 em Campo Grande/MS (UTC-4), equivalente a 18:30 em Brasília (UTC-3); ainda não confirmado.";
  const qualifiedMemories = [
    { key: "decision_maker", value: "É dono ou responsável pela ótica", confidence: 1 },
    { key: "professional_category", value: "owner_responsible", confidence: 1 },
    { key: "current_process", value: "Pega o contato, anota e chama no WhatsApp para conversar; ele mesmo faz a qualificação", confidence: 1 },
    { key: "main_pain", value: "O processo manual de atendimento e qualificação toma muito tempo", confidence: 1 },
    { key: "current_system_type", value: "manual", confidence: 1 },
    { key: "interest", value: "Aceitou ver uma demonstração do Renova123", confidence: 1 },
    { key: "demo_accepted", value: "sim", confidence: 1 },
    { key: "demo_status", value: "solicitada; aguardando confirmação da Marília", confidence: 1 },
    { key: "availability", value: schedule, confidence: 1 },
    { key: "city", value: "Campo Grande/MS", confidence: 1 },
    { key: "next_action", value: "Marília validar a disponibilidade e confirmar a demonstração no horário solicitado", confidence: 1 },
  ];
  const roleMemories = [
    { key: "decision_maker", value: "É dono ou responsável pela ótica", confidence: 1 },
    { key: "professional_category", value: "owner_responsible", confidence: 1 },
    { key: "answered_questions", value: "função de dono ou responsável", confidence: 1 },
  ];

  const dedupKey = groupNotificationDedupKey("lead_interested", qualifiedLeadId);
  const [existingHandoffs, existingNotification] = await Promise.all([
    must(db.from("handoffs").select("id,status,handoff_type").eq("owner_id", ownerId).eq("lead_id", qualifiedLeadId).order("created_at"), "existing handoffs"),
    must(db.from("notifications").select("id,delivery_status,dedup_key").eq("owner_id", ownerId).eq("dedup_key", dedupKey).maybeSingle(), "existing notification"),
  ]);
  const preview = { apply, qualifiedLeadId, roleLeadId, existingHandoffs, existingNotification, schedule };
  if (!apply) {
    console.log(JSON.stringify(preview, null, 2));
    return;
  }

  await upsertMemories(ownerId, qualifiedLeadId, String(qConversation.id), qualifiedMemories);
  const now = new Date().toISOString();
  const qMetadata = qLead.metadata && typeof qLead.metadata === "object" ? { ...(qLead.metadata as Record<string, unknown>) } : {};
  Object.assign(qMetadata, { qualificationStatus: "qualified", qualificationScore: 100, handoffType: "sales_qualified", mariliaConsent: "granted", professionalCategory: "owner_responsible" });
  await must(db.from("conversations").update({ stage: "handoff", qualification_status: "qualified", qualification_score: 100, handoff_type: "sales_qualified", marilia_consent: "granted", qualification_updated_at: now }).eq("owner_id", ownerId).eq("id", qConversation.id), "qualified conversation update");
  await must(db.from("leads").update({ stage: "handoff", qualified_at: now, human_active: false, automation_paused: false, metadata: qMetadata }).eq("owner_id", ownerId).eq("id", qualifiedLeadId), "qualified lead update");
  if (!(existingHandoffs as Array<unknown>).length) {
    await must(db.from("handoffs").insert({ owner_id: ownerId, lead_id: qualifiedLeadId, reason: `Lead aceitou demonstração. ${schedule}`, status: "pending", handoff_type: "sales_qualified" }), "qualified handoff");
  }

  let notificationId = String((existingNotification as Record<string, unknown> | null)?.id ?? "");
  if (!notificationId) {
    const body = formatHumanQualifiedGroupMessage({
      name: qLead.name,
      phone: qLead.phone,
      company: qLead.company,
      region: "Campo Grande/MS",
      context: `Responsável pela ótica. Faz manualmente o atendimento e a qualificação: pega o contato, anota e chama no WhatsApp. Relatou que isso toma muito tempo. ${schedule}`,
      mainInterest: "Conhecer o Renova123 em uma demonstração para automatizar o processo manual.",
      nextStep: `Marília validar a disponibilidade e confirmar a demonstração. ${schedule}`,
    });
    const notification = await must(db.from("notifications").insert({ owner_id: ownerId, type: "lead_interested", level: "info", title: "Lead qualificado para Marília", body, lead_id: qualifiedLeadId, conversation_id: qConversation.id, dedup_key: dedupKey, delivery_payload: { requestedLocalTime: "17:30", requestedTimezone: "America/Campo_Grande", brasiliaTime: "18:30", confirmed: false } }).select("id").single(), "qualified notification");
    notificationId = String((notification as { id: string }).id);
  }
  const notificationStatus = String((existingNotification as Record<string, unknown> | null)?.delivery_status ?? "pending");
  if (notificationId && notificationStatus !== "sent") {
    const jobKey = `group-notification:${dedupKey}`;
    const existingJob = await must(db.from("jobs").select("id,status").eq("owner_id", ownerId).eq("idempotency_key", jobKey).maybeSingle(), "existing group delivery job");
    if (!existingJob) await must(db.from("jobs").insert({ owner_id: ownerId, type: "maintenance", payload: { action: "deliver_group_notification", notificationId }, status: "pending", available_at: now, idempotency_key: jobKey }), "group delivery job");
  }

  await upsertMemories(ownerId, roleLeadId, String(rConversation.id), roleMemories);
  const rMetadata = rLead.metadata && typeof rLead.metadata === "object" ? { ...(rLead.metadata as Record<string, unknown>) } : {};
  rMetadata.professionalCategory = "owner_responsible";
  await must(db.from("leads").update({ metadata: rMetadata }).eq("owner_id", ownerId).eq("id", roleLeadId), "role lead update");

  await must(db.from("audit_logs").insert([
    { owner_id: ownerId, action: "production.regression.corrected", entity_type: "lead", entity_id: qualifiedLeadId, lead_id: qualifiedLeadId, conversation_id: qConversation.id, level: "info", service: "maintenance", details: { regression: "qualified_timezone_handoff", sourceMessageId: qualifiedInboundId, noLeadMessageSent: true } },
    { owner_id: ownerId, action: "production.regression.corrected", entity_type: "lead", entity_id: roleLeadId, lead_id: roleLeadId, conversation_id: rConversation.id, level: "info", service: "maintenance", details: { regression: "contextual_identity_with_social_opening", sourceMessageId: roleInboundId, noLeadMessageSent: true } },
  ]), "correction audit");

  console.log(JSON.stringify({ ...preview, applied: true, notificationId }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
