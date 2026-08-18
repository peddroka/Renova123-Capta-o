import type { AgentMemory } from "./types.js";

const allowed = new Set([
  "informed_name", "store_name", "store_count", "city", "current_system", "current_system_type", "current_process",
  "main_pain", "relevant_secondary_pain", "impact", "decision_maker", "professional_category", "interest",
  "interest_signals", "irritation_signals", "objections", "urgency", "budget", "preferred_tone", "current_topic",
  "answered_questions", "asked_topics", "last_useful_question", "sent_materials", "availability", "demo_status",
  "demo_discussed", "demo_accepted", "marilia_explained", "loss_reason", "next_action", "consents", "relevant_facts",
]);

export class ConversationMemoryService {
  select(memories: AgentMemory[], max = 48) {
    return memories
      .filter((item) => allowed.has(item.key) && item.value.trim())
      .sort((a, b) => evidenceWeight(b.evidenceType) - evidenceWeight(a.evidenceType))
      .slice(0, max)
      .map((item) => ({ ...item, evidenceType: item.evidenceType ?? "explicit", confidence: item.confidence ?? 1 }));
  }

  merge(current: AgentMemory[], updates: AgentMemory[]) {
    const merged = new Map(current.map((item) => [item.key, item]));
    for (const item of updates) {
      if (!allowed.has(item.key) || !item.value.trim()) continue;
      const prior = merged.get(item.key);
      // Facts are durable. Keep prior evidence when a weak model update arrives.
      if (prior && evidenceWeight(item.evidenceType) < evidenceWeight(prior.evidenceType)) continue;
      merged.set(item.key, { ...item, evidenceType: item.evidenceType ?? "explicit", confidence: item.confidence ?? 1 });
    }
    return [...merged.values()];
  }

  rollingSummary(previous: string, memories: AgentMemory[], stage: string, consent?: string, nextAction?: string) {
    const facts = this.select(memories, 48).map((item) => `${item.key}=${item.value}`).join("; ");
    const prior = previous.replace(/Resumo anterior:\s*/gi, "").replace(/Fatos comerciais:\s*[^.]+\./gi, "").replace(/\s{2,}/g, " ").trim();
    return [
      prior ? `Histórico relevante: ${prior}.` : "Histórico relevante: ainda não registrado.",
      `Fatos comerciais: ${facts || "ainda não registrados"}.`,
      `Estágio: ${stage}.`,
      consent ? `Consentimento de encaminhamento comercial: ${consent}.` : "",
      nextAction ? `Próximo passo: ${nextAction}.` : "",
    ].filter(Boolean).join(" ").slice(0, 5_000);
  }
}

function evidenceWeight(value?: AgentMemory["evidenceType"]) {
  return value === "explicit" ? 3 : value === "inference" ? 2 : 1;
}
