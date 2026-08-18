import { config as loadEnv } from "dotenv";
import { AgentContextBuilder } from "../packages/core/src/agent/agent-context-builder.js";
import type { AgentSnapshot } from "../packages/core/src/agent/types.js";
import { GeminiProvider } from "../packages/integrations/src/gemini.js";
import { GroqProvider } from "../packages/integrations/src/groq.js";

loadEnv({ path: ".env.local", quiet: true });

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("Supabase não configurado.");
const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };
async function rows(table: string, query: string) {
  const response = await fetch(`${url}/rest/v1/${table}?${query}`, { headers });
  if (!response.ok) throw new Error(`${table}: ${response.status}`);
  return await response.json() as Array<Record<string, any>>;
}

async function main() {
  const requestedProvider = process.argv[2];
  if (requestedProvider && !["groq", "gemini"].includes(requestedProvider)) throw new Error("Use groq ou gemini.");
  const [settings, knowledge] = await Promise.all([
    rows("system_settings", "select=section,values&section=in.(mind,commercial)"),
    rows("knowledge_items", "select=title,category,subject,tags,stages,source,content,active&active=eq.true&archived_at=is.null&limit=100"),
  ]);
  const setting = (section: string) => settings.find((item) => item.section === section)?.values ?? {};
  const base = (messages: AgentSnapshot["messages"], memories: AgentSnapshot["memories"] = []): AgentSnapshot => ({
    mind: setting("mind"), commercial: { ...setting("mind"), ...setting("commercial") }, knowledgeItems: knowledge,
    lead: {}, batch: {}, stage: "qualifying", summary: "", messages, memories, materials: [], availableSlots: [], followUps: [], questionsAsked: [], materialsSent: [],
    humanActive: false, automationPaused: false, blocked: false, qualificationStatus: "discovering", qualificationScore: 0, handoffType: null, mariliaConsent: "not_asked",
  });
  const cases = [
    { provider: "groq" as const, model: process.env.GROQ_MODEL!, userMessage: "Oi, sou eu\nComo posso ajudar?", snapshot: base([{ role: "agent", text: "Tudo bem? Você é o responsável pela ótica?" }, { role: "lead", text: "Oi, sou eu" }, { role: "lead", text: "Como posso ajudar?" }]) },
    { provider: "gemini" as const, model: process.env.GEMINI_MODEL!, userMessage: "Cadastro de clientes\nProdutos\nTem medidor de DP?", snapshot: base([{ role: "agent", text: "Quais funcionalidades são indispensáveis para sua ótica?" }, { role: "lead", text: "Cadastro de clientes" }, { role: "lead", text: "Produtos" }, { role: "lead", text: "Tem medidor de DP?" }], [{ key: "current_system", value: "papel e caneta", evidenceType: "explicit", confidence: 1 }, { key: "objections", value: "price", evidenceType: "explicit", confidence: 1 }]) },
  ];
  const output = [];
  for (const item of cases.filter((candidate) => !requestedProvider || candidate.provider === requestedProvider)) {
    const built = new AgentContextBuilder().build(item.snapshot, item.userMessage);
    const provider = item.provider === "groq"
      ? new GroqProvider({ apiKey: process.env.GROQ_API_KEY })
      : new GeminiProvider({ apiKey: process.env.GEMINI_API_KEY, model: item.model });
    try {
      const result = await provider.generateStructuredResponse({ systemPrompt: built.systemPrompt, userMessage: item.userMessage, model: item.model, temperature: 0.3 });
      output.push({ provider: item.provider, model: item.model, success: true, ...result.metrics, reply: result.decision.replyText, selectedKnowledge: ((built.selected.relevantKnowledge as Array<Record<string, unknown>> | undefined) ?? []).map((entry) => entry.title) });
    } catch (error) {
      output.push({ provider: item.provider, model: item.model, success: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  console.log(JSON.stringify(output, null, 2));
}

void main();
