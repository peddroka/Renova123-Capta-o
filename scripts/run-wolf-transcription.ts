import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

async function existingHealthyWhisper() {
  try {
    const response = await fetch("http://127.0.0.1:8765/health");
    return response.ok;
  } catch {
    return false;
  }
}

const root = process.cwd();
const python = join(root, ".runtime", "wolf-python", "Scripts", "python.exe");
const service = join(root, "services", "wolf-transcription");
if (!existsSync(python)) {
  console.error(
    "[WHISPER] ambiente local ausente. Execute: powershell -ExecutionPolicy Bypass -File .\\scripts\\setup-wolf-local.ps1",
  );
  process.exit(1);
}
let child: ChildProcess | null = null;
let stopping = false;
let attempts = 0;
const stop = () => {
  stopping = true;
  if (child && !child.killed) child.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.on("exit", stop);

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function run() {
  while (!stopping) {
    if (await existingHealthyWhisper()) {
      console.log("[WHISPER] 8765 já possui um Whisper saudável; reutilizando a instância existente.");
      break;
    }
    attempts += 1;
    console.log(`[WHISPER] iniciando ${python} na porta 8765 (tentativa ${attempts}/3)`);
    child = spawn(
      python,
      ["-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", "8765", "--log-level", "info"],
      {
        cwd: service,
        stdio: "inherit",
        windowsHide: true,
      },
    );
    const code = await new Promise<number>((resolve) =>
      child?.once("exit", (exitCode) => resolve(exitCode ?? 1)),
    );
    child = null;
    if (stopping) break;
    console.error(`[WHISPER] processo encerrou com código ${code}.`);
    if (code !== 0 && (await existingHealthyWhisper())) {
      console.log("[WHISPER] uma instância saudável respondeu em 8765; encerrando sem novo retry.");
      break;
    }
    if (attempts >= 3) {
      console.error("[WHISPER] três tentativas falharam; verifique a porta 8765 e o log acima.");
      process.exitCode = code || 1;
      break;
    }
    await delay(2_000);
  }
}
void run();
