#!/usr/bin/env node
// The Quick Add panel, web vs native (docs/MAC_REBUILD_PLAN.md M9, section 3.2): the web frame's panel
// (components/app/MacQuickAdd.tsx) against FoleviMac's WebQuickAddPanel, in the Debug app on the screens scratch
// library (apps/mac/build/run/screens, made by screens.mjs). Three states: empty (with the first-time hint), typed
// ("Call Sam tomorrow 9am !high": the date and priority chips) and added ("Added to Inbox" with Open). Each panel
// is drawn by the app itself (`cmd quickAddShot`: cacheDisplay and WebKit's own snapshot), never a screen capture.
// The material renders flat grey in-process, the same in both frames. Light and dark.
//
//   node apps/mac/scripts/quickadd.mjs [--light]   (needs build.mjs and screens.mjs's scratch library first)
//   node apps/mac/scripts/quickadd.mjs --places    (the page editor's place picker, with two places)
//
// Report in apps/mac/screens-report/quick-add. Adding a task adds it to the scratch library's Inbox only.
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { command, evaluate, launch } from "./mac.mjs";
import { diffAll, writeReport } from "./diff.mjs";

const MAC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { webkit } = createRequire(join(MAC, "../web/package.json"))("@playwright/test");
const dir = join(MAC, "build", "run", "screens");
const library = join(MAC, "build", "run", "screens-library");
const out = join(MAC, "screens-report", process.argv.includes("--places") ? "quick-add-places" : "quick-add");
if (!existsSync(join(dir, "fixture.json"))) {
  console.error("No scratch library: run node apps/mac/scripts/screens.mjs --fresh first.");
  process.exit(2);
}
for (const d of ["web", "native", "diff"]) {
  rmSync(join(out, d), { recursive: true, force: true });
  mkdirSync(join(out, d), { recursive: true });
}

const TYPED = "Call Sam tomorrow 9am !high";
/** Light, then dark (`--light` for light only). */
const SCHEMES = process.argv.includes("--light") ? ["light"] : ["light", "dark"];
/**
 * `--places`: the page editor with its place picker (several places), the scratch data with a made-up
 * second account (never signed in: only its name is drawn).
 */
const PLACES = process.argv.includes("--places");

/**
 * The material's flat grey (as it renders in-process) painted under the web page, so WebKit blends the panel's
 * translucent fills and text itself, as the screen does. Its own snapshot of a clear page blends them later and
 * differently (white at 10 % over the dark grey came out near 20 %), which only showed in dark.
 */
const UNDERLAY = (scheme) => `
  document.getElementById("qa-underlay")?.remove();
  const u = document.createElement("div");
  u.id = "qa-underlay";
  u.style.cssText = "position:fixed;inset:0;border-radius:18px;z-index:-1;pointer-events:none;background:${scheme === "dark" ? "rgb(75 75 75)" : "rgb(199 199 199)"}";
  document.body.prepend(u);
  return true;`;

/** The scratch library's Appearance (its profile's), set through the native frame's engine. */
const SET_APPEARANCE = (value) => `
  for (let i = 0; i < 100 && !window.__foleviEngine; i++) await new Promise((r) => setTimeout(r, 100));
  const reply = JSON.parse(await window.__foleviEngine.handle({ v: 1, id: "qa-appearance", kind: "command", place: window.__foleviNativeChrome.place, name: "settings.update", args: { appearance: ${JSON.stringify(value)} } }));
  if (reply.error) throw new Error(JSON.stringify(reply.error));
  return true;`;

/** The scratch library's Appearance now; with `value`, set back to it (the screens suite needs System). */
async function libraryAppearance(value) {
  const ud = (await launch({ dir, env: { FOLEVI_TEST_FOLDER: library } })).userData;
  try {
    await sleep(2000);
    if (value) return await evaluate(ud, SET_APPEARANCE(value));
    const read = `
      for (let i = 0; i < 100 && !window.__foleviEngine; i++) await new Promise((r) => setTimeout(r, 100));
      const reply = JSON.parse(await window.__foleviEngine.handle({ v: 1, id: "qa-read", kind: "query", place: window.__foleviNativeChrome.place, name: "settings.appearance", args: {} }));
      return reply.value?.appearance ?? "system";`;
    return await evaluate(ud, read);
  } finally {
    await command(ud, { cmd: "quit" }).catch(() => undefined);
    await sleep(4000);
  }
}

/**
 * One frame's three states in one scheme. Both panels follow the library's Appearance, not the app's, so the native
 * pass sets it to `scheme` first (it stays for the web pass after it).
 */
async function shoot(kind, scheme) {
  const env = { FOLEVI_TEST_FOLDER: library, ...(kind === "web" ? { FOLEVI_WEB_FRAME: "1" } : {}) };
  const ud = (await launch({ dir, env })).userData;
  const cmd = async (c, o = {}) => {
    const r = await command(ud, { cmd: c, ...o });
    if (r.error) throw new Error(`${c}: ${r.error}`);
    return r;
  };
  // The web field takes words through React's own setter; the native one through its model (Debug hook).
  const setText = (t) =>
    kind === "web"
      ? cmd("evalIn", { target: "quickAdd", script: `const i = document.getElementById("qa-title"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(t)}); i.dispatchEvent(new Event("input", { bubbles: true })); i.blur(); return i.value` })
      : cmd("quickAdd", { action: "text", text: t });
  const shot = (state) => cmd("quickAddShot", { out: join(out, kind, `${state}-${scheme}.png`) });
  try {
    await cmd("appearance", { value: scheme });
    if (kind === "native") {
      await evaluate(ud, SET_APPEARANCE(scheme));
      await sleep(1500);
    }
    await cmd("quickAdd", { action: "show" });
    await sleep(2500);
    if (kind === "web") {
      const theme = (await cmd("evalIn", { target: "quickAdd", script: `return document.documentElement.dataset.theme ?? ""` })).value;
      if (theme !== scheme) console.warn(`web panel is ${theme || "unthemed"} in ${scheme}`);
      await cmd("evalIn", { target: "quickAdd", script: UNDERLAY(scheme) });
    }
    await setText("");
    await sleep(500);
    await shot("empty");
    await setText(TYPED);
    await sleep(1500);
    await shot("typed");
    await setText("Water the plants");
    await sleep(500);
    // Return.
    if (kind === "web") await cmd("evalIn", { target: "quickAdd", script: `document.getElementById("qa-title").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); return 1` });
    else await cmd("quickAdd", { action: "command", selector: "insertNewline:" });
    await sleep(500);
    await shot("added");
    await sleep(1500);
  } finally {
    await command(ud, { cmd: "appearance", value: "system" }).catch(() => undefined);
    await command(ud, { cmd: "quit" }).catch(() => undefined);
    // (The next launch must not find this one still going.)
    await sleep(4000);
  }
}

/**
 * The page editor open with two places (`--places`), in the light scheme: a made-up account is added to the scratch
 * folder's places.json for the run (a copy of the folder would be a new run, its settings and Keychain names empty),
 * and the file is put back afterwards.
 */
async function shootPlaces(kind) {
  const file = join(dir, "places.json");
  const saved = readFileSync(file, "utf8");
  const places = JSON.parse(saved);
  places.accounts = [...(places.accounts ?? []), { userId: "qa-test-account", name: "Sam Rivera", email: "sam@example.com", workspaces: [], unread: 0, reminders: 0, waiting: 0 }];
  places.quickAdd = places.current;
  writeFileSync(file, JSON.stringify(places));
  try {
    await shootPlacesIn(kind);
  } finally {
    writeFileSync(file, saved);
  }
}

async function shootPlacesIn(kind) {
  const env = { FOLEVI_TEST_FOLDER: library, ...(kind === "web" ? { FOLEVI_WEB_FRAME: "1" } : {}) };
  const ud = (await launch({ dir, env })).userData;
  const cmd = async (c, o = {}) => {
    const r = await command(ud, { cmd: c, ...o });
    if (r.error) throw new Error(`${c}: ${r.error}`);
    return r;
  };
  try {
    await cmd("appearance", { value: "light" });
    await cmd("quickAdd", { action: "show" });
    await sleep(4000);
    if (kind === "web") {
      await cmd("evalIn", { target: "quickAdd", script: UNDERLAY("light") });
      await cmd("evalIn", { target: "quickAdd", script: `const b = document.querySelector('button[aria-label^="Adds to"]'); b?.click(); return !!b` });
    }
    else await cmd("quickAdd", { action: "pageEditor" });
    await sleep(1200);
    await cmd("quickAddShot", { out: join(out, kind, "places-light.png") });
  } finally {
    await command(ud, { cmd: "appearance", value: "system" }).catch(() => undefined);
    await command(ud, { cmd: "quit" }).catch(() => undefined);
    await sleep(4000);
  }
}

if (PLACES) {
  await shootPlaces("web");
  await shootPlaces("native");
} else {
  const original = await libraryAppearance();
  try {
    for (const scheme of SCHEMES) {
      await shoot("native", scheme);
      await shoot("web", scheme);
    }
  } finally {
    await libraryAppearance(original);
  }
}
const threshold = { channel: 24, radius: 1, maxRatio: 0.01 };
const browser = await webkit.launch();
const results = await diffAll(browser, out, PLACES ? [{ id: "places", scheme: "light" }] : SCHEMES.flatMap((scheme) => ["empty", "typed", "added"].map((id) => ({ id, scheme }))), threshold);
await browser.close();
writeReport(out, { title: "Quick Add: web vs Folevi for Mac", note: "The panel's content, 640 pt wide, the web frame vs the native frame.", threshold, results, imageWidth: 640 });
process.exit(results.every((r) => r.pass) ? 0 : 1);
