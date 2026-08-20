import { describe, expect, it } from "vitest";
import { agentConfigSchema, pedroInitialConfig } from "./agent-config.js";

describe("multi-agent architecture", () => {
  it("defines Pedro as fail-closed and within the requested window", () => {
    expect(pedroInitialConfig).toMatchObject({
      slug: "pedro", name: "Pedro", dailyLimit: 50, timezone: "America/Sao_Paulo",
      operationalStart: "08:00", operationalEnd: "17:00",
      globalPause: true, automationEnabled: false, outreachEnabled: false, realSendingEnabled: false,
    });
    expect(agentConfigSchema.safeParse({ agentId: "00000000-0000-4000-8000-000000000002", ...pedroInitialConfig }).success).toBe(true);
  });
});
