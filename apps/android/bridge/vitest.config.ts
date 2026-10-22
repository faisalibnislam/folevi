// The Android bridge's TypeScript tests: `node_modules/.bin/vitest run --config apps/android/bridge/vitest.config.ts`
// from the repository root (or `pnpm test:bridge` in apps/android).
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["apps/android/bridge/**/*.test.ts"], environment: "node", root: fileURLToPath(new URL("../../..", import.meta.url)) },
});
