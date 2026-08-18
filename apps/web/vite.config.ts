import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const rootEnvDir = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, rootEnvDir, "");
  const publicSupabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || "";
  const publicSupabaseAnonKey = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || "";

  return {
    plugins: [react()],
    envDir: rootEnvDir,
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(publicSupabaseUrl),
      "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(publicSupabaseAnonKey)
    },
    server: { host: "127.0.0.1", port: 5173, strictPort: true },
    build: { sourcemap: true }
  };
});
