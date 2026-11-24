// A stress run of the native Mac frame (the 2026-11-18 end-to-end pass), on perf.mjs's scratch library (run
// `node apps/mac/scripts/perf.mjs --fresh --runs 1` once first). Nothing here touches the installed app, its folder
// or the owner's library.
//
//   node apps/mac/scripts/stress.mjs [--cycles 6] [--tabs 25] [--label run]
//
// Tab churn (notes opened in tabs and closed again, the memory after each round), every native screen in turn,
// fast tab switching, a note opened and its tab closed at once, and 900 engine changes (300 notes made, starred and
// sent to Trash) with All notes on screen. Then the live objects (`heap`): models and engine stores that grow with
// each round of tabs are a leak (the note-title subscriptions did, 19 a round, before FrameModel's observers could
// end). Records the app's and its WebKit helpers' footprint and main-thread round trips (the frame command, less
// its fixed 350 ms wait). Exits 1 on a crash or a leak. Results in apps/mac/build/perf/stress-<label>.json.
// FOLEVI_APP runs another Debug build (a before and after).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { command, evaluate, launch, waitFor } from "./mac.mjs";

const MAC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(MAC, "build", "run", "perf");
const library = join(MAC, "build", "run", "perf-library");
const out = join(MAC, "build", "perf");
const arg = (n, f) => (process.argv.indexOf(n) > 0 ? process.argv[process.argv.indexOf(n) + 1] : f);
const CYCLES = Number(arg("--cycles", "6"));
const TABS = Number(arg("--tabs", "25"));
const LABEL = arg("--label", "run");
const env = { FOLEVI_TEST_FOLDER: library };

const appPid = () => JSON.parse(readFileSync(join(dir, "Debug", "app.json"), "utf8")).pid;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const webkitPids = () => new Set(execFileSync("ps", ["-axo", "pid=,comm="], { encoding: "utf8" }).split("\n").filter((l) => /com\.apple\.WebKit\./.test(l)).map((l) => Number(l.trim().split(/\s+/)[0])));
const fp = (pid) => {
  try {
    const t = execFileSync("footprint", ["-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const m = /Footprint:\s*([\d.]+)\s*([KMG])B/.exec(t);
    return m ? Number(m[1]) * (m[2] === "G" ? 1024 : m[2] === "K" ? 1 / 1024 : 1) : 0;
  } catch { return 0; }
};
const r1 = (x) => Math.round(x * 10) / 10;
const ENGINE = `
  const engine = window.__foleviEngine;
  const place = window.__foleviNativeChrome && window.__foleviNativeChrome.place;
  let n = 0;
  const run = async (name, args) => {
    const reply = JSON.parse(await engine.handle({ v: 1, id: "st" + n++, kind: "command", place, name, args }));
    if (reply.error) throw new Error(name + ": " + JSON.stringify(reply.error));
    return reply.result ?? reply.value;
  };`;

const res = { at: new Date().toISOString(), label: LABEL, phases: {}, problems: [] };
let pid;
const mem = () => {
  const now = webkitPids();
  const hs = [...now].filter((p) => !before.has(p));
  return { app: r1(fp(pid)), web: r1(hs.reduce((s, p) => s + fp(p), 0)), helpers: hs.length };
};
const frame = async (req = {}) => {
  const t = performance.now();
  const v = await command(dir, { cmd: "frame", ...req }, 30_000);
  return { ms: performance.now() - t - 350, v: v?.value, error: v?.error };
};
const check = (where) => { if (!alive(pid)) { res.problems.push(`app died during ${where}`); throw new Error(`app died during ${where}`); } };

await command(dir, { cmd: "quit" }).catch(() => undefined);
if (res.problems.length) process.exit(1);
await sleep(2500);
const before = webkitPids();
await launch({ dir, env });
await waitFor(dir, `return !!window.__foleviEngine && !!window.__foleviNativeChrome`, 90_000);
for (let i = 0; i < 300; i++) { const s = await command(dir, { cmd: "frame" }).catch(() => null); if (s?.value?.engine === "ready") break; await sleep(100); }
pid = appPid();
await frame({ do: "front" });
await sleep(4000);
res.start = mem();
const WATCH = /FrameModel|ValueStore|ListStore|EngineClient|TabPictureStore|NotesListModel/;
const objects = () => {
  const text = execFileSync("heap", [String(pid)], { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] });
  const c = {};
  for (const line of text.split("\n")) {
    const m = /^\s*(\d+)\s+\d+\s+[\d.]+\s+\S+\s+(.+?)\s+(Swift|ObjC|C\+\+|C)\s+\S+/.exec(line) ?? /^\s*(\d+)\s+\d+\s+\S+\s+(\S.*?)\s{2,}/.exec(line);
    if (m && WATCH.test(m[2])) c[m[2].replace(/\s+/g, " ")] = Number(m[1]);
  }
  return c;
};
const objectsAtStart = objects();
console.log("start", res.start);

const ids = await evaluate(dir, `${ENGINE}
  const made = [];
  const para = (i) => "Paragraph " + i + " about the garden, the market and the week ahead.";
  for (let i = 0; i < 40; i++) made.push((await run("note.create", { text: "Stress tab " + i + "\\n" + Array.from({ length: 30 + (i % 5) * 40 }, (_, k) => para(k)).join("\\n"), open: false })).id);
  return made;`, 120_000);
if (!Array.isArray(ids) || ids.length < TABS) throw new Error(`only ${ids?.length} notes found`);
console.log(ids.length, "note ids");

// 1. Tab churn.
{
  const cycles = [];
  for (let c = 0; c < CYCLES; c++) {
    const opened = [];
    const times = [];
    for (let k = 0; k < TABS; k++) {
      const f = await frame({ do: "open", path: "/d/" + ids[(c * 7 + k) % ids.length] });
      times.push(f.ms);
      const active = f.v?.tabs?.find((t) => t.active);
      if (active) opened.push(active.id);
    }
    check("tab churn open");
    const peak = mem();
    const tabsAtPeak = (await frame()).v?.tabs?.length;
    for (const id of opened) await frame({ do: "close", tab: id });
    check("tab churn close");
    await sleep(2500);
    const after = mem();
    const left = (await frame()).v?.tabs?.length;
    cycles.push({ peak, after, tabsAtPeak, tabsLeft: left, openMsMax: Math.round(Math.max(...times)), openMsMedian: Math.round([...times].sort((a, b) => a - b)[times.length >> 1]) });
    console.log("churn", c + 1, JSON.stringify(cycles.at(-1)));
  }
  res.phases.tabChurn = cycles;
}

// Live objects after the churn: anything up by more than a round's worth is kept per tab and never let go.
{
  const now = objects();
  const grew = Object.entries(now).filter(([k, n]) => n - (objectsAtStart[k] ?? 0) > Math.max(3, CYCLES)).map(([k, n]) => ({ type: k, start: objectsAtStart[k] ?? 0, now: n }));
  res.phases.objects = { grew };
  for (const g of grew) res.problems.push(`${g.type}: ${g.start} live at the start, ${g.now} after the tab churn`);
  console.log("objects", JSON.stringify(res.phases.objects));
}

// 2. Screen churn.
{
  const paths = ["/documents", "/notes", "/drafts", "/starred", "/archive", "/trash", "/templates", "/folders", "/calendar", "/tasks/today", "/changes", "/shared", "/graph", "/catch-up"];
  const rounds = [];
  for (let c = 0; c < 4; c++) {
    const times = {};
    for (const p of paths) {
      const f = await frame({ do: "open", path: p });
      if (f.error) res.problems.push(`${p}: ${f.error}`);
      times[p] = Math.round(f.ms);
      await sleep(300);
    }
    check("screen churn");
    // Close every tab but one.
    const tabs = (await frame()).v?.tabs ?? [];
    for (const t of tabs.slice(1)) await frame({ do: "close", tab: t.id });
    await sleep(2000);
    rounds.push({ mem: mem(), slowest: Object.entries(times).sort((a, b) => b[1] - a[1]).slice(0, 3) });
    console.log("screens", c + 1, JSON.stringify(rounds.at(-1)));
  }
  res.phases.screenChurn = rounds;
}

// 3. Rapid switching between 12 open note tabs (no wait between commands beyond the reply).
{
  for (let k = 0; k < 12; k++) await frame({ do: "open", path: "/d/" + ids[k] });
  const times = [];
  for (let k = 0; k < 150; k++) {
    const f = await frame({ do: k % 2 ? "next" : "previous" });
    times.push(f.ms);
  }
  for (let k = 0; k < 60; k++) times.push((await frame({ do: "number", n: 1 + (k % 9) })).ms);
  check("rapid switching");
  const s = [...times].sort((a, b) => a - b);
  res.phases.switching = { n: times.length, medianMs: Math.round(s[s.length >> 1]), p95Ms: Math.round(s[Math.floor(s.length * 0.95)]), maxMs: Math.round(s.at(-1)), mem: mem() };
  console.log("switching", JSON.stringify(res.phases.switching));
}

// 4. Open a note and close its tab at once, many times (results landing on a closed tab).
{
  let errors = 0;
  for (let k = 0; k < 40; k++) {
    const o = await frame({ do: "open", path: "/d/" + ids[(k * 3) % ids.length] }).catch(() => { errors++; return {}; });
    const v = o.v;
    const active = v?.tabs?.find((t) => t.active);
    if (active && v.tabs.length > 1) await frame({ do: "close", tab: active.id });
  }
  check("open-close race");
  await sleep(2000);
  const v = (await frame()).v;
  res.phases.openClose = { errors, tabs: v?.tabs?.length, route: v?.route, shownNote: v?.shownNote, toasts: v?.toasts, mem: mem() };
  console.log("openClose", JSON.stringify(res.phases.openClose));
}

// 5. Bulk edits while All notes is on screen: 300 creates, 300 stars, 300 to Trash, in chunks of 25 through the
// engine, with a main-thread round trip between chunks (the debug channel takes one request at a time).
{
  await frame({ do: "open", path: "/notes" });
  await sleep(1500);
  const t = performance.now();
  const probe = [];
  const made = [];
  let failed = 0;
  const chunk = async (body) => {
    try { return await evaluate(dir, `${ENGINE} ${body}`); } catch (e) { failed++; res.problems.push("bulk: " + String(e).slice(0, 200)); return null; }
  };
  for (let i = 0; i < 300; i += 25) {
    const ids = await chunk(`const out = []; for (let i = ${i}; i < ${i + 25}; i++) out.push((await run("note.create", { text: "Stress note " + i + "\\nBody " + i, open: false })).id); return out;`);
    if (ids) made.push(...ids);
    probe.push((await frame()).ms);
  }
  for (let i = 0; i < made.length; i += 25) {
    await chunk(`const ids = ${JSON.stringify(made.slice(i, i + 25))}; for (let k = 0; k < ids.length; k++) await run("note.star", { ids: [ids[k]], starred: k % 2 === 0 }); return true;`);
    probe.push((await frame()).ms);
  }
  for (let i = 0; i < made.length; i += 25) {
    await chunk(`const ids = ${JSON.stringify(made.slice(i, i + 25))}; for (const id of ids) await run("note.trash", { ids: [id] }); return true;`);
    probe.push((await frame()).ms);
  }
  check("bulk edits");
  const s = [...probe].sort((a, b) => a - b);
  res.phases.bulk = { made: made.length, failedChunks: failed, seconds: r1((performance.now() - t) / 1000), mainThreadProbe: { n: s.length, medianMs: Math.round(s[s.length >> 1] ?? 0), maxMs: Math.round(s.at(-1) ?? 0) }, mem: mem() };
  console.log("bulk", JSON.stringify(res.phases.bulk));
}

res.end = mem();
mkdirSync(out, { recursive: true });
writeFileSync(join(out, `stress-${LABEL}.json`), JSON.stringify(res, null, 2));
console.log("end", JSON.stringify(res.end), "problems", JSON.stringify(res.problems));
await command(dir, { cmd: "quit" }).catch(() => undefined);
if (res.problems.length) process.exit(1);
