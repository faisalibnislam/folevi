import { defineConfig } from "vitest/config";

export default defineConfig({
  define: { __FOLEVI_ORIGIN__: JSON.stringify("https://app.folevi.com"), __CLIPPER_VERSION__: JSON.stringify("0.0.0-test") },
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
