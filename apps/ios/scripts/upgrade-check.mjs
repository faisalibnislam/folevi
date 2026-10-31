// Today's app to the rebuild on one install (docs/IOS_REBUILD_PLAN.md, I2): a fresh install of the built app makes
// a library on this device and a note in it in today's frame (the engine's note.create, as Shortcuts would), then
// the same install opens in the new frame (FOLEVI_REBUILD=1, no reinstall) straight on that note, and back: a note
// made in the new frame is there in today's app. (Checked by its body: the editor makes apostrophes typographic.) Scratch data only: the app is reinstalled first.
//
//   node scripts/upgrade-check.mjs --app <App.app> [--device "iPhone 18 Pro"] [--out <folder for screenshots>]
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { BUNDLE, GATES, simulator } from "./gates.mjs";

const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const app = arg("--app");
const device = arg("--device", "iPhone 18 Pro");
const out = arg("--out", null);
if (!app) throw new Error("Pass --app <path to the built App.app>");
if (out) mkdirSync(out, { recursive: true });

const sim = simulator(device);
const shot = (name) => out && sim.screenshot(join(out, `${name}.png`));
const relaunch = (env) => {
  try {
    sim.simctl("terminate", sim.udid, BUNDLE);
  } catch {
    /* not running */
  }
  sim.sleep(1000);
  sim.launch(env);
};

/** A command straight to the engine in the page, as native sends it; its reply's value. */
const command = (name, args) =>
  sim.evalJs(`const marker = window.__foleviNativeChrome; const reply = JSON.parse(await window.__foleviEngine.handle({ v: 1, id: "upgrade-" + Date.now(), kind: "command", place: marker?.place ?? null, name: ${JSON.stringify(name)}, args: ${JSON.stringify(args)} })); if (!reply.ok) throw new Error(JSON.stringify(reply.error)); return reply.value;`);

const waitUntil = (what, test, ms = 30000) => {
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
const ready = () => waitUntil("the engine", () => sim.evalJs("return Boolean(window.__foleviEngine)"), 60000);
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok });
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

// 1. Today's frame: a library on this device, a note in it.
const ready0 = GATES.find((g) => g.id === "library-ready");
sim.open(app, ready0, {});
sim.press("Open Folevi");
sim.sleep(3000);
ready();
const first = command("note.create", { text: "Made in today's app\nIt opens in the new one.", open: false });
check("today's frame made a note", Boolean(first?.id), first?.id);
sim.sleep(2000);
shot("1-today");

// 2. The new frame on the same install, straight on that note.
relaunch({ FOLEVI_REBUILD: "1", FOLEVI_REBUILD_OPEN: `/d/${first.id}` });
ready();
const noGate = (() => {
  try {
    waitUntil("the note", () => sim.evalJs("return document.body.innerText.includes(\"It opens in the new one\")"), 30000);
    return true;
  } catch {
    return false;
  }
})();
check("the new frame opens today's note", noGate);
check("no first-launch screen in the new frame", !sim.evalJs('return document.body.innerText.includes("Where should your notes live?")'));
shot("2-rebuild");
const second = command("note.create", { text: "Made in the new frame\nIt opens in today's app.", open: false });
check("the new frame made a note", Boolean(second?.id), second?.id);
sim.sleep(2000);

// 3. Back to today's app: the new frame's note is there. (Read in the web frame, on the same store: today's native
// screens don't put a note's text in the page.)
relaunch({ FOLEVI_WEB_FRAME: "1" });
const loaded = () => waitUntil("the page", () => sim.evalJs('return document.readyState === "complete" && document.body.innerText.length > 0'), 60000);
loaded();
sim.sleep(1500);
sim.evalJs(`location.assign("/d/${second.id}"); return true;`);
sim.sleep(1500);
loaded();
const back = (() => {
  try {
    waitUntil("the note", () => sim.evalJs('return document.body.innerText.includes("It opens in today")'), 30000);
    return true;
  } catch {
    return false;
  }
})();
check("today's frame opens the new frame's note", back);
shot("3-today-again");

const failed = checks.filter((c) => !c.ok).length;
console.log(failed ? `${failed} of ${checks.length} failed` : `all ${checks.length} passed`);
process.exit(failed ? 1 : 0);
