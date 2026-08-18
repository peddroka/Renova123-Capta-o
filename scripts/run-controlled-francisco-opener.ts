import { config as loadEnv } from "dotenv";
import { createClient, type PostgrestError } from "@supabase/supabase-js";
import { normalizeBrazilianPhone } from "../packages/core/src/phone.js";
import { materializeOutreachTemplate } from "../apps/worker/src/outbound-text-integrity.js";

loadEnv({ path: ".env.local", quiet: true });

const AUTHORIZED_TEST_PHONE = "5582988543864";

async function main() {
  const action = process.argv[2];
  if (!["--reset-only", "--start"].includes(action ?? "")) throw new Error("Use --reset-only ou --start.");
  const requestedPhone = process.argv[3];
  const normalized = normalizeBrazilianPhone(requestedPhone ?? "");
  if (!normalized.valid || !normalized.normalized) throw new Error(normalized.reason ?? "Telefone inválido.");
  const phone = normalized.normalized;
  if (phone !== AUTHORIZED_TEST_PHONE) throw new Error("Telefone recusado: somente 5582988543864 é autorizado.");

  if (process.env.MOCK_MODE !== "false" || process.env.SIMULATION_MODE !== "false" || process.env.REAL_SENDING_ENABLED !== "true") {
    throw new Error("O ambiente não está em Supabase persistente com envio real habilitado.");
  }
  if (process.env.OUTREACH_ENABLED !== "false" || process.env.OUTREACH_ONLINE_ONLY !== "true" || process.env.OUTREACH_ONLINE_TEST_PHONE !== phone) {
    throw new Error("A proteção de outreach não corresponde ao teste controlado.");
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase persistente não configurado.");
  const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const ownerResult = await db.from("profiles").select("id").eq("role", "admin").order("created_at", { ascending: true }).limit(1).single();
  assertOk(ownerResult.error);
  const ownerId = String(ownerResult.data.id);
  const settingsResult = await db.from("app_settings").select("values").eq("owner_id", ownerId).eq("section", "outreach").single();
  assertOk(settingsResult.error);
  if (settingsResult.data.values?.enabled !== false) throw new Error("A campanha persistida ainda não está pausada.");

  const templateResult = await db.from("message_templates").select("id,name,content,active,use_count,last_used_at")
    .eq("owner_id", ownerId).eq("kind", "initial").eq("active", true)
    .order("use_count", { ascending: true }).order("last_used_at", { ascending: true, nullsFirst: true }).order("created_at", { ascending: true }).limit(1).single();
  assertOk(templateResult.error);

  const existingLead = await db.from("leads").select("id,source,metadata").eq("owner_id", ownerId).eq("phone", phone).maybeSingle();
  assertOk(existingLead.error);
  const sessionId = crypto.randomUUID();
  const resetAt = new Date().toISOString();
  const batchResult = await db.from("lead_batches").insert({
    owner_id: ownerId,
    name: `Conversa controlada Francisco ${resetAt}`.slice(0, 120),
    source: "Contato autorizado",
    context: "Contato isolado operacionalmente; dados de controle não devem entrar no contexto comercial.",
    notes: `Sessão ${sessionId}; campanha real preservada e pausada.`,
    initial_strategy: "",
    authorized: true,
    priority: 10,
    start_date: resetAt.slice(0, 10),
    daily_limit: 1,
    status: "paused",
    total_count: 1,
  }).select("id").single();
  assertOk(batchResult.error);
  const batchId = String(batchResult.data.id);

  let leadId: string;
  let leadSource = "";
  if (existingLead.data) {
    leadId = String(existingLead.data.id);
    leadSource = String(existingLead.data.source ?? "");
    const metadata = { ...(existingLead.data.metadata as Record<string, unknown> ?? {}), conversationResetAt: resetAt, controlledTestSessionId: sessionId };
    for (const key of ["handoffType", "mariliaConsent", "qualificationScore", "qualificationStatus", "professionalCategory"]) delete metadata[key];
    const update = await db.from("leads").update({
      batch_id: batchId,
      stage: "queued",
      automation_paused: false,
      human_active: false,
      approached_at: null,
      initial_outreach_sent_at: null,
      last_contact_at: null,
      consecutive_failures: 0,
      metadata,
    }).eq("owner_id", ownerId).eq("id", leadId);
    assertOk(update.error);
  } else {
    const inserted = await db.from("leads").insert({
      owner_id: ownerId,
      batch_id: batchId,
      phone,
      source: "Contato autorizado",
      stage: "queued",
      metadata: { conversationResetAt: resetAt, controlledTestSessionId: sessionId },
    }).select("id,source").single();
    assertOk(inserted.error);
    leadId = String(inserted.data.id);
    leadSource = String(inserted.data.source ?? "");
  }

  const conversationResult = await db.from("conversations").upsert({
    owner_id: ownerId,
    lead_id: leadId,
    status: "active",
    stage: "engaged",
    human_active: false,
    takeover_state: "ai_active",
    summary: "",
    questions_asked: [],
    materials_sent: [],
    qualification_status: "discovering",
    qualification_score: 0,
    handoff_type: null,
    marilia_consent: "not_asked",
    first_outbound_at: null,
    first_inbound_at: null,
    last_inbound_at: null,
    qualification_deadline_at: null,
    last_message_at: null,
  }, { onConflict: "lead_id" }).select("id").single();
  assertOk(conversationResult.error);
  const conversationId = String(conversationResult.data.id);

  const mutations = await Promise.all([
    db.from("lead_memories").update({ active: false }).eq("owner_id", ownerId).eq("lead_id", leadId).eq("active", true),
    db.from("conversation_memories").update({ active: false }).eq("owner_id", ownerId).eq("lead_id", leadId).eq("active", true),
    db.from("outreach_queue").update({ status: "cancelled", locked_at: null, locked_by: null, last_error: "Substituído por nova sessão controlada." }).eq("owner_id", ownerId).eq("lead_id", leadId).in("status", ["pending", "scheduled", "processing", "retry"]),
    db.from("ai_response_queue").update({ status: "cancelled", locked_at: null, locked_by: null, last_error: "Sessão reiniciada pelo administrador." }).eq("owner_id", ownerId).eq("lead_id", leadId).in("status", ["pending", "scheduled", "processing", "retry"]),
    db.from("follow_up_queue").update({ status: "cancelled", locked_at: null, locked_by: null, last_error: "Sessão reiniciada pelo administrador." }).eq("owner_id", ownerId).eq("lead_id", leadId).in("status", ["pending", "scheduled", "processing", "retry"]),
    db.from("follow_ups").update({ status: "cancelled" }).eq("owner_id", ownerId).eq("lead_id", leadId).in("status", ["scheduled", "processing"]),
    db.from("appointments").update({ status: "cancelled", cancelled_at: resetAt }).eq("owner_id", ownerId).eq("lead_id", leadId).in("status", ["pending", "scheduled"]),
    db.from("handoffs").update({ status: "closed", result: "Sessão anterior encerrada para nova conversa controlada.", closed_at: resetAt }).eq("owner_id", ownerId).eq("lead_id", leadId).in("status", ["pending", "active"]),
    db.from("jobs").update({ status: "cancelled", locked_at: null, locked_by: null, last_error: "Sessão reiniciada pelo administrador." }).eq("owner_id", ownerId).in("status", ["pending", "processing", "failed"]).or(`payload->>phone.eq.${phone},payload->>leadId.eq.${leadId}`),
  ]);
  for (const mutation of mutations) assertOk(mutation.error);

  if (action === "--reset-only") {
    const resetAudit = await db.from("audit_logs").insert({
      owner_id: ownerId,
      actor_id: ownerId,
      action: "conversation.controlled_test_reset",
      entity_type: "lead",
      entity_id: leadId,
      details: { phone, sessionId, resetAt, oldMessagesPreserved: true, campaignCursorPreserved: true, dailyCapReserved: false },
    });
    assertOk(resetAudit.error);
    console.log(JSON.stringify({ action: "reset", normalizedPhone: phone, campaignPaused: true, oldMessagesPreserved: true, conversationResetAt: resetAt, leadId, conversationId, batchId }, null, 2));
    return;
  }

  const member = await db.from("lead_batch_members").insert({ owner_id: ownerId, batch_id: batchId, lead_id: leadId, position: 1, status: "scheduled" });
  assertOk(member.error);
  const text = materializeOutreachTemplate(String(templateResult.data.content), leadSource);
  const availableAt = new Date().toISOString();
  const queueResult = await db.from("jobs").insert({
    owner_id: ownerId,
    type: "outreach",
    status: "pending",
    available_at: availableAt,
    idempotency_key: `controlled-test:${sessionId}`,
    payload: { type: "outreach", leadId, batchId, phone, text, controlledTest: true, newLeadReservation: false, onlineReady: false, testSessionId: sessionId },
  }).select("id,status,available_at").single();
  assertOk(queueResult.error);

  const audit = await db.from("audit_logs").insert({
    owner_id: ownerId,
    actor_id: ownerId,
    action: "conversation.controlled_test_prepared",
    entity_type: "lead",
    entity_id: leadId,
    details: { phoneSuffix: phone.slice(-4), sessionId, resetAt, oldMessagesPreserved: true, campaignCursorPreserved: true, dailyCapReserved: false, queueId: queueResult.data.id },
  });
  assertOk(audit.error);

  console.log(JSON.stringify({
    action: "start",
    phoneInput: requestedPhone,
    normalizedPhone: phone,
    campaignPaused: true,
    oldMessagesPreserved: true,
    conversationResetAt: resetAt,
    leadId,
    conversationId,
    batchId,
    queueId: queueResult.data.id,
    queueStatus: queueResult.data.status,
    selectedTemplate: { id: templateResult.data.id, name: templateResult.data.name },
  }, null, 2));
}

function assertOk(error: PostgrestError | null) {
  if (error) throw error;
}

void main();
