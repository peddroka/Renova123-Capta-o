import type { AgentMaterial } from "./types.js";
export class MaterialRecommendationService {
  recommend(query: string | null, materials: AgentMaterial[], stage: string) {
    if (!query) return null;
    const words = normalize(query).split(/\s+/).filter((word) => word.length > 2);
    const ranked = materials
      .filter((item) => item.active && !item.alreadySent && (!item.allowedStages?.length || item.allowedStages.includes(stage)))
      .map((item) => ({ item, score: words.filter((word) => normalize(`${item.name} ${item.description ?? ""} ${item.category ?? ""} ${item.relatedIntent ?? ""}`).includes(word)).length }))
      .sort((left, right) => right.score - left.score);
    return ranked[0]?.score ? ranked[0].item : null;
  }
}
function normalize(value: string) { return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
