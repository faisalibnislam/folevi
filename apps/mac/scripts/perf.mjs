#!/usr/bin/env node
// Launch time, memory and energy of the native frame (docs/MAC_REBUILD_PLAN.md M10): the Debug app on a scratch
// library with a long list (2,000 notes by default) and several places in its list (the library and two made-up
// accounts, never signed in: in a test run the app starts no runner for them). Nothing here touches the installed
// app, its folder, its Keychain or the owner's library.
//
//   node apps/mac/scripts/perf.mjs [--fresh] [--notes 2000] [--runs 3] [--idle 60]
//
// --fresh makes the scratch library again (apps/mac/build/run/perf and perf-library). Each run quits the app and
// launches it again, timing the launch (the eval hook up) and the first screen (the engine ready, Home drawn);
// then All notes is opened and the footprint (the app and the WebKit helpers it started) and `top`'s energy
// impact are sampled while idle. Results in apps/mac/build/perf/perf.json. Pause Parallels first (prlctl list -a).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const NOTES = Number(arg("--notes", "2000"));
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

const ENGINE = `
  const engine = window.__foleviEngine;
  const place = window.__foleviNativeChrome && window.__foleviNativeChrome.place;
  if (!engine || !place) throw new Error("no engine in this page");
  let n = 0;
  const run = async (name, args) => {
    const reply = JSON.parse(await engine.handle({ v: 1, id: "pf" + n++, kind: "command", place, name, args }));
    if (reply.error) throw new Error(name + ": " + JSON.stringify(reply.error));
    return reply.result ?? reply.value;
  };`;

/** A library on the test folder (local mode), then the long list, through the native frame's engine. */
async function setUp() {
  await quit();
  rmSync(dir, { recursive: true, force: true });
  rmSync(library, { recursive: true, force: true });
  mkdirSync(library, { recursive: true });
  await launch({ dir, env: { ...env, FOLEVI_WEB_FRAME: "1" } });
  await waitFor(dir, `return /Where should your (notes|library) live\\?/.test(document.body.innerText)`, 90_000);
  const info = await evaluate(dir, `return await foleviShell.library.setup({ kind: "folder" })`);
  if (!String(info?.displayPath ?? "").endsWith("perf-library")) throw new Error(`Not the script's own library: ${JSON.stringify(info)}. Stopped.`);
  await evaluate(dir, `await foleviShell.setMode("local"); setTimeout(() => location.reload(), 50); return true;`);
  await sleep(3000);
  await waitFor(dir, `return document.readyState === "complete" && !!document.querySelector('nav[aria-label="Folio"]')`, 90_000);
  await quit();
  await launch({ dir, env });
  await waitFor(dir, `return !!window.__foleviEngine && !!window.__foleviNativeChrome`, 90_000);
  await sleep(1500);
  const words = "Kyoto budget launch office passport garden market reading recipe meeting plan design".split(" ");
  for (let start = 0; start < NOTES; start += 100) {
    const count = Math.min(100, NOTES - start);
    await evaluate(
      dir,
      `${ENGINE}
      const words = ${JSON.stringify(words)};
      for (let i = ${start}; i < ${start + count}; i++) {
        const w = (k) => words[(i * 7 + k) % words.length];
        await run("note.create", { text: "Note " + (i + 1) + ": " + w(0) + " and " + w(3) + "\\nAbout the " + w(1) + ", the " + w(2) + " and the " + w(5) + ". " + w(4) + " " + w(6) + ".", open: false });
      }
      return true;`,
    );
    process.stdout.write(`\r${start + count} notes`);
  }
  process.stdout.write("\n");
  await sleep(3000);
  await quit();
  // Several places in the list: the library (open) and two accounts.
  const places = JSON.parse(readFileSync(join(dir, "places.json"), "utf8"));
  places.accounts = [
    { userId: "perf-account-1", name: "Sam Rivera", email: "sam@example.com", workspaces: [], unread: 0, reminders: 0, waiting: 0 },
    { userId: "perf-account-2", name: "Work", email: "work@example.com", workspaces: [], unread: 0, reminders: 0, waiting: 0 },
  ];
  writeFileSync(join(dir, "places.json"), JSON.stringify(places));
  writeFileSync(join(dir, "perf.json"), JSON.stringify({ notes: NOTES, at: new Date().toISOString() }));
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
  await waitFor(dir, `return !!window.__foleviEngine`, 90_000);
  for (let i = 0; i < 300; i++) {
    const s = await command(dir, { cmd: "frame" }).catch(() => null);
    if (s?.value?.engine === "ready") break;
    await sleep(100);
  }
  const ready = performance.now() - t0;
  await sleep(5000);
  const pid = appPid();
  const helpers = [...webkitPids()].filter((p) => !before.has(p));
  const pids = [pid, ...helpers];
  const home = pids.map(footprintMB).filter((x) => x !== null).reduce((s, x) => s + x, 0);
  // The long list.
  const t1 = performance.now();
  await command(dir, { cmd: "open", url: "folevi-dev://notes" });
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
  notes: JSON.parse(readFileSync(join(dir, "perf.json"), "utf8")).notes,
  places: 3,
  runs,
  median: { launchMs: median(runs.map((r) => r.launchMs)), readyMs: median(runs.map((r) => r.readyMs)), homeMB: median(runs.map((r) => r.footprintMB.home)), listMB: median(runs.map((r) => r.footprintMB.list)) },
};
writeFileSync(join(out, "perf.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results.median));
