#!/usr/bin/env node
// Drives the Debug build of Folevi for Mac from a script (Debug/MacEval.swift on the app's side), like
// apps/ios/scripts/simulator.mjs for the iPhone app. Every run gets its own data folder (FOLEVI_USER_DATA, by
// default apps/mac/build/run/default), so nothing here touches the installed app, its folder or its Keychain.
//
//   node apps/mac/scripts/mac.mjs launch [--user-data DIR] [--offline] [--appearance dark] [--env K=V]...
//   node apps/mac/scripts/mac.mjs eval "return document.title"      (an async function body; or @file.js)
//   node apps/mac/scripts/mac.mjs shot out.png [--window 0]         (the page, from WKWebView's snapshot)
//   node apps/mac/scripts/mac.mjs open folevi-dev://tasks/today
//   node apps/mac/scripts/mac.mjs appearance light|dark|system
//   node apps/mac/scripts/mac.mjs windows | new-window [/path] | quit
//   node apps/mac/scripts/mac.mjs checks [--out results.json]       (the spike's checks, in the real app)
//   node apps/mac/scripts/mac.mjs measure [--minutes 10] [--out DIR]
//                                       footprint and energy impact of the app, idle then typing
//
// Commands other packages add on the app's side (MacEval.commands) run with `mac.mjs cmd <name> [json]`.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { appPath } from "./build.mjs";
import { MAC } from "./project.mjs";

const REPO = resolve(MAC, "../..");
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(name);
const positional = () => {
  const out = [];
  for (let i = 1; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      if (!["--offline", "--release", "--keep"].includes(argv[i])) i++;
      continue;
    }
    out.push(argv[i]);
  }
  return out;
};

export const userData = (dir) => resolve(dir ?? process.env.FOLEVI_USER_DATA ?? join(MAC, "build", "run", "default"));
const debugDir = (ud) => join(ud, "Debug");
const appInfo = (ud) => {
  try {
    return JSON.parse(readFileSync(join(debugDir(ud), "app.json"), "utf8"));
  } catch {
    return null;
  }
};
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// One test app at a time on this Mac, across every checkout and script (screens.mjs, web-styles.mjs --app,
// gates.mjs, e2e): several Debug apps drawing and being captured at once hung WindowServer and restarted the Mac
// (2026-10-28). A lock folder in the system's temporary folder holds the owning process; a dead owner's lock is taken.
const LOCK = join(tmpdir(), "folevi-mac-ui.lock");
let lockHeld = false;

/** Waits for, then holds, the one-app-at-a-time lock until this process exits. */
export async function holdUiLock({ timeoutMs = 60 * 60_000, label = process.argv[1] ?? "script" } = {}) {
  if (lockHeld) return;
  const until = Date.now() + timeoutMs;
  let told = false;
  for (;;) {
    try {
      mkdirSync(LOCK);
      writeFileSync(join(LOCK, "owner.json"), JSON.stringify({ pid: process.pid, label, at: new Date().toISOString() }));
      lockHeld = true;
      const release = () => {
        try {
          const owner = JSON.parse(readFileSync(join(LOCK, "owner.json"), "utf8"));
          if (owner.pid === process.pid) rmSync(LOCK, { recursive: true, force: true });
        } catch {
          // Already gone.
        }
      };
      process.on("exit", release);
      for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { release(); process.exit(130); });
      return;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      let owner = null;
      try {
        owner = JSON.parse(readFileSync(join(LOCK, "owner.json"), "utf8"));
      } catch {
        // Being written: wait a moment.
      }
      if (owner && !alive(owner.pid)) {
        rmSync(LOCK, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > until) throw new Error(`Another test app run holds ${LOCK}: ${JSON.stringify(owner)}`);
      if (!told) {
        console.error(`waiting for the other test app run to finish (${owner?.label ?? "?"}, pid ${owner?.pid ?? "?"})`);
        told = true;
      }
      await sleep(3000);
    }
  }
}

/** Starts the app on its own data folder; resolves with { pid, userData } once its eval hook is up. */
export async function launch({ dir, offline = false, appearance = null, env = {}, app = appPath(false), timeoutMs = 60000 } = {}) {
  await holdUiLock();
  const ud = userData(dir);
  const running = appInfo(ud);
  if (running && alive(running.pid)) return { pid: running.pid, userData: ud, reused: true };
  mkdirSync(ud, { recursive: true });
  rmSync(join(debugDir(ud), "app.json"), { force: true });
  const exe = join(app, "Contents", "MacOS", app.endsWith("Folevi.app") ? "Folevi" : "Folevi Dev");
  if (!existsSync(exe)) throw new Error(`No app at ${app}: run node apps/mac/scripts/build.mjs first.`);
  const child = spawn(exe, [], {
    env: { ...process.env, FOLEVI_USER_DATA: ud, ...(offline ? { FOLEVI_OFFLINE: "1" } : {}), ...env },
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
  });
  child.unref();
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const info = appInfo(ud);
    if (info && info.pid === child.pid) {
      // The first window's page has loaded (or the wait runs out).
      await waitFor(ud, "return (window.foleviDesktop ? 1 : 0) && document.readyState === 'complete'", until - Date.now()).catch(() => undefined);
      if (appearance) await command(ud, { cmd: "appearance", value: appearance }).catch(() => undefined);
      return { pid: child.pid, userData: ud, reused: false };
    }
    await sleep(200);
  }
  throw new Error("The app didn't start its eval hook in time.");
}

let seq = 0;
/** One request to the running app; resolves with its answer ({ value } or { error }). */
export async function command(ud, request, timeoutMs = 30000) {
  const info = appInfo(ud);
  if (!info || !alive(info.pid)) throw new Error(`Folevi Dev isn't running on ${ud} (mac.mjs launch).`);
  const id = `r${process.pid}-${Date.now().toString(36)}-${seq++}`;
  const out = join(debugDir(ud), `result-${id}.json`);
  writeFileSync(join(debugDir(ud), "request.json"), JSON.stringify({ id, ...request }));
  execFileSync("notifyutil", ["-p", info.notify]);
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (existsSync(out)) {
      const text = readFileSync(out, "utf8");
      rmSync(out, { force: true });
      return JSON.parse(text);
    }
    await sleep(50);
  }
  throw new Error(`No answer to ${request.cmd} within ${timeoutMs} ms.`);
}

export async function evaluate(ud, script, window) {
  const r = await command(ud, { cmd: "eval", script, ...(window !== undefined ? { window: Number(window) } : {}) });
  if (r.error) throw new Error(r.error);
  return r.value;
}

/** Waits until `script` returns something truthy. */
export async function waitFor(ud, script, timeoutMs = 20000) {
  const until = Date.now() + timeoutMs;
  let last;
  while (Date.now() < until) {
    try {
      last = await evaluate(ud, script);
      if (last) return last;
    } catch (e) {
      last = e.message;
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting (${JSON.stringify(last)}).`);
}

/** The spike's checks (docs/MAC_WEBKIT_PLAN.md §1), run in the real app's page. */
export const CHECKS = `
  const r = {};
  r.href = location.href;
  r.origin = location.origin;
  r.dataDesktop = document.documentElement.getAttribute("data-desktop");
  r.userAgent = navigator.userAgent;
  r.title = document.title;
  r.heading = (document.querySelector("h1") || {}).textContent || null;
  r.secureContext = window.isSecureContext;
  r.foleviShell = !!window.foleviShell && { platform: foleviShell.platform, shellVersion: foleviShell.shellVersion, deviceName: foleviShell.deviceName, initialMode: foleviShell.initialMode, places: foleviShell.places ? { current: foleviShell.places.current, background: foleviShell.places.background } : null, fileUrl: foleviShell.library.fileUrl("a".repeat(64), "image/png") };
  r.foleviDesktop = !!window.foleviDesktop && { platform: foleviDesktop.platform, members: Object.keys(foleviDesktop).sort(), e2eeShared: foleviDesktop.e2ee === (window.foleviShell && foleviShell.e2ee) };
  r.noCapacitor = typeof window.Capacitor === "undefined" && typeof window.foleviNative === "undefined";
  try { const k = await crypto.subtle.generateKey({ name: "X25519" }, false, ["deriveBits"]); r.x25519 = !!k.privateKey; } catch (e) { r.x25519 = "no: " + e.name; }
  try { const k = await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]); r.ed25519 = !!k.privateKey; } catch (e) { r.ed25519 = "no: " + e.name; }
  try { r.webLock = await navigator.locks.request("mac-check", async () => true); } catch (e) { r.webLock = "no: " + e.name; }
  r.broadcastChannel = typeof BroadcastChannel === "function";
  r.localStorage = (() => { try { localStorage.setItem("mac-check", "1"); return localStorage.getItem("mac-check") === "1"; } catch (e) { return "no: " + e.name; } })();
  r.indexedDB = await new Promise((resolve) => {
    try {
      const req = indexedDB.open("mac-check-db", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("s");
      req.onerror = () => resolve("no: " + (req.error && req.error.name));
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("s", "readwrite");
        tx.objectStore("s").put({ at: Date.now(), bytes: new Uint8Array([1, 2, 3]) }, "k");
        tx.oncomplete = () => { const g = db.transaction("s").objectStore("s").get("k"); g.onsuccess = () => { resolve(!!g.result && g.result.bytes instanceof Uint8Array); db.close(); }; };
      };
    } catch (e) { resolve("no: " + e.name); }
  });
  // The transport: a ping with a reply, an unavailable call's error shape, a big call through /_bridge.
  const host = (method, options) => window.webkit.messageHandlers.folevi.postMessage({ plugin: "FoleviHost", method, options });
  r.ping = await host("ping", { echo: "hello" });
  try { await window.foleviShell.library.info(); r.unavailable = "answered?"; } catch (e) { r.unavailable = { name: e.name, code: e.code, message: e.message }; }
  // Over 256 KB both ways: the options POSTed to /_bridge/<id>, the answer read back from /_bridge/<id>.
  {
    const id = "chk" + Date.now().toString(36) + "abcdef";
    const big = "x".repeat(300 * 1024);
    const posted = await fetch("app://folevi/_bridge/" + id, { method: "POST", body: JSON.stringify({ echo: big }) });
    const rep = await window.webkit.messageHandlers.folevi.postMessage({ plugin: "FoleviHost", method: "ping", bodyId: id });
    const back = rep && rep.bodyId ? await (await fetch("app://folevi/_bridge/" + rep.bodyId)).json() : null;
    r.bigCall = { posted: posted.status, answerByBody: !!(rep && rep.bodyId), intact: !!back && back.echo === big };
  }
  r.desktopNull = await window.foleviDesktop.getSettings();
  r.cssAppRegion = CSS.supports("-webkit-app-region", "drag") || CSS.supports("app-region", "drag");
  r.backdropFilter = CSS.supports("backdrop-filter", "blur(10px)") || CSS.supports("-webkit-backdrop-filter", "blur(10px)");
  r.popoverApi = typeof HTMLElement.prototype.showPopover === "function";
  r.hasSelector = CSS.supports("selector(:has(a))");
  r.prefersDark = matchMedia("(prefers-color-scheme: dark)").matches;
  r.persisted = await navigator.storage.persisted().catch(() => "no");
  return r;
`;

// ---------------------------------------------------------------- measure

/** Process ids of the system's WebKit helpers now (to tell which ones a launch adds). */
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
    if (!m) return null;
    return Number(m[1]) * (m[2] === "G" ? 1024 : m[2] === "K" ? 1 / 1024 : 1);
  } catch {
    return null;
  }
};
/** One `top` sample of energy impact ("power") for the pids, after a 5 s interval. */
const powerSample = (pids) => {
  const args = ["-l", "2", "-s", "5", "-stats", "pid,power"];
  for (const p of pids) args.push("-pid", String(p));
  const text = execFileSync("top", args, { encoding: "utf8" });
  const last = text.split(/\n(?=Processes:)/).pop() ?? "";
  let sum = 0;
  for (const line of last.split("\n")) {
    const m = /^\s*(\d+)\s+([\d.]+)\s*$/.exec(line);
    if (m && pids.includes(Number(m[1]))) sum += Number(m[2]);
  }
  return sum;
};
// Typing: a character every 120 ms into the focused field, or into a box this adds.
const TYPING_START = `
  if (window.__measureTimer) return true;
  let target = document.activeElement && (document.activeElement.isContentEditable || /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) ? document.activeElement : null;
  if (!target) {
    target = document.createElement("div");
    target.contentEditable = "true";
    target.style.cssText = "position:fixed;left:12px;right:12px;bottom:12px;height:120px;overflow:auto;font:15px/1.5 -apple-system;z-index:99999;background:Canvas;color:CanvasText;border:1px solid GrayText;padding:8px";
    document.body.appendChild(target);
  }
  target.focus();
  const words = "the quick brown fox jumps over the lazy dog ".split("");
  let i = 0;
  window.__measureTimer = setInterval(() => { document.execCommand("insertText", false, words[i++ % words.length]); }, 120);
  return true;
`;
const TYPING_STOP = `clearInterval(window.__measureTimer); window.__measureTimer = null; return true;`;

async function measure() {
  const minutes = Number(opt("--minutes", "10"));
  const out = resolve(opt("--out", join(MAC, "build", "measure")));
  mkdirSync(out, { recursive: true });
  const results = { minutes, startedAt: new Date().toISOString(), apps: {} };
  const apps = [];

  // The WebKit app (Debug build) on a scratch folder of its own.
  const wkDir = join(out, "webkit-user-data");
  rmSync(wkDir, { recursive: true, force: true });
  const beforeWk = webkitPids();
  const wk = await launch({ dir: wkDir });
  await sleep(4000);
  const wkHelpers = [...webkitPids()].filter((p) => !beforeWk.has(p));
  apps.push({ name: "webkit", pids: () => [wk.pid, ...wkHelpers], type: (on) => evaluate(wkDir, on ? TYPING_START : TYPING_STOP) });


  for (const phase of ["idle", "typing"]) {
    if (phase === "typing") for (const a of apps) await a.type(true);
    const until = Date.now() + minutes * 60000;
    const samples = Object.fromEntries(apps.map((a) => [a.name, { footprintMB: [], power: [] }]));
    while (Date.now() < until) {
      for (const a of apps) {
        const pids = a.pids();
        const mem = pids.map(footprintMB).filter((x) => x !== null);
        samples[a.name].footprintMB.push(Math.round(mem.reduce((s, x) => s + x, 0) * 10) / 10);
        samples[a.name].power.push(Math.round(powerSample(pids) * 10) / 10);
      }
    }
    if (phase === "typing") for (const a of apps) await a.type(false);
    for (const a of apps) {
      const s = samples[a.name];
      const avg = (xs) => (xs.length ? Math.round((xs.reduce((t, x) => t + x, 0) / xs.length) * 10) / 10 : null);
      results.apps[a.name] ??= { pids: a.pids() };
      results.apps[a.name][phase] = { samples: s.footprintMB.length, footprintMB: { avg: avg(s.footprintMB), max: Math.max(...s.footprintMB) }, energyImpact: { avg: avg(s.power), max: Math.max(...s.power) } };
    }
  }
  results.finishedAt = new Date().toISOString();
  writeFileSync(join(out, "measure.json"), JSON.stringify(results, null, 2));
  if (!has("--keep")) {
    await command(wkDir, { cmd: "quit" }).catch(() => undefined);
  }
  console.log(JSON.stringify(results, null, 2));
}

// ---------------------------------------------------------------- the command line

async function main() {
  const [cmd] = argv;
  const ud = userData(opt("--user-data"));
  const args = positional();
  const print = (v) => console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2));
  switch (cmd) {
    case "launch": {
      const env = {};
      argv.forEach((a, i) => {
        if (a === "--env" && argv[i + 1]?.includes("=")) {
          const [k, ...rest] = argv[i + 1].split("=");
          env[k] = rest.join("=");
        }
      });
      print(await launch({ dir: ud, offline: has("--offline"), appearance: opt("--appearance", null), env, app: opt("--app", appPath(has("--release"))) }));
      break;
    }
    case "eval": {
      const src = args[0]?.startsWith("@") ? readFileSync(args[0].slice(1), "utf8") : (args[0] ?? "return document.title");
      print(await evaluate(ud, src, opt("--window")));
      break;
    }
    case "shot": {
      const file = resolve(args[0] ?? join(MAC, "build", "shot.png"));
      const r = await command(ud, { cmd: "shot", out: file, ...(opt("--window") ? { window: Number(opt("--window")) } : {}) });
      if (r.error) throw new Error(r.error);
      print(r.value);
      break;
    }
    case "open":
      print(await command(ud, { cmd: "open", url: args[0] }));
      break;
    case "appearance":
      print(await command(ud, { cmd: "appearance", value: args[0] ?? "system" }));
      break;
    case "windows":
      print((await command(ud, { cmd: "windows" })).value);
      break;
    case "new-window":
      print(await command(ud, { cmd: "newWindow", path: args[0] ?? "/" }));
      break;
    case "quit":
      print(await command(ud, { cmd: "quit" }).catch((e) => e.message));
      break;
    case "checks": {
      const r = await evaluate(ud, CHECKS);
      if (opt("--out")) writeFileSync(resolve(opt("--out")), JSON.stringify(r, null, 2));
      print(r);
      break;
    }
    case "measure":
      await measure();
      break;
    case "cmd":
      print(await command(ud, { cmd: args[0], ...(args[1] ? JSON.parse(args[1]) : {}) }));
      break;
    default:
      console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 21).join("\n"));
      process.exitCode = cmd ? 1 : 0;
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e.message ?? e);
    process.exitCode = 1;
  });
}
