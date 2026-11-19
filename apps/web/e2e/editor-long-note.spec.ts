// How the note editor holds up in a long note: about 2,000 blocks (some 50 pages), the size a note must stay
// smooth at on an iPhone or iPad (the owner's bar, 2026-11-19). The iPhone interface in local mode (a FakeShell),
// at iPhone size with the app's markers, in Chromium with the CPU slowed down (CDP) and in WebKit, the apps'
// engine. Measured in the page: a key's press to the frame that shows it (at the start, the middle and the end
// of the note), Enter and Backspace (which add and remove blocks), moving the caret, a paste of the whole note,
// opening it from the list, scrolling it, and what runs while nothing happens. Best against the export the app
// carries (the production build), served like the app serves it:
//   node scripts/build-shell.mjs --platform ios --no-copy && node scripts/serve-shell.mjs 4320 .next-shell-ios
//   E2E_LOCAL_BASE_URL=http://127.0.0.1:4320 E2E_BASE_URL=http://app.localhost:3002 E2E_NO_SERVER=1 \
//     npx playwright test e2e/editor-long-note.spec.ts --project local --workers=1          # Chromium, slower CPU
//     npx playwright test e2e/editor-long-note.spec.ts --project iphone-webkit --workers=1  # WebKit
// PERF_OUT=<file.json> saves the numbers; PERF_CPU sets the slow-down (default 4); PERF_BLOCKS the note's size
// (default 2000); PERF_PROFILE=<file.json> also writes where the script time of typing went, by function
// (Chromium; most useful against `next dev` on 3003, where functions keep their names). The time budgets are
// only checked against an export (PERF_BUDGETS=0 skips every budget, for experiments).
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { webkit, type CDPSession, type Page } from "@playwright/test";
import { expect, prepareContext, test } from "./fixtures/localShell";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FoleviiOS/1.0";
const CPU = Number(process.env.PERF_CPU ?? 4);
const BLOCKS = Number(process.env.PERF_BLOCKS ?? 2000);

/** The stand-in iOS bridge and the page's own meters (before any of its scripts). */
function instrument() {
  const bridge = {
    platform: "ios",
    version: "1.0",
    haptic: () => undefined,
    hapticPrepare: () => undefined,
    setStatusBar: () => undefined,
    openExternal: async () => true,
    getSettings: async () => ({ lock: false, lockAfter: 0, method: "faceID" }),
    setSettings: async () => ({ lock: false, lockAfter: 0, method: "faceID" }),
    onCommand: () => () => undefined,
    keyboard: () => undefined,
    onKeyboard: () => () => undefined,
  };
  Object.defineProperty(window, "foleviNative", { value: bridge });
  const fake = (window as unknown as { __foleviTestShell?: unknown }).__foleviTestShell;
  if (fake && !("foleviShell" in window)) Object.defineProperty(window, "foleviShell", { value: fake });
  const mark = () => document.documentElement?.setAttribute("data-native", "ios");
  mark();
  if (!document.documentElement) new MutationObserver((_, watch) => document.documentElement && (mark(), watch.disconnect())).observe(document, { childList: true });
  const hideBadge = () => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal { display: none !important; }";
    document.head.appendChild(style);
  };
  if (document.head) hideBadge();
  else document.addEventListener("DOMContentLoaded", hideBadge, { once: true });

  const m = { commits: 0, rendered: 0, names: new Map<string, number>(), longTasks: [] as number[], keys: [] as number[], sync: [] as number[], draw: [] as number[], mutations: 0 };
  Object.defineProperty(window, "__perf", { value: m });
  const COMPONENT = new Set([0, 1, 11, 14, 15]);
  type Fiber = { tag: number; flags: number; child: Fiber | null; sibling: Fiber | null; alternate: Fiber | null; type?: unknown; elementType?: unknown };
  const nameOf = (f: Fiber) => {
    const t = (f.elementType ?? f.type) as { displayName?: string; name?: string; render?: { displayName?: string; name?: string }; type?: { displayName?: string; name?: string } } | null;
    return (t && (t.displayName || t.name || t.render?.displayName || t.render?.name || t.type?.displayName || t.type?.name)) || "?";
  };
  const walk = (f: Fiber | null) => {
    const stack: Fiber[] = f ? [f] : [];
    while (stack.length) {
      const n = stack.pop()!;
      if (COMPONENT.has(n.tag) && n.flags & 1) {
        m.rendered++;
        const k = nameOf(n);
        m.names.set(k, (m.names.get(k) ?? 0) + 1);
      }
      // A subtree that bailed out keeps last time's fibers (and flags): don't count it again.
      if ((!n.alternate || n.child !== n.alternate.child) && n.child) stack.push(n.child);
      if (n.sibling) stack.push(n.sibling);
    }
  };
  Object.defineProperty(window, "__REACT_DEVTOOLS_GLOBAL_HOOK__", {
    value: {
      supportsFiber: true,
      isDisabled: false,
      renderers: new Map(),
      inject: () => 1,
      checkDCE: () => undefined,
      onScheduleFiberRoot: () => undefined,
      onCommitFiberUnmount: () => undefined,
      onPostCommitFiberRoot: () => undefined,
      onCommitFiberRoot: (_id: number, root: { current: Fiber }) => {
        m.commits++;
        walk(root.current.child);
      },
    },
  });
  try {
    new PerformanceObserver((list) => list.getEntries().forEach((e) => m.longTasks.push(e.duration))).observe({ type: "longtask", buffered: true });
  } catch {
    // (No long-task entries in this engine.)
  }
  // A key's press to the second frame after it: the one that shows what it did.
  // Split in two: the script the key runs before the page is free again (`sync`), and the frame that draws it
  // (`draw`: one frame's style, layout and paint, from the first frame's start to the next one's).
  const port = new MessageChannel();
  const waiting: number[] = [];
  port.port1.onmessage = () => m.sync.push(performance.now() - waiting.shift()!);
  window.addEventListener(
    "keydown",
    (e) => {
      const t = e.timeStamp;
      waiting.push(performance.now());
      port.port2.postMessage(0);
      requestAnimationFrame((first) => requestAnimationFrame((f) => (m.keys.push(f - t), m.draw.push(f - first))));
    },
    { capture: true },
  );
  const watch = () => new MutationObserver((r) => (m.mutations += r.length)).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  if (document.documentElement) watch();
  else document.addEventListener("DOMContentLoaded", watch, { once: true });
}

type Meter = { commits: number; rendered: number; names: Map<string, number>; longTasks: number[]; keys: number[]; sync: number[]; draw: number[]; mutations: number };

async function snapshot(page: Page, cdp: CDPSession | null) {
  const meter = await page.evaluate(() => {
    const m = (window as unknown as { __perf: Meter }).__perf;
    return { commits: m.commits, rendered: m.rendered, longTasks: m.longTasks.length, longTaskMs: m.longTasks.reduce((a, b) => a + b, 0), mutations: m.mutations };
  });
  let c: Record<string, number> = {};
  if (cdp) {
    const { metrics } = (await cdp.send("Performance.getMetrics")) as { metrics: { name: string; value: number }[] };
    c = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  }
  const v = (k: string) => c[k] ?? 0;
  return { ...meter, layouts: v("LayoutCount"), styles: v("RecalcStyleCount"), layoutMs: v("LayoutDuration") * 1000, styleMs: v("RecalcStyleDuration") * 1000, scriptMs: v("ScriptDuration") * 1000, taskMs: v("TaskDuration") * 1000 };
}

type Snap = Awaited<ReturnType<typeof snapshot>>;
const r1 = (n: number) => Math.round(n * 10) / 10;

const results = { cpu: CPU, base: "", engine: "", blocks: 0, paste: {} as Record<string, number>, open: {} as Record<string, number>, keys: [] as Record<string, unknown>[], scroll: [] as Record<string, unknown>[], idle: [] as Record<string, unknown>[], top: {} as Record<string, [string, number][]> };

/** Presses keys one at a time and reports each one's press-to-frame time and the work between. */
async function keys(page: Page, cdp: CDPSession | null, label: string, press: () => Promise<unknown>, count: number) {
  await page.evaluate(() => {
    const m = (window as unknown as { __perf: Meter }).__perf;
    m.keys.length = 0;
    m.sync.length = 0;
    m.draw.length = 0;
    m.names.clear();
  });
  const before = await snapshot(page, cdp);
  await press();
  await page.waitForTimeout(1500);
  const after = await snapshot(page, cdp);
  const { times, sync, draw, top } = await page.evaluate(() => {
    const m = (window as unknown as { __perf: Meter }).__perf;
    return { times: m.keys.slice(), sync: m.sync.slice(), draw: m.draw.slice(), top: [...m.names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25) };
  });
  const p95 = (list: number[]) => Math.round([...list].sort((a, b) => a - b)[Math.floor(list.length * 0.95)] ?? 0);
  const sorted = [...times].sort((a, b) => a - b);
  const n = Math.max(1, count);
  const d = (k: keyof Snap) => after[k] - before[k];
  const row = {
    label,
    keys: times.length,
    p50: Math.round(sorted[Math.floor(sorted.length * 0.5)] ?? 0),
    p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
    max: Math.round(sorted[sorted.length - 1] ?? 0),
    syncP95: p95(sync),
    drawP95: p95(draw),
    commitsPerKey: r1(d("commits") / n),
    renderedPerKey: r1(d("rendered") / n),
    longTasks: d("longTasks"),
    longTaskMs: Math.round(d("longTaskMs")),
    scriptMsPerKey: r1(d("scriptMs") / n),
    styleMsPerKey: r1(d("styleMs") / n),
    layoutMsPerKey: r1(d("layoutMs") / n),
    layoutsPerKey: r1(d("layouts") / n),
    mutationsPerKey: r1(d("mutations") / n),
  };
  results.keys.push(row);
  results.top[label] = top;
  console.log(new Date().toISOString().slice(11, 19), JSON.stringify(row));
  return row;
}

/** Puts the caret at the end of the body's `index`th block (a fraction of the note: 0 the start, 1 the end). */
async function caretAt(page: Page, where: number) {
  await page.evaluate((w) => {
    const el = document.querySelector('[aria-label="Document body"]') as HTMLElement;
    const paragraphs = [...el.children].filter((c) => c.tagName === "P" && (c.textContent ?? "").length > 40) as HTMLElement[];
    const p = paragraphs[Math.min(paragraphs.length - 1, Math.floor(w * paragraphs.length))]!;
    p.scrollIntoView({ block: "center" });
    const range = document.createRange();
    range.selectNodeContents(p);
    range.collapse(false);
    const sel = getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    el.focus();
  }, where);
  await page.waitForTimeout(800);
}

/** Frame gaps while `act` runs (at 60 Hz a frame is 16.7 ms). */
async function frames(page: Page, act: () => Promise<unknown>) {
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __framesOn: boolean };
    w.__frames = [];
    w.__framesOn = true;
    let last = performance.now();
    const tick = (t: number) => {
      w.__frames.push(t - last);
      last = t;
      if (w.__framesOn) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await act();
  const gaps = await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __framesOn: boolean };
    w.__framesOn = false;
    return w.__frames.slice(1);
  });
  const sorted = [...gaps].sort((a, b) => a - b);
  const p = (q: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0);
  return { frames: gaps.length, p50: p(0.5), p95: p(0.95), max: Math.round(sorted[sorted.length - 1] ?? 0), over33: gaps.filter((g) => g > 33.4).length, over50: gaps.filter((g) => g > 50).length };
}

/** Waits until React has committed nothing for 3 s (at most `seconds`). */
async function quiet(page: Page, seconds = 60) {
  const commits = () => page.evaluate(() => (window as unknown as { __perf: Meter }).__perf.commits);
  let last = await commits();
  let still = 0;
  for (let i = 0; i < seconds * 2 && still < 6; i++) {
    await page.waitForTimeout(500);
    const now = await commits();
    still = now === last ? still + 1 : 0;
    last = now;
  }
}

async function idle(page: Page, cdp: CDPSession | null, label: string, ms = 5000) {
  await quiet(page);
  await page.evaluate(() => (window as unknown as { __perf: Meter }).__perf.names.clear());
  const a = await snapshot(page, cdp);
  await page.waitForTimeout(ms);
  const b = await snapshot(page, cdp);
  const row = { label, seconds: ms / 1000, commits: b.commits - a.commits, rendered: b.rendered - a.rendered, mutations: b.mutations - a.mutations, scriptMs: Math.round(b.scriptMs - a.scriptMs), taskMs: Math.round(b.taskMs - a.taskMs) };
  results.idle.push(row);
  console.log(new Date().toISOString().slice(11, 19), JSON.stringify(row));
  return row;
}

/** A long note's worth of HTML: headings, paragraphs, bullets, numbered steps and to-dos, 10 blocks a section. */
function longNote(blocks: number) {
  const words = "the quiet garden by the river holds old stones and new seeds while the morning light moves slowly across the field".split(" ");
  const sentence = (i: number, n: number) => Array.from({ length: n }, (_, k) => words[(i * 7 + k * 3) % words.length]).join(" ");
  let html = "";
  for (let s = 0; s * 10 < blocks; s++) {
    html += `<h2>Section ${s + 1}</h2>`;
    for (let p = 0; p < 3; p++) html += `<p>${sentence(s + p, 40)} with <b>bold words</b> and a <a href="https://example.com/${s}">link</a>.</p>`;
    html += `<ul>${[0, 1, 2].map((i) => `<li>${sentence(s + i, 8)}</li>`).join("")}</ul>`;
    html += `<ol>${[0, 1, 2].map((i) => `<li>${sentence(s + i + 3, 8)}</li>`).join("")}</ol>`;
  }
  return html;
}

// No trace and no screenshots: Playwright's trace copies the whole page before and after every key, and in a
// note this long that copy took longer than the key (it was most of what the first runs measured).
test.use({ trace: "off", screenshot: "off" });

test.describe("the editor in a long note", { tag: ["@local", "@iphone-perf"] }, () => {
  test.beforeEach(({ backendMode }) => {
    test.skip(backendMode !== "local", "local mode only");
  });

  test("type, edit, paste, open and scroll a note of about 2,000 blocks", async ({ browser, browserName }, testInfo) => {
    test.skip(testInfo.config.workers > 1, "Measures time: run alone (--workers=1).");
    const chromium = browserName === "chromium";
    test.setTimeout(900_000);
    results.base = String(testInfo.project.use.baseURL);
    results.engine = browserName;
    const options = { viewport: { width: 440, height: 956 }, userAgent: IPHONE_UA, hasTouch: true, isMobile: true, deviceScaleFactor: 3 };
    // WebKit keeps no origin private file system (the FakeShell's library) in a throwaway context: a profile on disk.
    const context = chromium ? await browser.newContext(options) : await webkit.launchPersistentContext(mkdtempSync(join(tmpdir(), "editor-long-")), { ...options, baseURL: String(testInfo.project.use.baseURL) });
    await prepareContext(context, testInfo, { libraryName: `editor-long-${Date.now()}`, platform: "ios" });
    await context.addInitScript(instrument);
    const page = context.pages()[0] ?? (await context.newPage());
    const errors: string[] = [];
    page.on("pageerror", (e) => (errors.push(e.message), console.log("PAGE ERROR", e.message)));
    page.on("console", (m) => (m.type() === "error" ? console.log("CONSOLE", m.text().slice(0, 300)) : undefined));
    const cdp = chromium ? await context.newCDPSession(page) : null;
    results.cpu = chromium ? CPU : 1;
    if (cdp) await cdp.send("Performance.enable");

    await page.goto("/documents");
    await expect(page.getByRole("navigation", { name: "Tabs" })).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("main a[href^='/d/']").first()).toBeVisible({ timeout: 120_000 });
    await page.waitForTimeout(1500);
    if (cdp) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });

    // The long note: a new one, filled by one paste.
    await page.getByRole("button", { name: "Create" }).tap();
    await page.getByRole("menuitem", { name: "New note" }).tap();
    const body = page.getByRole("textbox", { name: "Document body" });
    await expect(body).toBeVisible();
    await page.keyboard.type("Long note");
    await body.click();
    const html = longNote(BLOCKS);
    await page.evaluate(() => (window as unknown as { __perf: Meter }).__perf.names.clear());
    // PERF_PASTE_PROFILE=<file.cpuprofile> (Chromium): the paste and its saving under the sampling profiler.
    const pasteProfile = cdp && process.env.PERF_PASTE_PROFILE ? process.env.PERF_PASTE_PROFILE : null;
    if (pasteProfile) {
      await cdp!.send("Profiler.enable");
      await cdp!.send("Profiler.setSamplingInterval", { interval: 200 });
      await cdp!.send("Profiler.start");
    }
    const pasteStart = await snapshot(page, cdp);
    const t0 = Date.now();
    await page.evaluate((h) => {
      const el = document.querySelector('[aria-label="Document body"]') as HTMLElement;
      el.focus();
      const dt = new DataTransfer();
      dt.setData("text/html", h);
      dt.setData("text/plain", h.replace(/<[^>]+>/g, " "));
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }, html);
    await expect.poll(() => body.evaluate((el) => el.children.length), { timeout: 120_000 }).toBeGreaterThan(BLOCKS * 0.9);
    const shownMs = Date.now() - t0;
    await quiet(page, 120);
    const pasteEnd = await snapshot(page, cdp);
    if (pasteProfile) writeFileSync(pasteProfile, JSON.stringify(((await cdp!.send("Profiler.stop")) as { profile: unknown }).profile));
    results.blocks = await body.evaluate((el) => el.children.length);
    results.paste = { shownMs, settledMs: Date.now() - t0 - 3000, longTasks: pasteEnd.longTasks - pasteStart.longTasks, longTaskMs: Math.round(pasteEnd.longTaskMs - pasteStart.longTaskMs), commits: pasteEnd.commits - pasteStart.commits, rendered: pasteEnd.rendered - pasteStart.rendered, scriptMs: Math.round(pasteEnd.scriptMs - pasteStart.scriptMs), styleMs: Math.round(pasteEnd.styleMs - pasteStart.styleMs), layoutMs: Math.round(pasteEnd.layoutMs - pasteStart.layoutMs), taskMs: Math.round(pasteEnd.taskMs - pasteStart.taskMs) };
    results.top["paste"] = await page.evaluate(() => [...(window as unknown as { __perf: Meter }).__perf.names.entries()].sort((x, y) => y[1] - x[1]).slice(0, 30));
    console.log("blocks", results.blocks, "paste", JSON.stringify(results.paste));
    console.log("paste drew", JSON.stringify(results.top["paste"]));

    // An experiment (PERF_TRACE=1): where an Enter's and a Backspace's time goes inside the editor, in any
    // engine (WebKit has no profiler here). Times every plugin's state step, added step, decorations and view
    // update, the view's own update, and the style and layout work left for the frame (forced right after).
    if (process.env.PERF_TRACE) {
      await caretAt(page, 0.5);
      // PERF_TRACE=<file.cpuprofile> (Chromium): the same keys under the sampling profiler instead, unwrapped.
      const profile = process.env.PERF_TRACE !== "1" && cdp ? process.env.PERF_TRACE! : null;
      if (profile) {
        await cdp!.send("Profiler.enable");
        await cdp!.send("Profiler.setSamplingInterval", { interval: 100 });
      }
      if (!profile) await page.evaluate(() => {
        type Fn = (...a: unknown[]) => unknown;
        const ed = (document.querySelector('[aria-label="Document body"]') as unknown as { editor: { state: { config: { fields: { name: string; apply: Fn }[] }; plugins: { key: string; spec: { appendTransaction?: Fn }; props: { decorations?: Fn } }[] }; view: { updateState: Fn; pluginViews: { update?: Fn; constructor: { name: string } }[]; props: { dispatchTransaction: Fn }; setProps: (p: object) => void } } }).editor;
        const T: Record<string, number> = {};
        (window as unknown as { __trace: Record<string, number> }).__trace = T;
        const timed = (label: string, fn: Fn): Fn =>
          function (this: unknown, ...a: unknown[]) {
            const t = performance.now();
            try {
              return fn.apply(this, a);
            } finally {
              T[label] = (T[label] ?? 0) + performance.now() - t;
            }
          };
        for (const f of ed.state.config.fields) f.apply = timed(`state ${f.name}`, f.apply);
        for (const p of ed.state.plugins) {
          if (p.spec.appendTransaction) p.spec.appendTransaction = timed(`append ${p.key}`, p.spec.appendTransaction);
          if (p.props.decorations) p.props.decorations = timed(`decorations ${p.key}`, p.props.decorations);
        }
        const view = ed.view;
        view.pluginViews.forEach((pv, i) => {
          if (pv.update) pv.update = timed(`pluginView ${i} ${pv.constructor.name}`, pv.update);
        });
        view.updateState = timed("VIEW updateState (all)", view.updateState.bind(view));
        const dispatch = view.props.dispatchTransaction;
        view.setProps({
          dispatchTransaction: (tr: unknown) => {
            const t = performance.now();
            dispatch(tr);
            const t1 = performance.now();
            void document.body.offsetHeight;
            T["DISPATCH (all)"] = (T["DISPATCH (all)"] ?? 0) + t1 - t;
            T["style and layout after"] = (T["style and layout after"] ?? 0) + performance.now() - t1;
            T["transactions"] = (T["transactions"] ?? 0) + 1;
            // What React draws straight after (its update for a key runs as a microtask, queued before this one),
            // and the style and layout that drawing left behind.
            const t2 = performance.now();
            queueMicrotask(() => {
              const t3 = performance.now();
              void document.body.offsetHeight;
              T["AFTER: microtasks (React's update)"] = (T["AFTER: microtasks (React's update)"] ?? 0) + t3 - t2;
              T["AFTER: style and layout after React"] = (T["AFTER: style and layout after React"] ?? 0) + performance.now() - t3;
              const t4 = performance.now();
              setTimeout(() => (T["AFTER: until the next task"] = (T["AFTER: until the next task"] ?? 0) + performance.now() - t4), 0);
            });
          },
        });
      });
      const run = async (label: string, key: string) => {
        await page.evaluate(() => {
          const T = (window as unknown as { __trace?: Record<string, number> }).__trace ?? {};
          for (const k of Object.keys(T)) delete T[k];
        });
        await keys(page, cdp, label, async () => {
          for (let i = 0; i < 6; i++) {
            await page.keyboard.press(key, { delay: 20 });
            await page.waitForTimeout(150);
          }
        }, 6);
        const T = await page.evaluate(() => (window as unknown as { __trace?: Record<string, number> }).__trace ?? {});
        console.log(label, "per key (ms):", JSON.stringify(Object.entries(T).map(([k, v]) => [k, Math.round((v / 6) * 10) / 10] as const).filter(([, v]) => v >= 0.3).sort((a, b) => b[1] - a[1])));
      };
      if (profile) await cdp!.send("Profiler.start");
      await run("trace Enter", "Enter");
      await run("trace Backspace", "Backspace");
      if (profile) writeFileSync(profile, JSON.stringify(((await cdp!.send("Profiler.stop")) as { profile: unknown }).profile));
      await run("trace letter", "x");
      await run("trace ArrowUp", "ArrowUp");
      await context.close();
      return;
    }

    // An experiment (PERF_DROP, patterns split by ";;"): what adding and removing a line costs, then again
    // with every CSS rule whose text matches each pattern taken out in turn. Shows which rules make a long
    // note's style work grow. Nothing else is measured in that run.
    if (process.env.PERF_DROP) {
      const structure = async (label: string) => {
        await caretAt(page, 0.5);
        await keys(page, cdp, label, async () => {
          for (let i = 0; i < 6; i++) {
            await page.keyboard.press("Enter", { delay: 20 });
            await page.waitForTimeout(120);
          }
          for (let i = 0; i < 6; i++) {
            await page.keyboard.press("Backspace", { delay: 20 });
            await page.waitForTimeout(120);
          }
        }, 12);
      };
      await structure("all rules");
      for (const pattern of process.env.PERF_DROP.split(";;")) {
        const dropped = await page.evaluate((src) => {
          const re = new RegExp(src);
          let n = 0;
          const prune = (owner: CSSStyleSheet | CSSGroupingRule) => {
            let rules: CSSRuleList;
            try {
              rules = owner.cssRules;
            } catch {
              return;
            }
            for (let i = rules.length - 1; i >= 0; i--) {
              const rule = rules[i]!;
              if ("cssRules" in rule && !(rule instanceof CSSStyleRule)) prune(rule as CSSGroupingRule);
              else if (re.test(rule.cssText)) {
                owner.deleteRule(i);
                n++;
              }
            }
          };
          for (const sheet of document.styleSheets) prune(sheet);
          return n;
        }, pattern);
        await page.waitForTimeout(500);
        await structure(`without /${pattern}/ (${dropped} rules)`);
      }
      if (process.env.PERF_OUT) writeFileSync(process.env.PERF_OUT, JSON.stringify(results, null, 2));
      await context.close();
      return;
    }

    // Leave and open it again, so it's a note opened from the list, not one just made.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.getByRole("button", { name: "Back", exact: true }).tap();
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    await page.waitForTimeout(2000);
    const openStart = await snapshot(page, cdp);
    const t1 = Date.now();
    await page.locator("main a[href^='/d/']", { hasText: "Long note" }).first().tap();
    await expect.poll(() => page.evaluate(() => document.querySelector('[aria-label="Document body"]')?.children.length ?? 0), { timeout: 120_000, intervals: [50] }).toBeGreaterThan(results.blocks / 2);
    const openMs = Date.now() - t1;
    await quiet(page, 60);
    const openEnd = await snapshot(page, cdp);
    results.open = { shownMs: openMs, longTasks: openEnd.longTasks - openStart.longTasks, longTaskMs: Math.round(openEnd.longTaskMs - openStart.longTaskMs), commits: openEnd.commits - openStart.commits, rendered: openEnd.rendered - openStart.rendered, scriptMs: Math.round(openEnd.scriptMs - openStart.scriptMs), layoutMs: Math.round(openEnd.layoutMs - openStart.layoutMs), styleMs: Math.round(openEnd.styleMs - openStart.styleMs) };
    console.log("open", JSON.stringify(results.open));
    await idle(page, cdp, "long note open");

    const profiling = Boolean(process.env.PERF_PROFILE) && cdp;
    if (profiling) {
      await cdp!.send("Profiler.enable");
      await cdp!.send("Profiler.setSamplingInterval", { interval: 200 });
      await cdp!.send("Profiler.start");
    }

    // Typing at three places: 30 keys each.
    const text = " and more words typed at a pace";
    for (const [name, where] of [["type at the start", 0], ["type in the middle", 0.5], ["type at the end", 1]] as const) {
      await caretAt(page, where);
      await keys(page, cdp, name, () => page.keyboard.type(text, { delay: 80 }), text.length);
    }
    // New blocks and joined blocks, in the middle.
    await caretAt(page, 0.5);
    await keys(page, cdp, "Enter then a letter, 8 times", async () => {
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press("Enter", { delay: 20 });
        await page.waitForTimeout(100);
        await page.keyboard.press("x", { delay: 20 });
        await page.waitForTimeout(100);
      }
    }, 16);
    await keys(page, cdp, "Backspace, 16 times", async () => {
      for (let i = 0; i < 16; i++) {
        await page.keyboard.press("Backspace", { delay: 20 });
        await page.waitForTimeout(100);
      }
    }, 16);
    // The caret moving, nothing changed.
    await keys(page, cdp, "ArrowUp, 20 times", async () => {
      for (let i = 0; i < 20; i++) {
        await page.keyboard.press("ArrowUp", { delay: 20 });
        await page.waitForTimeout(80);
      }
    }, 20);
    // A list line made deeper and shallower (the flat depth model's renumbering).
    await page.evaluate(() => {
      const el = document.querySelector('[aria-label="Document body"]') as HTMLElement;
      const items = [...el.children].filter((c) => /bullet|number|list/i.test(c.getAttribute("data-type") ?? c.className)) as HTMLElement[];
      const p = items[Math.floor(items.length / 2)] ?? (el.children[Math.floor(el.children.length / 2)] as HTMLElement);
      p.scrollIntoView({ block: "center" });
      const range = document.createRange();
      range.selectNodeContents(p);
      range.collapse(false);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      el.focus();
    });
    await page.waitForTimeout(500);
    await keys(page, cdp, "Tab and Shift+Tab, 6 times", async () => {
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press("Tab", { delay: 20 });
        await page.waitForTimeout(120);
        await page.keyboard.press("Shift+Tab", { delay: 20 });
        await page.waitForTimeout(120);
      }
    }, 12);

    if (profiling) {
      const { profile } = (await cdp!.send("Profiler.stop")) as { profile: { nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; hitCount?: number; children?: number[] }[]; timeDeltas?: number[]; samples?: number[] } };
      const dt = new Map<number, number>();
      (profile.samples ?? []).forEach((id, i) => dt.set(id, (dt.get(id) ?? 0) + (profile.timeDeltas?.[i] ?? 0)));
      const self = new Map<string, number>();
      for (const n of profile.nodes) {
        const key = `${n.callFrame.functionName || "(anonymous)"} ${n.callFrame.url.replace(/^.*\/(_next|src|node_modules)\//, "$1/").replace(/\?.*$/, "").slice(-90)}:${n.callFrame.lineNumber}`;
        self.set(key, (self.get(key) ?? 0) + (dt.get(n.id) ?? 0) / 1000);
      }
      const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 120).map(([k, v]) => [k, Math.round(v)]);
      writeFileSync(process.env.PERF_PROFILE!, JSON.stringify(top, null, 1));
    }

    await idle(page, cdp, "after typing", 4000);

    // Scrolling: a finger flick down and back up.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.waitForTimeout(800);
    const flick = async (dy: number) => {
      for (let i = 0; i < 3; i++) {
        if (cdp) await cdp.send("Input.synthesizeScrollGesture", { x: 220, y: 500, yDistance: dy, speed: 4000, gestureSourceType: "touch", repeatCount: 1 });
        else {
          // (Mobile WebKit takes no wheel or synthetic gestures: the view under the finger scrolls a step a frame.)
          await page.evaluate(
            (d) =>
              new Promise<void>((resolve) => {
                let el = document.elementFromPoint(220, 500) as HTMLElement | null;
                while (el && !(/(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight)) el = el.parentElement;
                if (!el) return resolve();
                let n = 0;
                const step = () => {
                  el!.scrollTop += -d / 30;
                  if (++n < 30) requestAnimationFrame(step);
                  else resolve();
                };
                requestAnimationFrame(step);
              }),
            dy,
          );
        }
      }
    };
    const down = await frames(page, () => flick(-6000));
    const up = await frames(page, () => flick(6000));
    results.scroll.push({ label: "down", ...down }, { label: "up", ...up });
    console.log("scroll", JSON.stringify(down), JSON.stringify(up));

    if (cdp) await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    if (process.env.PERF_OUT) writeFileSync(process.env.PERF_OUT, JSON.stringify(results, null, 2));
    await context.close();

    expect(errors, "errors thrown in the page").toEqual([]);
    expect(results.blocks, "the pasted note's blocks").toBeGreaterThan(BLOCKS * 0.9);
  });
});
