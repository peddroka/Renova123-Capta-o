import { config as loadEnv } from "dotenv";
import { AgentContextBuilder } from "../packages/core/src/agent/agent-context-builder.js";
import type { AgentSnapshot } from "../packages/core/src/agent/types.js";
import { aiDecisionJsonSchema, providerDecisionJsonSchema } from "../packages/integrations/src/ai-decision.js";

loadEnv({ path: ".env.local", quiet: true });

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.");
const headers = { apikey: key, authorization: `Bearer ${key}` };

async function rows(table: string, query: string) {
  const response = await fetch(`${url}/rest/v1/${table}?${query}`, { headers });
  if (!response.ok) throw new Error(`${table}: ${response.status} ${await response.text()}`);
  return await response.json() as Array<Record<string, any>>;
}

async function main() {
const phone = process.argv[2] ?? "5582988543864";
const [lead] = await rows("leads", `select=*&phone=eq.${phone}&limit=1`);
if (!lead) throw new Error(`Lead ${phone} não encontrado.`);
const [settings, messages, memories, knowledge, conversations, materials, batches] = await Promise.all([
  rows("system_settings", "select=section,values&section=in.(mind,commercial)"),
  rows("messages", `select=direction,sender_type,content,external_id,created_at&lead_id=eq.${lead.id}&order=created_at.asc`),
  rows("lead_memories", `select=key,value,evidence_type,confidence,created_at&lead_id=eq.${lead.id}&active=eq.true&order=created_at.asc`),
  rows("knowledge_items", "select=title,category,subject,tags,stages,source,content,active&active=eq.true&archived_at=is.null&limit=100"),
  rows("conversations", `select=*&lead_id=eq.${lead.id}&limit=1`),
  rows("materials", "select=id,name,description,category,instruction,active,allowed_stages,related_intent&active=eq.true"),
  lead.batch_id ? rows("lead_batches", `select=*&id=eq.${lead.batch_id}&limit=1`) : Promise.resolve([]),
]);
const setting = (section: string) => settings.find((item) => item.section === section)?.values ?? {};
const conversation = conversations[0] ?? {};

const scenarios = [
  { id: "A", turn: "Oi, sou eu\nComo posso ajudar?", last: "Como posso ajudar?", stage: "contacted", before: { input: 3469, output: 696, contextEstimate: 3827, generations: 1 } },
  { id: "B", turn: "Opa\nPapel e caneta kkkkkkkk", last: "Papel e caneta kkkkkkkk", stage: "qualifying", before: { input: 3422, output: 729, contextEstimate: 3766, generations: 1 } },
  { id: "C", turn: "Já pensei, mas ainda não encontro um bacana\nE a maioria é caro", last: "E a maioria é caro", stage: "qualifying", before: { input: 4863, output: 1277, contextEstimate: 4096, generations: 2 } },
  { id: "D", turn: "Cadastro de clientes\nProdutos\nTem medidor de DP?", last: "Tem medidor de DP?", stage: "qualifying", before: { input: 4147, output: 605, contextEstimate: 4532, generations: 2 } },
  { id: "E", turn: "Gostaria", last: "Gostaria", stage: "engaged", before: null },
] as const;

const estimate = (value: string) => Math.max(value ? 1 : 0, Math.ceil(value.length / 4));
const legacySchemaTokens = estimate(JSON.stringify(aiDecisionJsonSchema));
const compactSchemaTokens = estimate(JSON.stringify(providerDecisionJsonSchema));
const profiles = scenarios.map((scenario) => {
  const cutoffIndex = messages.findIndex((message) => message.direction === "inbound" && message.content === scenario.last);
  if (cutoffIndex < 0) throw new Error(`Turno ${scenario.id} não encontrado.`);
  const cutoff = messages[cutoffIndex]!.created_at as string;
  const history = messages.slice(0, cutoffIndex + 1).map((message) => ({ role: message.sender_type === "lead" ? "lead" as const : message.sender_type === "human" ? "human" as const : "agent" as const, text: String(message.content), createdAt: String(message.created_at) }));
  const snapshot: AgentSnapshot = {
    mind: setting("mind"), commercial: { ...setting("mind"), ...setting("commercial") }, knowledgeItems: knowledge,
    lead: { ...lead, qualificationStatus: scenario.id === "D" || scenario.id === "E" ? "discovering" : "discovering", qualificationScore: scenario.id === "E" ? 25 : 0 }, batch: batches[0] ?? {},
    stage: scenario.stage, summary: scenario.id === "A" || scenario.id === "B" ? "" : String(conversation.summary ?? ""), messages: history,
    memories: memories.filter((memory) => String(memory.created_at) <= cutoff).map((memory) => ({ key: String(memory.key), value: String(memory.value), evidenceType: memory.evidence_type, confidence: Number(memory.confidence ?? 1) })),
    materials: materials.map((material) => ({ id: String(material.id), name: String(material.name), description: String(material.description ?? ""), category: String(material.category ?? ""), instruction: String(material.instruction ?? ""), active: true, allowedStages: material.allowed_stages ?? [], relatedIntent: material.related_intent ?? null })),
    availableSlots: [], followUps: [], questionsAsked: conversation.questions_asked ?? [], materialsSent: conversation.materials_sent ?? [],
    humanActive: false, automationPaused: false, blocked: false, qualificationStatus: "discovering", qualificationScore: scenario.id === "E" ? 25 : 0, handoffType: null, mariliaConsent: "not_asked",
  };
  const built = new AgentContextBuilder().build(snapshot, scenario.turn);
  const inputEstimate = built.tokenBreakdown.systemTokens + built.tokenBreakdown.currentTurnTokens + compactSchemaTokens;
  return {
    case: scenario.id,
    turn: scenario.turn,
    before: scenario.before,
    afterEstimated: { ...built.tokenBreakdown, schemaTokens: compactSchemaTokens, totalInputTokens: inputEstimate, currentTurnOccurrencesInSystem: built.systemPrompt.split(scenario.turn).length - 1, selectedKnowledge: ((built.selected.relevantKnowledge as Array<Record<string, unknown>> | undefined) ?? []).map((item) => item.title) },
    estimatedReductionPercent: scenario.before ? Number(((1 - inputEstimate / scenario.before.input) * 100).toFixed(1)) : null,
  };
});

console.log(JSON.stringify({ measuredAt: new Date().toISOString(), phoneSuffix: phone.slice(-4), schema: { legacyTokensEstimated: legacySchemaTokens, compactTokensEstimated: compactSchemaTokens, reductionPercent: Number(((1 - compactSchemaTokens / legacySchemaTokens) * 100).toFixed(1)) }, profiles }, null, 2));
}

void main();
