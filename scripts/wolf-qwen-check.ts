import { buildApp } from "../apps/api/src/app.js";
import { createRepository } from "@renova123/database";

async function main() {
const repository = createRepository({ mock: true, supabaseUrl: undefined, serviceRoleKey: undefined, mockFilePath: null });
const app = await buildApp({ repository });
const auth = { authorization: "Bearer mock-admin-token" };
const call = await app.inject({ method: "POST", url: "/wolf/calls", headers: auth, payload: { leadId: null, direction: "outbound" } });
if (call.statusCode !== 200 && call.statusCode !== 201) throw new Error(`call=${call.statusCode} ${call.body}`);
const callId = call.json().id as string;
const turns = [
  ["operator", "Qual sistema vocês usam hoje?"],
  ["client", "Uso o Sistema X."],
  ["operator", "E o que mais incomoda nele?"],
  ["client", "Minha equipe esquece de acompanhar os clientes."],
  ["operator", "Isso acontece bastante?"],
  ["client", "Quase todo dia."],
] as const;
const suggestions: string[] = [];
for (const [index, [speaker, text]] of turns.entries()) {
  const response = await app.inject({ method: "POST", url: `/wolf/calls/${callId}/turns`, headers: auth, payload: { speaker, text, sequence: index } });
  if (response.statusCode !== 200 && response.statusCode !== 201) throw new Error(`turn=${response.statusCode} ${response.body}`);
  if (speaker === "client") {
    const suggestion = await app.inject({ method: "POST", url: `/wolf/calls/${callId}/suggest`, headers: auth, payload: {} });
    if (suggestion.statusCode !== 200) throw new Error(`suggest=${suggestion.statusCode} ${suggestion.body}`);
    suggestions.push(String(suggestion.json().faleAgora ?? ""));
  }
}
const page = await repository.page("wolfCalls", { page: 1, pageSize: 10 });
const saved = page.rows.find((row) => String(row.id) === callId) as any;
console.log(JSON.stringify({
  context: saved.liveContext,
  suggestions,
  noRepeatedQuestion: suggestions.every((item) => !/qual sistema vocês usam/i.test(item)),
  lastSuggestionRelatedToPain: /acompan|follow|esquec|equipe/i.test(suggestions.at(-1) ?? ""),
}, null, 2));
await app.close();
}
void main();
