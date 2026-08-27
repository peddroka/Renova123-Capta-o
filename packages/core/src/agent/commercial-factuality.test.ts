import { describe, expect, it } from "vitest";
import type { AiDecision } from "@renova123/shared";
import { enforceCommercialFactuality } from "./commercial-factuality.js";
import { CONFIRMED_PRODUCT_CATALOG, enforceProductGrounding } from "./product-grounding.js";

const decision = (replyText: string): AiDecision => ({ replyText, leadStage: "engaged", detectedIntent: "information", sentiment: "neutral", summaryUpdate: null, memoryUpdates: [], questionsAnswered: [], objectionsDetected: [], shouldSendMaterial: false, materialQuery: null, shouldProposeDemo: false, suggestedSlots: [], shouldScheduleDemo: false, appointmentData: null, shouldHandoff: false, handoffReason: null, shouldOptOut: false, followUpAction: { action: "none", delayHours: null, reason: "aguardar" }, confidence: .9, internalReasoningSummary: "teste", qualificationStatus: "discovering", handoffType: null, qualificationScore: 0, mariliaConsent: "not_asked" });

describe("factualidade comercial", () => {
  it("remove percentual não presente no contexto", () => expect(enforceCommercialFactuality(decision("reduzindo o tempo em até 70%"), {}).replyText).not.toMatch(/70%/));
  it("preserva percentual explicitamente cadastrado", () => expect(enforceCommercialFactuality(decision("reduzindo o tempo em até 70%"), { approvedMetric: "70%" }).replyText).toContain("70%"));
  it("remove duração quando a demonstração não está configurada", () => expect(enforceCommercialFactuality(decision("demo rápida de 15 minutos"), {}).replyText).not.toMatch(/15 minutos/i));
  it("permite duração configurada", () => expect(enforceCommercialFactuality(decision("demo rápida de 15 minutos"), { demoDuration: "15 a 20 minutos" }).replyText).toContain("15 minutos"));
  it("não altera benefício qualitativo", () => expect(enforceCommercialFactuality(decision("ajudando a reduzir bastante o tempo"), {}).replyText).toContain("reduzir bastante"));
  it("bloqueia funcionalidade não cadastrada", () => expect(enforceProductGrounding(decision("Temos simulador de lentes integrado.")).replyText).not.toMatch(/simulador de lentes/i));
  it("permite perguntar ao lead sobre simulador sem atribuir a função ao Renova", () => expect(enforceProductGrounding(decision("Vocês têm um simulador de lentes aí na ótica?")).replyText).toBe("Vocês têm um simulador de lentes aí na ótica?"));
  it("usa a prova social aprovada de 357 óticas, sem manter o número legado", () => { expect(CONFIRMED_PRODUCT_CATALOG.socialProof).toContain("Mais de 357 óticas no Brasil"); expect(CONFIRMED_PRODUCT_CATALOG.socialProof.join(" ")).not.toMatch(/700 óticas/i); });
});
