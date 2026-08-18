import { describe, expect, it } from "vitest";
import { ConversationMemoryService } from "./conversation-memory-service.js";

describe("ConversationMemoryService", () => {
  it("rebuilds the rolling summary without recursively nesting the previous summary", () => {
    const service = new ConversationMemoryService();
    const summary = service.rollingSummary(
      "Fatos comerciais: old=value. Resumo anterior: conteúdo antigo.",
      [{ key: "main_pain", value: "estoque", evidenceType: "explicit", confidence: 1 }],
      "qualifying",
      "not_asked",
      "understand_process",
    );

    expect(summary).toContain("main_pain=estoque");
    expect(summary).not.toContain("Resumo anterior");
    expect(summary).not.toContain("old=value");
  });
});
