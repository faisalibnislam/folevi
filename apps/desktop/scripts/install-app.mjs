// Puts the build in /Applications (replacing the one there) and opens it from there.
// Run after `pnpm package` (or use `pnpm release`, which does both).
//   --from <Folevi.app>  the build to install (default: release/mac-arm64/Folevi.app)
//   --to <folder>        install into another folder instead (a dry run): the app in /Applications is left
//                        alone, running or not
//   --no-open            don't open it afterwards
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
};
const built = resolve(flag("--from") ?? resolve(here, "../release/mac-arm64/Folevi.app"));
const folder = resolve(flag("--to") ?? "/Applications");
const installed = join(folder, "Folevi.app");
const replacingTheInstalledApp = installed === "/Applications/Folevi.app";

if (!existsSync(built)) {
  console.error(`No build at ${built}. Run \`pnpm package\` first.`);
  process.exit(1);
}

// The build must carry the team's Developer ID signature (a stable one is what keeps macOS from asking for
// permissions again).
const TEAM = "7K32QQ2FX8";
execFileSync("codesign", ["--verify", "--deep", "--strict", built], { stdio: "inherit" });
const details = spawnSync("codesign", ["-dv", "--verbose=2", built], { encoding: "utf8" }).stderr;
if (!/Authority=Developer ID Application:/.test(details) || !details.includes(`TeamIdentifier=${TEAM}`)) {
  console.error(`The build isn't signed with the Developer ID Application certificate of team ${TEAM}; not installing it.`);
  process.exit(1);
}

if (replacingTheInstalledApp) {
  // Quit the running copy (politely, then for sure) so it can be replaced.
  try {
    execFileSync("osascript", ["-e", 'if application id "com.folevi.mac" is running then tell application id "com.folevi.mac" to quit'], { stdio: "ignore" });
  } catch {
    /* Not running. */
  }
  // Up to 15 seconds to quit on its own: a forced quit makes macOS offer to "reopen its windows" next time.
  for (let i = 0; i < 60; i++) {
    try {
      execFileSync("pgrep", ["-f", `${installed}/Contents/MacOS/Folevi`], { stdio: "ignore" });
      execFileSync("sleep", ["0.25"]);
    } catch {
      break;
    }
  }
  try {
    execFileSync("pkill", ["-f", `${installed}/Contents/MacOS/Folevi`], { stdio: "ignore" });
    execFileSync("sleep", ["2"]);
    // A copy stuck inside a system call never acts on that signal: it's ended outright, or `open` below
    // would bring the stuck copy forward instead of starting the new one.
    execFileSync("pkill", ["-9", "-f", `${installed}/Contents/MacOS/Folevi`], { stdio: "ignore" });
  } catch {
    /* Already gone. */
  }
}

mkdirSync(folder, { recursive: true });
rmSync(installed, { recursive: true, force: true });
execFileSync("ditto", [built, installed]);
execFileSync("codesign", ["--verify", "--deep", "--strict", installed], { stdio: "inherit" });
if (!argv.includes("--no-open")) execFileSync("open", [installed]);
console.log(`Installed${argv.includes("--no-open") ? "" : " and opened"} ${installed}`);
