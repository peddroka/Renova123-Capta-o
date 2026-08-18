import { describe, expect, it } from "vitest";
import { ConversationLanes } from "./conversation-lanes.js";

describe("ConversationLanes", () => {
  it("does not turn same-conversation waiters into global active jobs", () => {
    const lanes = new ConversationLanes();
    expect(lanes.tryStart("phone:A")).toBe(true);
    expect(lanes.tryStart("phone:A")).toBe(false);
    expect(lanes.tryStart("phone:B")).toBe(true);
    expect(lanes.size()).toBe(2);
    lanes.finish("phone:A");
    expect(lanes.tryStart("phone:A")).toBe(true);
  });

  it("admits 50 independent leads while preserving one lane per lead", () => {
    const lanes = new ConversationLanes();
    for (let i = 0; i < 50; i += 1) expect(lanes.tryStart(`phone:${i}`)).toBe(true);
    expect(lanes.size()).toBe(50);
    expect(lanes.tryStart("phone:0")).toBe(false);
    expect(lanes.tryStart("phone:50")).toBe(true);
  });

  it("lets B/C/D/E start even when A has 15 queued messages", () => {
    const lanes = new ConversationLanes();
    expect(lanes.tryStart("phone:A")).toBe(true);
    for (let i = 0; i < 14; i += 1) expect(lanes.tryStart("phone:A")).toBe(false);
    for (const lead of ["B", "C", "D", "E"]) expect(lanes.tryStart(`phone:${lead}`)).toBe(true);
    expect(lanes.size()).toBe(5);
  });
});
