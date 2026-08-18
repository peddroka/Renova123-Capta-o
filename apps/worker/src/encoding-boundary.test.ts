import { describe, expect, it } from "vitest";
import { formatHumanQualifiedGroupMessage } from "@renova123/core";
import { normalizeWhatsAppText } from "@renova123/integrations";

describe("fronteira UTF-8 do WhatsApp", () => {
  it("preserva acentos e emojis exatos até a saída do provider", () => {
    const source = formatHumanQualifiedGroupMessage({ name: "João", company: "Ótica Fric", region: "São Paulo", context: "Não usa planilha", mainInterest: "demonstração" });
    const output = normalizeWhatsAppText(source);
    expect(output).toContain("🔥 LEAD QUALIFICADO");
    expect(output).toContain("🏪 Ótica: Ótica Fric");
    expect(output).toContain("📍 Região: São Paulo");
    expect(output).toContain("Não usa planilha");
    expect(output).not.toContain("Ã£");
    expect(output).not.toContain("Ã§");
  });
});
