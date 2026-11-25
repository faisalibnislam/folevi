#!/usr/bin/env node
// Scrolling the web app's screens in the Mac app (docs/perf/apple-results.md), on perf.mjs's scratch library (run
// `node apps/mac/scripts/perf.mjs --fresh --runs 1` once first). Nothing here touches the installed app, its
// folder or the owner's library. Launching the app brings it to the front: run it only with the owner's OK.
//
//   node apps/mac/scripts/perf-scroll.mjs [--label before] [--rounds 3] [--appearance dark] [--screens home,folders,notes]
//
// On each screen the page's tallest scrolling list is scrolled down and back, a step on every display frame (as a
// trackpad's momentum does), by the page itself; the frames that came late (over 1.5 frame times) and the
// slowest one, per screen. Results in apps/mac/build/perf/scroll-<label>.json.
import { mkdirSync, writeFileSync } from "node:fs";
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
const LABEL = arg("--label", "run");
const ROUNDS = Number(arg("--rounds", "3"));
const APPEARANCE = arg("--appearance", "dark");
// --screens folders,notes: only those.
const SCREENS = arg("--screens", "home,folders,notes").split(",");

/** Scrolls the tallest scrolling element down `distance` px and back over `seconds`, timing each frame. */
const BENCH = (distance, seconds) => `
  const all = [...document.querySelectorAll("*")].filter((el) => el.scrollHeight > el.clientHeight + 200 && /(auto|scroll)/.test(getComputedStyle(el).overflowY));
  const el = all.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
  if (!el) return { error: "nothing scrolls here" };
  const start = el.scrollTop;
  const frames = [];
  let last = performance.now();
  const t0 = last;
  const total = ${seconds} * 1000;
  await new Promise((done) => {
    const step = (now) => {
      frames.push(now - last);
      last = now;
      const k = Math.min(1, (now - t0) / total);
      el.scrollTop = start + ${distance} * (k < 0.5 ? k * 2 : (1 - k) * 2);
      if (k < 1) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  });
  frames.shift();
  const frame = frames.slice().sort((a, b) => a - b)[Math.floor(frames.length / 2)];
  const late = frames.filter((f) => f > frame * 1.5).length;
  return { frames: frames.length, frameMs: Math.round(frame * 10) / 10, late, worstMs: Math.round(Math.max(...frames)), scrolled: el.scrollHeight };`;

await launch({ dir, appearance: APPEARANCE });
await waitFor(dir, `return document.readyState === "complete" && !!document.querySelector("nav")`, 90_000);
await sleep(2000);

const results = { at: new Date().toISOString(), label: LABEL, appearance: APPEARANCE, screens: {} };
for (const [name, path] of [["home", "/documents"], ["folders", "/folders"], ["notes", "/notes"]].filter(([n]) => SCREENS.includes(n))) {
  await evaluate(dir, `location.assign(${JSON.stringify(path)}); return true;`).catch(() => undefined);
  await waitFor(dir, `return document.readyState === "complete" && location.pathname === ${JSON.stringify(path)}`, 30_000);
  await sleep(2500);
  const runs = [];
  for (let r = 0; r < ROUNDS; r++) {
    const res = await evaluate(dir, BENCH(3000, 3));
    if (res?.error) throw new Error(`${name}: ${res.error}`);
    runs.push(res);
    await sleep(800);
  }
  results.screens[name] = runs;
  console.log(name, JSON.stringify(runs));
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, `scroll-${LABEL}.json`), JSON.stringify(results, null, 2));
await command(dir, { cmd: "quit" }).catch(() => undefined);
