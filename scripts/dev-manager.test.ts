import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { profileServices } from "./dev-manager-profiles.mjs";

describe("dev manager profiles", () => {
  it("keeps worker out of wolf and dev", () => {
    expect(profileServices("wolf")).not.toContain("worker");
    expect(profileServices("dev")).not.toContain("worker");
  });
  it("includes worker only in full", () => {
    expect(profileServices("full")).toContain("worker");
  });
  it("uses the operational Francisco profile without Whisper", () => {
    expect(profileServices("francisco")).toEqual(["web", "api", "worker"]);
  });
  it("uses live health and never shell=true", () => {
    const source = readFileSync(new URL("./dev-manager.mjs", import.meta.url), "utf8");
    expect(source).toContain("/health/live");
    expect(source).toContain("shell: false");
    expect(source).not.toContain("shell: true");
  });
  it("runs Francisco worker through the supervisor and fails the manager on any unexpected child exit", () => {
    const source = readFileSync(new URL("./dev-manager.mjs", import.meta.url), "utf8");
    expect(source).toContain('@renova123/worker", "supervisor');
    expect(source).toContain("code && code !== 0 ? code : 1");
  });
});
