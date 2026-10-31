// The screens before the app, the web's against the native frame's, whole screen, in the iOS Simulator
// (docs/IOS_REBUILD_PLAN.md, I2): each gate from a fresh install, once in the web frame (the web draws it) and once
// in the new frame (native draws it over the page), light and dark, the status bar and home indicator left out;
// compared as the match harness compares specimens (apps/mac/scripts/diff.mjs). Report in
// apps/ios/match-report/gates/.
//
//   node scripts/gate-match.mjs --app <App.app> [--device "iPhone 18 Pro"] [--only first-launch,...]
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { GATES, simulator } from "./gates.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const app = arg("--app");
const device = arg("--device", "iPhone 18 Pro");
const only = arg("--only")?.split(",");
if (!app) throw new Error("Pass --app <path to the built App.app>");
const sim = simulator(device);
const out = join(repo, "apps/ios/match-report/gates");
for (const d of ["web", "native", "diff"]) mkdirSync(join(out, d), { recursive: true });

// The status bar and the home indicator are the system's: cropped away (points at 3x).
const TOP = 62 * 3;
const BOTTOM = 34 * 3;
const crop = (path) => {
  const info = execFileSync("sips", ["-g", "pixelHeight", "-g", "pixelWidth", path], { encoding: "utf8" });
  const h = Number(/pixelHeight: (\d+)/.exec(info)[1]);
  const w = Number(/pixelWidth: (\d+)/.exec(info)[1]);
  execFileSync("sips", ["-c", String(h - TOP - BOTTOM), String(w), "--cropOffset", String(TOP), "0", path], { stdio: "pipe" });
};

const gates = GATES.filter((g) => !only || only.includes(g.id));
// --diff-only: compare the pictures already taken.
for (const gate of process.argv.includes("--diff-only") ? [] : gates) {
  for (const [side, env] of [["web", { FOLEVI_WEB_FRAME: "1" }], ["native", { FOLEVI_REBUILD: "1" }]]) {
    sim.open(app, gate, env);
    for (const scheme of ["light", "dark"]) {
      sim.appearance(scheme);
      sim.sleep(1500);
      const path = join(out, side, `${gate.id}-${scheme}.png`);
      sim.screenshot(path);
      crop(path);
    }
  }
  console.log(`${gate.id}: shot`);
}
sim.appearance("light");

const require = createRequire(join(repo, "apps/web/package.json"));
const { webkit } = require("@playwright/test");
const { diffAll, writeReport } = await import(join(repo, "apps/mac/scripts/diff.mjs"));
const spec = JSON.parse(readFileSync(join(repo, "packages/design-tokens/match/specimens.json"), "utf8"));
const threshold = { ...spec.threshold, sizeSlack: 1 };
const browser = await webkit.launch();
const results = await diffAll(browser, out, gates.flatMap((g) => ["light", "dark"].map((scheme) => ({ id: g.id, scheme }))), threshold);
await browser.close();
writeReport(out, { title: "iPhone gates", note: "Whole screens in the Simulator; the status bar and home indicator are left out.", threshold, results });
