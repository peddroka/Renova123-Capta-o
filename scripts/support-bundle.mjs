import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = join(root, "artifacts", "support-bundles", `renova123-support-${stamp}`);
const files = ["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml", "tsconfig.base.json", "vitest.config.ts", "scripts/dev-manager.mjs", "scripts/dev-manager-profiles.mjs", "apps/api/src", "apps/api/package.json", "apps/worker/src/config.ts", "apps/worker/src/startup-safety.ts", "apps/worker/package.json", "services/wolf-transcription/app.py"];
mkdirSync(out, { recursive: true });
for (const relative of files) { const source = join(root, relative); if (existsSync(source)) cpSync(source, join(out, relative), { recursive: true }); }
const logDir = join(root, "logs");
if (existsSync(logDir)) { const safeLogs = readdirSync(logDir).filter((name) => /\.(log|txt)$/i.test(name)); for (const name of safeLogs) { const content = readFileSync(join(logDir, name), "utf8").replace(/(token|secret|password|api[_-]?key|authorization)[^\r\n]*/gi, "$1=[REDACTED]"); mkdirSync(join(out, "logs"), { recursive: true }); writeFileSync(join(out, "logs", name), content); } }
writeFileSync(join(out, "build-info.json"), JSON.stringify({ createdAt: new Date().toISOString(), node: process.version, packageManager: "pnpm@11.9.0" }, null, 2));
const archive = `${out}.zip`;
execFileSync("powershell.exe", ["-NoProfile", "-Command", `Compress-Archive -Path '${out}\\*' -DestinationPath '${archive}' -Force`], { stdio: "ignore" });
rmSync(out, { recursive: true, force: true });
console.log(archive);
