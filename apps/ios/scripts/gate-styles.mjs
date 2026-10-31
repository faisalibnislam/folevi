// The screens before the app as the iPhone app's web draws them (docs/IOS_REBUILD_PLAN.md, I2), measured for the
// native gates: each gate in packages/design-tokens/match/app-styles/gates.json that needs no website, from a
// fresh install in the Simulator, in the web frame (FOLEVI_WEB_FRAME=1), light and dark; the same measuring script
// as the Mac's (scripts/style-extract.mjs). Written to app-styles-cache/gates.ios.json; `pnpm styles:gen` puts the
// ones that differ from the Mac's in WebStyles.ios. Scratch data only: the app is reinstalled for each screen.
//
//   node scripts/gate-styles.mjs --app <App.app> [--device "iPhone 18 Pro"]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extract } from "../../../scripts/style-extract.mjs";
import { GATES, simulator } from "./gates.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const app = arg("--app");
const device = arg("--device", "iPhone 18 Pro");
if (!app) throw new Error("Pass --app <path to the built App.app>");

const sim = simulator(device);

const spec = JSON.parse(readFileSync(join(repo, "packages/design-tokens/match/app-styles/gates.json"), "utf8"));
const out = { light: {}, dark: {} };
for (const gate of GATES) {
  sim.open(app, gate, { FOLEVI_WEB_FRAME: "1" });
  for (const scheme of ["light", "dark"]) {
    sim.appearance(scheme);
    sim.sleep(1200);
    if (spec.prepare?.[gate.id]) {
      sim.evalJs(spec.prepare[gate.id]);
      sim.sleep(600);
    }
    const tags = Object.fromEntries(Object.entries(spec.styles).filter(([, t]) => t.screen === gate.id));
    if (gate.id === GATES[0].id) tags.__vars = { names: spec.vars ?? [] };
    Object.assign(out[scheme], sim.evalJs(`return (${extract.toString()})(${JSON.stringify(tags)})`));
  }
  console.log(`${gate.id}: ${Object.keys(out.light).length} styles so far`);
}
sim.appearance("light");
const wanted = Object.entries(spec.styles).filter(([, t]) => GATES.some((g) => g.id === t.screen)).map(([id]) => id);
const missing = wanted.filter((id) => !out.light[id]);
if (missing.length) console.warn(`not found on the iPhone: ${missing.join(", ")}`);
const dir = join(repo, "packages/design-tokens/match/app-styles-cache");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "gates.ios.json"), JSON.stringify(out, null, 1) + "\n");
console.log(`wrote gates.ios.json (${Object.keys(out.light).length} styles)`);
