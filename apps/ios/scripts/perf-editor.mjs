#!/usr/bin/env node
// A repeatable measurement of the note page in the app's own web view (a Debug build on a Simulator, local mode,
// scratch data only; docs/IOS_PERFORMANCE.md). It uses `simulator.mjs eval`, so it needs a Debug build open on the
// device. JavaScript runs on the Mac here: compare runs with each other, never with a phone's numbers.
//
//   node scripts/perf-editor.mjs seed <device> [blocks]     makes a scratch note of that many blocks, prints its id
//   node scripts/perf-editor.mjs run <device> [label]       on the note open now: typing, selection, scrolling
//
// Typing goes through ProseMirror's own transactions, one character every two frames. Selection moves the caret.
// Scrolling drives the note's own scroller. Reported: the JavaScript time of each change, the gaps between frames,
// and what crossed the bridge to native (messages, bytes, event names).
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const [command, device, arg] = process.argv.slice(2);
if (!command || !device) {
  console.log("Usage: node scripts/perf-editor.mjs seed|run <device> [blocks|label]");
  process.exit(1);
}

function page(js) {
  const raw = execFileSync("node", [resolve(here, "simulator.mjs"), "eval", js, device], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`The page answered: ${raw.slice(0, 400)}`);
  }
  if (parsed.error) throw new Error(parsed.error);
  return parsed.value;
}

const ENGINE = `
  const call = async (m) => JSON.parse(await window.__foleviEngine.handle(JSON.stringify({ v: 1, ...m })));
  const place = "library";
`;

if (command === "seed") {
  const blocks = Number(arg ?? 3000);
  const id = page(`${ENGINE}
    const made = await call({ id: "perf-c", kind: "command", place, name: "note.create", args: { open: false } });
    if (!made.ok) return made;
    return made.value.id;`);
  console.log(JSON.stringify({ id, blocks, next: `FOLEVI_REBUILD_OPEN=/d/${id}` }));
} else if (command === "fill") {
  // On the note open now: its content replaced with `arg` blocks of mixed kinds (a scratch note only).
  const blocks = Number(arg ?? 3000);
  const out = page(`
    const dom = document.querySelector(".ProseMirror");
    const editor = dom && dom.editor;
    if (!editor) return "no editor";
    const words = "the quick brown fox jumps over a lazy dog while রাত গভীর হলে পাখিরা ঘুমায় and notes keep their shape".split(" ");
    const sentence = (i) => Array.from({ length: 18 }, (_, k) => words[(i * 7 + k * 3) % words.length]).join(" ");
    const content = [];
    for (let i = 0; i < ${blocks}; i++) {
      const text = [{ type: "text", text: sentence(i) }];
      if (i % 40 === 0) content.push({ type: "heading", attrs: { level: 2 }, content: text });
      else content.push({ type: "paragraph", content: text });
    }
    const t0 = performance.now();
    editor.commands.setContent({ type: "doc", content });
    return { ms: performance.now() - t0, childCount: editor.state.doc.childCount, size: editor.state.doc.content.size };`);
  console.log(JSON.stringify(out));
} else if (command === "run") {
  // (The run outlasts one eval call: it starts in the page and is asked for until it's done.)
  page(`window.__perfResult = null; (async () => { try { window.__perfResult = await (async () => {
    const dom = document.querySelector(".ProseMirror");
    const editor = dom && dom.editor;
    if (!editor) return { error: "no editor" };
    const view = editor.view;
    const raf = () => new Promise((r) => requestAnimationFrame(r));
    const stats = (a) => {
      const s = [...a].sort((x, y) => x - y);
      const at = (p) => s.length ? +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(2) : 0;
      return { n: s.length, avg: s.length ? +(s.reduce((x, y) => x + y, 0) / s.length).toFixed(2) : 0, p50: at(0.5), p95: at(0.95), max: at(1) };
    };
    // What goes to native: every batch the engine posts.
    const handler = window.webkit.messageHandlers.foleviEngine;
    const bridge = { messages: 0, bytes: 0, events: {} };
    const proto = Object.getPrototypeOf(handler);
    const realPost = proto.postMessage;
    proto.postMessage = function (m) {
      bridge.messages++;
      bridge.bytes += m.length || 0;
      try {
        for (const item of JSON.parse(m)) {
          const key = item.kind === "event" ? item.name : "update";
          bridge.events[key] = (bridge.events[key] || 0) + 1;
        }
      } catch {}
      return realPost.call(this, m);
    };
    const take = () => { const copy = JSON.parse(JSON.stringify(bridge)); bridge.messages = 0; bridge.bytes = 0; bridge.events = {}; return copy; };
    const frames = async (work) => {
      const gaps = [];
      let running = true;
      let last = performance.now();
      const loop = () => requestAnimationFrame((t) => { const n = performance.now(); gaps.push(n - last); last = n; if (running) loop(); });
      loop();
      const extra = await work();
      running = false;
      await raf();
      return { gaps: stats(gaps), over17: gaps.filter((g) => g > 17).length, over33: gaps.filter((g) => g > 33).length, ...extra };
    };
    const results = { doc: { blocks: view.state.doc.childCount, size: view.state.doc.content.size } };
    view.focus();
    await raf();

    // Typing, in the middle of the note.
    const middle = Math.floor(view.state.doc.content.size / 2);
    const start = view.state.doc.resolve(middle).end();
    view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.near(view.state.doc.resolve(start))));
    await raf(); await raf();
    take();
    results.typing = await frames(async () => {
      const js = [];
      for (let i = 0; i < 200; i++) {
        const t0 = performance.now();
        view.dispatch(view.state.tr.insertText(i % 7 === 6 ? " " : "x"));
        js.push(performance.now() - t0);
        await raf(); await raf();
      }
      return { dispatchMs: stats(js) };
    });
    results.typing.bridge = take();

    // Autosave settling after the typing.
    await new Promise((r) => setTimeout(r, 4000));
    results.afterTyping = { bridge: take() };

    // Caret movement.
    const sel = view.state.selection.constructor;
    results.selection = await frames(async () => {
      const js = [];
      for (let i = 0; i < 120; i++) {
        const t0 = performance.now();
        const pos = Math.min(view.state.doc.content.size - 2, 40 + i * 211);
        view.dispatch(view.state.tr.setSelection(sel.near(view.state.doc.resolve(pos))));
        js.push(performance.now() - t0);
        await raf(); await raf();
      }
      return { dispatchMs: stats(js) };
    });
    results.selection.bridge = take();

    // Scrolling the note.
    const s = document.getElementById("doc-scroll");
    if (s) {
      s.scrollTop = 0;
      await raf(); take();
      results.scrolling = await frames(async () => {
        for (let i = 0; i < 300; i++) { s.scrollTop += 40; await raf(); }
        return { end: s.scrollTop, height: s.scrollHeight };
      });
      results.scrolling.bridge = take();
    }
    proto.postMessage = realPost;
    return results;
  })(); } catch (e) { window.__perfResult = { error: String(e) }; } })(); return 1`);
  let out = null;
  for (let i = 0; i < 600 && !out; i++) {
    execFileSync("sleep", ["1"]);
    out = page("return window.__perfResult");
  }
  const label = arg ?? "run";
  console.log(JSON.stringify({ label, ...out }, null, 1));
} else {
  console.log("Usage: node scripts/perf-editor.mjs seed|fill|run <device> [blocks|label]");
  process.exit(1);
}
