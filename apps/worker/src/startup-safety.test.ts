import { describe, expect, it } from "vitest";
import { assertWorkerStartupAllowed } from "./startup-safety.js";

describe("worker startup safety", () => {
  it("requires explicit opt-in for real outreach in development", () => { expect(() => assertWorkerStartupAllowed({ NODE_ENV: "development", OUTREACH_ENABLED: "true", SIMULATION_MODE: "false", REAL_SENDING_ENABLED: "true" })).toThrow("ALLOW_REAL_OUTREACH_DEV"); });
  it("allows simulation and explicit opt-in", () => { expect(() => assertWorkerStartupAllowed({ NODE_ENV: "development", OUTREACH_ENABLED: "true", SIMULATION_MODE: "true", REAL_SENDING_ENABLED: "true" })).not.toThrow(); expect(() => assertWorkerStartupAllowed({ NODE_ENV: "development", OUTREACH_ENABLED: "true", SIMULATION_MODE: "false", REAL_SENDING_ENABLED: "true", ALLOW_REAL_OUTREACH_DEV: "true" })).not.toThrow(); });
});
