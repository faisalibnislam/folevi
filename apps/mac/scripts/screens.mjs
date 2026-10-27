#!/usr/bin/env node
// Whole screens, web vs native (docs/MAC_REBUILD_PLAN.md section 3.2), in the real Debug app on one scratch
// library: the app draws each screen twice, once in the native frame and once as the web app the shipped Mac
// app shows (FOLEVI_WEB_FRAME=1), with the same notes, the same engine, the same fonts and the same window size,
// light and dark; diff.mjs compares the two.
//
//   node apps/mac/scripts/screens.mjs [--fresh] [--only home,notes] [--size 1280x820]
//
// Everything lives in apps/mac/build/run/screens (the app's data) and apps/mac/build/run/screens-library (the
// library folder, FOLEVI_TEST_FOLDER): never the installed app's folder, Keychain or library. --fresh starts
// both again (first launch, library setup and the fixture notes). Needs the Debug build (build.mjs) and the shell
// export in apps/mac/web (apps/web/scripts/build-shell.mjs).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { command, evaluate, launch, waitFor } from "./mac.mjs";
import { diffAll, writeReport } from "./diff.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const MAC = resolve(here, "..");
const repo = resolve(MAC, "../..");
const require = createRequire(join(repo, "apps/web/package.json"));
const { webkit } = require("@playwright/test");

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const [width, height] = (arg("--size") ?? "1280x820").split("x").map(Number);
const dir = join(MAC, "build", "run", "screens");
const library = join(MAC, "build", "run", "screens-library");
const out = join(MAC, "screens-report");

/** The screens, by id: the folevi-dev:// link that opens each one. */
export const SCREENS = [
  { id: "home", link: "folevi-dev://documents" },
  { id: "notes", link: "folevi-dev://notes" },
  { id: "starred", link: "folevi-dev://starred" },
  { id: "drafts", link: "folevi-dev://drafts" },
  { id: "tasks-today", link: "folevi-dev://tasks/today" },
  { id: "tasks-upcoming", link: "folevi-dev://tasks/upcoming" },
  { id: "calendar", link: "folevi-dev://calendar" },
  { id: "templates", link: "folevi-dev://templates" },
  { id: "archive", link: "folevi-dev://archive" },
  { id: "trash", link: "folevi-dev://trash" },
  // The first fixture note ("Kyoto in November"), by its id from fixture.json.
  { id: "note", link: (fx) => `folevi-dev://d/${fx.notes[0]}`, settle: 2500, ...noteTool("contents", "Table of contents") },
  // The note's own sidebar, each tool tab (the web's tab clicked, the native one chosen in its defaults).
  { id: "note-comments", link: (fx) => `folevi-dev://d/${fx.notes[0]}`, settle: 1200, ...noteTool("comments", "Comments") },
  { id: "note-tasks", link: (fx) => `folevi-dev://d/${fx.notes[0]}`, settle: 1200, ...noteTool("tasks", "Tasks in this page") },
  { id: "note-attachments", link: (fx) => `folevi-dev://d/${fx.notes[0]}`, settle: 1200, ...noteTool("attachments", "Attachments and links") },
  // A folder with a subfolder (Travel, with Japan), and the Folders and Tags pages.
  { id: "folder", link: (fx) => `folevi-dev://folders/${fx.folders?.travel}` },
  { id: "folders", link: "folevi-dev://folders" },
  { id: "tags", link: "folevi-dev://tags" },
];

/** A note screen showing one tab of the note's sidebar: `defaults` for the native frame, `web` run in the web frame. */
function noteTool(tab, title) {
  return {
    defaults: { "folevi.noteSidebar.tab": tab },
    web: `for (let i = 0; i < 40 && !document.querySelector('[aria-label="Page tools"]'); i++) await new Promise((r) => setTimeout(r, 100)); document.querySelector('[aria-label="Page tools"] > button[title="${title}"]')?.click(); return true;`,
  };
}
const only = arg("--only")?.split(",");
const screens = SCREENS.filter((s) => !only || only.includes(s.id));

/** The fixture library: folders, notes with text, stars and tasks, made through the engine's own commands. */
const FIXTURE = `
  const engine = window.__foleviEngine;
  const place = window.__foleviNativeChrome && window.__foleviNativeChrome.place;
  if (!engine || !place) throw new Error("no engine in this page");
  let n = 0;
  const run = async (name, args) => {
    const reply = JSON.parse(await engine.handle({ v: 1, id: "fx" + n++, kind: "command", place, name, args }));
    if (reply.error) throw new Error(name + ": " + JSON.stringify(reply.error));
    return reply.result ?? reply.value;
  };
  const travel = await run("folder.create", { name: "Travel", parentId: null, color: null });
  const japan = await run("folder.create", { name: "Japan", parentId: travel.id, color: null });
  const work = await run("folder.create", { name: "Work", parentId: null, color: null });
  const notes = [
    ["Kyoto in November\\nTemples to see, the moss garden at Saiho-ji, and where to eat near Nishiki market.", japan.id],
    ["Packing list\\nPassport\\nAdapters\\nRain jacket", travel.id],
    ["Quarterly plan\\nShip the Mac app, then the iPhone app. Hire one designer.", work.id],
    ["Meeting with Sam\\nAgenda: budget, launch dates, the new office.", work.id],
    ["Reading list\\nThe Remains of the Day\\nPiranesi\\nKlara and the Sun", null],
    ["Recipes to try\\nMiso soup, okonomiyaki, matcha cookies.", null],
  ];
  const ids = [];
  for (const [text, folderId] of notes) {
    const r = await run("note.create", { text, open: false });
    ids.push(r.id);
    if (folderId) await run("note.move", { ids: [r.id], folderId });
  }
  await run("note.star", { ids: [ids[0], ids[2]], starred: true });
  for (const t of ["Book the ryokan tomorrow", "Call Sam on Friday 3pm", "Renew passport next week", "Buy matcha today"]) await run("task.create", { text: t });
  window.__fxFolders = { travel: travel.id, japan: japan.id, work: work.id };
  return ids;
`;

const STILL = `if (!document.getElementById("__screensStill")) { const s = document.createElement("style"); s.id = "__screensStill"; s.textContent = "*, *::before, *::after { animation: none !important; transition: none !important; }"; document.documentElement.appendChild(s); } return true;`;

const ensure = (r) => {
  if (r && r.error) throw new Error(r.error);
  return r?.value;
};

/** Ends this script's own app, if one is still running from an earlier run (its pid in the data folder). */
function stopOwnApp() {
  try {
    const app = JSON.parse(readFileSync(join(dir, "Debug", "app.json"), "utf8"));
    process.kill(app.pid, "SIGTERM");
  } catch {
    // Not running.
  }
}

async function setUp() {
  stopOwnApp();
  await sleep(1000);
  rmSync(dir, { recursive: true, force: true });
  rmSync(library, { recursive: true, force: true });
  mkdirSync(library, { recursive: true });
  // The first launch in the web frame: the library on the test folder, local mode.
  await launch({ dir, env: { FOLEVI_TEST_FOLDER: library, FOLEVI_WEB_FRAME: "1" } });
  await waitFor(dir, `return /Where should your (notes|library) live\?/.test(document.body.innerText)`, 90_000);
  const info = await evaluate(dir, `return await foleviShell.library.setup({ kind: "folder" })`);
  if (!String(info?.displayPath ?? "").endsWith(library.split("/").pop())) throw new Error(`Not the script's own library: ${JSON.stringify(info)}. Stopped.`);
  await evaluate(dir, `await foleviShell.setMode("local"); setTimeout(() => location.reload(), 50); return true;`);
  await sleep(3000);
  await waitFor(dir, `return document.readyState === "complete" && !!document.querySelector('nav[aria-label="Folio"]')`, 90_000);
  await quit();
  // The fixture notes, through the native frame's engine.
  await launch({ dir, env: { FOLEVI_TEST_FOLDER: library } });
  await waitFor(dir, `return !!window.__foleviEngine && !!window.__foleviNativeChrome`, 90_000);
  await sleep(1500);
  const made = await evaluate(dir, FIXTURE);
  const folders = await evaluate(dir, `return window.__fxFolders`).catch(() => null);
  await sleep(1500);
  await quit();
  writeFileSync(join(dir, "fixture.json"), JSON.stringify({ notes: made, folders, at: new Date().toISOString() }));
}

async function quit() {
  await command(dir, { cmd: "quit" }).catch(() => undefined);
  const app = JSON.parse(readFileSync(join(dir, "Debug", "app.json"), "utf8"));
  for (let i = 0; i < 60; i++) {
    try {
      process.kill(app.pid, 0);
    } catch {
      return;
    }
    await sleep(250);
  }
  throw new Error("the app didn't quit");
}

/** Every screen, light and dark, in one frame (native, or the web frame). */
async function shoot(kind) {
  await launch({ dir, env: { FOLEVI_TEST_FOLDER: library, ...(kind === "web" ? { FOLEVI_WEB_FRAME: "1" } : {}) } });
  await waitFor(dir, kind === "web" ? `return document.readyState === "complete" && !!document.querySelector('nav[aria-label="Folio"]')` : `return !!window.__foleviEngine`, 90_000);
  await sleep(2000);
  ensure(await command(dir, { cmd: "resize", width, height }));
  mkdirSync(join(out, kind), { recursive: true });
  for (const scheme of ["light", "dark"]) {
    ensure(await command(dir, { cmd: "appearance", value: scheme }));
    for (const s of screens) {
      const fixture = JSON.parse(readFileSync(join(dir, "fixture.json"), "utf8"));
      if (kind === "native") for (const [key, value] of Object.entries(s.defaults ?? {})) ensure(await command(dir, { cmd: "setDefault", key, value }));
      ensure(await command(dir, { cmd: "open", url: typeof s.link === "function" ? s.link(fixture) : s.link }));
      await sleep(1600);
      if (kind === "web" && s.web) await evaluate(dir, s.web).catch(() => undefined);
      // A window behind others doesn't run CSS animations (a note's sheet would stay at its first, invisible
      // frame): the end state at once, in both frames alike.
      await evaluate(dir, STILL).catch(() => undefined);
      await sleep(s.settle ?? 400);
      // The window as the screen shows it (macOS's own capture, no window shadow): the same path for both frames.
      const number = ensure(await command(dir, { cmd: "windows" }))[0].number;
      execFileSync("screencapture", ["-x", "-o", "-l", String(number), join(out, kind, `${s.id}-${scheme}.png`)]);
    }
  }
  await quit();
}

try {
  stopOwnApp();
  if (process.argv.includes("--fresh") || !existsSync(join(dir, "fixture.json"))) await setUp();
  for (const d of ["web", "native", "diff"]) {
    rmSync(join(out, d), { recursive: true, force: true });
    mkdirSync(join(out, d), { recursive: true });
  }
  await shoot("native");
  await shoot("web");
} catch (e) {
  const text = await evaluate(dir, `return document.body.innerText.slice(0, 400)`).catch(() => "(no page)");
  console.error(`stopped: ${e.message}\npage: ${JSON.stringify(text)}`);
  stopOwnApp();
  process.exit(2);
}
const threshold = { channel: 24, radius: 1, maxRatio: 0.01 };
const browser = await webkit.launch();
const results = await diffAll(browser, out, screens.flatMap((s) => ["light", "dark"].map((scheme) => ({ id: s.id, scheme }))), threshold);
await browser.close();
writeReport(out, { title: "Screens: web vs Folevi for Mac", note: `The Debug app on one scratch library, ${width} x ${height} pt, the web frame (FOLEVI_WEB_FRAME=1) vs the native frame.`, threshold, results, imageWidth: 520 });
process.exit(results.every((r) => r.pass) ? 0 : 1);
