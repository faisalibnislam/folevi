#!/usr/bin/env node
// Launch time, memory and energy of the Mac app (the web app in WKWebView, docs/perf/apple-results.md): the Debug
// app on a scratch library and several places in its list (the library and two made-up accounts, never signed in).
// Nothing here touches the installed app, its folder, its Keychain or the owner's library. Launching the app
// brings it to the front: run it only with the owner's OK (they keep working on this Mac).
//
//   node apps/mac/scripts/perf.mjs [--fresh] [--library <generated library folder>] [--runs 3] [--idle 60]
//
// --fresh makes the scratch library again (apps/mac/build/run/perf and perf-library). Each run quits the app and
// launches it again, timing the launch (the eval hook up, the first page loaded) and the first screen drawn; then
// All notes is opened and the footprint (the app and the WebKit helpers it started) and `top`'s energy impact
// are sampled while idle. Results in apps/mac/build/perf/perf.json. Pause Parallels first (prlctl list -a).
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { command, evaluate, launch, waitFor } from "./mac.mjs";

const MAC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(MAC, "build", "run", "perf");
const library = join(MAC, "build", "run", "perf-library");
const out = join(MAC, "build", "perf");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const SOURCE = arg("--library", null) ? resolve(arg("--library", null)) : null;
/** The web app's first screen is drawn (its page loaded, the sidebar or the bottom bar in). */
const DRAWN = `return document.readyState === "complete" && !!document.querySelector("nav")`;
const RUNS = Number(arg("--runs", "3"));
const IDLE = Number(arg("--idle", "60"));
const env = { FOLEVI_TEST_FOLDER: library };

const appPid = () => JSON.parse(readFileSync(join(dir, "Debug", "app.json"), "utf8")).pid;
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function quit() {
  let pid = null;
  try {
    pid = appPid();
  } catch {
    return;
  }
  await command(dir, { cmd: "quit" }).catch(() => undefined);
  for (let i = 0; i < 80 && alive(pid); i++) await sleep(250);
  if (alive(pid)) process.kill(pid, "SIGTERM");
  await sleep(2000);
}

const webkitPids = () =>
  new Set(
    execFileSync("ps", ["-axo", "pid=,comm="], { encoding: "utf8" })
      .split("\n")
      .filter((l) => /com\.apple\.WebKit\./.test(l))
      .map((l) => Number(l.trim().split(/\s+/)[0])),
  );
const footprintMB = (pid) => {
  try {
    const text = execFileSync("footprint", ["-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const m = /Footprint:\s*([\d.]+)\s*([KMG])B/.exec(text);
    return m ? Number(m[1]) * (m[2] === "G" ? 1024 : m[2] === "K" ? 1 / 1024 : 1) : null;
  } catch {
    return null;
  }
};
const powerSample = (pids) => {
  const args = ["-l", "2", "-s", "5", "-stats", "pid,power"];
  for (const p of pids) args.push("-pid", String(p));
  const last = execFileSync("top", args, { encoding: "utf8" }).split(/\n(?=Processes:)/).pop() ?? "";
  let sum = 0;
  for (const line of last.split("\n")) {
    const m = /^\s*(\d+)\s+([\d.]+)\s*$/.exec(line);
    if (m && pids.includes(Number(m[1]))) sum += Number(m[2]);
  }
  return sum;
};
const round = (x) => Math.round(x * 10) / 10;
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/**
 * The scratch library (local mode) the runs open. With --library <folder>, a library generated elsewhere (the perf
 * pass's 5,000 notes) is copied in first; otherwise the library starts empty and the numbers are the frame's alone.
 * (The native screens' engine that used to make the notes, window.__foleviEngine, is gone with them.)
 */
async function setUp() {
  await quit();
  rmSync(dir, { recursive: true, force: true });
  rmSync(library, { recursive: true, force: true });
  mkdirSync(library, { recursive: true });
  if (SOURCE) cpSync(SOURCE, library, { recursive: true });
  await launch({ dir, env });
  await waitFor(dir, `return /Where should your (notes|library) live\\?/.test(document.body.innerText) || !!document.querySelector("nav")`, 90_000);
  const info = await evaluate(dir, `return await foleviShell.library.setup({ kind: "folder" })`);
  if (!String(info?.displayPath ?? "").endsWith("perf-library")) throw new Error(`Not the script's own library: ${JSON.stringify(info)}. Stopped.`);
  await evaluate(dir, `await foleviShell.setMode("local"); setTimeout(() => location.reload(), 50); return true;`);
  await sleep(3000);
  await waitFor(dir, DRAWN, 90_000);
  await quit();
  // Several places in the list: the library (open) and two accounts.
  const places = JSON.parse(readFileSync(join(dir, "places.json"), "utf8"));
  places.accounts = [
    { userId: "perf-account-1", name: "Sam Rivera", email: "sam@example.com", workspaces: [], unread: 0, reminders: 0, waiting: 0 },
    { userId: "perf-account-2", name: "Work", email: "work@example.com", workspaces: [], unread: 0, reminders: 0, waiting: 0 },
  ];
  writeFileSync(join(dir, "places.json"), JSON.stringify(places));
  writeFileSync(join(dir, "perf.json"), JSON.stringify({ library: SOURCE ?? "empty", at: new Date().toISOString() }));
}

if (process.argv.includes("--fresh") || !existsSync(join(dir, "perf.json"))) await setUp();
mkdirSync(out, { recursive: true });
await quit();

const runs = [];
for (let r = 0; r < RUNS; r++) {
  const before = webkitPids();
  const t0 = performance.now();
  await launch({ dir, env });
  const hook = performance.now() - t0;
  await waitFor(dir, DRAWN, 90_000);
  const ready = performance.now() - t0;
  await sleep(5000);
  const pid = appPid();
  const helpers = [...webkitPids()].filter((p) => !before.has(p));
  const pids = [pid, ...helpers];
  const home = pids.map(footprintMB).filter((x) => x !== null).reduce((s, x) => s + x, 0);
  // The long list.
  const t1 = performance.now();
  await evaluate(dir, `location.assign("/notes"); return true;`).catch(() => undefined);
  await waitFor(dir, DRAWN, 30_000);
  await sleep(4000);
  const listOpen = performance.now() - t1;
  const list = pids.map(footprintMB).filter((x) => x !== null).reduce((s, x) => s + x, 0);
  const run = { launchMs: Math.round(hook), readyMs: Math.round(ready), footprintMB: { home: round(home), list: round(list), app: round(footprintMB(pid) ?? 0) }, helpers: helpers.length };
  if (r === RUNS - 1) {
    // Idle energy and memory with the list on screen.
    const power = [];
    const mem = [];
    const until = Date.now() + IDLE * 1000;
    while (Date.now() < until) {
      power.push(powerSample(pids));
      mem.push(pids.map(footprintMB).filter((x) => x !== null).reduce((s, x) => s + x, 0));
    }
    run.idle = { seconds: IDLE, energyImpact: { avg: round(power.reduce((s, x) => s + x, 0) / power.length), max: round(Math.max(...power)) }, footprintMB: { avg: round(mem.reduce((s, x) => s + x, 0) / mem.length), max: round(Math.max(...mem)) } };
    run.listOpenWallMs = Math.round(listOpen);
  }
  runs.push(run);
  console.log(`run ${r + 1}: ${JSON.stringify(run)}`);
  await quit();
}

const results = {
  at: new Date().toISOString(),
  library: JSON.parse(readFileSync(join(dir, "perf.json"), "utf8")).library,
  places: 3,
  runs,
  median: { launchMs: median(runs.map((r) => r.launchMs)), readyMs: median(runs.map((r) => r.readyMs)), homeMB: median(runs.map((r) => r.footprintMB.home)), listMB: median(runs.map((r) => r.footprintMB.list)) },
};
writeFileSync(join(out, "perf.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results.median));
