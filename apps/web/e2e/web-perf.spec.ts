// How fast the website feels on a low-spec computer (docs/WEB_PERFORMANCE.md): a signed-in scratch account on the
// development backend with a library of 240 notes (three of them long), in Chromium with the CPU slowed down (CDP),
// measured in the page: input to the first frame that shows the answer, until nothing moves, long tasks, React
// commits and the components each one rendered, style and layout work, frame gaps while scrolling, what runs
// while nothing happens, the JavaScript each start reads, requests and Convex socket traffic.
// Best against a production build (`next build`, then `next start` on port 3000: the origin the development
// backend trusts for signing in):
//   PERF_STATE=<dir> PERF_SEED=1 E2E_BASE_URL=http://app.localhost:3000 E2E_NO_SERVER=1 \
//     npx playwright test e2e/web-perf.spec.ts --project account --workers=1      # once: makes the account
//   PERF_STATE=<dir> PERF_OUT=<file.json> E2E_BASE_URL=http://app.localhost:3000 E2E_NO_SERVER=1 \
//     npx playwright test e2e/web-perf.spec.ts --project account --workers=1      # each measurement
// PERF_STATE keeps the account (its sign-in and authenticator secret) outside the repository, so runs before and
// after a change measure the same library. PERF_CPU sets the slow-down (default 4); PERF_NET=0 skips the slow
// network on the cold start.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import { APP, newPerson, totpCode, type Account } from "./helpers";

const CPU = Number(process.env.PERF_CPU ?? 4);
const STATE = process.env.PERF_STATE ?? "";
const VIEWPORT = { width: 1366, height: 768 };

/** The page's own meters (before any of its scripts). */
function instrument() {
  const m = {
    commits: 0,
    rendered: 0,
    names: new Map<string, number>(),
    longTasks: [] as number[],
    longAt: [] as [number, number][],
    events: [] as { name: string; duration: number }[],
    timeouts: 0,
    intervals: 0,
    rafs: 0,
    mutations: 0,
    lastInput: 0,
    commitAt: [] as number[],
    lcp: 0,
    cls: 0,
    wsIn: 0,
    wsInBytes: 0,
    wsOut: 0,
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
    const stack: Fiber[] = f ? [f] : [];
    while (stack.length) {
      const n = stack.pop()!;
      if (COMPONENT.has(n.tag) && n.flags & 1) {
        m.rendered++;
        const k = nameOf(n);
        m.names.set(k, (m.names.get(k) ?? 0) + 1);
      }
      // A subtree that bailed out keeps last time's fibers (and flags): don't count it again.
      const fresh = !n.alternate || n.child !== n.alternate.child;
      if (fresh && n.child) stack.push(n.child);
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
        m.commitAt.push(performance.now());
        walk(root.current.child);
      },
    },
  });
  const observe = (type: string, fn: (e: PerformanceEntry) => void, extra: Record<string, unknown> = {}) => {
    try {
      new PerformanceObserver((list) => list.getEntries().forEach(fn)).observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
    } catch {
      // (Not in this engine.)
    }
  };
  observe("longtask", (e) => (m.longTasks.push(e.duration), m.longAt.push([e.startTime, e.duration])));
  observe("event", (e) => m.events.push({ name: e.name, duration: e.duration }), { durationThreshold: 16 });
  observe("largest-contentful-paint", (e) => (m.lcp = e.startTime));
  observe("layout-shift", (e) => {
    const s = e as unknown as { value: number; hadRecentInput: boolean };
    if (!s.hadRecentInput) m.cls += s.value;
  });
  const st = window.setTimeout;
  const si = window.setInterval;
  const raf = window.requestAnimationFrame;
  window.setTimeout = ((fn: TimerHandler, ms?: number, ...a: unknown[]) => st(typeof fn === "function" ? (...x: unknown[]) => (m.timeouts++, (fn as (...y: unknown[]) => void)(...x)) : fn, ms, ...a)) as typeof setTimeout;
  window.setInterval = ((fn: TimerHandler, ms?: number, ...a: unknown[]) => si(typeof fn === "function" ? (...x: unknown[]) => (m.intervals++, (fn as (...y: unknown[]) => void)(...x)) : fn, ms, ...a)) as typeof setInterval;
  window.requestAnimationFrame = (cb: FrameRequestCallback) => raf((t) => (m.rafs++, cb(t)));
  for (const type of ["pointerdown", "keydown", "mousedown"]) window.addEventListener(type, (e) => (m.lastInput = e.timeStamp), { capture: true, passive: true });
  // Convex's socket: messages each way.
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (this: WebSocket, data: Parameters<WebSocket["send"]>[0]) {
    m.wsOut++;
    if (!(this as unknown as { __perfWatched?: boolean }).__perfWatched) {
      (this as unknown as { __perfWatched?: boolean }).__perfWatched = true;
      this.addEventListener("message", (e: MessageEvent) => {
        m.wsIn++;
        m.wsInBytes += typeof e.data === "string" ? e.data.length : 0;
      });
    }
    return send.call(this, data);
  };
  const watch = () => new MutationObserver((r) => (m.mutations += r.length)).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  if (document.documentElement) watch();
  else document.addEventListener("DOMContentLoaded", watch, { once: true });
  const hideBadge = () => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal { display: none !important; }";
    document.head.appendChild(style);
  };
  if (document.head) hideBadge();
  else document.addEventListener("DOMContentLoaded", hideBadge, { once: true });
}

type Meter = { commits: number; rendered: number; longTasks: number[]; events: { name: string; duration: number }[]; timeouts: number; intervals: number; rafs: number; mutations: number; wsIn: number; wsInBytes: number; wsOut: number };

async function cdpMetrics(cdp: CDPSession): Promise<Record<string, number>> {
  const { metrics } = (await cdp.send("Performance.getMetrics")) as { metrics: { name: string; value: number }[] };
  return Object.fromEntries(metrics.map((x) => [x.name, x.value]));
}

/** What the page's meters and Chromium's counters say now. */
async function snapshot(page: Page, cdp: CDPSession) {
  const meter = await page.evaluate(() => {
    const m = (window as unknown as { __perf: Meter }).__perf;
    return { commits: m.commits, rendered: m.rendered, longTasks: m.longTasks.length, longTaskMs: m.longTasks.reduce((a, b) => a + b, 0), timeouts: m.timeouts, intervals: m.intervals, rafs: m.rafs, mutations: m.mutations, wsIn: m.wsIn, wsInKB: m.wsInBytes / 1024, wsOut: m.wsOut };
  });
  const c = await cdpMetrics(cdp);
  const v = (k: string) => c[k] ?? 0;
  return { ...meter, layouts: v("LayoutCount"), styles: v("RecalcStyleCount"), layoutMs: v("LayoutDuration") * 1000, styleMs: v("RecalcStyleDuration") * 1000, scriptMs: v("ScriptDuration") * 1000, taskMs: v("TaskDuration") * 1000, nodes: v("Nodes"), listeners: v("JSEventListeners"), heapMB: v("JSHeapUsedSize") / 1048576 };
}

type Snap = Awaited<ReturnType<typeof snapshot>>;
const diff = (a: Snap, b: Snap) => Object.fromEntries(Object.keys(b).map((k) => [k, Math.round((((b as Record<string, number>)[k] ?? 0) - ((a as Record<string, number>)[k] ?? 0)) * 10) / 10])) as Record<keyof Snap, number>;

const results = {
  cpu: CPU,
  base: APP,
  startup: {} as Record<string, Record<string, number>>,
  interactions: [] as Record<string, unknown>[],
  typing: {} as Record<string, Record<string, number>>,
  scroll: [] as Record<string, unknown>[],
  idle: [] as Record<string, unknown>[],
  memory: [] as Record<string, unknown>[],
  topRendered: {} as Record<string, [string, number][]>,
};
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function topNames(page: Page, label: string) {
  results.topRendered[label] = await page.evaluate(() => {
    const m = (window as unknown as { __perf: { names: Map<string, number> } }).__perf;
    const out = [...m.names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
    m.names.clear();
    return out;
  });
}
const clearNames = (page: Page) => page.evaluate(() => (window as unknown as { __perf: { names: Map<string, number> } }).__perf.names.clear());

const shown = (selector: string, text?: string) => `() => [...document.querySelectorAll(${JSON.stringify(selector)})].some((el) => el.getBoundingClientRect().height > 0 && getComputedStyle(el).visibility !== "hidden"${text ? ` && el.textContent.includes(${JSON.stringify(text)})` : ""})`;
const gone = (selector: string) => `() => ![...document.querySelectorAll(${JSON.stringify(selector)})].some((el) => el.getBoundingClientRect().height > 0)`;
const titleIs = (title: string) => `() => [...document.querySelectorAll('textarea[id^="title-"]')].some((el) => el.getBoundingClientRect().height > 0 && el.value === ${JSON.stringify(title)})`;

/**
 * Arms a watcher for `until` (a function's source, run each frame), does `act`, and returns how long from the input
 * to the first frame where `until` was true (`paint`) and to when no animation runs any more (`settled`), with the
 * work it took.
 */
async function measure(page: Page, cdp: CDPSession, label: string, act: () => Promise<unknown>, until: string) {
  await page.evaluate((src) => {
    const w = window as unknown as { __perf: { lastInput: number; events: unknown[] }; __wait?: Promise<{ paint: number; settled: number; late: number; worstFrame: number }> };
    w.__perf.lastInput = 0;
    w.__perf.events.length = 0;
    const test = new Function(`return (${src})()`) as () => boolean;
    w.__wait = new Promise((resolve) => {
      setTimeout(() => resolve({ paint: -1, settled: -1, late: -1, worstFrame: -1 }), 20_000);
      const tick = () => {
        if (!w.__perf.lastInput || !test()) return void requestAnimationFrame(tick);
        requestAnimationFrame((t) => {
          const paint = t - w.__perf.lastInput;
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
  await page.waitForTimeout(400);
  const after = await snapshot(page, cdp);
  const worst = await page.evaluate(() => (window as unknown as { __perf: Meter }).__perf.events.reduce((a, e) => Math.max(a, e.duration), 0));
  const d = diff(before, after);
  const row = { label, paintMs: Math.round(timing.paint), settledMs: Math.round(timing.settled), lateFrames: timing.late, worstFrameMs: Math.round(timing.worstFrame), worstEventMs: Math.round(worst), commits: d.commits, rendered: d.rendered, longTasks: d.longTasks, longTaskMs: Math.round(d.longTaskMs), styles: d.styles, layouts: d.layouts, styleMs: Math.round(d.styleMs), layoutMs: Math.round(d.layoutMs), scriptMs: Math.round(d.scriptMs), wsIn: d.wsIn, wsOut: d.wsOut };
  results.interactions.push(row);
  log(JSON.stringify(row));
  return row;
}

/** Frame gaps while `act` runs (rAF intervals; at 60 Hz a frame is 16.7 ms). */
async function frames(page: Page, label: string, act: () => Promise<unknown>) {
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
  const row = { label, frames: gaps.length, p50: p(0.5), p95: p(0.95), max: Math.round(sorted[sorted.length - 1] ?? 0), over33: gaps.filter((g) => g > 33.4).length, over50: gaps.filter((g) => g > 50).length };
  results.scroll.push(row);
  log(JSON.stringify(row));
}

/** Everything the page does in `ms` while nobody touches it. */
async function idle(page: Page, cdp: CDPSession, label: string, ms = 5000) {
  await clearNames(page);
  const a = await snapshot(page, cdp);
  await page.waitForTimeout(ms);
  const b = await snapshot(page, cdp);
  await topNames(page, `idle ${label}`);
  const d = diff(a, b);
  const row = { label, seconds: ms / 1000, taskMs: Math.round(d.taskMs), scriptMs: Math.round(d.scriptMs), commits: d.commits, rendered: d.rendered, timeouts: d.timeouts, intervals: d.intervals, rafs: d.rafs, mutations: d.mutations, styles: d.styles, layouts: d.layouts, wsIn: d.wsIn, wsOut: d.wsOut };
  results.idle.push(row);
  log(JSON.stringify(row));
}

/** Heap, DOM nodes and listeners now (after a collection). */
async function memory(page: Page, cdp: CDPSession, label: string) {
  await cdp.send("HeapProfiler.collectGarbage");
  const s = await snapshot(page, cdp);
  const row = { label, heapMB: Math.round(s.heapMB * 10) / 10, nodes: s.nodes, listeners: s.listeners, iframes: await page.locator("iframe").count() };
  results.memory.push(row);
  log(JSON.stringify(row));
}

/** Typing `text` where the caret is: each key's input to the frame after, and the work per key. */
async function typing(page: Page, cdp: CDPSession, label: string, text: string) {
  await page.waitForTimeout(800);
  await clearNames(page);
  await page.evaluate(() => {
    const w = window as unknown as { __perf: Meter; __keys: number[]; __keysOn?: boolean };
    w.__perf.events.length = 0;
    w.__keys = [];
    if (w.__keysOn) return;
    w.__keysOn = true;
    window.addEventListener("keydown", (e) => {
      const t = e.timeStamp;
      requestAnimationFrame(() => requestAnimationFrame((f) => w.__keys.push(f - t)));
    }, { capture: true });
  });
  const before = await snapshot(page, cdp);
  await page.keyboard.type(text, { delay: 80 });
  await page.waitForTimeout(1500);
  const after = await snapshot(page, cdp);
  const keys = await page.evaluate(() => (window as unknown as { __keys: number[] }).__keys.slice());
  const d = diff(before, after);
  const n = keys.length;
  const sorted = [...keys].sort((a, b) => a - b);
  const per = (x: number) => Math.round((x / n) * 10) / 10;
  results.typing[label] = {
    keys: n,
    keyToFrameP50: Math.round(sorted[Math.floor(n * 0.5)] ?? 0),
    keyToFrameP95: Math.round(sorted[Math.floor(n * 0.95)] ?? 0),
    keyToFrameMax: Math.round(sorted[n - 1] ?? 0),
    commitsPerKey: per(d.commits),
    renderedPerKey: per(d.rendered),
    longTasks: d.longTasks,
    longTaskMs: Math.round(d.longTaskMs),
    stylesPerKey: per(d.styles),
    layoutsPerKey: per(d.layouts),
    scriptMsPerKey: per(d.scriptMs),
    styleMsPerKey: per(d.styleMs),
    layoutMsPerKey: per(d.layoutMs),
    mutationsPerKey: per(d.mutations),
    wsOutPerKey: per(d.wsOut),
  };
  log("typing", label, JSON.stringify(results.typing[label]));
  await topNames(page, `typing ${label}`);
}

/** Puts the caret at the end of the middle block of the note's body. */
async function caretInMiddle(page: Page) {
  await page.locator(".ProseMirror").first().evaluate((el) => {
    const p = el.children[Math.floor(el.children.length / 2)] as HTMLElement;
    p.scrollIntoView({ block: "center" });
    const range = document.createRange();
    range.selectNodeContents(p);
    range.collapse(false);
    const sel = getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    (el as HTMLElement).focus();
  });
}

/** The library: 240 short notes in 12 folders linking to each other, with to-dos and dates, and three long notes. */
function libraryZip(): Uint8Array {
  const words = "the quiet garden by the river holds old stones and new seeds while the morning light moves slowly across the field".split(" ");
  const sentence = (i: number, n: number) => Array.from({ length: n }, (_, k) => words[(i * 7 + k * 3) % words.length]).join(" ");
  const files: Record<string, Uint8Array> = {};
  const day = (i: number) => new Date(Date.now() + ((i % 40) - 10) * 86_400_000).toISOString().slice(0, 10);
  for (let i = 0; i < 240; i++) {
    const folder = `Folder ${String.fromCharCode(65 + (i % 12))}`;
    const lines = [`# Note ${i + 1}`, "", sentence(i, 30) + ".", "", `See [[Note ${((i * 7) % 240) + 1}]] and [[Note ${((i * 13) % 240) + 1}]].`, "", `- [ ] Task ${i + 1} due ${day(i)}`, `- [x] Done ${i + 1}`, "", sentence(i + 1, 50) + "."];
    files[`${folder}/Note ${i + 1}.md`] = strToU8(lines.join("\n"));
  }
  for (const n of [1, 2, 3]) {
    const lines = [`# Long note ${n}`, ""];
    for (let s = 0; s < 70; s++) {
      lines.push(`## Section ${s + 1}`, "");
      for (let p = 0; p < 3; p++) lines.push(sentence(s + p + n, 40) + ".", "");
      lines.push(...[0, 1, 2].map((i) => `- ${sentence(s + i, 8)}`), "");
    }
    files[`Long/Long note ${n}.md`] = strToU8(lines.join("\n"));
  }
  return zipSync(files);
}

const stateFile = () => join(STATE, "account.json");
const storageFile = () => join(STATE, "storage.json");

test.describe("the website's speed", { tag: "@web-perf" }, () => {
  test.skip(!STATE, "PERF_STATE unset");
  test.use({ viewport: VIEWPORT, actionTimeout: 30_000 });

  test("seed: a scratch account with a big library", async ({ browser }) => {
    test.skip(process.env.PERF_SEED !== "1", "PERF_SEED=1 makes the account");
    test.setTimeout(600_000);
    mkdirSync(STATE, { recursive: true });
    const { context, page, account } = await newPerson(browser, "Perf Person");
    await page.goto(`${APP}/settings/data`);
    await page.locator('input[type="file"]').first().setInputFiles({ name: "library.zip", mimeType: "application/zip", buffer: Buffer.from(libraryZip()) });
    await expect(page.getByRole("list", { name: "Import results" }).getByRole("link", { name: /Long note 3/ })).toBeVisible({ timeout: 300_000 });
    writeFileSync(stateFile(), JSON.stringify(account));
    await context.storageState({ path: storageFile() });
    await context.close();
  });

  test("measure: start, notes, tabs, joined notes, lists, typing, views", async ({ browser }) => {
    test.skip(process.env.PERF_SEED === "1", "seeding run");
    test.skip(!existsSync(stateFile()), "no seeded account: run with PERF_SEED=1 first");
    test.setTimeout(1_200_000);
    const account = JSON.parse(readFileSync(stateFile(), "utf8")) as Account;
    const open = async (opts: { storage: boolean }) => {
      const context = await browser.newContext({ viewport: VIEWPORT, ...(opts.storage ? { storageState: storageFile() } : {}) });
      await context.addInitScript(instrument);
      const page = await context.newPage();
      page.on("pageerror", (e) => log("PAGE ERROR", e.message));
      const cdp = await context.newCDPSession(page);
      await cdp.send("Performance.enable");
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
      return { context, page, cdp };
    };
    const homeUsable = (page: Page) => expect(page.locator("main a[href^='/d/']").first()).toBeVisible({ timeout: 120_000 });
    const startRow = async (page: Page, cdp: CDPSession, extra: Record<string, number>) => {
      const nav = await page.evaluate(() => {
        const n = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
        const fcp = performance.getEntriesByName("first-contentful-paint")[0];
        const m = (window as unknown as { __perf: Meter & { lcp: number; cls: number } }).__perf;
        const js = (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).filter((r) => r.initiatorType === "script" || r.name.endsWith(".js"));
        return {
          ttfb: Math.round(n.responseStart),
          domContentLoaded: Math.round(n.domContentLoadedEventEnd),
          fcp: Math.round(fcp?.startTime ?? -1),
          lcp: Math.round(m.lcp),
          cls: Math.round(m.cls * 1000) / 1000,
          usable: Math.round(performance.now()),
          longTasks: m.longTasks.length,
          longTaskMs: Math.round(m.longTasks.reduce((a, b) => a + b, 0)),
          commits: m.commits,
          rendered: m.rendered,
          requests: performance.getEntriesByType("resource").length,
          jsFiles: js.length,
          jsKB: Math.round(js.reduce((a, r) => a + r.decodedBodySize, 0) / 1024),
          jsTransferKB: Math.round(js.reduce((a, r) => a + r.transferSize, 0) / 1024),
          wsIn: m.wsIn,
          wsInKB: Math.round(m.wsInBytes / 1024),
          wsOut: m.wsOut,
        };
      });
      const c = await cdpMetrics(cdp);
      return { ...nav, scriptMs: Math.round((c.ScriptDuration ?? 0) * 1000), taskMs: Math.round((c.TaskDuration ?? 0) * 1000), ...extra };
    };

    // 1. Sign in to Home: a fresh browser (nothing cached), the password and the authenticator code.
    {
      const { context, page, cdp } = await open({ storage: false });
      await page.goto(`${APP}/signin`);
      await page.getByLabel("Email").fill(account.email);
      await page.getByLabel("Password", { exact: true }).fill(account.password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForURL(/\/two-factor(\?|$)/, { timeout: 30_000 });
      await page.getByLabel("6-digit code").fill(totpCode(account.totpSecret));
      const t0 = Date.now();
      await page.getByRole("button", { name: "Verify" }).click();
      await homeUsable(page);
      const wall = Date.now() - t0;
      await page.waitForTimeout(1500);
      results.startup["sign in"] = await startRow(page, cdp, { verifyToHomeMs: wall });
      log("sign in", JSON.stringify(results.startup["sign in"]));
      await context.storageState({ path: storageFile() });
      await context.close();
    }

    // 2. Cold start, signed in, on a slow network and an empty cache; then a warm start (cached code).
    const { context, page, cdp } = await open({ storage: true });
    if (process.env.PERF_NET !== "0") await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    for (const run of ["cold", "warm"] as const) {
      const t0 = Date.now();
      await page.goto(`${APP}/documents`);
      await homeUsable(page);
      const wall = Date.now() - t0;
      await page.waitForTimeout(2000);
      results.startup[run] = await startRow(page, cdp, { wallMs: wall });
      log(run, JSON.stringify(results.startup[run]));
      await topNames(page, `start ${run}`);
      if (run === "cold") await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    }
    await page.waitForTimeout(3000);
    await idle(page, cdp, "home");
    await memory(page, cdp, "home");

    // 3. Opening notes: from Home, then from the sidebar's All notes, each one adds a tab.
    const strip = page.getByRole("navigation", { name: "Open pages" });
    await clearNames(page);
    const first = page.locator("main a[href^='/d/']").first();
    await measure(page, cdp, "open note (Home)", () => first.click(), shown(".ProseMirror"));
    await topNames(page, "open note (Home)");
    await page.waitForTimeout(1500);
    await idle(page, cdp, "note");
    const folio = page.getByRole("navigation", { name: "Folio" });
    // A note's sidebar holds its own tools: the Home tab brings the folio's back.
    await measure(page, cdp, "Home tab (from a note)", () => strip.getByRole("link", { name: "Home", exact: true }).click(), shown("main a[href^='/d/']"));
    await page.waitForTimeout(1000);
    await clearNames(page);
    await measure(page, cdp, "All notes", () => folio.getByRole("link", { name: "All notes" }).click(), shown("main a[href^='/d/']", "Note 1"));
    await topNames(page, "All notes");
    await page.waitForTimeout(1500);
    await idle(page, cdp, "All notes");
    await frames(page, "All notes scroll", async () => {
      await page.mouse.move(800, 500);
      for (let i = 0; i < 12; i++) {
        await page.mouse.wheel(0, 400);
        await page.waitForTimeout(60);
      }
      for (let i = 0; i < 12; i++) {
        await page.mouse.wheel(0, -400);
        await page.waitForTimeout(60);
      }
    });
    const titles = ["Note 240", "Note 239", "Note 238", "Long note 1"];
    for (const t of titles) {
      await strip.getByRole("link", { name: "Home", exact: true }).click();
      await folio.getByRole("link", { name: "All notes" }).click();
      await expect(page.locator("main a[href^='/d/']", { hasText: "Note 1" }).first()).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(800);
      const link = page.locator("main a[href^='/d/']").filter({ has: page.getByRole("heading", { name: t, exact: true }) }).first();
      await link.scrollIntoViewIfNeeded();
      await measure(page, cdp, `open ${t} (All notes)`, () => link.click(), t.startsWith("Long") ? `() => (document.querySelector('.ProseMirror')?.children.length ?? 0) > 200` : shown(".ProseMirror"));
    }
    await page.waitForTimeout(2000);
    await idle(page, cdp, "long note");
    await memory(page, cdp, "long note, 5 tabs");

    // 4. Typing in the long note.
    await caretInMiddle(page);
    await typing(page, cdp, "long note", " and some more words typed here at a steady pace");
    await idle(page, cdp, "after typing", 4000);
    await frames(page, "long note scroll", async () => {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.mouse.move(700, 450);
      for (let i = 0; i < 15; i++) {
        await page.mouse.wheel(0, 500);
        await page.waitForTimeout(50);
      }
      for (let i = 0; i < 15; i++) {
        await page.mouse.wheel(0, -500);
        await page.waitForTimeout(50);
      }
    });

    // 5. Switching tabs, a tab's preview, Tab Overview.
    await clearNames(page);
    for (const [name, title] of [["Note 240", "Note 240"], ["Long note 1", "Long note 1"], ["Note 239", "Note 239"], ["Note 238", "Note 238"]] as const) {
      await measure(page, cdp, `switch tab to ${name}`, () => strip.getByRole("link", { name, exact: true }).click(), titleIs(title));
    }
    await topNames(page, "switch tabs");
    await page.waitForTimeout(1000);
    await clearNames(page);
    await measure(page, cdp, "tab preview (hover)", () => strip.getByRole("link", { name: "Long note 1", exact: true }).hover().then(() => page.evaluate(() => ((window as unknown as { __perf: { lastInput: number } }).__perf.lastInput = performance.now()))), shown("iframe"));
    await topNames(page, "tab preview");
    await page.mouse.move(700, 600);
    await page.waitForTimeout(1200);
    await clearNames(page);
    await measure(page, cdp, "open Tab Overview", () => page.getByRole("button", { name: "Show all tabs" }).click(), shown('[role="dialog"]'));
    await topNames(page, "Tab Overview");
    await memory(page, cdp, "Tab Overview open");
    await measure(page, cdp, "close Tab Overview", () => page.keyboard.press("Escape"), gone('[role="dialog"]'));

    // 6. Joined notes: Note 2, Note 3 and Long note 1 side by side (the tab strip's own storage, as the Join
    // picker leaves it), then typing in one of them.
    await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => /^folevi:tabs:[^:]+$/.test(k))!;
      const tabs = JSON.parse(localStorage.getItem(key)!) as { id: string; title: string; panes?: string[]; at?: string }[];
      const pick = (t: string) => tabs.find((x) => x.title === t)!;
      const ids = [pick("Note 240").id, pick("Note 239").id, pick("Long note 1").id];
      const rest = tabs.filter((x) => !ids.includes(x.id));
      localStorage.setItem(key, JSON.stringify([...rest, { id: "join:perf0001", title: "", panes: ids, at: ids[0] }]));
    });
    await clearNames(page);
    await page.goto(`${APP}/documents`);
    await homeUsable(page);
    await page.waitForTimeout(2000);
    await measure(page, cdp, "open joined tab (3 notes)", () => strip.getByRole("link", { name: /\(joined\)/ }).first().click(), "() => document.querySelectorAll('[data-pane]').length >= 3 && document.querySelectorAll('.ProseMirror').length >= 1");
    await topNames(page, "open joined");
    await page.waitForTimeout(2000);
    await idle(page, cdp, "joined (3 notes)");
    await memory(page, cdp, "joined (3 notes)");
    await page.locator(".ProseMirror").first().evaluate((el) => {
      const p = el.lastElementChild as HTMLElement;
      const range = document.createRange();
      range.selectNodeContents(p);
      range.collapse(false);
      const sel = getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      (el as HTMLElement).focus();
    });
    await typing(page, cdp, "joined pane", " typed beside two other notes");

    // 7. Views: Tasks, Calendar, Graph, Home.
    await strip.getByRole("link", { name: "Home", exact: true }).click();
    await expect(folio).toBeVisible();
    await page.waitForTimeout(1000);
    for (const [label, name, until] of [
      ["Tasks", "Tasks", shown("main h1", "Tasks")],
      ["Calendar", "Calendar", shown("main [data-date]")],
      ["Graph", "Graph", shown("main canvas, main svg")],
      ["Home", "Home", shown("main a[href^='/d/']")],
    ] as const) {
      await clearNames(page);
      await measure(page, cdp, `view ${label}`, () => folio.getByRole("link", { name: new RegExp(`^${name}\\b`) }).first().click(), until);
      await topNames(page, `view ${label}`);
      await page.waitForTimeout(2500);
      if (label !== "Home") await idle(page, cdp, label, 4000);
    }
    await memory(page, cdp, "end");

    if (process.env.PERF_OUT) writeFileSync(process.env.PERF_OUT, JSON.stringify(results, null, 2));
    await context.close();
  });
});
