import { describe, expect, it } from "vitest";
import { STRUCTURED_OUTPUT_MAX_ATTEMPTS, structuredOutputDisposition, structuredOutputFailurePlan } from "./structured-output-policy.js";

describe("política de falha de Structured Output", () => {
  it("faz apenas um retry completo antes de exigir revisão", () => {
    expect(STRUCTURED_OUTPUT_MAX_ATTEMPTS).toBe(2);
    expect(structuredOutputDisposition(1)).toBe("retry");
    expect(structuredOutputDisposition(2)).toBe("review_required");
    expect(structuredOutputDisposition(20)).toBe("review_required");
  });

  it("torna o ciclo de vida observável e nunca conclui silenciosamente uma falha final", () => {
    expect(structuredOutputFailurePlan(1)).toEqual({ disposition: "retry", lifecycle: "retrying", terminal: false });
    expect(structuredOutputFailurePlan(2)).toEqual({ disposition: "review_required", lifecycle: "failed_final", terminal: true });
  });
});
