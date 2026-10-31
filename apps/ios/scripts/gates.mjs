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

// Types a scratch passphrase twice into the library's encryption fields (React's own value setter, then its input
// event), ticks "I understand", and submits.
const PASSPHRASE_JS = `const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
for (const el of document.querySelectorAll("input[type=password]")) { set.call(el, "scratch gate words"); el.dispatchEvent(new Event("input", { bubbles: true })); }
const box = document.querySelector("input[type=checkbox]") ?? document.querySelector("[role=checkbox]"); if (box && !(box.checked || box.getAttribute("aria-checked") === "true")) box.click();
setTimeout(() => [...document.querySelectorAll("button[type=submit]")].find((b) => b.textContent.includes("Open Folevi"))?.click(), 300); return true;`;

// The gates reached without a website, and how (apps/mac/scripts/gates.mjs, with the iPhone's labels).
export const GATES = [
  { id: "first-launch", steps: [], ready: "Where should your notes live?" },
  { id: "library-setup", steps: [["Keep notes on my devices", "Where should your library live?"]], ready: "Where should your library live?" },
  { id: "library-ready", steps: [["Keep notes on my devices", "Where should your library live?"], ["This device", "Your library is ready"]], ready: "Your library is ready" },
  // Account mode with no session: the sign-in card. (It asks the Folevi website whether there's a session; nothing
  // is signed in to. The page reloads into account mode first, which may show the choice again.)
  { id: "sign-in", steps: [["Sign in to Folevi", "Continue with Apple|Where should your notes live?", 15000], ["?Sign in to Folevi", "Continue with Apple", 15000]], ready: "Continue with Apple" },
  // A library on this device encrypted with a passphrase, then opened again without its key (as a device joining it
  // would: FOLEVI_FORGET_LIBRARY_KEY, Debug Simulator builds only): the locked library.
  {
    id: "locked",
    steps: [
      ["Keep notes on my devices", "Where should your library live?"],
      ["This device", "Your library is ready"],
      [{ js: `document.querySelector("[aria-label='Encrypt with a passphrase']").click(); return true;` }, "Type it again"],
      [{ js: PASSPHRASE_JS }, null],
    ],
    settle: 8000,
    // Compared without the keyboard: the web's field let go, the native one never focused.
    relaunch: { FOLEVI_FORGET_LIBRARY_KEY: "1", FOLEVI_GATE_NO_KEYBOARD: "1" },
    blur: true,
    ready: "Enter your library's passphrase",
  },
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
  const waitForAny = (texts, ms) => {
    for (let t = 0; t < ms; t += 500) {
      try {
        if (evalJs(`return ${JSON.stringify(texts)}.some((x) => document.body.innerText.includes(x))`)) return;
      } catch {
        /* the page is reloading */
      }
      sleep(500);
    }
    throw new Error(`none of ${texts.join(", ")} showed`);
  };
  const press = (label) => evalJs(`const b = [...document.querySelectorAll("button, a")].find((x) => x.textContent.trim().startsWith(${JSON.stringify(label)})) ?? [...document.querySelectorAll("button, a")].find((x) => x.textContent.includes(${JSON.stringify(label)})); if (!b) return false; b.click(); return true;`);
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
      // A step's label starting "?" is pressed only if it's there; "a|b" waits for either.
      for (const [label, next, ms] of gate.steps) {
        // A step may be a script run in the page instead of a button pressed: { js }.
        if (typeof label === "object") {
          if (!evalJs(label.js)) throw new Error(`${gate.id}: a step's script failed`);
          sleep(1500);
          if (next) waitForAny(next.split("|"), ms ?? 30000);
          continue;
        }
        const optional = label.startsWith("?");
        const name = optional ? label.slice(1) : label;
        if (optional && evalJs(`return document.body.innerText.includes(${JSON.stringify(next.split("|")[0])})`)) continue;
        if (!press(name) && !optional) throw new Error(`${gate.id}: no button "${name}"`);
        sleep(1500);
        waitForAny(next.split("|"), ms ?? 30000);
      }
      // Launched again (not reinstalled), with more in the environment: the gate is what the next launch shows.
      if (gate.relaunch) {
        sleep(gate.settle ?? 3000);
        simctl("terminate", udid, BUNDLE);
        sh("xcrun", ["simctl", "launch", udid, BUNDLE], Object.fromEntries(Object.entries({ ...env, ...gate.relaunch }).map(([k, v]) => [`SIMCTL_CHILD_${k}`, v])));
      }
      waitFor(gate.ready, 60000);
      if (gate.blur) {
        evalJs("document.activeElement?.blur(); return true");
        sleep(1000);
      }
    },
    appearance: (scheme) => simctl("ui", udid, "appearance", scheme),
    screenshot: (path) => simctl("io", udid, "screenshot", path),
  };
}
