import { createHash } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = join(root, "public");
const dist = join(root, "dist");
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const manifest = JSON.parse(await readFile(join(source, "manifest.json"), "utf8"));
if (packageJson.version !== "0.3.9" || manifest.version !== packageJson.version) throw new Error(`Versão inconsistente: package=${packageJson.version}, manifest=${manifest.version}`);
const required = ["background.js", "offscreen.js", "content.js", "manifest.json", "sidepanel.html", "offscreen.html"];
for (const file of required) { try { await readFile(join(source, file)); } catch { throw new Error(`Arquivo obrigatório ausente: ${file}`); } }
const background = await readFile(join(source, "background.js"), "utf8");
for (const forbidden of ["WOLF_CAPTURE_TAB", "WOLF_CAPTURE_TAB_ID", "WOLF_START_TAB_STREAM", "getMediaStreamId(options)"]) if (background.includes(forbidden)) throw new Error(`Rota legada proibida encontrada: ${forbidden}`);
await mkdir(dist, { recursive: true }); await cp(source, dist, { recursive: true });
const timestamp = new Date().toISOString();
const buildSources = await Promise.all(["background.js", "offscreen.js", "main.js", "sidepanel.css", "manifest.json"].map((file) => readFile(join(dist, file))));
const hash = createHash("sha256").update(Buffer.concat(buildSources)).digest("hex").slice(0, 16);
await writeFile(join(dist, "build-info.json"), JSON.stringify({ version: packageJson.version, timestamp, hash }, null, 2));
console.log(`THE WOLF extension ${packageJson.version} ready (${hash})`);
