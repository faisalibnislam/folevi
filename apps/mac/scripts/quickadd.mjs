#!/usr/bin/env node
// The Quick Add panel, web vs native (docs/MAC_REBUILD_PLAN.md M9, section 3.2): the web frame's panel
// (components/app/MacQuickAdd.tsx) against FoleviMac's WebQuickAddPanel, in the Debug app on the screens scratch
// library (apps/mac/build/run/screens, made by screens.mjs). Three states: empty (with the first-time hint), typed
// ("Call Sam tomorrow 9am !high": the date and priority chips) and added ("Added to Inbox" with Open). Each panel
// is drawn by the app itself (`cmd quickAddShot`: cacheDisplay and WebKit's own snapshot), never a screen capture.
// The material renders flat grey in-process, the same in both frames.
//
//   node apps/mac/scripts/quickadd.mjs        (needs build.mjs and screens.mjs's scratch library first)
//
// Report in apps/mac/screens-report/quick-add. Adding a task adds it to the scratch library's Inbox only.
import { createRequire } from "node:module";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { command, launch } from "./mac.mjs";
import { diffAll, writeReport } from "./diff.mjs";

const MAC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { webkit } = createRequire(join(MAC, "../web/package.json"))("@playwright/test");
const dir = join(MAC, "build", "run", "screens");
const library = join(MAC, "build", "run", "screens-library");
const out = join(MAC, "screens-report", "quick-add");
if (!existsSync(join(dir, "fixture.json"))) {
  console.error("No scratch library: run node apps/mac/scripts/screens.mjs --fresh first.");
  process.exit(2);
}
for (const d of ["web", "native", "diff"]) {
  rmSync(join(out, d), { recursive: true, force: true });
  mkdirSync(join(out, d), { recursive: true });
}

const TYPED = "Call Sam tomorrow 9am !high";

async function shoot(kind) {
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
  const shot = (state) => cmd("quickAddShot", { out: join(out, kind, `${state}-light.png`) });
  try {
    await cmd("appearance", { value: "light" });
    await cmd("quickAdd", { action: "show" });
    await sleep(2500);
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

await shoot("web");
await shoot("native");
const threshold = { channel: 24, radius: 1, maxRatio: 0.01 };
const browser = await webkit.launch();
const results = await diffAll(browser, out, ["empty", "typed", "added"].map((id) => ({ id, scheme: "light" })), threshold);
await browser.close();
writeReport(out, { title: "Quick Add: web vs Folevi for Mac", note: "The panel's content, 640 pt wide, the web frame vs the native frame.", threshold, results, imageWidth: 640 });
process.exit(results.every((r) => r.pass) ? 0 : 1);
