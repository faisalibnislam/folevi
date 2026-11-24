#!/usr/bin/env node
// The upgrade from 1.0.04 (docs/MAC_REBUILD_PLAN.md section 5.5, M10): a Debug build of 1.0.04 (the commit
// f5f00a26, built in a scratch worktree) sets up a library on a scratch folder, makes notes, keeps a Foli AI key,
// and is killed with one more note not yet in the library's files (an unsent edit); then this build opens the same
// folder and must find all of it. Both are the Debug identity on one FOLEVI_USER_DATA folder, so they share its
// settings, web storage and Keychain names (com.folevi.dev.<run>.*), as a release update shares the release's.
// Nothing here touches the installed app, its folder, its Keychain items or the owner's library.
//
//   node apps/mac/scripts/upgrade.mjs --old "<worktree of f5f00a26>/apps/mac/build/DerivedData/Build/Products/Debug/Folevi Dev.app"
//
// Results in apps/mac/build/upgrade/upgrade.json; exits 1 when something didn't survive.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { command, evaluate, launch, waitFor } from "./mac.mjs";

const MAC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(MAC, "build", "run", "upgrade");
const library = join(MAC, "build", "run", "upgrade-library");
const out = join(MAC, "build", "upgrade");
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const old = arg("--old");
if (!old || !existsSync(old)) {
  console.error("Say where the 1.0.04 Debug build is: --old <path>/Folevi Dev.app");
  process.exit(2);
}
const env = { FOLEVI_TEST_FOLDER: library };
const KEY = "sk-upgrade-test-not-a-real-key";
const NOTES = ["Upgrade one\nWritten by 1.0.04.", "Upgrade two\nAlso by 1.0.04, with a second line.", "Upgrade three\nThe last saved one."];
const UNSENT = "Upgrade unsent\nTyped in 1.0.04 just before it was killed.";

const pidOf = () => JSON.parse(readFileSync(join(dir, "Debug", "app.json"), "utf8")).pid;
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function quit() {
  let pid;
  try {
    pid = pidOf();
  } catch {
    return;
  }
  await command(dir, { cmd: "quit" }).catch(() => undefined);
  for (let i = 0; i < 80 && alive(pid); i++) await sleep(250);
  if (alive(pid)) process.kill(pid, "SIGTERM");
  await sleep(2000);
}
const cmd = async (c, o = {}) => {
  const r = await command(dir, { cmd: c, ...o });
  if (r.error) throw new Error(`${c}: ${r.error}`);
  return r;
};
/** Every file under `root` with its text (the library's notes are small). */
function files(root) {
  const outFiles = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else outFiles.push(p);
    }
  };
  if (existsSync(root)) walk(root);
  return outFiles;
}
const libraryHas = (text) => files(library).some((f) => statSync(f).size < 2_000_000 && readFileSync(f).includes(text));
const firstLine = (t) => t.split("\n")[0];

const results = { at: new Date().toISOString(), old, checks: {} };
const check = (name, ok, detail) => {
  results.checks[name] = { ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) };
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail === undefined ? "" : `  ${JSON.stringify(detail)}`}`);
};

// ---- 1.0.04
await quit();
rmSync(dir, { recursive: true, force: true });
rmSync(library, { recursive: true, force: true });
mkdirSync(library, { recursive: true });
mkdirSync(out, { recursive: true });

await launch({ dir, env, app: old });
await waitFor(dir, `return /Where should your (notes|library) live\\?/.test(document.body.innerText)`, 90_000);
const info = await evaluate(dir, `return await foleviShell.library.setup({ kind: "folder" })`);
if (!String(info?.displayPath ?? "").endsWith("upgrade-library")) throw new Error(`Not the script's own library: ${JSON.stringify(info)}. Stopped.`);
await evaluate(dir, `await foleviShell.setMode("local"); setTimeout(() => location.reload(), 50); return true;`);
await sleep(3000);
await waitFor(dir, `return document.readyState === "complete" && !!document.querySelector('nav[aria-label="Folio"]')`, 90_000);
results.oldVersion = await evaluate(dir, `return foleviShell.shellVersion ?? null`).catch(() => null);
for (const text of NOTES) {
  await cmd("service", { text });
  await sleep(1500);
}
await evaluate(dir, `await foleviShell.secrets.set("ai.openai", ${JSON.stringify(KEY)}); return await foleviShell.secrets.has("ai.openai")`);
await sleep(4000);
await quit();
check("1.0.04 wrote the saved notes to the library", NOTES.every((t) => libraryHas(firstLine(t))));

// The unsent edit: a note the page has taken (its device copy and journal) but not yet written to the library's
// files, then a kill (no quit, no flush).
await launch({ dir, env, app: old });
// (It opens again on the last note, where the sidebar's Folio isn't drawn.)
await waitFor(dir, `return document.readyState === "complete" && /Search or jump/.test(document.body.innerText)`, 90_000);
await sleep(2000);
await cmd("service", { text: UNSENT });
let taken = false;
for (let i = 0; i < 40 && !taken; i++) {
  await sleep(50);
  taken = await evaluate(dir, `return document.body.innerText.includes(${JSON.stringify(firstLine(UNSENT))})`).catch(() => false);
}
const inFilesAtKill = libraryHas(firstLine(UNSENT));
process.kill(pidOf(), "SIGKILL");
await sleep(2000);
results.unsent = { shownByThePageBeforeTheKill: taken, inTheLibraryFilesAtTheKill: inFilesAtKill };
console.log(`unsent edit: shown before the kill ${taken}, in the library's files at the kill ${inFilesAtKill}`);

// ---- this build
const t0 = performance.now();
await launch({ dir, env });
await waitFor(dir, `return !!window.__foleviEngine && !!window.__foleviNativeChrome`, 90_000);
results.newReadyMs = Math.round(performance.now() - t0);
await sleep(4000);
const mode = await evaluate(dir, `return { mode: foleviShell.initialMode ?? null, places: foleviShell.places ? foleviShell.places.current : null }`).catch((e) => ({ error: e.message }));
check("the library is still the open place", mode?.places === "library" || mode?.mode === "local", mode);
const lib = await evaluate(dir, `return await foleviShell.library.info()`).catch((e) => ({ error: e.message }));
check("the library is still set up on its folder", lib?.configured === true && String(lib?.displayPath ?? "").endsWith("upgrade-library"), { configured: lib?.configured, displayPath: lib?.displayPath });
const listed = await evaluate(
  dir,
  `const engine = window.__foleviEngine, place = window.__foleviNativeChrome.place;
   const r = JSON.parse(await engine.handle({ v: 1, id: "up1", kind: "query", place, name: "notes.list", args: { view: "all" }, window: { start: 0, count: 200 } }));
   if (r.error) throw new Error(JSON.stringify(r.error));
   return JSON.stringify(r.value ?? r.result ?? r);`,
);
const titles = [...String(listed).matchAll(/"title":"([^"]*)"/g)].map((m) => m[1]);
results.titles = titles;
for (const t of NOTES) check(`note "${firstLine(t)}" survived`, titles.includes(firstLine(t)));
check(`the unsent note "${firstLine(UNSENT)}" survived`, titles.includes(firstLine(UNSENT)), results.unsent);
const key = await evaluate(dir, `return await foleviShell.secrets.has("ai.openai")`).catch((e) => ({ error: e.message }));
check("the Foli AI key survived (Keychain, never read back)", key === true, key);
await sleep(5000);
check("the unsent note reached the library's files", libraryHas(firstLine(UNSENT)));

// Clean up the run's Keychain item (scratch, this run's name only).
await evaluate(dir, `await foleviShell.secrets.delete("ai.openai"); return true`).catch(() => undefined);
await quit();
results.ok = Object.values(results.checks).every((c) => c.ok);
writeFileSync(join(out, "upgrade.json"), JSON.stringify(results, null, 2));
console.log(results.ok ? "upgrade: everything survived" : "upgrade: something didn't survive");
process.exit(results.ok ? 0 : 1);
