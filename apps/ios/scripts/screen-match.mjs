// The app's screens, the web's against the new frame's, whole screen, in the iOS Simulator (docs/IOS_REBUILD_PLAN.md,
// I3): one scratch library seeded on a fresh install (local mode on this device: the sample notes and folders,
// plus a few notes made and starred through the engine), then each screen opened in the web frame
// (FOLEVI_WEB_FRAME=1, the web draws it) and in the new frame (FOLEVI_REBUILD=1), light and dark, the status bar
// and home indicator left out, compared as gate-match.mjs compares the gates. Report in apps/ios/match-report/screens.
//
// Times ("4 mins ago") come from the clock on both sides: run with --no-seed an hour or more after seeding for
// shots that can't fall either side of a minute.
//
// --styles measures the web's elements for the native screens instead (packages/design-tokens/match/app-styles/
// phone.json, in the web frame) into app-styles-cache/phone.ios.json; `node scripts/web-styles.mjs --no-samples`
// puts them in WebStyles.
//
// Foli AI's screens (I5) run on the Debug stand-in model (FOLEVI_FAKE_AI=1, Native/Shell/FakeAI.swift: offline, the
// same answer every time, nothing sent anywhere): the sheet from the tab bar, new and with an answer, and the page,
// new and with the fixture conversation (asked through the engine in the web frame, then opened in both).
//
//   node scripts/screen-match.mjs --app <App.app> [--device "iPhone 18 Pro"] [--only home,...] [--no-seed] [--styles]
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { extract } from "../../../scripts/style-extract.mjs";
import { GATES, simulator } from "./gates.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const app = arg("--app");
const device = arg("--device", "iPhone 18 Pro");
const only = arg("--only")?.split(",");
const styles = process.argv.includes("--styles");
if (!app) throw new Error("Pass --app <path to the built App.app>");
const sim = simulator(device);

/** The screens, by route. `ready` is text the web shows once the screen is drawn. */
// `scroll`: the screen scrolled down by that many points (FOLEVI_REBUILD_SCROLL in the new frame).
export const SCREENS = [
  { id: "home", path: "/documents", ready: "All notes" },
  { id: "home-lower", path: "/documents", ready: "All notes", scroll: 420 },
  { id: "notes", path: "/notes", ready: "Packing list" },
  { id: "drafts", path: "/drafts", ready: "Packing list" },
  { id: "starred", path: "/starred", ready: "Packing list" },
  { id: "archive", path: "/archive", ready: "Old receipts" },
  { id: "trash", path: "/trash", ready: "Trash is empty" },
  { id: "folders", path: "/folders", ready: "Projects" },
  // A folder by its name (`folder`): its id is looked up in the web frame first.
  { id: "folder", folder: "Personal", ready: "Reading Shelf" },
  // Search: the web opens it from Home's field (`press`), types (`type`) and lets go of the keyboard; the new frame
  // opens its route (`native`) without the keyboard.
  { id: "search", path: "/documents", ready: "All notes", press: "Search in Personal", native: "/search" },
  { id: "search-trip", path: "/documents", ready: "All notes", press: "Search in Personal", type: "trip", native: "/search?q=trip" },
  // Foli AI (`ai`: on the stand-in model). The web opens the sheet from the tab bar (`js`); the new frame at launch
  // (`nativeEnv`). Both at the sheet's large detent, where the keyboard takes it on both (iOS 26 floats a sheet at a
  // partial detent in from the screen's edges, the web's stays attached: the medium height isn't comparable). The
  // web focuses the box (the sheet goes large) and lets go of the keyboard; asking, it types and presses Ask, the
  // new frame asks at launch; both wait for the answer and read from its end (`toEnd`).
  { id: "ai-sheet", path: "/documents", ready: "All notes", ai: true, js: "OPEN_AI", after: "Suggestions", nativeEnv: { FOLEVI_REBUILD_SHEET: "ai", FOLEVI_REBUILD_SHEET_DETENT: "large" } },
  { id: "ai-chat", path: "/documents", ready: "All notes", ai: true, js: "ASK_AI", after: "Regenerate", toEnd: true, nativeEnv: { FOLEVI_REBUILD_SHEET: "ai", FOLEVI_REBUILD_SHEET_DETENT: "large", FOLEVI_REBUILD_ASK: "Plan three days in Kyoto" }, settle: 6000 },
  { id: "ai-page", path: "/ai", ready: "Meet Foli AI", ai: true },
  // The fixture conversation's page (`conversation`: its id from asking through the engine).
  { id: "ai-page-chat", conversation: true, ready: "Regenerate", ai: true, toEnd: true },
];

/** Page scripts for `js`: the tab bar's Foli AI button; that, then a question asked in the sheet. */
const PAGE_JS = {
  OPEN_AI: `document.querySelector('[aria-label="Foli AI"]').click();
    for (let i = 0; i < 40 && !document.querySelector(".ai-chat textarea"); i++) await new Promise((r) => setTimeout(r, 250));
    await new Promise((r) => setTimeout(r, 600));
    document.querySelector(".ai-chat textarea").focus();
    await new Promise((r) => setTimeout(r, 1200));
    document.activeElement?.blur();
    return true;`,
  ASK_AI: `document.querySelector('[aria-label="Foli AI"]').click();
    for (let i = 0; i < 40 && !document.querySelector(".ai-chat textarea"); i++) await new Promise((r) => setTimeout(r, 250));
    await new Promise((r) => setTimeout(r, 600));
    const t = document.querySelector(".ai-chat textarea");
    t.focus();
    await new Promise((r) => setTimeout(r, 1200));
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(t, "Plan three days in Kyoto");
    t.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    document.querySelector(".ai-chat [aria-label=Ask]").click();
    return true;`,
};
/** After an answer: the thread at its end (WebKit's "Jump to latest" can stay up after the stream's last scroll). */
const TO_END = `const s = document.querySelector(".ai-chat div.overflow-y-auto.px-4, main section div.overflow-y-auto.px-4"); if (s) { s.scrollTop = s.scrollHeight; s.dispatchEvent(new Event("scroll")); } return true;`;
/** The fixture conversation: one question, answered by the stand-in model, through the engine (screens.mjs's). */
const AI_FIXTURE = `
  const engine = window.__foleviEngine;
  const place = window.__foleviNativeChrome && window.__foleviNativeChrome.place;
  let n = 0;
  const call = async (kind, name, args) => {
    const reply = JSON.parse(await engine.handle({ v: 1, id: "ai" + n++, kind, place, name, args }));
    if (!reply.ok) throw new Error(name + ": " + JSON.stringify(reply.error));
    return reply.value;
  };
  const sent = await call("command", "ai.send", { text: "Plan three days in Kyoto" });
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const c = await call("query", "ai.conversation", { conversationId: sent.conversationId }).catch(() => null);
    const last = c && c.messages && c.messages[c.messages.length - 1];
    if (last && last.role === "assistant" && last.status !== "streaming") return sent.conversationId;
  }
  throw new Error("the fixture answer didn't finish");
`;
const screens = SCREENS.filter((s) => !only || only.includes(s.id));

const waitUntil = (what, test, ms = 60000) => {
  for (let t = 0; t < ms; t += 500) {
    try {
      if (test()) return;
    } catch {
      /* the page is loading */
    }
    sim.sleep(500);
  }
  throw new Error(`${what}: never`);
};

// The scratch library: a fresh install in today's frame, "This device", a note made and one starred.
if (!process.argv.includes("--no-seed")) {
  sim.appearance("light");
  sim.open(app, GATES.find((g) => g.id === "library-ready"), {});
  sim.press("Open Folevi");
  waitUntil("the engine", () => sim.evalJs("return Boolean(window.__foleviEngine)"));
  sim.sleep(3000);
  const made = sim.command("note.create", { text: "Packing list\nPassport, charger, the good socks.", open: false });
  sim.command("note.star", { ids: [made.id], starred: true });
  const old = sim.command("note.create", { text: "Old receipts\nKept for the tax year, then archived.", open: false });
  sim.command("note.archive", { ids: [old.id], archived: true });
  sim.sleep(2000);
  console.log("seeded");
}

// Not seeded again: the build goes over the seeded install (its data stays).
if (process.argv.includes("--no-seed")) sim.simctl("install", sim.udid, app);

// Folders named by screens: their ids, from Home's folder links in the web frame.
if (screens.some((s) => s.folder)) {
  sim.relaunch({ FOLEVI_WEB_FRAME: "1" });
  waitUntil("Home", () => sim.evalJs("return document.body.innerText.includes(\"All notes\")"));
  sim.sleep(1500);
  for (const s of screens.filter((x) => x.folder)) {
    const href = sim.evalJs(`return [...document.querySelectorAll("a[href^='/folders/']")].find((a) => (a.getAttribute("aria-label") ?? a.textContent).startsWith(${JSON.stringify(s.folder)}))?.getAttribute("href") ?? null`);
    if (!href) throw new Error(`no folder called ${s.folder}`);
    s.path = href;
  }
}

// Foli AI's fixture conversation, for the screens that show it.
if (screens.some((s) => s.conversation)) {
  // (In today's frame: the engine runs where native chrome asks it, as in the seeding.)
  sim.relaunch({ FOLEVI_FAKE_AI: "1" });
  waitUntil("the engine", () => sim.evalJs("return Boolean(window.__foleviEngine)"));
  sim.sleep(2000);
  const id = sim.evalJs(AI_FIXTURE);
  for (const s of screens.filter((x) => x.conversation)) s.path = `/ai/${id}`;
  console.log(`fixture conversation ${id}`);
}

/** Opens `screen` in the frame `env` names, on the seeded install. */
const open = (screen, base) => {
  const env = { ...base, ...(screen.ai ? { FOLEVI_FAKE_AI: "1" } : {}) };
  const native = env.FOLEVI_REBUILD === "1";
  const extra = { ...(native && screen.scroll ? { FOLEVI_REBUILD_SCROLL: String(screen.scroll) } : {}), ...(native ? screen.nativeEnv : {}) };
  const route = native ? (screen.native ?? screen.path) : screen.path;
  const opens = native && route !== "/documents" ? { FOLEVI_REBUILD_OPEN: route, FOLEVI_GATE_NO_KEYBOARD: "1" } : {};
  sim.relaunch({ ...env, ...extra, ...opens });
  waitUntil("the page", () => sim.evalJs('return document.readyState === "complete"'));
  if (!native) {
    if (sim.evalJs("return location.pathname") !== screen.path) sim.evalJs(`location.assign(${JSON.stringify(screen.path)}); return true;`);
    waitUntil(screen.ready, () => sim.evalJs(`return document.body.innerText.includes(${JSON.stringify(screen.ready)})`));
    if (screen.press) {
      sim.sleep(1000);
      sim.press(screen.press);
      sim.sleep(1200);
      if (screen.type) {
        sim.evalJs(`const i = document.querySelector("dialog input"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(screen.type)}); i.dispatchEvent(new Event("input", { bubbles: true })); return true;`);
        sim.sleep(1500);
      }
      sim.evalJs("document.activeElement?.blur(); return true");
    }
    if (screen.scroll) {
      sim.sleep(1500);
      sim.evalJs(`document.querySelector("main#main").scrollTo(0, ${screen.scroll}); return true;`);
    }
    if (screen.js) {
      sim.sleep(1000);
      sim.evalJs(PAGE_JS[screen.js]);
    }
    if (screen.after) waitUntil(screen.after, () => sim.evalJs(`return document.body.innerText.includes(${JSON.stringify(screen.after)})`));
    if (screen.ai) {
      sim.sleep(1500);
      sim.evalJs("document.activeElement?.blur(); return true");
      sim.sleep(1000);
      if (screen.toEnd) sim.evalJs(TO_END);
    }
  }
  sim.sleep(screen.settle ?? 2500);
};

if (styles) {
  // The iPhone measures its own screens (phone.json into phone.ios.json); the iPad measures the Mac frame's areas
  // as its web draws them in the wide layout (--spec frame,notes into frame.ipad.json, notes.ipad.json: the
  // iPad's `data-ipad` touch sizes, which WebStyles.ipad holds and `named` prefers on an iPad).
  const ipad = /ipad/i.test(device);
  const areas = arg("--spec", ipad ? "frame,notes" : "phone").split(",");
  for (const area of areas) {
    const spec = JSON.parse(readFileSync(join(repo, `packages/design-tokens/match/app-styles/${area}.json`), "utf8"));
    const out = { light: {}, dark: {} };
    for (const screen of screens) {
      const tags = Object.fromEntries(Object.entries(spec.styles).filter(([, t]) => t.screen === screen.id));
      if (!Object.keys(tags).length) continue;
      open(screen, { FOLEVI_WEB_FRAME: "1" });
      for (const scheme of ["light", "dark"]) {
        sim.appearance(scheme);
        sim.sleep(1200);
        Object.assign(out[scheme], sim.evalJs(`return (${extract.toString()})(${JSON.stringify(tags)})`));
      }
    }
    sim.appearance("light");
    const wanted = Object.entries(spec.styles).filter(([, t]) => screens.some((s) => s.id === t.screen)).map(([id]) => id);
    const missing = wanted.filter((id) => !out.light[id]);
    if (missing.length) console.warn(`${area}: not found on the ${ipad ? "iPad" : "iPhone"}: ${missing.join(", ")}`);
    const name = `${area}.${ipad ? "ipad" : "ios"}.json`;
    const file = join(repo, "packages/design-tokens/match/app-styles-cache", name);
    // Screens measured before stay unless measured again.
    let kept = { light: {}, dark: {} };
    try {
      kept = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      /* none yet */
    }
    writeFileSync(file, JSON.stringify({ light: { ...kept.light, ...out.light }, dark: { ...kept.dark, ...out.dark } }, null, 1) + "\n");
    console.log(`wrote ${name} (${Object.keys(out.light).length} styles)`);
  }
  process.exit(0);
}

const outDir = join(repo, "apps/ios/match-report/screens");
for (const d of ["web", "native", "diff"]) mkdirSync(join(outDir, d), { recursive: true });
// The status bar and the home indicator are the system's: cropped away (points at 3x).
const TOP = 62 * 3;
const BOTTOM = 34 * 3;
const crop = (path) => {
  const info = execFileSync("sips", ["-g", "pixelHeight", "-g", "pixelWidth", path], { encoding: "utf8" });
  const h = Number(/pixelHeight: (\d+)/.exec(info)[1]);
  const w = Number(/pixelWidth: (\d+)/.exec(info)[1]);
  execFileSync("sips", ["-c", String(h - TOP - BOTTOM), String(w), "--cropOffset", String(TOP), "0", path], { stdio: "pipe" });
};
for (const screen of process.argv.includes("--diff-only") ? [] : screens) {
  for (const [side, env] of [["web", { FOLEVI_WEB_FRAME: "1" }], ["native", { FOLEVI_REBUILD: "1" }]]) {
    open(screen, env);
    for (const scheme of ["light", "dark"]) {
      sim.appearance(scheme);
      sim.sleep(1500);
      const path = join(outDir, side, `${screen.id}-${scheme}.png`);
      sim.screenshot(path);
      crop(path);
    }
    sim.appearance("light");
  }
  console.log(`${screen.id}: shot`);
}

const require = createRequire(join(repo, "apps/web/package.json"));
const { webkit } = require("@playwright/test");
const { diffAll, writeReport } = await import(join(repo, "apps/mac/scripts/diff.mjs"));
const spec = JSON.parse(readFileSync(join(repo, "packages/design-tokens/match/specimens.json"), "utf8"));
const threshold = { ...spec.threshold, sizeSlack: 1 };
const browser = await webkit.launch();
const results = await diffAll(browser, outDir, screens.flatMap((s) => ["light", "dark"].map((scheme) => ({ id: s.id, scheme }))), threshold);
await browser.close();
writeReport(outDir, { title: "iPhone screens", note: "Whole screens in the Simulator, one seeded scratch library; the status bar and home indicator are left out.", threshold, results });
