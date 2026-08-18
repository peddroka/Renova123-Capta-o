import { describe, expect, it } from "vitest";
import { evaluateScheduledResume } from "./campaign-resume.js";

const state = { globalPause: true, scheduledResumeAt: "2026-08-11T08:00:00-03:00" };

describe("retomada agendada da campanha", () => {
  it("mantém pausado antes do horário", () => {
    expect(evaluateScheduledResume(state, new Date("2026-08-10T23:00:00Z"), false, true).action).toBe("wait");
  });
  it("ativa no horário quando o preflight passa", () => {
    expect(evaluateScheduledResume(state, new Date("2026-08-11T11:00:00Z"), true, true)).toMatchObject({ action: "activate" });
  });
  it("reconcilia no bootstrap após o horário, dentro da janela", () => {
    expect(evaluateScheduledResume(state, new Date("2026-08-11T12:15:00Z"), true, true).action).toBe("activate");
  });
  it("não ativa fora da janela", () => {
    expect(evaluateScheduledResume(state, new Date("2026-08-11T23:01:00Z"), false, true).reason).toBe("outside-window");
  });
  it("mantém novos cold outbound bloqueados às 22:01", () => {
    expect(evaluateScheduledResume(state, new Date("2026-08-11T22:01:00-03:00"), false, true).reason).toBe("outside-window");
  });
  it("não ativa com preflight crítico falhando", () => {
    expect(evaluateScheduledResume(state, new Date("2026-08-11T11:00:00Z"), true, false).reason).toBe("preflight-failed");
  });
  it("não aplica duas vezes após retomada", () => {
    expect(evaluateScheduledResume({ ...state, scheduledResumeAppliedAt: "2026-08-11T11:00:02Z" }, new Date("2026-08-11T12:00:00Z"), true, true).reason).toBe("already-applied");
  });
  it("pausa manual sem scheduledResumeAt não é revertida", () => {
    expect(evaluateScheduledResume({ globalPause: true }, new Date("2026-08-11T11:00:00Z"), true, true).reason).toBe("not-scheduled");
  });
  it("pausa manual posterior cancela a retomada pendente", () => {
    expect(evaluateScheduledResume({ globalPause: true, scheduledResumeAt: null }, new Date("2026-08-11T11:00:00Z"), true, true).reason).toBe("not-scheduled");
  });
});
