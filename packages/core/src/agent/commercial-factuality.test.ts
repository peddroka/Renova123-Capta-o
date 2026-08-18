import { describe, expect, it } from "vitest";
import type { AiDecision } from "@renova123/shared";
import { enforceCommercialFactuality } from "./commercial-factuality.js";
import { enforceProductGrounding } from "./product-grounding.js";

const decision = (replyText: string): AiDecision => ({ replyText, leadStage: "engaged", detectedIntent: "information", sentiment: "neutral", summaryUpdate: null, memoryUpdates: [], questionsAnswered: [], objectionsDetected: [], shouldSendMaterial: false, materialQuery: null, shouldProposeDemo: false, suggestedSlots: [], shouldScheduleDemo: false, appointmentData: null, shouldHandoff: false, handoffReason: null, shouldOptOut: false, followUpAction: { action: "none", delayHours: null, reason: "aguardar" }, confidence: .9, internalReasoningSummary: "teste", qualificationStatus: "discovering", handoffType: null, qualificationScore: 0, mariliaConsent: "not_asked" });

describe("factualidade comercial", () => {
  it("remove percentual não presente no contexto", () => expect(enforceCommercialFactuality(decision("reduzindo o tempo em até 70%"), {}).replyText).not.toMatch(/70%/));
  it("preserva percentual explicitamente cadastrado", () => expect(enforceCommercialFactuality(decision("reduzindo o tempo em até 70%"), { approvedMetric: "70%" }).replyText).toContain("70%"));
  it("remove duração quando a demonstração não está configurada", () => expect(enforceCommercialFactuality(decision("demo rápida de 15 minutos"), {}).replyText).not.toMatch(/15 minutos/i));
  it("permite duração configurada", () => expect(enforceCommercialFactuality(decision("demo rápida de 15 minutos"), { demoDuration: "15 a 20 minutos" }).replyText).toContain("15 minutos"));
  it("não altera benefício qualitativo", () => expect(enforceCommercialFactuality(decision("ajudando a reduzir bastante o tempo"), {}).replyText).toContain("reduzir bastante"));
  it("bloqueia funcionalidade não cadastrada", () => expect(enforceProductGrounding(decision("Temos simulador de lentes integrado.")).replyText).not.toMatch(/simulador de lentes/i));
});
