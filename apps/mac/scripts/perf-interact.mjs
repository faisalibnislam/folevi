#!/usr/bin/env node
// What using the native frame costs (the owner's 2026-10-30 report: slow to open a note, to switch tabs, to type),
// on perf.mjs's scratch library (run `node apps/mac/scripts/perf.mjs --fresh --runs 1` once first). Nothing here
// touches the installed app, its folder or the owner's library.
//
//   node apps/mac/scripts/perf-interact.mjs [--rounds 8] [--chars 80] [--label before]
//
// Opening a note: from the frame's `open` to the note's text in the page's editor (the page's own clock, so the
// command's trip is in it). Switching tabs: the same, between two open notes, back and forth. Typing: characters
// typed at the end of a long note one per frame; the time from one frame to the next while typing (a frame that
// took long is a stall the person sees), and the CPU the app and its web page used meanwhile.
// Results in apps/mac/build/perf/interact-<label>.json.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
const ROUNDS = Number(arg("--rounds", "8"));
const CHARS = Number(arg("--chars", "80"));
const LABEL = arg("--label", "run");
const env = { FOLEVI_TEST_FOLDER: library };

const appPid = () => JSON.parse(readFileSync(join(dir, "Debug", "app.json"), "utf8")).pid;
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const p95 = (xs) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))];
const round = (x) => Math.round(x * 10) / 10;
/** CPU seconds a process has used so far (`ps` TIME, minutes:seconds.hundredths). */
const cpuSeconds = (pid) => {
  try {
    const t = execFileSync("ps", ["-o", "time=", "-p", String(pid)], { encoding: "utf8" }).trim();
    const [m, s] = t.split(":");
    return Number(m) * 60 + Number(s);
  } catch {
    return 0;
  }
};
const webkitPids = () =>
  new Set(
    execFileSync("ps", ["-axo", "pid=,comm="], { encoding: "utf8" })
      .split("\n")
      .filter((l) => /com\.apple\.WebKit\./.test(l))
      .map((l) => Number(l.trim().split(/\s+/)[0])),
  );

const ENGINE = `
  const engine = window.__foleviEngine;
  const place = window.__foleviNativeChrome && window.__foleviNativeChrome.place;
  if (!engine || !place) throw new Error("no engine in this page");
  let n = 0;
  const run = async (name, args) => {
    const reply = JSON.parse(await engine.handle({ v: 1, id: "pi" + n++, kind: "command", place, name, args }));
    if (reply.error) throw new Error(name + ": " + JSON.stringify(reply.error));
    return reply.result ?? reply.value;
  };`;

/** Opens `path` and returns the page's ms until the editor holds `text` (null when it never did). */
async function timeOpen(path, text) {
  await evaluate(
    dir,
    `window.__piDone = null;
     const t0 = performance.now();
     const want = ${JSON.stringify(text)};
     const check = () => {
       const ed = document.querySelector(".fb-editor");
       if (ed && ed.textContent.includes(want)) { window.__piDone = performance.now() - t0; return true; }
       return false;
     };
     const tick = () => { if (!check()) requestAnimationFrame(tick); };
     requestAnimationFrame(tick);
     return true;`,
  );
  await command(dir, { cmd: "frame", do: "open", path });
  for (let i = 0; i < 200; i++) {
    const v = await evaluate(dir, `return window.__piDone`);
    if (typeof v === "number") return v;
    await sleep(25);
  }
  return null;
}

await command(dir, { cmd: "quit" }).catch(() => undefined);
await sleep(2500);
await launch({ dir, env });
await waitFor(dir, `return !!window.__foleviEngine && !!window.__foleviNativeChrome`, 90_000);
for (let i = 0; i < 300; i++) {
  const s = await command(dir, { cmd: "frame" }).catch(() => null);
  if (s?.value?.engine === "ready") break;
  await sleep(100);
}
await sleep(3000);

// Two short notes and a long one, made once and kept in the scratch library.
const notes = await evaluate(
  dir,
  `${ENGINE}
   const list = await run("notes.search", { text: "Perf interact" }).catch(() => null);
   const found = {};
   for (const h of (list && list.hits) || []) found[h.title] = h.id;
   const make = async (title, lines) => found[title] ?? (await run("note.create", { text: title + "\\n" + lines.join("\\n"), open: false })).id;
   const para = (i) => "Line " + i + " of the long note, about the garden, the market and the reading list for the week.";
   return {
     a: await make("Perf interact A", ["Alpha body text for the first note."]),
     b: await make("Perf interact B", ["Bravo body text for the second note."]),
     long: await make("Perf interact long", Array.from({ length: 400 }, (_, i) => para(i))),
   };`,
);
if (!notes?.a || !notes?.b || !notes?.long) throw new Error(`Couldn't make the notes: ${JSON.stringify(notes)}`);

// Opening: Home between opens, so each is a note opened from a native screen.
const opens = [];
for (let r = 0; r < ROUNDS; r++) {
  await command(dir, { cmd: "frame", do: "open", path: "/documents" });
  await sleep(600);
  const ms = await timeOpen(`/d/${r % 2 ? notes.b : notes.a}`, r % 2 ? "Bravo body" : "Alpha body");
  if (ms !== null) opens.push(ms);
  await sleep(400);
}
// Switching: A and B both open as tabs, back and forth.
const switches = [];
for (let r = 0; r < ROUNDS; r++) {
  const ms = await timeOpen(`/d/${r % 2 ? notes.a : notes.b}`, r % 2 ? "Alpha body" : "Bravo body");
  if (ms !== null) switches.push(ms);
  await sleep(400);
}

// Typing at the end of the long note.
await timeOpen(`/d/${notes.long}`, "Line 399 of the long note");
await sleep(1500);
const pid = appPid();
const web = [...webkitPids()];
const cpu0 = { app: cpuSeconds(pid), web: web.reduce((s, p) => s + cpuSeconds(p), 0) };
const frames = await evaluate(
  dir,
  `const ed = document.querySelector(".fb-editor");
   const last = ed.lastElementChild;
   const range = document.createRange();
   range.selectNodeContents(last);
   range.collapse(false);
   ed.focus();
   const sel = getSelection();
   sel.removeAllRanges();
   sel.addRange(range);
   const gaps = [];
   let prev = performance.now();
   const text = "the quick brown fox jumps over the lazy dog ";
   for (let i = 0; i < ${CHARS}; i++) {
     document.execCommand("insertText", false, text[i % text.length]);
     await new Promise((r) => requestAnimationFrame(() => r()));
     const now = performance.now();
     gaps.push(now - prev);
     prev = now;
   }
   return gaps;`,
);
await sleep(1500);
const cpu1 = { app: cpuSeconds(pid), web: web.reduce((s, p) => s + cpuSeconds(p), 0) };

const results = {
  at: new Date().toISOString(),
  label: LABEL,
  openMs: { median: round(median(opens)), p95: round(p95(opens)), all: opens.map(round) },
  switchMs: { median: round(median(switches)), p95: round(p95(switches)), all: switches.map(round) },
  typing: {
    chars: CHARS,
    frameMs: { median: round(median(frames)), p95: round(p95(frames)), max: round(Math.max(...frames)), over33: frames.filter((g) => g > 33).length },
    cpuSeconds: { app: round(cpu1.app - cpu0.app), webkit: round(cpu1.web - cpu0.web) },
  },
};
mkdirSync(out, { recursive: true });
writeFileSync(join(out, `interact-${LABEL}.json`), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
await command(dir, { cmd: "quit" }).catch(() => undefined);
