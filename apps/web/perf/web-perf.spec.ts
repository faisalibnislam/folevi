// The web app's speed with a big library (docs/perf/web-results.md, docs/perf/PERF_PASS_2026-11-25.md).
//
// What it runs against: the production shell export (`node scripts/build-shell.mjs --no-copy`, out-shell/), the
// same components the website and every app show, in local mode: the test FakeShell (e2e/fixtures/localShell.ts)
// keeps the library in the browser profile's origin private file system, so no backend and no account are involved,
// and the network guard fails the run if the page contacts Folevi or Convex. The library is generated
// (perf/library.ts: 5,000 notes, 200 folders, 2,000 tasks, 20 long notes with images) and imported once through
// Settings > Data into a headless Chromium profile kept in PERF_STATE, so every later run measures the same library.
//
//   node scripts/build-shell.mjs --no-copy                                  # the production export
//   PERF_STATE=<dir outside the repo> npx playwright test -c perf/playwright.config.ts   # seeds if needed, measures
//
// PERF_OUT=<file.json> saves the numbers; PERF_CPU sets the CPU slow-down (default 4, a mid-range phone or an
// older laptop); PERF_VIEWPORTS=desktop,phone picks the widths; PERF_ROOT serves another export folder.
//
// Per width: start (LCP, CLS, FCP, long tasks; cold with the cache cleared and warm), note open (click in All
// notes to the editor taking keys), INP (Event Timing over typing in a note and clicking through lists), scroll
// frame gaps on All notes and Tasks, JS heap after opening and closing 20 notes, and the JavaScript each route
// downloads on a cold load.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type BrowserContext, type CDPSession, type Page } from "@playwright/test";
import { expect, prepareContext, test } from "../e2e/fixtures/localShell";
import { batches, libraryZip, NOTES } from "./library";

const STATE = process.env.PERF_STATE ?? "";
const CPU = Number(process.env.PERF_CPU ?? 4);
const LIBRARY = "perf-library";
const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
} as const;
type Width = keyof typeof VIEWPORTS;
const WIDTHS = (process.env.PERF_VIEWPORTS ?? "desktop,phone").split(",").filter((w): w is Width => w in VIEWPORTS);
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** The page's own meters, before any of its scripts. */
function instrument() {
  const m = {
    lcp: 0,
    cls: 0,
    longTasks: [] as number[],
    interactions: new Map<number, { name: string; duration: number }>(),
    lastInput: 0,
    shifts: [] as string[],
  };
  Object.defineProperty(window, "__perf", { value: m });
  const observe = (type: string, fn: (e: PerformanceEntry) => void, extra: Record<string, unknown> = {}) => {
    try {
      new PerformanceObserver((list) => list.getEntries().forEach(fn)).observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
    } catch {
      // Not in this engine.
    }
  };
  observe("largest-contentful-paint", (e) => (m.lcp = e.startTime));
  observe("layout-shift", (e) => {
    const s = e as unknown as { value: number; hadRecentInput: boolean; sources?: { node?: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }[] };
    if (s.hadRecentInput) return;
    m.cls += s.value;
    // What moved (PERF_CLS prints it): the element, where it was and where it went.
    const describe = (n: Node | null | undefined) => {
      const el = n instanceof Element ? n : n?.parentElement;
      if (!el) return "?";
      const label = el.getAttribute("aria-label") ?? el.getAttribute("data-testid") ?? (el.textContent ?? "").trim().slice(0, 30);
      return `${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 3).join(".")} "${label}"`;
    };
    for (const src of s.sources ?? []) m.shifts.push(`${Math.round(e.startTime)}ms ${s.value.toFixed(3)} ${describe(src.node)} y ${Math.round(src.previousRect.y)}->${Math.round(src.currentRect.y)} h ${Math.round(src.previousRect.height)}->${Math.round(src.currentRect.height)}`);
  });
  observe("longtask", (e) => m.longTasks.push(e.duration));
  // INP's inputs: each interaction's longest event (input delay + processing + until the next paint).
  observe(
    "event",
    (e) => {
      const ev = e as PerformanceEventTiming & { interactionId?: number };
      if (!ev.interactionId) return;
      const had = m.interactions.get(ev.interactionId);
      if (!had || had.duration < ev.duration) m.interactions.set(ev.interactionId, { name: ev.name, duration: ev.duration });
    },
    { durationThreshold: 16 },
  );
  for (const type of ["pointerdown", "keydown", "mousedown", "click"]) window.addEventListener(type, (e) => (m.lastInput ||= e.timeStamp), { capture: true, passive: true });
  const hideBadge = () => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal { display: none !important; }";
    document.head.appendChild(style);
  };
  if (document.head) hideBadge();
  else document.addEventListener("DOMContentLoaded", hideBadge, { once: true });
}

/** A production export reads only `window.foleviShell`, never the development test hook: the FakeShell is it. */
function aliasShell() {
  const fake = (window as unknown as { __foleviTestShell?: unknown }).__foleviTestShell;
  if (fake && !("foleviShell" in window)) Object.defineProperty(window, "foleviShell", { value: fake });
}

type Meter = { shifts: string[]; lcp: number; cls: number; longTasks: number[]; interactions: Map<number, { name: string; duration: number }>; lastInput: number };
const meter = <T,>(page: Page, fn: (m: Meter) => T) => page.evaluate(`(${fn.toString()})(window.__perf)`) as Promise<T>;

const results: Record<string, unknown> = { cpu: CPU, notes: NOTES, date: new Date().toISOString(), widths: {} };
const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? -1);
  return { n: s.length, p50: q(0.5), p95: q(0.95), max: Math.round(s[s.length - 1] ?? -1) };
};

async function openContext(width: Width, testInfo: Parameters<typeof prepareContext>[1]): Promise<{ context: BrowserContext; page: Page; cdp: CDPSession }> {
  const context = await chromium.launchPersistentContext(join(STATE, "profile"), {
    headless: true,
    baseURL: String(testInfo.project.use.baseURL),
    ...VIEWPORTS[width],
  });
  await prepareContext(context, testInfo, { libraryName: LIBRARY, platform: "mac" });
  await context.addInitScript(aliasShell);
  await context.addInitScript(instrument);
  const page = context.pages()[0] ?? (await context.newPage());
  page.on("pageerror", (e) => log("PAGE ERROR", e.message.slice(0, 300)));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  return { context, page, cdp };
}

const throttle = (cdp: CDPSession, rate: number) => cdp.send("Emulation.setCPUThrottlingRate", { rate });
const noteLinks = (page: Page) => page.locator("main a[href^='/d/']");

/** Waits until the editor of the open note takes keys. */
async function editorReady(page: Page) {
  await page.waitForFunction(() => [...document.querySelectorAll('.ProseMirror[contenteditable="true"]')].some((el) => el.getBoundingClientRect().height > 0 && (el.textContent ?? "").length > 0), null, { timeout: 60_000 });
}

/** Time from the input to the first frame where `ready` holds (polled each frame). */
async function inputToFrame(page: Page, act: () => Promise<unknown>, ready: string): Promise<number> {
  // Editors already on the page don't count as the note that opens.
  await page.evaluate(() => document.querySelectorAll(".ProseMirror").forEach((el) => el.setAttribute("data-perf-old", "")));
  await page.evaluate((src) => {
    const w = window as unknown as { __perf: Meter; __wait?: Promise<number> };
    w.__perf.lastInput = 0;
    const test = new Function(`return (${src})()`) as () => boolean;
    w.__wait = new Promise((resolve) => {
      const started = performance.now();
      const tick = (t: number) => {
        if (performance.now() - started > 60_000) return resolve(-1);
        if (!w.__perf.lastInput || !test()) return void requestAnimationFrame(tick);
        resolve(t - w.__perf.lastInput);
      };
      requestAnimationFrame(tick);
    });
  }, ready);
  await act();
  return Math.round(await page.evaluate(() => (window as unknown as { __wait: Promise<number> }).__wait));
}
// The opened note's own editor (not a hover preview's): its page is the URL, and its body takes keys and has text.
const EDITOR_READY = `() => location.pathname.startsWith("/d/") && [...document.querySelectorAll('.ProseMirror[contenteditable="true"][aria-label="Document body"]:not([data-perf-old])')].some((el) => el.getBoundingClientRect().height > 0 && el.textContent.length > 0)`;

/** rAF gaps while `act` runs. */
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
  const s = stats(gaps);
  return { frames: s.n, p50: s.p50, p95: s.p95, max: s.max, over33: gaps.filter((g) => g > 33.4).length, avgFps: Math.round((1000 * gaps.length) / Math.max(1, gaps.reduce((a, b) => a + b, 0))) };
}

async function scrollList(page: Page, cdp: CDPSession) {
  // The list's scroller is whatever scrolls under the middle of main.
  const box = await page.locator("main").first().boundingBox();
  const x = (box?.x ?? 200) + (box?.width ?? 400) / 2;
  const y = (box?.y ?? 200) + (box?.height ?? 400) / 2;
  await page.mouse.move(x, y);
  void cdp;
  return frames(page, async () => {
    for (let i = 0; i < 60; i++) {
      await page.mouse.wheel(0, 240);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(500);
  });
}

/** Listeners on window and document by event type (what stays behind after a note closes). */
async function globalListeners(cdp: CDPSession): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const expr of ["window", "document"]) {
    const { result } = (await cdp.send("Runtime.evaluate", { expression: expr })) as { result: { objectId: string } };
    const { listeners } = (await cdp.send("DOMDebugger.getEventListeners", { objectId: result.objectId })) as { listeners: { type: string }[] };
    for (const l of listeners) out[`${expr}.${l.type}`] = (out[`${expr}.${l.type}`] ?? 0) + 1;
  }
  return out;
}

/** PERF_HEAP=1: a heap snapshot saved as <PERF_STATE>/<name>.heapsnapshot (perf/heap-diff.mjs compares two). */
async function heapSnapshot(cdp: CDPSession, name: string) {
  if (!process.env.PERF_HEAP) return;
  const chunks: string[] = [];
  const on = (e: { chunk: string }) => chunks.push(e.chunk);
  cdp.on("HeapProfiler.addHeapSnapshotChunk", on);
  await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
  cdp.off("HeapProfiler.addHeapSnapshotChunk", on);
  writeFileSync(join(STATE, `${name}.heapsnapshot`), chunks.join(""));
}

async function heapMB(cdp: CDPSession) {
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.collectGarbage");
  const { metrics } = (await cdp.send("Performance.getMetrics")) as { metrics: { name: string; value: number }[] };
  const v = (k: string) => metrics.find((x) => x.name === k)?.value ?? 0;
  return { heapMB: Math.round((v("JSHeapUsedSize") / 1048576) * 10) / 10, nodes: v("Nodes"), listeners: v("JSEventListeners") };
}

/** Script bytes (compressed on the wire as served; the export is served uncompressed, so this is the raw size) of a cold load of `path`. */
async function routeJs(page: Page, cdp: CDPSession, path: string, ready: () => Promise<unknown>) {
  await cdp.send("Network.enable");
  await cdp.send("Network.clearBrowserCache");
  const sizes = new Map<string, number>();
  const types = new Map<string, string>();
  const onResp = (e: { requestId: string; type: string }) => types.set(e.requestId, e.type);
  const onDone = (e: { requestId: string; encodedDataLength: number }) => sizes.set(e.requestId, e.encodedDataLength);
  cdp.on("Network.responseReceived", onResp);
  cdp.on("Network.loadingFinished", onDone);
  await page.goto(path);
  await ready();
  await page.waitForTimeout(1500);
  cdp.off("Network.responseReceived", onResp);
  cdp.off("Network.loadingFinished", onDone);
  let js = 0;
  let files = 0;
  for (const [id, t] of types) {
    if (t !== "Script") continue;
    js += sizes.get(id) ?? 0;
    files++;
  }
  return { jsKB: Math.round(js / 1024), files };
}

/** PERF_PROFILE=1: a CPU profile of `act`, saved as <PERF_STATE>/<name>.cpuprofile (perf/profile-summary.mjs reads it). */
async function profiled<T>(cdp: CDPSession, name: string, act: () => Promise<T>): Promise<T> {
  if (!process.env.PERF_PROFILE) return act();
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
  await cdp.send("Profiler.start");
  try {
    return await act();
  } finally {
    const { profile } = (await cdp.send("Profiler.stop")) as { profile: unknown };
    writeFileSync(join(STATE, `${name}.cpuprofile`), JSON.stringify(profile));
  }
}

async function seed(page: Page) {
  log("seeding:", NOTES, "notes in", batches(), "imports");
  await page.goto("/settings/data");
  for (let b = 0; b < batches(); b++) {
    const input = page.locator('input[type="file"]').first();
    await input.waitFor({ state: "attached", timeout: 120_000 });
    await expect(page.getByText(/^Imported \d+ of \d+ pages?$/)).toHaveCount(0, { timeout: 60_000 });
    await input.setInputFiles({ name: `library-${b + 1}.zip`, mimeType: "application/zip", buffer: Buffer.from(libraryZip(b)) });
    const done = page.getByText(/^Imported \d+ of \d+ pages?$/).first();
    await expect(done).toBeVisible({ timeout: 1_800_000 });
    const text = await done.textContent();
    const failed = await page.locator('[aria-label="Import results"] .text-danger').allTextContents();
    log(`batch ${b + 1}:`, text, failed.length ? `errors: ${[...new Set(failed)].slice(0, 5).join(" | ")}` : "");
    if (!text || /^Imported 0 /.test(text) || failed.length) throw new Error(`import failed: ${text}`);
  }
}

test.describe("web app speed with a big library", { tag: "@web-perf" }, () => {
  test.skip(!STATE, "PERF_STATE unset");

  test("start, open notes, type, scroll, memory, JS per route", async ({ backendMode }, testInfo) => {
    test.skip(backendMode !== "local", "local mode");
    mkdirSync(STATE, { recursive: true });
    const seededFlag = join(STATE, `seeded-${NOTES}`);

    for (const width of WIDTHS) {
      const out: Record<string, unknown> = {};
      (results.widths as Record<string, unknown>)[width] = out;
      const { context, page, cdp } = await openContext(width, testInfo);
      try {
        if (!existsSync(seededFlag)) {
          await seed(page);
          writeFileSync(seededFlag, new Date().toISOString());
          if (process.env.PERF_SEED_ONLY) return;
        }
        // Warm up once (the library index loads into IndexedDB the first time), then measure.
        await page.goto("/notes");
        await expect(noteLinks(page).first()).toBeVisible({ timeout: 600_000 });
        await page.waitForTimeout(3000);
        if (process.env.PERF_SHOTS) await page.screenshot({ path: join(STATE, `${width}-notes.png`) });
        await throttle(cdp, CPU);

        // ---- Start: cold (cache cleared) and warm, on All notes. ----
        for (const kind of ["cold", "warm"] as const) {
          if (kind === "cold") {
            await cdp.send("Network.enable");
            await cdp.send("Network.clearBrowserCache");
          }
          await profiled(cdp, `${width}-start-${kind}`, async () => {
            await page.goto("/notes");
            await expect(noteLinks(page).first()).toBeVisible({ timeout: 120_000 });
            await page.waitForTimeout(2500);
          });
          out[`start.${kind}`] = await page.evaluate(() => {
            const m = (window as unknown as { __perf: Meter }).__perf;
            const fcp = performance.getEntriesByName("first-contentful-paint")[0];
            return { lcpMs: Math.round(m.lcp), cls: Math.round(m.cls * 1000) / 1000, fcpMs: Math.round(fcp?.startTime ?? -1), longTasks: m.longTasks.length, longTaskMs: Math.round(m.longTasks.reduce((a, b) => a + b, 0)), rows: document.querySelectorAll("main a[href^='/d/']").length, nodes: document.getElementsByTagName("*").length };
          });
          log(width, kind, JSON.stringify(out[`start.${kind}`]));
          if (process.env.PERF_CLS) log(width, kind, "shifts:\n  " + (await meter(page, (m) => m.shifts.slice(0, 20))).join("\n  "));
        }

        // PERF_ONLY=start: only the start (quick checks of LCP and CLS).
        if (process.env.PERF_ONLY === "start") continue;

        // PERF_ONLY=memory: straight to opening and closing notes.
        if (process.env.PERF_ONLY !== "memory") {
        // ---- Note open: from All notes, 10 notes, click to editor ready; then back. ----
        await meter(page, (m) => m.interactions.clear());
        const opens: number[] = [];
        for (let i = 0; i < 10; i++) {
          const link = noteLinks(page).nth(i % Math.max(1, await noteLinks(page).count()));
          await link.scrollIntoViewIfNeeded();
          opens.push(await inputToFrame(page, () => link.click(), EDITOR_READY));
          await page.waitForTimeout(400);
          await page.goBack();
          await expect(noteLinks(page).first()).toBeVisible();
          await page.waitForTimeout(300);
        }
        out.noteOpen = stats(opens);
        // The same by keyboard (Tab to the card, Enter): no pointer hovering the card first, so nothing is warmed up.
        const keyed: number[] = [];
        for (let i = 0; i < 5; i++) {
          const link = noteLinks(page).nth(10 + i);
          await link.scrollIntoViewIfNeeded();
          await link.focus();
          keyed.push(await profiled(cdp, `${width}-open-keyboard-${i}`, () => inputToFrame(page, () => page.keyboard.press("Enter"), EDITOR_READY)));
          await page.waitForTimeout(400);
          await page.goBack();
          await expect(noteLinks(page).first()).toBeVisible();
          await page.waitForTimeout(300);
        }
        out.noteOpenKeyboard = stats(keyed);
        // A long note (images, ~420 blocks): the long notes are the first ones in Folder 001.
        await page.goto("/folders");
        const folder = page.getByRole("link", { name: /Folder 001/ }).first();
        await folder.click({ timeout: 30_000 }).catch(() => undefined);
        const long = page.locator("main a[href^='/d/']", { hasText: /Long note 1\b/ }).first();
        await long.waitFor({ timeout: 30_000 }).catch(() => undefined);
        if (await long.count()) {
          await long.scrollIntoViewIfNeeded();
          out.longNoteOpenMs = await inputToFrame(page, () => long.click(), EDITOR_READY);
        }
        log(width, "note open", JSON.stringify(out.noteOpen), "keyboard", JSON.stringify(out.noteOpenKeyboard), "long", out.longNoteOpenMs);

        // ---- Typing in the long note (or the last open note): INP from keys. ----
        if (!(await page.locator('.ProseMirror[contenteditable="true"][aria-label="Document body"]').count())) {
          await page.goto("/notes");
          await noteLinks(page).first().click();
        }
        await editorReady(page);
        await page.locator('.ProseMirror[contenteditable="true"]').first().evaluate((el) => {
          const p = el.children[Math.floor(el.children.length / 2)] as HTMLElement;
          p.scrollIntoView({ block: "center" });
          const range = document.createRange();
          range.selectNodeContents(p);
          range.collapse(false);
          getSelection()!.removeAllRanges();
          getSelection()!.addRange(range);
          (el as HTMLElement).focus();
        });
        await meter(page, (m) => m.interactions.clear());
        await page.keyboard.type(" the quick brown fox jumps over the lazy dog", { delay: 60 });
        await page.waitForTimeout(1500);
        const typed = await meter(page, (m) => [...m.interactions.values()].map((x) => x.duration));
        out.typingInp = stats(typed);
        log(width, "typing INP", JSON.stringify(out.typingInp));

        // ---- Lists: scroll All notes and Tasks; clicks through lists count toward INP. ----
        await page.goto("/notes");
        await expect(noteLinks(page).first()).toBeVisible();
        await page.waitForTimeout(1500);
        out["scroll.allNotes"] = await scrollList(page, cdp);
        log(width, "scroll All notes", JSON.stringify(out["scroll.allNotes"]));
        await page.goto("/tasks");
        await page.waitForTimeout(3000);
        out["scroll.tasks"] = await scrollList(page, cdp);
        log(width, "scroll Tasks", JSON.stringify(out["scroll.tasks"]));

        // Clicking through: All notes > Tasks > Folders > Home by the app's own links where present.
        await meter(page, (m) => m.interactions.clear());
        await page.goto("/notes");
        await expect(noteLinks(page).first()).toBeVisible();
        const perLink: Record<string, number> = {};
        for (const name of ["Tasks", "All notes", "Home", "All notes", "Calendar", "All notes"]) {
          const link = page.getByRole("link", { name, exact: true }).first();
          if (await link.isVisible().catch(() => false)) {
            const had = await meter(page, (m) => [...m.interactions.keys()]);
            await profiled(cdp, `${width}-click-${Object.keys(perLink).length + 1}-${name.replace(/\s+/g, "")}`, async () => {
              await link.click();
              await page.waitForTimeout(1500);
            });
            const now = await meter(page, (m) => [...m.interactions.entries()].map(([k, v]) => [k, v.duration] as [number, number]));
            perLink[`${Object.keys(perLink).length + 1}. ${name}`] = Math.round(Math.max(0, ...now.filter(([k]) => !had.includes(k)).map(([, d]) => d)));
          }
        }
        out.listClicks = perLink;
        const clicks = await meter(page, (m) => [...m.interactions.values()].map((x) => x.duration));
        out.listClickInp = stats([...clicks, ...opens.map(() => 0)].filter((x) => x > 0));
        out.inp = Math.max(out.typingInp ? (out.typingInp as { max: number }).max : 0, (out.listClickInp as { max: number }).max);
        log(width, "list click INP", JSON.stringify(out.listClickInp));

        }
        // ---- Memory: open and close 20 notes. ----
        await page.goto("/notes");
        await expect(noteLinks(page).first()).toBeVisible();
        await page.waitForTimeout(1500);
        const before = await heapMB(cdp);
        const listenersBefore = await globalListeners(cdp);
        const openClose = async (from: number) => {
          for (let i = from; i < from + 20; i++) {
            const link = noteLinks(page).nth(i % Math.max(1, await noteLinks(page).count()));
            await link.scrollIntoViewIfNeeded();
            await link.click();
            await editorReady(page);
            await page.goBack();
            await expect(noteLinks(page).first()).toBeVisible();
          }
          await page.waitForTimeout(2000);
          return heapMB(cdp);
        };
        const after = await openClose(0);
        await heapSnapshot(cdp, `${width}-after20`);
        const listenersAfter = await globalListeners(cdp);
        const grew = Object.fromEntries(Object.entries(listenersAfter).map(([k, n]) => [k, n - (listenersBefore[k] ?? 0)]).filter(([k, d]) => d !== 0 && !k.includes("playwright")));
        if (Object.keys(grew).length) log(width, "window/document listeners that grew", JSON.stringify(grew));
        // Twenty more: a leak keeps growing, a bounded cache (recent notes' undo history, the query cache) doesn't.
        const after40 = await openClose(20);
        await heapSnapshot(cdp, `${width}-after40`);
        if (process.env.PERF_ONLY === "memory") continue;
        out.memory = { before, after, after40, growthMB: Math.round((after.heapMB - before.heapMB) * 10) / 10, growth20to40MB: Math.round((after40.heapMB - after.heapMB) * 10) / 10 };
        log(width, "memory", JSON.stringify(out.memory));

        // ---- JavaScript per route on a cold load (no CPU slow-down needed). ----
        await throttle(cdp, 1);
        const firstId = await noteLinks(page).first().getAttribute("href");
        const js: Record<string, unknown> = {};
        for (const [path, ready] of [
          ["/documents", () => page.locator("main").first().waitFor()],
          ["/notes", () => noteLinks(page).first().waitFor()],
          [firstId ?? "/notes", () => editorReady(page)],
          ["/tasks", () => page.locator("main").first().waitFor()],
          ["/folders", () => page.locator("main").first().waitFor()],
          ["/settings", () => page.locator("main").first().waitFor()],
        ] as const) {
          js[path.startsWith("/d/") ? "/d/[id]" : path] = await routeJs(page, cdp, path, ready);
        }
        out.routeJs = js;
        log(width, "route JS", JSON.stringify(js));
      } finally {
        await context.close();
      }
    }
    if (process.env.PERF_OUT) writeFileSync(process.env.PERF_OUT, JSON.stringify(results, null, 2));
    log(JSON.stringify(results, null, 2));
  });
});
