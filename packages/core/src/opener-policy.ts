const ROLE_WORDS = ["dono", "responsavel", "gestao", "operacao"];
const EARLY_PITCH_WORDS = ["francisco", "renova123", "automacao", "ia", "clientes", "vendas", "agendamento", "prospeccao"];

function plain(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function isHumanAttentionOpener(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.includes("\n\n") || !trimmed.endsWith("?")) return false;
  const normalized = plain(trimmed);
  return ROLE_WORDS.some((word) => normalized.includes(word))
    && EARLY_PITCH_WORDS.every((word) => !normalized.includes(word));
}
