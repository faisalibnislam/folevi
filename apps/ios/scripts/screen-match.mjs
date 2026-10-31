// The app's screens, the web's against the new frame's, whole screen, in the iOS Simulator (docs/IOS_REBUILD_PLAN.md,
// I3): one scratch library seeded on a fresh install (local mode on this device: the sample notes and folders,
// plus a few notes made and starred through the engine), then each screen opened in the web frame
// (FOLEVI_WEB_FRAME=1, the web draws it) and in the new frame (FOLEVI_REBUILD=1), light and dark, the status bar
// and home indicator left out, compared as gate-match.mjs compares the gates. Report in apps/ios/match-report/screens.
//
// --styles measures the web's elements for the native screens instead (packages/design-tokens/match/app-styles/
// phone.json, in the web frame) into app-styles-cache/phone.ios.json; `node scripts/web-styles.mjs --no-samples`
// puts them in WebStyles.
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
export const SCREENS = [{ id: "home", path: "/documents", ready: "All notes" }];
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
  sim.sleep(2000);
  console.log("seeded");
}

// Not seeded again: the build goes over the seeded install (its data stays).
if (process.argv.includes("--no-seed")) sim.simctl("install", sim.udid, app);

/** Opens `screen` in the frame `env` names, on the seeded install. */
const open = (screen, env) => {
  const native = env.FOLEVI_REBUILD === "1";
  sim.relaunch(native && screen.path !== "/documents" ? { ...env, FOLEVI_REBUILD_OPEN: screen.path } : env);
  waitUntil("the page", () => sim.evalJs('return document.readyState === "complete"'));
  if (!native) {
    if (sim.evalJs("return location.pathname") !== screen.path) sim.evalJs(`location.assign(${JSON.stringify(screen.path)}); return true;`);
    waitUntil(screen.ready, () => sim.evalJs(`return document.body.innerText.includes(${JSON.stringify(screen.ready)})`));
  }
  sim.sleep(2500);
};

if (styles) {
  const spec = JSON.parse(readFileSync(join(repo, "packages/design-tokens/match/app-styles/phone.json"), "utf8"));
  const out = { light: {}, dark: {} };
  for (const screen of screens) {
    open(screen, { FOLEVI_WEB_FRAME: "1" });
    for (const scheme of ["light", "dark"]) {
      sim.appearance(scheme);
      sim.sleep(1200);
      const tags = Object.fromEntries(Object.entries(spec.styles).filter(([, t]) => t.screen === screen.id));
      Object.assign(out[scheme], sim.evalJs(`return (${extract.toString()})(${JSON.stringify(tags)})`));
    }
  }
  sim.appearance("light");
  const wanted = Object.entries(spec.styles).filter(([, t]) => screens.some((s) => s.id === t.screen)).map(([id]) => id);
  const missing = wanted.filter((id) => !out.light[id]);
  if (missing.length) console.warn(`not found on the iPhone: ${missing.join(", ")}`);
  const file = join(repo, "packages/design-tokens/match/app-styles-cache/phone.ios.json");
  // Screens measured before stay unless measured again.
  let kept = { light: {}, dark: {} };
  try {
    kept = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    /* none yet */
  }
  writeFileSync(file, JSON.stringify({ light: { ...kept.light, ...out.light }, dark: { ...kept.dark, ...out.dark } }, null, 1) + "\n");
  console.log(`wrote phone.ios.json (${Object.keys(out.light).length} styles)`);
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
