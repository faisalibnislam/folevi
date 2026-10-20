import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

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
      {
        // The API the apps' built-in interface was built against (tests/contract/api-snapshot.test.ts).
        test: {
          name: "contract",
          environment: "node",
          include: ["tests/contract/**/*.test.ts"],
        },
      },
      {
        // Local mode and account mode doing the same thing (docs/LOCAL_MODE_PLAN.md §2.5, tests/parity/types.ts).
        // The web app's aliases resolve, so local-mode code from apps/web/src/lib/local loads here.
        resolve: {
          alias: {
            "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
            "@convex": fileURLToPath(new URL("./convex", import.meta.url)),
          },
        },
        test: {
          name: "parity",
          environment: "edge-runtime",
          include: ["tests/parity/**/*.test.ts"],
          server: { deps: { inline: ["convex-test"] } },
        },
      },
    ],
  },
});
