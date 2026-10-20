// shell/build.json, written by apps/web/scripts/build-shell.mjs and read by main.ts (shellBuild.ts).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parseShellBuild, readShellBuild, shellBuildProblems, type ShellBuild } from "./shellBuild";

const PROD: ShellBuild = {
  v: 1,
  target: "production",
  convexUrl: "https://fastidious-clownfish-123.convex.cloud",
  siteUrl: "https://app.folevi.com",
  dbVersion: 3,
  appVersion: "1.16.0",
  builtAt: "2026-10-20T00:00:00.000Z",
};

describe("the bundled interface's build info", () => {
  test("reads what build-shell writes, and refuses anything else", () => {
    const dir = mkdtempSync(join(tmpdir(), "folevi-shellbuild-"));
    try {
      expect(readShellBuild(dir)).toBeNull();
      mkdirSync(join(dir, "shell"));
      writeFileSync(join(dir, "shell/build.json"), JSON.stringify(PROD));
      expect(readShellBuild(dir)).toEqual(PROD);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(parseShellBuild("{nope")).toBeNull();
    expect(parseShellBuild(JSON.stringify({ ...PROD, v: 2 }))).toBeNull();
    expect(parseShellBuild(JSON.stringify({ ...PROD, target: "staging" }))).toBeNull();
    expect(parseShellBuild(JSON.stringify({ ...PROD, dbVersion: "3" }))).toBeNull();
    expect(parseShellBuild(JSON.stringify({ ...PROD, convexUrl: 5 }))?.convexUrl).toBeNull();
  });

  test("a packaged app must carry a production build of its own version, for its own website", () => {
    const app = { version: "1.16.0", packaged: true, serviceUrl: "https://app.folevi.com/" };
    expect(shellBuildProblems(PROD, app)).toEqual([]);
    expect(shellBuildProblems(null, app)).toHaveLength(1);
    const dev = { ...PROD, target: "development" as const, convexUrl: "https://dev-otter-1.convex.cloud", siteUrl: "http://app.localhost:3002" };
    expect(shellBuildProblems(dev, app).join("\n")).toMatch(/development build[\s\S]*signs in at http:\/\/app\.localhost:3002/);
    expect(shellBuildProblems({ ...PROD, appVersion: "1.15.0" }, app)).toEqual(["the bundled interface was built for 1.15.0, this app is 1.16.0"]);
    // A development run against the dev server: only the website has to match.
    expect(shellBuildProblems(dev, { version: "1.16.0", packaged: false, serviceUrl: "http://app.localhost:3002" })).toEqual([]);
  });
});
