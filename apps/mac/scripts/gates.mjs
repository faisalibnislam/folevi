// The screens before the app (first launch, library setup, sign-in, the library lock), each reached from a
// fresh scratch data folder of its own in apps/mac/build/run/gates-<id> (never the installed app's folder,
// Keychain or library), by pressing the page's own buttons, so the web frame and the native frame reach the same
// state the same way. Used by screens.mjs --gates (web vs native diffs) and web-styles.mjs (area files with
// "gates": true).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { command, evaluate, launch, waitFor } from "./mac.mjs";

const MAC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const gateDir = (id) => join(MAC, "build", "run", `gates-${id}`);

/** Clicks the page's first button whose text (or test id) matches, in either frame (native draws over it). */
const click = (text) => `
  const want = ${JSON.stringify(text)};
  const b = document.querySelector('[data-testid="' + want + '"]') || [...document.querySelectorAll("button")].find((x) => x.innerText.replace(/\\s+/g, " ").includes(want));
  if (!b) throw new Error("no button " + want);
  b.click();
  return true;`;
const until = (text) => `return document.body.innerText.includes(${JSON.stringify(text)})`;

/**
 * The gate screens: the steps from a first launch to each. `site` ones need the website the build signs in
 * through (shell/build.json siteUrl, the web dev server) and run only with FOLEVI_GATES_SITE=1.
 */
export const GATES = [
  { id: "first-launch", steps: [] , ready: "Where should your notes live?" },
  { id: "library-setup", steps: [["Keep notes on my devices", "Where should your library live?"]], ready: "Where should your library live?" },
  {
    id: "library-ready",
    steps: [
      ["Keep notes on my devices", "Where should your library live?"],
      ["place-folder", "Your library is ready"],
    ],
    ready: "Your library is ready",
  },
  // Needs the website the shell build signs in through (shell/build.json siteUrl) to answer "no session".
  // (The window reloads into account mode and shows the choice again: its "go straight on" note in
  // sessionStorage doesn't survive the Mac's reload into the other mode, so Sign in is pressed twice.)
  { id: "sign-in", site: true, steps: [["Sign in to Folevi", "Where should your notes live?", 6000], ["Sign in to Folevi", "Continue with Apple"]], ready: "Continue with Apple" },
  // No network: account mode opens on "You're offline" (a FullPageMessage card with one button).
  { id: "offline", env: { FOLEVI_OFFLINE: "1" }, steps: [["Sign in to Folevi", "You're offline"]], ready: "You're offline" },
].filter((g) => !g.site || process.env.FOLEVI_GATES_SITE === "1");

function stop(dir) {
  try {
    process.kill(JSON.parse(readFileSync(join(dir, "Debug", "app.json"), "utf8")).pid, "SIGTERM");
  } catch {
    // Not running.
  }
}

/** Starts the app fresh in `gate`'s state; resolves with its data folder once the screen is up. */
export async function enterGate(gate, { web }) {
  const dir = gateDir(gate.id);
  const library = `${dir}-library`;
  stop(dir);
  await sleep(800);
  rmSync(dir, { recursive: true, force: true });
  rmSync(library, { recursive: true, force: true });
  mkdirSync(library, { recursive: true });
  // The run's settings live in a defaults suite named after the folder (Paths.runTag), not in the folder: a fresh
  // first launch needs it gone too (the mode would say "account" or "local" from the last run).
  const tag = createHash("sha256").update(dir).digest("hex").slice(0, 8);
  try {
    execFileSync("defaults", ["delete", `com.folevi.mac.dev.run-${tag}`], { stdio: "ignore" });
  } catch {
    // Nothing kept yet.
  }
  await launch({ dir, env: { FOLEVI_TEST_FOLDER: library, ...(gate.env ?? {}), ...(web ? { FOLEVI_WEB_FRAME: "1" } : {}) } });
  await waitFor(dir, until("Where should your notes live?"), 90_000);
  for (const [button, next, settle] of gate.steps) {
    await sleep(600);
    await evaluate(dir, click(button));
    await sleep(settle ?? 1500);
    await waitFor(dir, until(next), 90_000);
  }
  await sleep(1200);
  await command(dir, { cmd: "float" });
  return dir;
}

export async function quitGate(dir) {
  await command(dir, { cmd: "quit" }).catch(() => undefined);
  await sleep(1500);
  stop(dir);
}
