import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "convex",
          environment: "edge-runtime",
          include: ["convex/tests/**/*.test.ts"],
          server: { deps: { inline: ["convex-test"] } },
        },
      },
      {
        test: {
          name: "convex-static",
          environment: "node",
          include: ["convex/tests/static/**/*.test.ts"],
        },
      },
    ],
  },
});
