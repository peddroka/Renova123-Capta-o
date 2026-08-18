import { describe, expect, it } from "vitest";
import { canStartSession, initialWolfSnapshot, transition } from "./state.js";

describe("THE WOLF state machine", () => {
  it("does not start a session without live tab, mic and contact", () => { expect(() => transition(initialWolfSnapshot(), "LISTENING")).toThrow(); });
  it("allows listening only when all prerequisites are live", () => {
    const base = initialWolfSnapshot();
    const ready = { ...base, captureTarget: { tabId: 1, windowId: 2, url: "https://web.whatsapp.com/", status: "LIVE" as const }, mic: "LIVE" as const, contact: { displayName: "Contato", phone: null } };
    expect(canStartSession(ready)).toBe(true); expect(transition(ready, "LISTENING").state).toBe("LISTENING");
  });
  it("keeps streams conceptually independent from session", () => { const snapshot = { ...initialWolfSnapshot(), captureTarget: { tabId: 1, windowId: null, url: "https://web.whatsapp.com/", status: "LIVE" as const } }; expect(snapshot.sessionId).toBeNull(); expect(snapshot.captureTarget.status).toBe("LIVE"); });
  it("allows infrastructure to be armed without creating a call", () => { expect(transition(initialWolfSnapshot(), "ARMED").state).toBe("ARMED"); });
});
