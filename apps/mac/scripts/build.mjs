#!/usr/bin/env node
// Builds Folevi for Mac (apps/mac): generates the project, then xcodebuild. Debug by default: the app is
// "Folevi Dev.app" (com.folevi.mac.dev, its own data, folevi-dev:// links), left in apps/mac/build and never
// installed. One xcodebuild at a time on a loaded Mac.
//
//   node apps/mac/scripts/build.mjs             Debug build, prints the app's path
//   node apps/mac/scripts/build.mjs --test      Debug build and the FoleviTests (XCTest)
//   node apps/mac/scripts/build.mjs --test --only FoleviTests/SchemeTests
//   node apps/mac/scripts/build.mjs --release   Release build (Developer ID signed, not notarized, not installed;
//                                               release.mjs, WM3, does the real thing)
//   node apps/mac/scripts/build.mjs --clean
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MAC, generateProject } from "./project.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

export const DERIVED = join(MAC, "build", "DerivedData");
export const configuration = (release) => (release ? "Release" : "Debug");
export const appPath = (release = false) => join(DERIVED, "Build", "Products", configuration(release), release ? "Folevi.app" : "Folevi Dev.app");

export function build({ release = false, test = false, only = null, quiet = false } = {}) {
  const project = generateProject({ quiet: true });
  const xcodeArgs = ["-project", project, "-scheme", "Folevi", "-configuration", configuration(release), "-destination", "platform=macOS,arch=arm64", "-derivedDataPath", DERIVED];
  if (only) xcodeArgs.push(`-only-testing:${only}`);
  xcodeArgs.push(test ? "test" : "build");
  execFileSync("xcodebuild", xcodeArgs, { cwd: MAC, stdio: quiet ? "pipe" : "inherit", maxBuffer: 256 * 1024 * 1024 });
  return appPath(release);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  if (flag("--clean")) rmSync(DERIVED, { recursive: true, force: true });
  try {
    const app = build({ release: flag("--release"), test: flag("--test"), only: value("--only") ?? null });
    console.log(`\n${app}`);
  } catch (e) {
    process.exitCode = typeof e.status === "number" ? e.status : 1;
  }
}
