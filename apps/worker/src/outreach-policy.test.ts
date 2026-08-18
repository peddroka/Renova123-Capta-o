import { describe, expect, it } from "vitest";
import { CONTROLLED_OUTREACH_TEST_PHONE, isControlledOutreachTestJob, isOperationalTestMode, operationalTestDestination } from "./outreach-policy.js";

describe("bypass de outreach controlado", () => {
  it("permite somente o telefone autorizado com test flag", () => {
    expect(isControlledOutreachTestJob(CONTROLLED_OUTREACH_TEST_PHONE, true, CONTROLLED_OUTREACH_TEST_PHONE)).toBe(true);
  });
  it("bloqueia telefone diferente", () => {
    expect(isControlledOutreachTestJob("5582988543865", true, CONTROLLED_OUTREACH_TEST_PHONE)).toBe(false);
  });
  it("bloqueia o telefone autorizado sem test flag", () => {
    expect(isControlledOutreachTestJob(CONTROLLED_OUTREACH_TEST_PHONE, false, CONTROLLED_OUTREACH_TEST_PHONE)).toBe(false);
  });
  it("bloqueia configuração apontando para telefone diferente", () => {
    expect(isControlledOutreachTestJob(CONTROLLED_OUTREACH_TEST_PHONE, true, "5582988543865")).toBe(false);
  });
  it("ativa modo operacional somente com pausa e allowlist exata", () => {
    expect(isOperationalTestMode(true, true, CONTROLLED_OUTREACH_TEST_PHONE)).toBe(true);
    expect(isOperationalTestMode(false, true, CONTROLLED_OUTREACH_TEST_PHONE)).toBe(false);
    expect(isOperationalTestMode(true, false, CONTROLLED_OUTREACH_TEST_PHONE)).toBe(false);
  });
  it("simula o guard: autorizado permitido e lead real bloqueado", () => {
    expect(operationalTestDestination("+55 82 98854-3864", CONTROLLED_OUTREACH_TEST_PHONE)).toMatchObject({ allowed: true, normalizedPhone: CONTROLLED_OUTREACH_TEST_PHONE });
    expect(operationalTestDestination("5511992468815", CONTROLLED_OUTREACH_TEST_PHONE)).toMatchObject({ allowed: false, normalizedPhone: "5511992468815" });
  });
});
