import { describe, expect, it } from "vitest";
import { AgentContextBuilder } from "./agent-context-builder.js";
import type { AgentSnapshot } from "./types.js";

const makeSnapshot = (knowledgeItems: Array<Record<string, unknown>>, overrides: Partial<AgentSnapshot> = {}): AgentSnapshot => ({
  mind: {}, commercial: {}, lead: {}, batch: {}, stage: "engaged", summary: "", messages: [], memories: [], materials: [], availableSlots: [], followUps: [], questionsAsked: [], materialsSent: [], humanActive: false, automationPaused: false, blocked: false, knowledgeItems, ...overrides,
});
const item = (title: string, category: string, content: string, tags: string[]) => ({ title, category, subject: title, content, tags, active: true });

describe("retrieval comportamental do Francisco", () => {
  const knowledge = [
    item("Financeiro — contas", "FINANCEIRO", "Contas a pagar e receber ajudam a acompanhar a rotina financeira.", ["financeiro", "contas", "receber"]),
    item("Estoque — armações", "ESTOQUE", "Estoque em tempo real ajuda a acompanhar armações e giro.", ["estoque", "armações", "giro"]),
    item("Medição pupilar pelo celular", "MEDIÇÃO", "A solução apresenta medição pupilar pelo celular.", ["medição", "pupilar"]),
    item("Objeção — já tenho sistema", "OBJEÇÕES", "Descubra qual limitação ainda existe no sistema atual.", ["objeção", "sistema"]),
    item("Objeção — uso planilha", "OBJEÇÕES", "Use o fato de que a ótica usa planilha sem perguntar de novo.", ["objeção", "planilha"]),
    item("Clientes — histórico", "CLIENTES / CRM", "Cadastro e histórico do cliente incluem prescrições, compras e retornos.", ["cliente", "histórico"]),
    item("Segurança — dúvida desconhecida", "SEGURANÇA", "Se não houver informação confirmada sobre uma integração ou dúvida, reconheça o limite e verifique.", ["segurança", "dúvida", "integração"]),
    item("Financeiro duplicado", "FINANCEIRO", "Contas a pagar e receber ajudam a acompanhar a rotina financeira com visibilidade.", ["financeiro", "contas"]),
  ];

  it("recupera financeiro para pergunta financeira", () => expect(new AgentContextBuilder().build(makeSnapshot(knowledge), "Como acompanho contas e recebimentos?").selected.relevantKnowledge).toEqual(expect.arrayContaining([expect.objectContaining({ category: "FINANCEIRO" })])));
  it("recupera estoque para pergunta de estoque", () => expect(new AgentContextBuilder().build(makeSnapshot(knowledge), "Como vejo o giro das armações no estoque?").selected.relevantKnowledge).toEqual(expect.arrayContaining([expect.objectContaining({ category: "ESTOQUE" })])));
  it("recupera medição para pergunta pupilar", () => expect(new AgentContextBuilder().build(makeSnapshot(knowledge), "Vocês têm medição pupilar?").selected.relevantKnowledge).toEqual(expect.arrayContaining([expect.objectContaining({ category: "MEDIÇÃO" })])));
  it("recupera resposta contextual para já tenho sistema", () => expect(new AgentContextBuilder().build(makeSnapshot(knowledge), "Já tenho sistema").selected.relevantKnowledge).toEqual(expect.arrayContaining([expect.objectContaining({ title: "Objeção — já tenho sistema" })])));
  it("recupera orientação adequada para uso de planilha", () => expect(new AgentContextBuilder().build(makeSnapshot(knowledge), "Uso planilha e caderno").selected.relevantKnowledge).toEqual(expect.arrayContaining([expect.objectContaining({ title: "Objeção — uso planilha" })])));
  it("não injeta conhecimento quando a pergunta é desconhecida", () => expect(new AgentContextBuilder().build(makeSnapshot(knowledge), "zzzxxyy").selected.relevantKnowledge ?? []).toHaveLength(0));
  it("mantém regra de não inventar preço", () => expect(new AgentContextBuilder().build(makeSnapshot(knowledge), "Qual é o preço?").systemPrompt).toContain("não invente preço"));
  it("memória e knowledge permanecem separados", () => { const built = new AgentContextBuilder().build(makeSnapshot(knowledge, { memories: [{ key: "current_system", value: "Planilha", evidenceType: "explicit" }] }), "Uso planilha"); expect(built.selected.memory).toEqual(expect.arrayContaining([expect.objectContaining({ key: "current_system" })])); expect(built.selected.knowledge ?? {}).not.toHaveProperty("current_system"); });
  it("não muda de medição para financeiro sem relação", () => expect(new AgentContextBuilder().build(makeSnapshot(knowledge), "Ainda não uso medição pupilar").selected.relevantKnowledge).not.toEqual(expect.arrayContaining([expect.objectContaining({ category: "FINANCEIRO" })])));
  it("limita o conjunto relevante a poucos itens", () => expect((new AgentContextBuilder().build(makeSnapshot(knowledge), "Como funcionam contas, estoque, clientes e medição?").selected.relevantKnowledge as unknown[]).length).toBeLessThanOrEqual(4));
  it("remove blocos redundantes", () => { const result = new AgentContextBuilder().build(makeSnapshot(knowledge), "contas e recebimentos").selected.relevantKnowledge as Array<Record<string, unknown>>; expect(result.filter((row) => row.category === "FINANCEIRO")).toHaveLength(1); });
  it("recupera limite seguro para dúvida não conhecida", () => expect(new AgentContextBuilder().build(makeSnapshot(knowledge), "Não sei se existe essa integração").selected.relevantKnowledge).toEqual(expect.arrayContaining([expect.objectContaining({ category: "SEGURANÇA" })])));
});
