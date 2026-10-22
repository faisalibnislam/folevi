#!/usr/bin/env node
// The native Folevi for Mac's version (decision M9): 2.0.0 for the first native build, then 2.1.0, 2.2.0... The
// number after "2." goes up by one for each release, and the build number (CFBundleVersion, what Sparkle compares)
// by one. Both live in project.yml (MARKETING_VERSION, CURRENT_PROJECT_VERSION). A version that was never released
// (no `mac-v<version>` tag, which release.mjs --install makes) is kept, so the first release ships as 2.0.0.
//
//   node apps/mac/scripts/bump-version.mjs            bump if the current version was released, print it
//   node apps/mac/scripts/bump-version.mjs --print    print the version and build only
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MAC } from "./project.mjs";

const spec = join(MAC, "project.yml");

export function currentVersion() {
  const text = readFileSync(spec, "utf8");
  const version = /^\s*MARKETING_VERSION:\s*"?([0-9.]+)"?\s*$/m.exec(text)?.[1];
  const build = Number(/^\s*CURRENT_PROJECT_VERSION:\s*"?([0-9]+)"?\s*$/m.exec(text)?.[1]);
  if (!version || !Number.isInteger(build)) throw new Error("project.yml has no MARKETING_VERSION or CURRENT_PROJECT_VERSION");
  return { version, build };
}

export const released = (version) => {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", `refs/tags/mac-v${version}`], { cwd: MAC, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

export function bump() {
  const { version, build } = currentVersion();
  if (!released(version)) return { version, build, bumped: false };
  const [major, minor] = version.split(".").map(Number);
  const next = { version: `${major || 2}.${(minor || 0) + 1}.0`, build: build + 1 };
  const text = readFileSync(spec, "utf8")
    .replace(/^(\s*MARKETING_VERSION:\s*)"?[0-9.]+"?\s*$/m, `$1${next.version}`)
    .replace(/^(\s*CURRENT_PROJECT_VERSION:\s*)"?[0-9]+"?\s*$/m, `$1${next.build}`);
  writeFileSync(spec, text);
  return { ...next, bumped: true };
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const v = process.argv.includes("--print") ? { ...currentVersion(), bumped: false } : bump();
  console.log(`Folevi for Mac ${v.version} (${v.build})${v.bumped ? "" : process.argv.includes("--print") ? "" : ", not released yet: kept"}`);
}
