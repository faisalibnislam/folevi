#!/usr/bin/env node
// Real captures of the Debug app's windows (`screencapture -l`), for looking at: the app's own windowShot can't
// draw glass, materials or shadows (docs/MAC_NATIVE_LOOK.md). One capture at a time, never several at once (see
// holdUiLock in mac.mjs). screens.mjs --look uses this for every screen; on its own:
//
//   node apps/mac/scripts/look.mjs shot <user-data> <out.png> [--main | --id N]   every window on screen (or only the
//                                                                       largest, or the one with that window number)
//   node apps/mac/scripts/look.mjs windows <user-data>                  the app's windows on screen, as JSON
//   node apps/mac/scripts/look.mjs hover <user-data> <x> <y> [--click]  the pointer over a point of the main window
//                                                                       (points from its top left), for this app only
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const here = dirname(fileURLToPath(import.meta.url));
const TOOLS = resolve(here, "..", "build", "tools");

/** A small Swift tool beside this script, built once into apps/mac/build/tools. */
function tool(name) {
  const bin = join(TOOLS, name);
  if (!existsSync(bin)) {
    mkdirSync(TOOLS, { recursive: true });
    execFileSync("swiftc", ["-O", join(here, `${name}.swift`), "-o", bin], { stdio: "inherit" });
  }
  return bin;
}

const pidOf = (udir) => JSON.parse(readFileSync(join(udir, "Debug", "app.json"), "utf8")).pid;

/** The app's windows on screen, the largest first (menus, popovers and sheets are windows of their own). */
export function windowsOf(udir) {
  const all = JSON.parse(execFileSync(tool("winlist"), [String(pidOf(udir))], { encoding: "utf8" }));
  return all.filter((w) => w.alpha > 0 && w.width > 40 && w.height > 20).sort((a, b) => b.width * b.height - a.width * a.height);
}

/** Real captures of the app's windows: the largest into `path`, the others into `<path>-w2.png`, ... */
export async function lookShot(udir, path, { mainOnly = false, id = null } = {}) {
  // `id`: one window by its number (mac.mjs windows), whatever else is open (the Settings window can be the larger).
  const wins = id ? windowsOf(udir).filter((w) => w.id === id) : windowsOf(udir).slice(0, mainOnly ? 1 : undefined);
  let n = 1;
  for (const w of wins) {
    execFileSync("screencapture", ["-x", "-o", "-l", String(w.id), n === 1 ? path : path.replace(/\.png$/, `-w${n}.png`)]);
    n++;
    await sleep(150);
  }
  return wins;
}

/** The pointer over a point of the app's largest window (points from its top left), without moving the Mac's own. */
export function hover(udir, x, y, { click = false } = {}) {
  const [main] = windowsOf(udir);
  if (!main) throw new Error("no window on screen");
  execFileSync(tool("pointer"), [String(pidOf(udir)), String(main.x + x), String(main.y + y), ...(click ? ["click"] : [])]);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, udir, ...rest] = process.argv.slice(2);
  const ud = resolve(udir ?? "");
  if (cmd === "shot") console.log(JSON.stringify((await lookShot(ud, resolve(rest[0]), { mainOnly: rest.includes("--main"), id: rest.includes("--id") ? Number(rest[rest.indexOf("--id") + 1]) : null })).map((w) => [w.name, w.width, w.height])));
  else if (cmd === "windows") console.log(JSON.stringify(windowsOf(ud), null, 1));
  else if (cmd === "hover") hover(ud, Number(rest[0]), Number(rest[1]), { click: rest.includes("--click") });
  else console.error("look.mjs shot|windows|hover <user-data> ...");
}
