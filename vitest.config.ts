import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "convex",
          environment: "edge-runtime",
          include: ["tests/convex/**/*.test.ts"],
          exclude: ["tests/convex/static/**"],
          server: { deps: { inline: ["convex-test"] } },
        },
      },
      {
        test: {
          name: "convex-static",
          environment: "node",
          include: ["tests/convex/static/**/*.test.ts"],
        },
      },
    ],
  },
});
