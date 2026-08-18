import type { AiDecision } from "@renova123/shared";

export type CapabilityStatus = "CONFIRMED" | "UNCONFIRMED" | "AMBIGUOUS";

export const CONFIRMED_PRODUCT_CATALOG = {
  overview: {
    product: "Sistema de gestão feito para óticas",
    benefit: "Centraliza informações da operação, vendas e gestão da ótica",
    examples: ["estoque em tempo real", "financeiro com contas e fluxo de caixa", "cadastro e histórico de clientes"],
  },
  demo: {
    format: "Reunião online conduzida pelo Pedro, mostrando a tela e os recursos relevantes",
    duration: "Normalmente cerca de 15 a 20 minutos, podendo ser mais rápida conforme o caso",
    purpose: "Entender dúvidas e avaliar o próximo passo com o potencial cliente",
  },
  socialProof: ["Mais de 700 óticas no Brasil", "Mais de 30 óticas em Maceió"],
  budgets: [
    "Criar proposta para cliente cadastrado ou atendimento avulso",
    "Buscar por nome, WhatsApp ou CPF",
    "Adicionar itens de estoque ou personalizados, com descrição, quantidade, valor unitário e desconto",
    "Aplicar descontos por item e no total, definir validade e registrar observações ou condições",
    "Revisar subtotal, desconto e total antes de salvar",
    "Visualizar ou baixar PDF, enviar pelo WhatsApp e consultar o histórico recente",
  ],
  explicitlyNotConfirmed: ["follow-up automático de orçamento", "lembretes automáticos de orçamento", "30% de resultado", "implantação em 5 minutos"],
} as const;

export const APPROVED_SOCIAL_PROOF = [
  { scope: "country", country: "Brasil", claim: "Mais de 700 óticas no Brasil" },
  { scope: "city", country: "Brasil", state: "Alagoas", city: "Maceió", claim: "Mais de 30 óticas em Maceió" },
] as const;

export function capabilityStatus(item: Record<string, unknown>): CapabilityStatus {
  const tags = normalize(Array.isArray(item.tags) ? item.tags.join(" ") : String(item.tags ?? ""));
  if (tags.includes("capability confirmed")) return "CONFIRMED";
  if (tags.includes("capability unconfirmed")) return "UNCONFIRMED";
  return "AMBIGUOUS";
}

export function enforceProductGrounding(decision: AiDecision): AiDecision {
  const reply = decision.replyText;
  if (!reply) return decision;
  const normalized = normalize(reply);
  const unsupportedBudgetAutomation = /(?:follow up|retorno|lembrete|cobranca|chama)[a-z ]{0,35}automatic/.test(normalized) && /orcamento/.test(normalized);
  const unsupportedMetric = (/\b30\s*(?:%|por cento)\b|\b30\b[^.!?]{0,20}\b(?:mais|ganho|aumento|conversao|resultado)\b/.test(normalized) && !/\b30\b[^.!?]{0,35}\bmaceio\b/.test(normalized)) || /\b5\s*minut/.test(normalized);
  const unsupportedCapability = /simulador de lentes/.test(normalized);
  const wrongGeography = /(?:30|trinta)[^.!?]{0,35}alagoas/.test(normalized);
  if (!unsupportedBudgetAutomation && !unsupportedMetric && !unsupportedCapability && !wrongGeography) return decision;
  return {
    ...decision,
    ...(unsupportedBudgetAutomation ? { shouldHandoff: false, shouldProposeDemo: false, handoffType: null } : {}),
    replyText: "No Renova123, essa parte é organizada dentro do sistema e o Pedro consegue te mostrar como funciona na demonstração.",
  };
}

function normalize(value: string) {
  return value.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
