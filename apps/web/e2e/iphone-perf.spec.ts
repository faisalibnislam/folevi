// How fast the iPhone app feels (docs/IOS_PERFORMANCE.md): the iPhone interface in local mode (a FakeShell, the
// starter library), at iPhone size with the app's markers, in Chromium with the CPU slowed down (CDP), measured
// in the page: tap to the first frame that shows the answer, until nothing moves any more, every input's
// Event Timing (input to next paint), long tasks, React commits and the components each one rendered, style
// and layout work, frame gaps while scrolling, and what runs while nothing happens. Best against the export
// the app carries (the production build), served like the app serves it:
//   node scripts/build-shell.mjs --platform ios --no-copy && node scripts/serve-shell.mjs 4320 .next-shell-ios
//   E2E_LOCAL_BASE_URL=http://127.0.0.1:4320 E2E_BASE_URL=http://app.localhost:3002 E2E_NO_SERVER=1 \
//     npx playwright test e2e/iphone-perf.spec.ts --project local --workers=1
// PERF_OUT=<file.json> saves the numbers; PERF_CPU sets the slow-down (default 4). Against `next dev` (3003) the
// numbers are React's development build's (much slower); the time budgets are only checked against an export
// (PERF_BUDGETS=0 skips every budget, for experiments).
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { webkit, type CDPSession, type Page } from "@playwright/test";
import { expect, prepareContext, test } from "./fixtures/localShell";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FoleviiOS/1.0";
const CPU = Number(process.env.PERF_CPU ?? 4);

/** The stand-in iOS bridge, and the page's own meters (before any of its scripts). */
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
  // A production export reads only the app's own `foleviShell` (never the dev builds' test hook): the FakeShell is it.
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

  const m = {
    commits: 0,
    rendered: 0,
    names: new Map<string, number>(),
    roots: new Map<string, number>(),
    longTasks: [] as number[],
    events: [] as { name: string; duration: number; delay: number }[],
    timeouts: 0,
    intervals: 0,
    rafs: 0,
    mutations: 0,
    lastInput: 0,
    marks: [] as [string, number][],
  };
  Object.defineProperty(window, "__perf", { value: m });
  // React tells a devtools hook about every commit, production builds too: count them and what each rendered.
  const COMPONENT = new Set([0, 1, 11, 14, 15]);
  const nameOf = (f: { type?: unknown; elementType?: unknown }) => {
    const t = (f.elementType ?? f.type) as { displayName?: string; name?: string; render?: { displayName?: string; name?: string }; type?: { displayName?: string; name?: string } } | null;
    return (t && (t.displayName || t.name || t.render?.displayName || t.render?.name || t.type?.displayName || t.type?.name)) || "?";
  };
  type Fiber = { tag: number; flags: number; child: Fiber | null; sibling: Fiber | null; alternate: Fiber | null; type?: unknown; elementType?: unknown };
  const walk = (f: Fiber | null) => {
    // Each fiber with whether a component above it rendered in this commit (the first that did is where it started).
    const stack: [Fiber, boolean][] = [];
    if (f) stack.push([f, false]);
    while (stack.length) {
      const [n, inside] = stack.pop()!;
      let below = inside;
      if (COMPONENT.has(n.tag) && n.flags & 1) {
        m.rendered++;
        const k = nameOf(n);
        m.names.set(k, (m.names.get(k) ?? 0) + 1);
        if (!inside) m.roots.set(k, (m.roots.get(k) ?? 0) + 1);
        below = true;
      }
      // A subtree that bailed out keeps last time's fibers (and flags): don't count it again.
      const fresh = !n.alternate || n.child !== n.alternate.child;
      if (fresh && n.child) stack.push([n.child, below]);
      if (n.sibling) stack.push([n.sibling, inside]);
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
        m.marks.push(["commit", performance.now()]);
        walk(root.current.child);
      },
    },
  });
  try {
    new PerformanceObserver((list) => list.getEntries().forEach((e) => m.longTasks.push(e.duration))).observe({ type: "longtask", buffered: true });
  } catch {
    // (No long-task entries in this engine.)
  }
  try {
    new PerformanceObserver((list) =>
      list.getEntries().forEach((e) => m.events.push({ name: e.name, duration: e.duration, delay: (e as PerformanceEventTiming).processingStart - e.startTime })),
    ).observe({ type: "event", durationThreshold: 16, buffered: true } as PerformanceObserverInit);
  } catch {
    // (No Event Timing in this engine.)
  }
  const st = window.setTimeout;
  const si = window.setInterval;
  const raf = window.requestAnimationFrame;
  window.setTimeout = ((fn: TimerHandler, ms?: number, ...a: unknown[]) => st(typeof fn === "function" ? (...x: unknown[]) => (m.timeouts++, (fn as (...y: unknown[]) => void)(...x)) : fn, ms, ...a)) as typeof setTimeout;
  window.setInterval = ((fn: TimerHandler, ms?: number, ...a: unknown[]) => si(typeof fn === "function" ? (...x: unknown[]) => (m.intervals++, (fn as (...y: unknown[]) => void)(...x)) : fn, ms, ...a)) as typeof setInterval;
  window.requestAnimationFrame = (cb: FrameRequestCallback) => raf((t) => (m.rafs++, cb(t)));
  for (const type of ["pointerdown", "touchstart", "keydown", "mousedown"]) window.addEventListener(type, (e) => (m.lastInput = e.timeStamp), { capture: true, passive: true });
  for (const type of ["touchend", "pointerup", "click"]) window.addEventListener(type, () => m.marks.push([type, performance.now()]), { capture: true, passive: true });
  const push = history.pushState.bind(history);
  history.pushState = (...a: Parameters<History["pushState"]>) => (m.marks.push(["pushState", performance.now()]), push(...a));
  const watch = () => new MutationObserver((r) => (m.mutations += r.length)).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  if (document.documentElement) watch();
  else document.addEventListener("DOMContentLoaded", watch, { once: true });
}

type Meter = { commits: number; rendered: number; longTasks: number[]; events: { name: string; duration: number; delay: number }[]; timeouts: number; intervals: number; rafs: number; mutations: number };
type Metrics = Record<string, number>;

async function cdpMetrics(cdp: CDPSession | null): Promise<Metrics> {
  if (!cdp) return { LayoutCount: 0, RecalcStyleCount: 0, LayoutDuration: 0, RecalcStyleDuration: 0, ScriptDuration: 0, TaskDuration: 0, Nodes: 0 };
  const { metrics } = (await cdp.send("Performance.getMetrics")) as { metrics: { name: string; value: number }[] };
  return Object.fromEntries(metrics.map((x) => [x.name, x.value]));
}

/** What the page's meters and Chromium's counters say now. */
async function snapshot(page: Page, cdp: CDPSession | null) {
  const meter = await page.evaluate(() => {
    const m = (window as unknown as { __perf: Meter & { names: Map<string, number> } }).__perf;
    return { commits: m.commits, rendered: m.rendered, longTasks: m.longTasks.length, longTaskMs: m.longTasks.reduce((a, b) => a + b, 0), events: m.events.length, timeouts: m.timeouts, intervals: m.intervals, rafs: m.rafs, mutations: m.mutations };
  });
  const c = await cdpMetrics(cdp);
  const v = (k: string) => c[k] ?? 0;
  return { ...meter, layouts: v("LayoutCount"), styles: v("RecalcStyleCount"), layoutMs: v("LayoutDuration") * 1000, styleMs: v("RecalcStyleDuration") * 1000, scriptMs: v("ScriptDuration") * 1000, taskMs: v("TaskDuration") * 1000, nodes: v("Nodes") };
}

type Snap = Awaited<ReturnType<typeof snapshot>>;
const diff = (a: Snap, b: Snap) => Object.fromEntries(Object.keys(b).map((k) => [k, Math.round((((b as Record<string, number>)[k] ?? 0) - ((a as Record<string, number>)[k] ?? 0)) * 10) / 10])) as Record<keyof Snap, number>;

/**
 * Arms a watcher in the page for `until` (a function's source, run each frame), does `act`, and returns how long
 * from the input to the first frame where `until` was true (`paint`) and to when no animation runs any more
 * (`settled`), with the work it took.
 */
async function measure(page: Page, cdp: CDPSession | null, label: string, act: () => Promise<unknown>, until: string) {
  await page.evaluate((src) => {
    const w = window as unknown as { __perf: { lastInput: number; events: unknown[] }; __wait?: Promise<{ paint: number; settled: number; late: number; worstFrame: number }> };
    w.__perf.lastInput = 0;
    w.__perf.events.length = 0;
    (w.__perf as unknown as { marks: unknown[] }).marks.length = 0;
    const test = new Function(`return (${src})()`) as () => boolean;
    w.__wait = new Promise((resolve) => {
      // (Never there: say so instead of waiting for ever.)
      setTimeout(() => resolve({ paint: -1, settled: -1, late: -1, worstFrame: -1 }), 15_000);
      const tick = () => {
        if (w.__perf.lastInput) (w.__perf as unknown as { marks: [string, number][] }).marks.push(["frame", performance.now()]);
        if (!w.__perf.lastInput || !test()) return void requestAnimationFrame(tick);
        // The frame that shows it.
        requestAnimationFrame((t) => {
          const paint = t - w.__perf.lastInput;
          // While it moves: how many frames came late (the main thread busy drawing it).
          let last = t;
          let late = 0;
          let worst = 0;
          const quiet = (now: number) => {
            const gap = now - last;
            last = now;
            if (gap > 20) late++;
            worst = Math.max(worst, gap);
            const running = document.getAnimations().filter((a) => a.playState === "running" && !(a.effect?.getComputedTiming().iterations === Infinity));
            if (running.length) return void requestAnimationFrame(quiet);
            resolve({ paint, settled: performance.now() - w.__perf.lastInput, late, worstFrame: worst });
          };
          requestAnimationFrame(quiet);
        });
      };
      requestAnimationFrame(tick);
    });
  }, until);
  const before = await snapshot(page, cdp);
  await act();
  const timing = await page.evaluate(() => (window as unknown as { __wait: Promise<{ paint: number; settled: number; late: number; worstFrame: number }> }).__wait);
  await page.waitForTimeout(300);
  const after = await snapshot(page, cdp);
  const events = await page.evaluate(() => (window as unknown as { __perf: Meter }).__perf.events.slice());
  const marks = await page.evaluate(() => {
    const m = (window as unknown as { __perf: { lastInput: number; marks: [string, number][] } }).__perf;
    return m.marks.filter(([, t]) => t - m.lastInput < 1500).map(([n, t]) => `${n}@${Math.round(t - m.lastInput)}`).join(" ");
  });
  const worst = events.reduce((a, e) => Math.max(a, e.duration), 0);
  const d = diff(before, after);
  const row = { label, paintMs: Math.round(timing.paint), settledMs: Math.round(timing.settled), lateFrames: timing.late, worstFrameMs: Math.round(timing.worstFrame), worstEventMs: Math.round(worst), commits: d.commits, rendered: d.rendered, longTasks: d.longTasks, longTaskMs: Math.round(d.longTaskMs), styles: d.styles, layouts: d.layouts, styleMs: Math.round(d.styleMs), layoutMs: Math.round(d.layoutMs), scriptMs: Math.round(d.scriptMs) };
  results.interactions.push({ ...row, marks });
  console.log(new Date().toISOString().slice(11, 19), JSON.stringify(row));
  return row;
}

/** Frame gaps over `ms` while `act` runs (rAF intervals; at 60 Hz a frame is 16.7 ms). */
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

/** Everything the page does in `ms` while nobody touches it. */
async function idle(page: Page, cdp: CDPSession | null, label: string, ms = 5000) {
  await clearNames(page);
  const a = await snapshot(page, cdp);
  await page.waitForTimeout(ms);
  const b = await snapshot(page, cdp);
  await topNames(page, `idle ${label}`);
  const d = diff(a, b);
  const row = { label, seconds: ms / 1000, taskMs: Math.round(d.taskMs), scriptMs: Math.round(d.scriptMs), commits: d.commits, rendered: d.rendered, timeouts: d.timeouts, intervals: d.intervals, rafs: d.rafs, mutations: d.mutations, styles: d.styles, layouts: d.layouts };
  results.idle.push(row);
  console.log(new Date().toISOString().slice(11, 19), JSON.stringify(row));
  return row;
}

/** Layers and costly effects on screen now. */
async function surfaces(page: Page, cdp: CDPSession | null, label: string) {
  const dom = await page.evaluate(() => {
    let blur = 0;
    let blurArea = 0;
    let filters = 0;
    let willChange = 0;
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || s.visibility === "hidden" || s.display === "none") continue;
      const bf = s.backdropFilter || (s as unknown as { webkitBackdropFilter?: string }).webkitBackdropFilter;
      if (bf && bf !== "none") {
        blur++;
        blurArea += Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
      }
      if (s.filter !== "none") filters++;
      if (s.willChange !== "auto") willChange++;
    }
    return { nodes: document.getElementsByTagName("*").length, backdropFilters: blur, backdropScreens: Math.round((blurArea / (innerWidth * innerHeight)) * 100) / 100, filters, willChange };
  });
  const layers = !cdp ? -1 : await new Promise<number>((resolve) => {
    void cdp.send("LayerTree.enable");
    const on = (e: { layers?: unknown[] }) => {
      if (!e.layers) return;
      cdp.off("LayerTree.layerTreeDidChange", on);
      resolve(e.layers.length);
    };
    cdp.on("LayerTree.layerTreeDidChange", on);
    void page.evaluate(() => document.body.style.setProperty("--perf-poke", String(Math.random())));
    setTimeout(() => resolve(-1), 3000);
  });
  if (cdp) await cdp.send("LayerTree.disable");
  const row = { label, ...dom, layers };
  results.surfaces.push(row);
  console.log(new Date().toISOString().slice(11, 19), JSON.stringify(row));
}

const results = { cpu: CPU, base: "", startup: {} as Record<string, number>, interactions: [] as Record<string, unknown>[], typing: {} as Record<string, unknown>, scroll: [] as Record<string, unknown>[], idle: [] as Record<string, unknown>[], surfaces: [] as Record<string, unknown>[], topRendered: {} as Record<string, [string, number][]>, renderRoots: {} as Record<string, [string, number][]> };

const shown = (selector: string, text?: string) => `() => [...document.querySelectorAll(${JSON.stringify(selector)})].some((el) => el.getBoundingClientRect().height > 0 && getComputedStyle(el).visibility !== "hidden"${text ? ` && el.textContent.includes(${JSON.stringify(text)})` : ""})`;
const gone = (selector: string) => `() => ![...document.querySelectorAll(${JSON.stringify(selector)})].some((el) => el.getBoundingClientRect().height > 0)`;

async function topNames(page: Page, label: string) {
  const top = await page.evaluate(() => {
    const m = (window as unknown as { __perf: { names: Map<string, number>; roots: Map<string, number> } }).__perf;
    const out = [...m.names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 70);
    const roots = [...m.roots.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
    m.names.clear();
    m.roots.clear();
    return { out, roots };
  });
  results.topRendered[label] = top.out;
  results.renderRoots[label] = top.roots;
}

async function clearNames(page: Page) {
  await page.evaluate(() => {
    const m = (window as unknown as { __perf: { names: Map<string, number>; roots: Map<string, number> } }).__perf;
    m.names.clear();
    m.roots.clear();
  });
}

/** A long note's worth of HTML: headings, paragraphs, lists and to-dos. */
function longNote(sections: number) {
  const words = "the quiet garden by the river holds old stones and new seeds while the morning light moves slowly across the field".split(" ");
  const sentence = (i: number, n: number) => Array.from({ length: n }, (_, k) => words[(i * 7 + k * 3) % words.length]).join(" ");
  let html = "";
  for (let s = 0; s < sections; s++) {
    html += `<h2>Section ${s + 1}</h2>`;
    for (let p = 0; p < 3; p++) html += `<p>${sentence(s + p, 40)}.</p>`;
    html += `<ul>${[0, 1, 2].map((i) => `<li>${sentence(s + i, 8)}</li>`).join("")}</ul>`;
  }
  return html;
}

test.describe("the iPhone app's speed", { tag: ["@local", "@iphone-perf"] }, () => {
  test.beforeEach(({ backendMode }) => {
    test.skip(backendMode !== "local", "local mode only");
  });

  test("tap, type and scroll in the iPhone app under a slow CPU", async ({ browser, browserName }, testInfo) => {
    // WebKit (the app's engine) has no CPU slow-down or counters through Playwright: there it's the page's own meters.
    const chromium = browserName === "chromium";
    test.setTimeout(900_000);
    results.base = String(testInfo.project.use.baseURL);
    const options = { viewport: { width: 440, height: 956 }, userAgent: IPHONE_UA, hasTouch: true, isMobile: true, deviceScaleFactor: 3 };
    // WebKit keeps no origin private file system (the FakeShell's library) in a throwaway context: a profile on disk.
    const context = chromium ? await browser.newContext(options) : await webkit.launchPersistentContext(mkdtempSync(join(tmpdir(), "iphone-perf-")), { ...options, baseURL: String(testInfo.project.use.baseURL) });
    await prepareContext(context, testInfo, { libraryName: `iphone-perf-${Date.now()}`, platform: "ios" });
    await context.addInitScript(instrument);
    // Experiments (PERF_CSS): extra CSS to see what an effect costs, e.g. "* { backdrop-filter: none !important }".
    if (process.env.PERF_CSS)
      await context.addInitScript((css: string) => {
        const add = () => {
          const style = document.createElement("style");
          style.textContent = css;
          document.head.appendChild(style);
        };
        if (document.head) add();
        else document.addEventListener("DOMContentLoaded", add, { once: true });
      }, process.env.PERF_CSS);
    const page = context.pages()[0] ?? (await context.newPage());
    page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
    page.on("console", (m) => (m.type() === "error" ? console.log("CONSOLE", m.text().slice(0, 300)) : undefined));
    const cdp = chromium ? await context.newCDPSession(page) : null;
    results.cpu = chromium ? CPU : 1;
    if (cdp) {
      await cdp.send("Performance.enable");
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
    }

    // Start: to Home's first usable frame (twice: the first also fills the library and caches the code).
    for (const run of ["first", "again"] as const) {
      const t0 = Date.now();
      await page.goto("/documents");
      await expect(page.getByRole("navigation", { name: "Tabs" })).toBeVisible({ timeout: 60_000 });
      await expect(page.locator("main a[href^='/d/']").first()).toBeVisible({ timeout: 120_000 });
      const wall = Date.now() - t0;
      const nav = await page.evaluate(() => {
        const n = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
        const fcp = performance.getEntriesByName("first-contentful-paint")[0];
        const m = (window as unknown as { __perf: Meter }).__perf;
        return { domContentLoaded: Math.round(n.domContentLoadedEventEnd), fcp: Math.round(fcp?.startTime ?? -1), longTasks: m.longTasks.length, longTaskMs: Math.round(m.longTasks.reduce((a, b) => a + b, 0)), commits: m.commits, rendered: m.rendered, now: Math.round(performance.now()) };
      });
      results.startup[`${run}.usableMs`] = nav.now;
      results.startup[`${run}.wallMs`] = wall;
      results.startup[`${run}.fcpMs`] = nav.fcp;
      results.startup[`${run}.domContentLoadedMs`] = nav.domContentLoaded;
      results.startup[`${run}.longTasks`] = nav.longTasks;
      results.startup[`${run}.longTaskMs`] = nav.longTaskMs;
      results.startup[`${run}.commits`] = nav.commits;
      results.startup[`${run}.rendered`] = nav.rendered;
      console.log(run, JSON.stringify(nav), wall);
    }
    await page.waitForTimeout(2000);
    await topNames(page, "startup");
    await surfaces(page, cdp, "home");
    await idle(page, cdp, "home");
    await topNames(page, "idle home");

    const tabs = page.getByRole("navigation", { name: "Tabs" });
    // Open a note from Home, and back.
    await clearNames(page);
    await measure(page, cdp, "open note (Home card)", () => page.locator("main a[href^='/d/']").first().tap(), shown('[aria-label="Document body"]'));
    await topNames(page, "open note");
    await surfaces(page, cdp, "note");
    await idle(page, cdp, "note");
    await measure(page, cdp, "Back to Home", () => page.getByRole("button", { name: "Back", exact: true }).tap(), shown("h1", "Home"));
    // All notes (a push) and back.
    await measure(page, cdp, "push All notes", () => page.getByRole("link", { name: "All notes" }).tap(), shown("h1", "All notes"));
    await measure(page, cdp, "Back from All notes", () => page.getByRole("button", { name: "Back", exact: true }).tap(), shown("h1", "Home"));
    // The + menu, and away.
    await clearNames(page);
    await measure(page, cdp, "open + menu", () => page.getByRole("button", { name: "Create" }).tap(), shown('[role="menu"]'));
    await topNames(page, "open + menu");
    await surfaces(page, cdp, "menu open");
    await measure(page, cdp, "close + menu", () => page.keyboard.press("Escape"), gone('[role="menu"]'));
    // The account sheet, and away.
    await clearNames(page);
    await measure(page, cdp, "open account sheet", () => page.getByRole("button", { name: /account and places/ }).tap(), shown('dialog[open], [role="dialog"]'));
    await topNames(page, "open account sheet");
    await surfaces(page, cdp, "sheet open");
    await measure(page, cdp, "close account sheet", () => page.getByRole("dialog").getByRole("button", { name: "Close" }).first().tap(), gone('dialog[open], [role="dialog"]'));
    // Tabs.
    await clearNames(page);
    await measure(page, cdp, "tab Tasks", () => tabs.getByRole("link", { name: "Tasks" }).tap(), shown("h1", "Tasks"));
    await topNames(page, "tab Tasks");
    await measure(page, cdp, "tab Calendar", () => tabs.getByRole("link", { name: "Calendar" }).tap(), shown('[aria-label^="Today, "][aria-pressed="true"]'));
    await measure(page, cdp, "tab Home", () => tabs.getByRole("link", { name: "Home" }).tap(), shown("h1", "Home"));

    // A long note: a new one, filled by a paste.
    await page.getByRole("button", { name: "Create" }).tap();
    await measure(page, cdp, "New note", () => page.getByRole("menuitem", { name: "New note" }).tap(), shown('[aria-label="Document body"]'));
    const body = page.getByRole("textbox", { name: "Document body" });
    await page.keyboard.type("Perf note");
    await body.click();
    const html = longNote(60);
    await page.evaluate((h) => {
      const el = document.querySelector('[aria-label="Document body"]') as HTMLElement;
      el.focus();
      const dt = new DataTransfer();
      dt.setData("text/html", h);
      dt.setData("text/plain", h.replace(/<[^>]+>/g, " "));
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }, html);
    await page.waitForTimeout(3000);
    const blocks = await body.evaluate((el) => el.children.length);
    console.log("blocks in the long note", blocks);
    results.typing["blocks"] = blocks;
    // Leave and open it again, so it's a note opened from the list, not one just made.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.getByRole("button", { name: "Back", exact: true }).tap();
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    await page.waitForTimeout(1500);
    await clearNames(page);
    await measure(page, cdp, "open long note", () => page.locator("main a[href^='/d/']", { hasText: "Perf note" }).first().tap(), `() => (document.querySelector('[aria-label="Document body"]')?.children.length ?? 0) > ${Math.floor(blocks / 2)}`);
    await topNames(page, "open long note");
    await surfaces(page, cdp, "long note");
    await idle(page, cdp, "long note");

    // Typing in the middle of it: 40 keys, each one's input to paint.
    await body.evaluate((el) => {
      const p = el.children[Math.floor(el.children.length / 2)] as HTMLElement;
      p.scrollIntoView({ block: "center" });
      const range = document.createRange();
      range.selectNodeContents(p);
      range.collapse(false);
      const sel = getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      el.focus();
    });
    await page.waitForTimeout(800);
    await clearNames(page);
    await page.evaluate(() => {
      const w = window as unknown as { __perf: Meter; __keys: number[] };
      w.__perf.events.length = 0;
      w.__keys = [];
      // keydown to the next frame, per key (Event Timing only reports the slow ones).
      window.addEventListener(
        "keydown",
        (e) => {
          const t = e.timeStamp;
          requestAnimationFrame(() => requestAnimationFrame((f) => w.__keys.push(f - t)));
        },
        { capture: true },
      );
    });
    const before = await snapshot(page, cdp);
    await page.keyboard.type(" and some more words typed here at a steady pace", { delay: 80 });
    await page.waitForTimeout(1500);
    const after = await snapshot(page, cdp);
    const keys = await page.evaluate(() => (window as unknown as { __keys: number[] }).__keys.slice());
    const evs = await page.evaluate(() => (window as unknown as { __perf: Meter }).__perf.events.filter((e) => e.name === "keydown" || e.name === "keypress" || e.name === "beforeinput" || e.name === "input" || e.name === "keyup"));
    const d = diff(before, after);
    const n = keys.length;
    const sorted = [...keys].sort((a, b) => a - b);
    results.typing = {
      ...results.typing,
      keys: n,
      keyToFrameP50: Math.round(sorted[Math.floor(n * 0.5)] ?? 0),
      keyToFrameP95: Math.round(sorted[Math.floor(n * 0.95)] ?? 0),
      keyToFrameMax: Math.round(sorted[n - 1] ?? 0),
      slowEvents: evs.length,
      worstEventMs: Math.round(evs.reduce((a, e) => Math.max(a, e.duration), 0)),
      commitsPerKey: Math.round((d.commits / n) * 10) / 10,
      renderedPerKey: Math.round((d.rendered / n) * 10) / 10,
      longTasks: d.longTasks,
      stylesPerKey: Math.round((d.styles / n) * 10) / 10,
      layoutsPerKey: Math.round((d.layouts / n) * 10) / 10,
      scriptMsPerKey: Math.round((d.scriptMs / n) * 10) / 10,
      styleMsPerKey: Math.round((d.styleMs / n) * 10) / 10,
      layoutMsPerKey: Math.round((d.layoutMs / n) * 10) / 10,
      mutationsPerKey: Math.round((d.mutations / n) * 10) / 10,
    };
    console.log("typing", JSON.stringify(results.typing));
    await topNames(page, "typing");
    await idle(page, cdp, "after typing", 4000);

    // Scrolling the long note: a finger flick down and back up.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.waitForTimeout(800);
    const flick = async (dy: number) => {
      for (let i = 0; i < 3; i++) {
        if (cdp) await cdp.send("Input.synthesizeScrollGesture", { x: 220, y: 500, yDistance: dy, speed: 2500, gestureSourceType: "touch", repeatCount: 1 });
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
    await clearNames(page);
    const s1 = await frames(page, () => flick(-1500));
    const s2 = await frames(page, () => flick(1500));
    results.scroll.push({ label: "long note down", ...s1 }, { label: "long note up", ...s2 });
    console.log("scroll note", JSON.stringify(s1), JSON.stringify(s2));
    await topNames(page, "scroll note");

    // Back to Home, then All notes, scrolled.
    await measure(page, cdp, "Back from long note", () => page.getByRole("button", { name: "Back", exact: true }).tap(), shown("h1", "Home"));
    const s3 = await frames(page, () => flick(-1200));
    const s4 = await frames(page, () => flick(1200));
    results.scroll.push({ label: "Home down", ...s3 }, { label: "Home up", ...s4 });
    await page.getByRole("link", { name: "All notes" }).tap();
    await expect(page.getByRole("heading", { level: 1, name: "All notes" })).toBeVisible();
    await page.waitForTimeout(1000);
    const s5 = await frames(page, () => flick(-1200));
    results.scroll.push({ label: "All notes down", ...s5 });
    console.log("scroll lists", JSON.stringify(s3), JSON.stringify(s4), JSON.stringify(s5));

    if (cdp) await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    if (process.env.PERF_OUT) writeFileSync(process.env.PERF_OUT, JSON.stringify(results, null, 2));
    await context.close();

    // Budgets (docs/IOS_PERFORMANCE.md): what React does per keystroke and while nothing happens, in any build;
    // the times only for an export (not React's development build) in Chromium with the CPU slowed down.
    if (process.env.PERF_BUDGETS === "0") return;
    const typing = results.typing as { commitsPerKey: number; renderedPerKey: number };
    expect(typing.commitsPerKey, "React commits per keystroke").toBeLessThanOrEqual(1);
    expect(typing.renderedPerKey, "components drawn per keystroke").toBeLessThanOrEqual(30);
    const idleOf = (label: string) => results.idle.find((r) => r.label === label) as { commits: number; rafs: number; intervals: number } | undefined;
    expect(idleOf("home")?.commits, "commits on Home while nothing happens").toBe(0);
    expect(idleOf("long note")?.commits, "commits in a note while nothing happens").toBe(0);
    const dev = /:3003\b/.test(results.base);
    if (chromium && !dev && CPU >= 4) {
      expect(results.startup["again.usableMs"], "Home usable on a second launch").toBeLessThanOrEqual(1500);
      const open = results.interactions.find((r) => r.label === "open note (Home card)") as { paintMs: number; longTaskMs: number };
      expect(open.paintMs, "a note's first frame after the tap").toBeLessThanOrEqual(600);
      const push = results.interactions.find((r) => r.label === "push All notes") as { paintMs: number };
      expect(push.paintMs, "a list's first frame after the tap").toBeLessThanOrEqual(250);
    }
  });
});
