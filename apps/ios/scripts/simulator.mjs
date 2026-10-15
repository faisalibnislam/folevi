// Builds Folevi for the iOS Simulator and runs it there (no Apple Developer team needed: Simulator builds
// aren't signed for a device). Run `pnpm sync` (or `pnpm sync:dev`) first: it writes the Capacitor config
// and the offline page into the Xcode project.
//
//   node scripts/simulator.mjs build [device]   compile (default device: "iPhone 18 Pro")
//   node scripts/simulator.mjs run [device]     boot the device if needed, build, install and open Folevi
//   node scripts/simulator.mjs eval '<js>' [device]
//                                               Debug builds only: run JavaScript in the app's web view (an
//                                               async function body; `return` a value) and print the result
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const project = resolve(here, "../ios/App");
const derived = resolve(project, "build/DerivedData");
const app = resolve(derived, "Build/Products/Debug-iphonesimulator/App.app");
const BUNDLE = "com.folevi.ios";

const [command, ...args] = process.argv.slice(2);
const sh = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { encoding: "utf8", stdio: opts.quiet ? "pipe" : "inherit", ...opts });
const simctl = (...argv) => sh("xcrun", ["simctl", ...argv], { quiet: true });

/** The device's id, by name or id ("iPhone 18 Pro", or a UDID). */
function deviceId(name = "iPhone 18 Pro") {
  const { devices } = JSON.parse(simctl("list", "devices", "available", "--json"));
  const all = Object.values(devices).flat();
  const found = all.find((d) => d.udid === name) ?? all.find((d) => d.name === name);
  if (!found) throw new Error(`No simulator called "${name}". See: xcrun simctl list devices available`);
  return found;
}

function build(device) {
  if (!existsSync(resolve(project, "App/capacitor.config.json"))) throw new Error("Run `pnpm sync` (or `pnpm sync:dev`) first.");
  sh("xcodebuild", ["-quiet", "-project", resolve(project, "App.xcodeproj"), "-scheme", "App", "-configuration", "Debug", "-destination", `platform=iOS Simulator,id=${device.udid}`, "-derivedDataPath", derived, "build"]);
}

if (command === "build") {
  build(deviceId(args[0]));
} else if (command === "run") {
  const device = deviceId(args[0]);
  if (device.state !== "Booted") simctl("boot", device.udid);
  // The Simulator window, to watch (it lives inside Xcode); the app runs without it too.
  try {
    sh("open", ["-a", resolve(sh("xcode-select", ["-p"], { quiet: true }).trim(), "Applications/Simulator.app")], { quiet: true });
  } catch {}
  build(device);
  simctl("install", device.udid, app);
  console.log(simctl("launch", "--terminate-running-process", device.udid, BUNDLE).trim());
} else if (command === "eval") {
  const device = deviceId(args[1]);
  const tmp = resolve(simctl("get_app_container", device.udid, BUNDLE, "data").trim(), "tmp");
  const out = resolve(tmp, "eval-result.json");
  rmSync(out, { force: true });
  writeFileSync(resolve(tmp, "eval.js"), args[0] ?? "return location.href");
  simctl("spawn", device.udid, "notifyutil", "-p", "com.folevi.ios.eval");
  for (let i = 0; i < 100 && !existsSync(out); i++) await new Promise((r) => setTimeout(r, 100));
  console.log(existsSync(out) ? readFileSync(out, "utf8") : "No answer (is a Debug build of Folevi open on that device?)");
} else {
  console.log("Usage: node scripts/simulator.mjs build|run [device] | eval '<js>' [device]");
  process.exit(command ? 1 : 0);
}
