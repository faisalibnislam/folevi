#!/usr/bin/env node
// A smoke run of Folevi for Windows and Linux from source, on any computer (a Mac too, where the page gets the
// Windows look), always on a scratch data folder: never anyone's library, settings or credential store. It runs
// the development build with FOLEVI_PROBE and the scripted walk in scripts/smoke-flow.js (first launch -> Keep notes
// on my devices -> This device only -> Open Folevi -> the library -> Settings > Desktop app) and checks each step.
//   node scripts/smoke.mjs [--embedded]   (needs `cargo build` in src-tauri and the export in web/)
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
// Windows' program is Folevi.exe; Linux's is folevi (tauri.linux.conf.json; a Mac's disk doesn't mind the case).
const exe = join(root, "src-tauri/target/debug", process.platform === "win32" ? "Folevi.exe" : process.platform === "linux" ? "folevi" : "Folevi");
const data = mkdtempSync(join(tmpdir(), "folevi-smoke-"));
// --embedded: the interface as a release build serves it (installed beside the app as resources, src-tauri/target/
// debug/web here; a page served under the wrong name once left release builds blank while runs from the folder were
// fine). Otherwise the export in web/ through FOLEVI_SHELL_DIR.
const embedded = process.argv.includes("--embedded");
const env = { ...process.env, FOLEVI_PROBE: "1", FOLEVI_PROBE_SCRIPT: join(root, "scripts/smoke-flow.js"), FOLEVI_USER_DATA: data, ...(embedded ? {} : { FOLEVI_SHELL_DIR: join(root, "web") }) };
delete (embedded ? env : {}).FOLEVI_SHELL_DIR;
const child = spawn(exe, [], { env, stdio: ["ignore", "pipe", "pipe"] });
const steps = new Map();
let log = "";
const read = (chunk) => {
  log += chunk;
  for (const line of String(chunk).split("\n")) {
    const m = /^PROBE-FETCH main (\{"step".*)$/.exec(line.trim());
    if (!m) continue;
    try {
      const s = JSON.parse(m[1]);
      steps.set(s.step, s);
      console.log(`  ${s.step}: ${JSON.stringify(s)}`);
    } catch {
      /* not one of the walk's */
    }
  }
};
child.stdout.on("data", read);
child.stderr.on("data", read);

const deadline = Date.now() + 150_000;
while (Date.now() < deadline && !steps.has("settings") && !steps.has("error") && !steps.has("no-app")) await new Promise((r) => setTimeout(r, 1000));
child.kill();
rmSync(data, { recursive: true, force: true });

const checks = [
  ["first launch offers the library", steps.get("first-launch")?.ok === true],
  ["This device only sets up a library", steps.get("library-setup")?.ok === true],
  ["the app opens in the library", !!steps.get("app")],
  ["the caption buttons' corner is kept clear", process.platform === "linux" || parseFloat(steps.get("app")?.tabbarRight ?? "0") > 100],
  ["the library is on this computer", steps.get("library-info")?.configured === true && steps.get("library-info")?.kind === "device"],
  ["the starter notes are files", (steps.get("library-list")?.notes ?? 0) > 0],
  // Windows says "this PC", Linux "this computer".
  ["Settings > Desktop app speaks this platform", steps.get("settings")?.hasPC === (process.platform !== "linux") && steps.get("settings")?.shortcut === true],
];
for (const [name, ok] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
const failed = checks.filter(([, ok]) => !ok).length;
if (failed) console.log(log.split("\n").filter((l) => !l.startsWith("SERVE")).slice(-20).join("\n"));
process.exit(failed ? 1 : 0);
