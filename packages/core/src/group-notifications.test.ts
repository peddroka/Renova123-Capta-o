import { describe, expect, it } from "vitest";
import { canAttemptGroupDelivery, formatDisqualifiedGroupMessage, formatHumanQualifiedGroupMessage, formatQualifiedGroupMessage, formatStalledGroupMessage, groupNotificationDedupKey, qualificationDeadlineAt, shouldMarkStalled } from "./group-notifications.js";

describe("notificações internas de grupos", () => {
  it("qualificado contém somente fatos humanos conhecidos e UTF-8 válido", () => {
    const body = formatHumanQualifiedGroupMessage({ name: "Ana", phone: "5511999999999", company: "Ótica Fric", region: "São Paulo", context: "Usa orçamento em papel", mainInterest: "ver demonstração" });
    expect(body).toContain("🔥 LEAD QUALIFICADO");
    expect(body).toContain("🏪 Ótica: Ótica Fric");
    expect(body).toContain("📍 Região: São Paulo");
    expect(body).toContain("🎯 PRINCIPAL INTERESSE");
    expect(body).not.toMatch(/Ã.|owner_responsible|\bhigh\b|_/);
  });

  it("ausência de dados usa exatamente Não informado", () => {
    const body = formatQualifiedGroupMessage({ name: "Ana" });
    expect(body).toContain("WhatsApp: Não informado");
    expect(body).toContain("Ótica: Não informado");
  });

  it("desqualificado é legível sem expor campo técnico de opt-out", () => {
    const body = formatDisqualifiedGroupMessage({ phone: "5582988543864", mainPain: "comissão e orçamento" });
    expect(body).toContain("❌ LEAD DESQUALIFICADO");
    expect(body).not.toContain("opt-out");
    expect(body).not.toContain("Ã£");
    expect(body).not.toContain("Ã§");
  });

  it("mantém regras de prazo, deduplicação e retry", () => {
    expect(qualificationDeadlineAt(null, "2026-01-01T00:00:00.000Z")).toBe("2026-01-04T00:00:00.000Z");
    expect(groupNotificationDedupKey("lead_stalled", "lead-1")).toBe("lead_stalled:lead-1");
    expect(groupNotificationDedupKey("lead_disqualified", "lead-1")).toBe("lead_disqualified:lead-1");
    expect(canAttemptGroupDelivery("pending")).toBe(true);
    expect(canAttemptGroupDelivery("sent")).toBe(false);
    expect(formatStalledGroupMessage({ name: "Ana", summary: "sem avanço" })).toContain("LEAD SEM AVANÇO");
  });
});

describe("eligibilidade de stalled", () => {
  it("exige três mensagens, engajamento e ausência de bloqueios", () => {
    expect(shouldMarkStalled({ deadlineReached: true, inboundMessages: 2, hasCommercialEngagement: true, explicitNoInterest: false })).toBe(false);
    expect(shouldMarkStalled({ deadlineReached: true, inboundMessages: 3, hasCommercialEngagement: true, explicitNoInterest: false })).toBe(true);
    expect(shouldMarkStalled({ deadlineReached: true, inboundMessages: 4, hasCommercialEngagement: true, explicitNoInterest: false, qualificationStatus: "qualified" })).toBe(false);
    expect(shouldMarkStalled({ deadlineReached: true, inboundMessages: 4, hasCommercialEngagement: true, explicitNoInterest: true })).toBe(false);
  });
});
