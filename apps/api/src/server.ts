import { buildApp } from "./app.js";
import { config } from "./config.js";

const app = await buildApp();
try {
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
  app.log.info({ model: config.WOLF_AI_MODEL, reasoning: config.WOLF_REASONING_EFFORT }, "the_wolf_ai_config");
  app.log.info({ pid: process.pid, version: config.BUILD_VERSION, startedAt: new Date().toISOString(), host: config.API_HOST, port: config.API_PORT }, "api_started");
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code;
  app.log.error({ err: error, pid: process.pid, port: config.API_PORT, hint: code === "EADDRINUSE" ? "A porta já está ocupada; encerre o processo antigo ou altere LOCAL_API_PORT." : undefined }, "api_start_failed");
  process.exit(1);
}
