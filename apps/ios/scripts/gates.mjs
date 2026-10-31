// The screens before the app in the iOS Simulator, for measuring and comparing them (docs/IOS_REBUILD_PLAN.md,
// I2): a fresh install of the built app, launched in the web frame (FOLEVI_WEB_FRAME=1, the web draws the gate) or
// the new native frame (FOLEVI_REBUILD=1, native draws it over the page), and the steps to each gate pressed in
// the page (which stays behind the native gate). Scratch data only: the app is reinstalled each time.
// Used by gate-styles.mjs and gate-match.mjs.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const BUNDLE = "com.folevi.ios";

// The gates reached without a website, and how (apps/mac/scripts/gates.mjs, with the iPhone's labels).
export const GATES = [
  { id: "first-launch", steps: [], ready: "Where should your notes live?" },
  { id: "library-setup", steps: [["Keep notes on my devices", "Where should your library live?"]], ready: "Where should your library live?" },
  { id: "library-ready", steps: [["Keep notes on my devices", "Where should your library live?"], ["This device", "Your library is ready"]], ready: "Your library is ready" },
];

export function simulator(device) {
  const sh = (cmd, argv, env) => execFileSync(cmd, argv, { encoding: "utf8", stdio: "pipe", env: { ...process.env, ...env } });
  const simctl = (...argv) => sh("xcrun", ["simctl", ...argv]);
  const sleep = (ms) => execFileSync("sleep", [String(ms / 1000)]);
  const udid = Object.values(JSON.parse(simctl("list", "devices", "booted", "--json")).devices).flat().find((d) => d.name === device)?.udid;
  if (!udid) throw new Error(`Boot the Simulator called ${device} first.`);
  const evalJs = (js) => {
    const out = sh("node", [join(here, "simulator.mjs"), "eval", js, device]).trim().split("\n").pop();
    const parsed = JSON.parse(out || "{}");
    if (parsed.error) throw new Error(parsed.error);
    return parsed.value;
  };
  const waitFor = (text, ms = 30000) => {
    for (let t = 0; t < ms; t += 500) {
      try {
        if (evalJs(`return document.body.innerText.includes(${JSON.stringify(text)})`)) return;
      } catch {
        /* the page is still loading */
      }
      sleep(500);
    }
    throw new Error(`"${text}" never showed`);
  };
  const press = (label) => evalJs(`const b = [...document.querySelectorAll("button, a")].find((x) => x.textContent.trim().startsWith(${JSON.stringify(label)})); if (!b) return false; b.click(); return true;`);
  return {
    udid,
    sleep,
    simctl,
    evalJs,
    waitFor,
    press,
    /** A fresh install of `app`, launched with `env`, at `gate` (its steps pressed in the page). */
    open(app, gate, env) {
      try {
        simctl("terminate", udid, BUNDLE);
      } catch {
        /* not running */
      }
      try {
        simctl("uninstall", udid, BUNDLE);
      } catch {
        /* not installed */
      }
      simctl("install", udid, app);
      sh("xcrun", ["simctl", "launch", udid, BUNDLE], Object.fromEntries(Object.entries(env).map(([k, v]) => [`SIMCTL_CHILD_${k}`, v])));
      waitFor("Where should your notes live?", 60000);
      for (const [label, next] of gate.steps) {
        if (!press(label)) throw new Error(`${gate.id}: no button "${label}"`);
        waitFor(next);
      }
      waitFor(gate.ready);
    },
    appearance: (scheme) => simctl("ui", udid, "appearance", scheme),
    screenshot: (path) => simctl("io", udid, "screenshot", path),
  };
}
