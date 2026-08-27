import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { profileServices } from "./dev-manager-profiles.mjs";

describe("dev manager profiles", () => {
  it("mantém o worker fora do perfil dev", () => {
    expect(profileServices("dev")).not.toContain("worker");
  });
  it("inclui worker nos perfis full e francisco", () => {
    expect(profileServices("full")).toContain("worker");
    expect(profileServices("francisco")).toEqual(["web", "api", "worker"]);
  });
  it("não mantém runtime legado do Wolf/Whisper", () => {
    const source = readFileSync(new URL("./dev-manager.mjs", import.meta.url), "utf8");
    expect(source).not.toMatch(/wolf:transcription|THE WOLF|whisper/i);
  });
  it("usa live health, shell false e supervisor do worker", () => {
    const source = readFileSync(new URL("./dev-manager.mjs", import.meta.url), "utf8");
    expect(source).toContain("/health/live");
    expect(source).toContain("shell: false");
    expect(source).not.toContain("shell: true");
    expect(source).toContain('@renova123/worker", "supervisor');
    expect(source).toContain("code && code !== 0 ? code : 1");
  });
});
