import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  use: { baseURL: "http://127.0.0.1:5173", trace: "on-first-retry" },
  webServer: [
    { command: "node node_modules/tsx/dist/cli.mjs apps/api/src/server.ts", url: "http://127.0.0.1:3333/health", reuseExistingServer: true },
    { command: "node apps/web/node_modules/vite/bin/vite.js --host 127.0.0.1", url: "http://127.0.0.1:5173", reuseExistingServer: true }
  ],
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } }
  ]
});
