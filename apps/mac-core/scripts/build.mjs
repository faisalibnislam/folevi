#!/usr/bin/env node
// Builds Folevi (Debug by default) and prints only what matters: errors, warnings in Core's own files, and
// where the app is. `--release` builds Release; `--generate` regenerates the Xcode project first (always done
// when project.yml is newer than it).
//
//   node apps/mac-core/scripts/build.mjs [--release] [--warnings]
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CORE = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const config = args.has("--release") ? "Release" : "Debug";
const project = join(CORE, "FoleviCore.xcodeproj");

const spec = join(CORE, "project.yml");
if (!args.has("--no-generate")) {
  const xcodegen = ["/opt/homebrew/bin/xcodegen", "/usr/local/bin/xcodegen"].find((p) => existsSync(p)) ?? "xcodegen";
  execFileSync(xcodegen, ["generate", "--spec", spec, "--project", CORE, "--quiet"], { cwd: CORE, stdio: "inherit" });
}

const r = spawnSync("xcodebuild", ["-project", project, "-scheme", "FoleviCore", "-configuration", config, "-derivedDataPath", join(CORE, "build/dd"), "-destination", "platform=macOS", "-allowProvisioningUpdates", "build"], { cwd: CORE, encoding: "utf8", maxBuffer: 1 << 28 });
const lines = (r.stdout + r.stderr).split("\n");
const seen = new Set();
const show = (l) => {
  const short = l.replace(/^.*\/apps\//, "");
  if (seen.has(short)) return;
  seen.add(short);
  console.log(short);
};
for (const l of lines) {
  if (/^\/.*error:/.test(l)) show(l);
  else if (args.has("--warnings") && /^\/.*mac-core\/.*warning:/.test(l)) show(l);
}
const ok = lines.some((l) => l.includes("BUILD SUCCEEDED"));
const name = config === "Debug" ? "Folevi Dev" : "Folevi";
console.log(ok ? `BUILD SUCCEEDED: ${join(CORE, "build/dd/Build/Products", config, name + ".app")}` : "BUILD FAILED");
process.exit(ok ? 0 : 1);
