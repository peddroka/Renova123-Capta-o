export class KnowledgeService {
  select(mind: Record<string, unknown>, commercial: Record<string, unknown>, userMessage: string, maxCharacters = 8_000) {
    const query = normalize(userMessage);
    const priority = ["companyDescription", "productDescription", "targetAudience", "benefits", "features", "differentiators", "prices", "plans", "implementation", "freeTrial", "multiStoreDiscount", "referralProgram", "validity", "commercialTerms", "exceptions", "authorizationRequired", "objections", "approvedAnswers", "faq"];
    const rows = priority.flatMap((key) => {
      const value = commercial[key] ?? mind[key];
      if (value === undefined || value === null || value === "") return [];
      const text = typeof value === "string" ? value : JSON.stringify(value);
      const relevance = scoreText(`${key} ${text}`, query, keywords(key));
      if (relevance === 0) return [];
      return [{ key, value: text.slice(0, 3000), relevance }];
    }).sort((a, b) => b.relevance - a.relevance || priority.indexOf(a.key) - priority.indexOf(b.key)).slice(0, 4);
    let used = 0;
    return Object.fromEntries(rows.filter((row) => { if (used + row.value.length > maxCharacters) return false; used += row.value.length; return true; }).map((row) => [row.key, row.value]));
  }
}
function normalize(value: string) { return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
function scoreText(text: string, query: string, aliases: string[]) {
  const normalizedText = normalize(text);
  const terms = query.split(/\s+/).filter((term) => term.length >= 4);
  const termHits = terms.filter((term) => normalizedText.includes(term)).length;
  const aliasHit = aliases.some((alias) => query.includes(alias) || normalizedText.includes(alias) && terms.some((term) => alias.includes(term)));
  return termHits + (aliasHit ? 3 : 0);
}
function keywords(key: string) {
  const map: Record<string, string[]> = {
    companyDescription: ["renova123", "empresa", "atende", "otica"], targetAudience: ["dono", "gestor", "responsavel", "otica"],
    productDescription: ["produto", "sistema", "funciona"], benefits: ["beneficio", "ajuda", "ganho"], features: ["recurso", "funcionalidade", "modulo"], differentiators: ["diferencial", "especializado"],
    prices: ["preco", "valor", "custa", "mensalidade"], plans: ["plano"], implementation: ["implantacao", "configuracao", "treinamento"], freeTrial: ["teste", "gratuita", "demonstracao"],
    multiStoreDiscount: ["lojas", "unidades", "multiloja", "desconto"], referralProgram: ["indicacao", "indicar"], validity: ["validade", "atualizado"], commercialTerms: ["condicao", "pagamento", "prazo"],
    exceptions: ["integracao", "migracao", "fiscal"], authorizationRequired: ["confirmar", "responsavel", "tecnico"], objections: ["caro", "duvida", "receio", "nao quero"], approvedAnswers: ["objecao", "responder"], faq: ["como", "funciona", "integra"]
  }; return map[key] ?? [];
}
