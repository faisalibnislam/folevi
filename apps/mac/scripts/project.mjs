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
  // The shared Dropbox and Google Drive kit (git-ignored, apps/ios/scripts/bundle-cloud.mjs) is one of the
  // project's sources: build it when it's missing, as in a fresh checkout, or XcodeGen refuses the spec.
  const kit = join(MAC, "../ios/ios/App/Native/Shell/folevi-cloud.js");
  if (!existsSync(kit)) execFileSync(process.execPath, [join(MAC, "../ios/scripts/bundle-cloud.mjs")], { stdio: quiet ? "pipe" : "inherit" });
  const xcodegen = ["/opt/homebrew/bin/xcodegen", "/usr/local/bin/xcodegen"].find((p) => existsSync(p)) ?? "xcodegen";
  execFileSync(xcodegen, ["generate", "--spec", join(MAC, "project.yml"), "--project", MAC, ...(quiet ? ["--quiet"] : [])], { cwd: MAC, stdio: quiet ? "pipe" : "inherit" });
  return join(MAC, "Folevi.xcodeproj");
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(generateProject());
}
