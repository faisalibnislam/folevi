#!/usr/bin/env node
// Scrolling the native screens (the owner's 2026-10-30 report: Home and Folders jump and drop frames), on
// perf.mjs's scratch library (run `node apps/mac/scripts/perf.mjs --fresh --runs 1` once first), with a dozen
// folders of notes added once. Nothing here touches the installed app, its folder or the owner's library.
//
//   node apps/mac/scripts/perf-scroll.mjs [--label before] [--rounds 3] [--appearance dark]
//
// Each screen is scrolled down and back by the Debug app's `scrollBench` (a step on every display frame, as a
// trackpad's momentum does); the frames the main thread missed meanwhile, per screen. Results in
// apps/mac/build/perf/scroll-<label>.json.
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

const ENGINE = `
  const engine = window.__foleviEngine;
  const place = window.__foleviNativeChrome && window.__foleviNativeChrome.place;
  if (!engine || !place) throw new Error("no engine in this page");
  let n = 0;
  const run = async (name, args, kind = "command") => {
    const reply = JSON.parse(await engine.handle({ v: 1, id: "ps" + n++, kind, place, name, args }));
    if (reply.error) throw new Error(name + ": " + JSON.stringify(reply.error));
    return reply.result ?? reply.value;
  };`;

await command(dir, { cmd: "quit" }).catch(() => undefined);
await sleep(2500);
await launch({ dir, env: { FOLEVI_TEST_FOLDER: library } });
await waitFor(dir, `return !!window.__foleviEngine && !!window.__foleviNativeChrome`, 90_000);
for (let i = 0; i < 300; i++) {
  const s = await command(dir, { cmd: "frame" }).catch(() => null);
  if (s?.value?.engine === "ready") break;
  await sleep(100);
}
await command(dir, { cmd: "frame", do: "front" });
await command(dir, { cmd: "frame", do: "resize", w: 1400, h: 820 });
await command(dir, { cmd: "appearance", value: APPEARANCE }).catch(() => undefined);
await sleep(2000);

// A dozen folders with a few notes each, made once (Folders and Home's recent folders draw their cards).
await evaluate(
  dir,
  `${ENGINE}
   const tree = await run("folders.tree", {}, "query").catch(() => null);
   const names = JSON.stringify(tree || "");
   if (!names.includes("Scroll folder 12")) {
     const colors = ["red", "orange", "yellow", "green", "blue", "purple", "pink", "gray"];
     for (let f = 1; f <= 12; f++) {
       const { id } = await run("folder.create", { name: "Scroll folder " + f, color: colors[f % colors.length] });
       for (let k = 1; k <= 4; k++) await run("note.create", { folderId: id, title: "Folder " + f + " note " + k, open: false });
     }
   }
   return true;`,
);
await sleep(2000);

const results = { at: new Date().toISOString(), label: LABEL, appearance: APPEARANCE, screens: {} };
for (const [name, path] of [["home", "/documents"], ["folders", "/folders"], ["notes", "/notes"]]) {
  await command(dir, { cmd: "frame", do: "open", path });
  await sleep(2500);
  const runs = [];
  for (let r = 0; r < ROUNDS; r++) {
    const res = await command(dir, { cmd: "scrollBench", distance: 3000, seconds: 3 }, 60_000);
    if (res.error) throw new Error(`${name}: ${res.error}`);
    runs.push(res.value);
    await sleep(800);
  }
  results.screens[name] = runs;
  console.log(name, JSON.stringify(runs));
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, `scroll-${LABEL}.json`), JSON.stringify(results, null, 2));
await command(dir, { cmd: "quit" }).catch(() => undefined);
