// scripts/build-shell.mjs --production (what `pnpm release` ships): the production deployment is baked in and no
// development value from the .env files is.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
// @ts-expect-error: a plain .mjs script without types
import { buildEnv, checkBakedEnv, envFileValues, PRODUCTION_ENV } from "../scripts/build-shell.mjs";

describe("the production shell build", () => {
  test("its environment: production values, every other public variable empty, development builds untouched", () => {
    const dir = mkdtempSync(join(tmpdir(), "folevi-env-"));
    try {
      writeFileSync(join(dir, ".env.local"), 'NEXT_PUBLIC_CONVEX_URL=https://dev-otter-1.convex.cloud\nNEXT_PUBLIC_ENABLE_SW="1"\nFOLEVI_SERVER_SECRET=abcdefghijkl\n# a comment\n');
      const files = envFileValues(dir) as Map<string, string>;
      expect(Object.fromEntries(files)).toEqual({ NEXT_PUBLIC_CONVEX_URL: "https://dev-otter-1.convex.cloud", NEXT_PUBLIC_ENABLE_SW: "1", FOLEVI_SERVER_SECRET: "abcdefghijkl" });
      const base = { PATH: "/bin", NEXT_PUBLIC_APP_URL: "http://app.localhost:3002", NEXT_DIST_DIR: ".next-x" };
      const prod = buildEnv(base, { production: true, files });
      expect(prod).toMatchObject({ ...PRODUCTION_ENV, NEXT_PUBLIC_ENABLE_SW: "", NODE_ENV: "production", FOLEVI_BUILD: "shell", PATH: "/bin" });
      expect(prod.NEXT_DIST_DIR).toBeUndefined();
      expect(buildEnv(base, { production: false, files })).toMatchObject({ NEXT_PUBLIC_APP_URL: "http://app.localhost:3002", FOLEVI_BUILD: "shell" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the export check finds development values and a missing production deployment", async () => {
    const dir = mkdtempSync(join(tmpdir(), "folevi-export-"));
    try {
      mkdirSync(join(dir, "_next"));
      const files = new Map([["NEXT_PUBLIC_CONVEX_URL", "https://dev-otter-1.convex.cloud"], ["FOLEVI_SERVER_SECRET", "abcdefghijkl"]]);
      writeFileSync(join(dir, "_next/a.js"), `const u="${PRODUCTION_ENV.NEXT_PUBLIC_CONVEX_URL}";`);
      expect(await checkBakedEnv(dir, files)).toEqual([]);
      writeFileSync(join(dir, "_next/b.js"), 'fetch("https://dev-otter-1.convex.cloud");const s="abcdefghijkl";const h="http://app.localhost:3002"');
      const problems = await checkBakedEnv(dir, files);
      // Long values are cut short in the message (a secret isn't printed whole).
      expect(problems).toEqual(["_next/b.js: https://dev-…", "_next/b.js: abcdefghijkl", "_next/b.js: localhost:", "_next/b.js: app.localhost"]);
      rmSync(join(dir, "_next/a.js"));
      expect((await checkBakedEnv(dir, new Map())).join("\n")).toMatch(/isn't in the export/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
