import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Francisco always-on structural policy", () => {
  const worker = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const database = readFileSync(new URL("../../../packages/database/src/index.ts", import.meta.url), "utf8");

  it("keeps conversation claims alive even when proactive automation is disabled", () => {
    expect(worker).toContain("const proactiveEnabled = testMode || (automationEnabled && general.globalPause !== true)");
    expect(worker).toContain("includeOutbound: proactiveEnabled");
    expect(worker).not.toContain("if (general.globalPause === true || (automationEnabled && (!general.globalPause || testMode)))");
  });

  it("treats ai_response_queue as conversation work instead of proactive outreach", () => {
    expect(database).toContain('for (const queue of (["ai_response_queue"] as const))');
  });

  it("retries transient heartbeat transport failures without masking explicit lease loss", () => {
    expect(worker).toContain("await heartbeatWithRetry()");
    expect(worker).toContain("throw new WorkerLeaseLostError()");
  });
});
