import { describe, expect, it } from "vitest";
import { isEvolutionConfigured } from "./WhatsAppPage";

describe("WhatsApp configuration fallback", () => {
  it("treats an online pairing with a valid webhook as configured while diagnostics is unavailable", () => {
    expect(isEvolutionConfigured({ evolution: "online", webhook: "ok" } as never, null)).toBe(true);
  });

  it("does not override an explicit unconfigured diagnostic", () => {
    expect(isEvolutionConfigured({ evolution: "online", webhook: "ok" } as never, {
      connectionMode: "not_configured",
      apiKeyConfigured: false,
      webhookConfigured: false,
      apiKeyExposed: false,
    })).toBe(false);
  });
});
