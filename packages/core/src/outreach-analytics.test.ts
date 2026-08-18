import { describe, expect, it } from "vitest";
import { aggregateOutreachByHour } from "./outreach-analytics.js";

describe("outreach analytics", () => {
  it("atribui resposta e qualificação à hora da primeira abordagem", () => {
    const leads = Array.from({ length: 20 }, (_, index) => ({
      initialOutreachSentAt: `2026-01-05T${String(11 + (index % 2)).padStart(2, "0")}:00:00.000Z`,
      firstInboundAt: "2026-01-08T20:00:00.000Z",
      qualifiedAt: index % 2 === 0 ? "2026-01-09T20:00:00.000Z" : null,
    }));
    const result = aggregateOutreachByHour(leads, "UTC");
    expect(result.hours.find((hour) => hour.hour === 11)).toMatchObject({ sent: 10, responded: 10, qualified: 10 });
    expect(result.hours.find((hour) => hour.hour === 12)).toMatchObject({ sent: 10, responded: 10, qualified: 0 });
    expect(result.bestResponseHour).toBe(11);
    expect(result.totalSample).toBe(20);
  });

  it("não anuncia melhor horário com amostra pequena", () => {
    const result = aggregateOutreachByHour([{ initialOutreachSentAt: "2026-01-05T12:00:00.000Z" }], "UTC");
    expect(result.bestResponseHour).toBeNull();
    expect(result.bestQualificationHour).toBeNull();
  });
});
