import { describe, expect, it } from "vitest";
import { FRANCISCO_HOURS, PEDRO_HOURS, canProcessInboundReply, canSendConversationReply, canSendProactive, isProactiveWindow, shouldInvalidateFollowUpsOnInbound } from "./agent-hours.js";

describe("política separada de prospecção e resposta", () => {
  it.each([
    ["Francisco 23:59 inbound", FRANCISCO_HOURS, "2026-08-19T02:59:00.000Z"],
    ["Francisco 02:00 inbound", FRANCISCO_HOURS, "2026-08-19T05:00:00.000Z"],
    ["Pedro 02:00 inbound previamente abordado", PEDRO_HOURS, "2026-08-19T05:00:00.000Z"],
    ["Pedro 18:00 inbound previamente abordado", PEDRO_HOURS, "2026-08-19T21:00:00.000Z"],
  ])("%s responde 24/7", (_label, agent, iso) => {
    expect(canProcessInboundReply(agent, { inboundValid: true, previouslyAddressed: agent.slug === "pedro" })).toBe(true);
    expect(canSendConversationReply(agent, { inboundValid: true, previouslyAddressed: agent.slug === "pedro" })).toBe(true);
    expect(iso).toBeTruthy();
  });

  it("bloqueia somente outbound proativo fora da janela", () => {
    expect(isProactiveWindow(FRANCISCO_HOURS, new Date("2026-08-19T05:00:00.000Z"))).toBe(false);
    expect(isProactiveWindow(FRANCISCO_HOURS, new Date("2026-08-19T01:59:00.000Z"))).toBe(true);
    expect(canSendProactive(FRANCISCO_HOURS, new Date("2026-08-19T05:00:00.000Z"))).toBe(false);
    expect(canSendProactive(PEDRO_HOURS, new Date("2026-08-19T21:00:00.000Z"))).toBe(false);
  });

  it("protege inbound não solicitado do Pedro em qualquer horário", () => {
    expect(canProcessInboundReply(PEDRO_HOURS, { inboundValid: true, previouslyAddressed: false })).toBe(false);
    expect(canProcessInboundReply(PEDRO_HOURS, { inboundValid: true, previouslyAddressed: true })).toBe(true);
  });

  it("inbound válido invalida follow-up futuro imediatamente", () => {
    expect(shouldInvalidateFollowUpsOnInbound({ inboundValid: true })).toBe(true);
    expect(shouldInvalidateFollowUpsOnInbound({ inboundValid: false })).toBe(false);
  });
});
