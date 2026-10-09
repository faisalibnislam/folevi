// Puts the build in /Applications (replacing the one there) and opens it from there.
// Run after `pnpm package` (or use `pnpm release`, which does both).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const built = resolve(here, "../release/mac-arm64/Folevi.app");
const installed = "/Applications/Folevi.app";

if (!existsSync(built)) {
  console.error(`No build at ${built}. Run \`pnpm package\` first.`);
  process.exit(1);
}

// The build must carry the personal signature (a stable one is what keeps macOS from asking for permissions again).
execFileSync("codesign", ["--verify", "--deep", "--strict", built], { stdio: "inherit" });
const details = spawnSync("codesign", ["-dv", "--verbose=2", built], { encoding: "utf8" }).stderr;
if (!/Authority=Apple Development:/.test(details)) {
  console.error("The build isn't signed with the Apple Development certificate; not installing it.");
  process.exit(1);
}

// Quit the running copy (politely, then for sure) so it can be replaced.
try {
  execFileSync("osascript", ["-e", 'if application id "com.folevi.mac" is running then tell application id "com.folevi.mac" to quit'], { stdio: "ignore" });
} catch {
  /* Not running. */
}
for (let i = 0; i < 20; i++) {
  try {
    execFileSync("pgrep", ["-f", `${installed}/Contents/MacOS/Folevi`], { stdio: "ignore" });
    execFileSync("sleep", ["0.25"]);
  } catch {
    break;
  }
}
try {
  execFileSync("pkill", ["-f", `${installed}/Contents/MacOS/Folevi`], { stdio: "ignore" });
} catch {
  /* Already gone. */
}

rmSync(installed, { recursive: true, force: true });
execFileSync("ditto", [built, installed]);
execFileSync("open", [installed]);
console.log(`Installed and opened ${installed}`);
