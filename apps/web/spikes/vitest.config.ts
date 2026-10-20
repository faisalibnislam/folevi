// Spikes for docs/LOCAL_MODE.md (Phase 0). Not part of the app's test run: cd apps/web && npx vitest run --config spikes/vitest.config.ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
  test: { root: fileURLToPath(new URL(".", import.meta.url)), environment: "jsdom", include: ["**/*.test.ts", "**/*.test.tsx"], setupFiles: ["../test/setup.ts"] },
});
