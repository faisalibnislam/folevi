// Which pull requests skip the end-to-end jobs (scripts/ci-scope.mjs, the "scope" job in .github/workflows/ci.yml).
// The rule must only ever skip for files the web app, Convex and the suite can't read: a wrong skip lets a broken
// change into main with the end-to-end checks marked green.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
// @ts-expect-error: a plain .mjs script without types
import * as scope from "../../../scripts/ci-scope.mjs";

const repo = resolve(__dirname, "../../..");

describe("which pull requests need the end-to-end jobs", () => {
  test("a version pull request skips them", () => {
    expect(
      scope.needsE2e([
        "version.json",
        "CHANGELOG.json",
        "CHANGELOG.md",
        "apps/mac/project.yml",
        "apps/ios/ios/App/App.xcodeproj/project.pbxproj",
        "apps/mobile/ios/App/project.yml",
      ]),
    ).toBe(false);
  });

  test("handoff notes, docs and the native apps skip them", () => {
    expect(scope.needsE2e(["handoff/log/2026-11-28-entry.md", "handoff/state/mac.md", "docs/DESKTOP_PARITY.md"])).toBe(false);
    expect(scope.needsE2e(["apps/native-kit/Sources/FoleviMac/App.swift", "apps/desktop/src-tauri/src/main.rs"])).toBe(false);
    expect(scope.needsE2e(["README.md", "CLAUDE.md"])).toBe(false);
  });

  test("anything the web app, Convex or the suite reads runs them", () => {
    for (const file of [
      "apps/web/src/app/globals.css",
      "apps/web/e2e/home.spec.ts",
      "apps/web/package.json",
      "convex/ai.ts",
      "packages/design-tokens/tokens.json",
      "apps/clipper/src/background.ts",
      "scripts/setup-local.mjs",
      "scripts/ci-scope.mjs",
      ".github/workflows/ci.yml",
      "package.json",
      "pnpm-lock.yaml",
      "apps/web/README.md",
    ]) {
      expect(scope.needsE2e([file]), file).toBe(true);
    }
  });

  test("one file that matters is enough, whatever else changed", () => {
    expect(scope.needsE2e(["handoff/log/a.md", "apps/mac/project.yml", "apps/web/src/lib/version.ts"])).toBe(true);
    expect(scope.reasons(["handoff/log/a.md", "apps/web/src/lib/version.ts"])).toEqual(["apps/web/src/lib/version.ts"]);
  });

  test("an unreadable diff runs them", () => {
    expect(scope.needsE2e([])).toBe(true);
    expect(scope.needsE2e(["", "  "])).toBe(true);
  });

  test("a folder is matched whole, never by its first letters", () => {
    expect(scope.needsE2e(["docs-site/page.tsx"])).toBe(true);
    expect(scope.needsE2e(["apps/mac-helper/index.ts"])).toBe(true);
    expect(scope.needsE2e(["handoff.config.ts"])).toBe(true);
  });

  test("every folder on the list exists, so a renamed one can't hide here", () => {
    for (const folder of scope.UNAFFECTED_FOLDERS) expect(existsSync(resolve(repo, folder)), folder).toBe(true);
    for (const file of scope.UNAFFECTED_FILES) expect(existsSync(resolve(repo, file)), file).toBe(true);
  });

  test("the command prints the one line the workflow reads", () => {
    const run = (input: string) =>
      execFileSync("node", [resolve(repo, "scripts/ci-scope.mjs")], { input, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] });
    expect(run("version.json\nhandoff/log/a.md\n")).toBe("e2e=false\n");
    expect(run("version.json\nconvex/ai.ts\n")).toBe("e2e=true\n");
    expect(run("")).toBe("e2e=true\n");
  });
});
