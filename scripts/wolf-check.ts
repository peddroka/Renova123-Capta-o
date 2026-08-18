const checks: Array<[string, string, (response: Response) => Promise<boolean>]> = [
  ["API", "http://127.0.0.1:3333/health", async (r) => r.ok],
  ["Whisper/VAD", "http://127.0.0.1:8765/health", async (r) => { const body = await r.json() as { ok?: boolean; vad?: string }; return r.ok && body.ok === true && Boolean(body.vad); }],
  ["Ollama/Qwen", "http://127.0.0.1:11434/api/tags", async (r) => { const body = await r.json() as { models?: Array<{ name?: string }> }; return r.ok && (body.models ?? []).some((m) => m.name === (process.env.WOLF_OLLAMA_MODEL ?? "qwen3.5:9b")); }],
];

async function portOpen(port: number) { try { return await import("node:net").then(({ createConnection }) => new Promise<boolean>((resolve) => { const socket = createConnection({ host: "127.0.0.1", port }); socket.once("connect", () => { socket.destroy(); resolve(true); }); socket.once("error", () => resolve(false)); })); } catch { return false; } }

async function main() {
  let ready = true;
  console.log("THE WOLF LOCAL CHECK");
  for (const [name, url, test] of checks) { try { const response = await fetch(url, { signal: AbortSignal.timeout(5000) }); const ok = await test(response); ready &&= ok; console.log(`${name}: ${ok ? "OK" : "FALHOU"}`); } catch (error) { ready = false; console.log(`${name}: FALHOU — ${error instanceof Error ? error.message : "indisponível"}`); } }
  const gateway = await portOpen(3344); console.log(`Gateway: ${gateway ? "OK" : "FALHOU"}`); ready &&= gateway;
  console.log(`READY: ${ready ? "YES" : "NO"}`); process.exitCode = ready ? 0 : 1;
}

void main();
