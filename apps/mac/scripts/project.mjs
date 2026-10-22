#!/usr/bin/env node
// Generates apps/mac/Folevi.xcodeproj from project.yml with XcodeGen (the project isn't committed, so parallel
// work never conflicts in a .pbxproj). Run it after adding or removing files; build.mjs runs it every time.
//
//   node apps/mac/scripts/project.mjs
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const MAC = join(dirname(fileURLToPath(import.meta.url)), "..");

export function generateProject({ quiet = false } = {}) {
  const xcodegen = ["/opt/homebrew/bin/xcodegen", "/usr/local/bin/xcodegen"].find((p) => existsSync(p)) ?? "xcodegen";
  execFileSync(xcodegen, ["generate", "--spec", join(MAC, "project.yml"), "--project", MAC, ...(quiet ? ["--quiet"] : [])], { cwd: MAC, stdio: quiet ? "pipe" : "inherit" });
  return join(MAC, "Folevi.xcodeproj");
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(generateProject());
}
