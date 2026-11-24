#!/usr/bin/env node
// Runs and drives the Debug Folevi: always with a scratch data folder (FOLEVI_USER_DATA), never the owner's
// library or any installed app's data.
//
//   node apps/mac/scripts/app.mjs launch [--demo] [--data <dir>] [--fresh]   start (quits a running one first)
//   node apps/mac/scripts/app.mjs cmd <name> [json]                           a Debug command (MacEval.swift)
//   node apps/mac/scripts/app.mjs shot <file.png> [--front]                   a picture of the main (or frontmost) window
//   node apps/mac/scripts/app.mjs quit
//
// Debug commands the app knows: state, go {path, tab}, gate {action, values}, palette, inspector {value, tab}, style
// {value}, ask, quickadd, settings {section}, eval {script}, appearance {value}; and the shared Places': places, switch,
// add-account, wake, hide.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CORE = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(CORE, "build/dd/Build/Products/Debug/Folevi Dev.app");
const BIN = join(APP, "Contents/MacOS/Folevi Dev");
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const value = (n, d) => (argv.indexOf(n) >= 0 ? argv[argv.indexOf(n) + 1] : d);
const DATA = resolve(value("--data", process.env.FOLEVI_USER_DATA || join(CORE, "build/run/scratch")));
const DEBUG = join(DATA, "Debug");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pid() {
  try {
    return Number(readFileSync(join(DEBUG, "pid"), "utf8").trim()) || null;
  } catch {
    return null;
  }
}

function alive(p) {
  try {
    process.kill(p, 0);
    return true;
  } catch {
    return false;
  }
}

/** Every running copy of this build (a crashed run can leave its pid file behind). */
function running() {
  try {
    return execFileSync("pgrep", ["-f", BIN], { encoding: "utf8" }).split("\n").map(Number).filter(Boolean);
  } catch {
    return [];
  }
}

async function quit() {
  // A normal quit first (the app saves its windows), then a signal if it doesn't go.
  if (running().length) {
    try { execFileSync("osascript", ["-e", 'tell application id "com.folevi.mac.dev" to quit']); } catch {}
    for (let i = 0; i < 40 && running().length; i++) await sleep(100);
  }
  for (const p of running()) {
    process.kill(p, "SIGTERM");
    for (let i = 0; i < 50 && alive(p); i++) await sleep(100);
    if (alive(p)) process.kill(p, "SIGKILL");
  }
}

async function cmd(name, args = {}, timeout = 20000) {
  const id = Math.random().toString(36).slice(2);
  mkdirSync(join(DEBUG, "requests"), { recursive: true });
  const answer = join(DEBUG, "answers", id + ".json");
  writeFileSync(join(DEBUG, "requests", id + ".json.tmp"), JSON.stringify({ id, cmd: name, ...args }));
  execFileSync("mv", [join(DEBUG, "requests", id + ".json.tmp"), join(DEBUG, "requests", id + ".json")]);
  for (let t = 0; t < timeout; t += 100) {
    if (existsSync(answer)) {
      const out = JSON.parse(readFileSync(answer, "utf8"));
      rmSync(answer, { force: true });
      return out;
    }
    await sleep(100);
  }
  throw new Error(`no answer to ${name} in ${timeout} ms`);
}

function windows(p) {
  const tool = join(CORE, "build/tools/winlist");
  if (!existsSync(tool)) {
    mkdirSync(dirname(tool), { recursive: true });
    execFileSync("swiftc", ["-O", "-o", tool, join(CORE, "scripts/winlist.swift")]);
  }
  return JSON.parse(execFileSync(tool, [String(p)], { encoding: "utf8" }));
}

const [verb, ...rest] = argv;
if (verb === "launch") {
  await quit();
  if (flag("--fresh")) rmSync(DATA, { recursive: true, force: true });
  mkdirSync(DEBUG, { recursive: true });
  rmSync(join(DEBUG, "pid"), { force: true });
  const env = { ...process.env, FOLEVI_USER_DATA: DATA, FOLEVI_UPDATES: "off" };
  if (flag("--demo")) env.FOLEVI_DEMO = "1";
  const child = spawn(BIN, [], { env, detached: true, stdio: "ignore" });
  child.unref();
  for (let i = 0; i < 200 && !pid(); i++) await sleep(100);
  console.log(JSON.stringify({ pid: pid(), data: DATA, demo: flag("--demo") }));
} else if (verb === "cmd") {
  const [name, json] = rest;
  console.log(JSON.stringify(await cmd(name, json ? JSON.parse(json) : {}), null, 2));
} else if (verb === "shot") {
  const file = resolve(rest[0] || join(CORE, "screens/shot.png"));
  mkdirSync(dirname(file), { recursive: true });
  const p = running()[0] ?? pid();
  try {
    execFileSync("osascript", ["-e", `tell application "System Events" to set frontmost of (first process whose unix id is ${p}) to true`]);
  } catch {}
  await sleep(400);
  const ws = windows(p).filter((w) => w.layer === 0 && w.width > 200 && w.height > 120);
  if (!ws.length) throw new Error("no window on screen");
  // --front: the frontmost window (Settings, a sheet's window); otherwise the biggest (the main window).
  const target = flag("--front") ? ws[0] : ws.sort((a, b) => b.width * b.height - a.width * a.height)[0];
  execFileSync("screencapture", ["-x", "-o", "-l", String(target.id), file]);
  console.log(file);
} else if (verb === "quit") {
  await quit();
} else {
  console.log("usage: app.mjs launch [--demo] [--fresh] | cmd <name> [json] | shot <file> | quit");
}
