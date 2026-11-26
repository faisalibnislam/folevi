// How the app feels signed in, near and far from the backend, in Chromium and WebKit (docs/perf/feel-results.md).
//
// perf/web-perf.spec.ts measures local mode with a 5,000-note library in Chromium at a quarter of the CPU. This one
// measures the other half: account mode (live queries over a WebSocket) with a small library, at full speed, with the
// backend a chosen distance away. Chromium only: WebKit applies the pages' upgrade-insecure-requests to
// http://app.localhost and drops the session cookie there, so a signed-in WebKit run needs TLS. It answers "what does a click wait for?".
//
// Needs, started by hand (HANDOFF.md "The e2e suite exactly as CI runs it"): the local Convex backend on 3210/3211,
// perf/latency-proxy.mjs 3310:3210,3311:3211, and `next start --port 3000` of a build whose .env.local points
// NEXT_PUBLIC_CONVEX_URL / _SITE_URL at the proxy (3310 / 3311) with NEXT_PUBLIC_FOLEVI_TEST_HOOKS=1.
//
//   npx playwright test -c perf/feel.config.ts
//
// FEEL_DELAYS=0,100 are the proxy's delays each way in ms (100 = a 200 ms round trip); FEEL_NOTES the library's
// size (default 300); PERF_OUT=<file.json> saves the numbers. Nothing here touches a real account or library.
import { writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { APP, completeOnboarding, confirmEmail, seedDemo, signUp, uniqueEmail } from "../e2e/helpers";

const DELAYS = (process.env.FEEL_DELAYS ?? "0,130").split(",").map(Number);
const NOTES = Number(process.env.FEEL_NOTES ?? 300);
const CONTROL = `http://127.0.0.1:${process.env.PERF_PROXY_CONTROL ?? 3399}/`;
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

type Run = { t0: number; first: number; last: number; ready: number; n: number; log: [number, string][] };
type Feel = { run: Run | null; test: (() => boolean) | null; start: { shell: number; firstNote: number; last: number } };

/** The page's own stopwatch, before any of its scripts. */
function instrument() {
  const f: Feel = { run: null, test: null, start: { shell: 0, firstNote: 0, last: 0 } };
  Object.defineProperty(window, "__feel", { value: f });
  // What an input waits for: the first change on the page after it, the last one, and the frame `test` first holds.
  const input = (e: Event) => {
    if (f.run && !f.run.t0 && e.isTrusted) f.run.t0 = e.timeStamp;
  };
  addEventListener("click", input, true);
  addEventListener("keydown", input, true);
  // Where a change happened: the nearest named region and the element itself, short.
  const where = (n: Node | null) => {
    const el = n instanceof Element ? n : (n?.parentElement ?? null);
    if (!el) return "?";
    const region = el.closest("[role=dialog],[role=menu],nav,aside,header,main,[aria-label]");
    const name = (e: Element) => `${e.tagName.toLowerCase()}${e.getAttribute("aria-label") ? `[${e.getAttribute("aria-label")!.slice(0, 24)}]` : ""}`;
    return `${region ? name(region) : "body"} > ${name(el)}.${String(el.className?.toString?.() ?? "").split(" ")[0]?.slice(0, 24) ?? ""}`;
  };
  const seen = (records: MutationRecord[]) => {
    const at = where(records[0]?.target ?? null);
    requestAnimationFrame((t) => {
      f.start.last = t;
      const r = f.run;
      if (!r || !r.t0) return;
      if (!r.first) r.first = t;
      r.last = t;
      r.n++;
      if (r.log.length < 30) r.log.push([Math.round(t - r.t0), at]);
    });
  };
  const watch = () => new MutationObserver(seen).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  if (document.documentElement) watch();
  else addEventListener("DOMContentLoaded", watch);
  const tick = (t: number) => {
    if (!f.start.shell && document.querySelector('nav[aria-label="Folio"]')) f.start.shell = t;
    if (!f.start.firstNote && document.querySelector("main a[href^='/d/']")) f.start.firstNote = t;
    const r = f.run;
    if (r && r.t0 && !r.ready && f.test) {
      try {
        if (f.test()) r.ready = t;
      } catch {
        // Not ready.
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Runs `act` (one click or key) and reports, in ms after it: first change, `ready` holding, and the page going quiet. */
async function timed(page: Page, act: () => Promise<unknown>, ready?: string): Promise<{ first: number; ready: number; settled: number; changes: number; late?: string[] }> {
  await page.evaluate((src) => {
    const f = (window as unknown as { __feel: Feel }).__feel;
    f.test = src ? (new Function(`return (${src})()`) as () => boolean) : null;
    f.run = { t0: 0, first: 0, last: 0, ready: 0, n: 0, log: [] };
  }, ready ?? "");
  await act();
  // Quiet = no change for 700 ms (or 10 s in all).
  await page.waitForFunction(
    (wantReady) => {
      const r = (window as unknown as { __feel: Feel }).__feel.run;
      if (!r || !r.t0) return false;
      const now = performance.now();
      if (now - r.t0 > 10_000) return true;
      if (wantReady && !r.ready) return false;
      return now - Math.max(r.last, r.t0) > 700;
    },
    Boolean(ready),
    { timeout: 30_000, polling: 100 },
  );
  return page.evaluate(() => {
    const f = (window as unknown as { __feel: Feel }).__feel;
    const r = f.run!;
    f.run = null;
    const ms = (t: number) => (t ? Math.round(t - r.t0) : -1);
    // FEEL_LATE: what changed more than 80 ms after the input (what arrived late, and where).
    const late = r.log.filter(([t]) => t > 80).map(([t, w]) => `${t} ${w}`);
    return { first: ms(r.first), ready: ms(r.ready), settled: ms(r.last), changes: r.n, ...(late.length ? { late } : {}) };
  });
}

const EDITOR_READY = `() => location.pathname.startsWith("/d/") && [...document.querySelectorAll('.ProseMirror[contenteditable="true"][aria-label="Document body"]')].some((el) => el.getBoundingClientRect().height > 0)`;
const LIST_READY = `() => !location.pathname.startsWith("/d/") && !!document.querySelector("main a[href^='/d/']")`;
const noteLinks = (page: Page) => page.locator("main a[href^='/d/']");
/** The sidebar's Tasks row: its text carries the count ("Tasks38"), its name more. */
const tasksLink = (page: Page) => page.getByRole("navigation", { name: "Folio" }).getByRole("link").filter({ hasText: /^Tasks\d*$/ }).first();
const setDelay = async (ms: number) => void (await fetch(`${CONTROL}?ms=${ms}`));

test("signed in: start, view switches and note opens, near and far", async ({ page, browserName }) => {
  test.setTimeout(1_800_000);
  const results: Record<string, unknown> = { engine: browserName, notes: NOTES, date: new Date().toISOString() };
  await setDelay(0);
  await page.context().addInitScript(instrument);
  page.on("pageerror", (e) => log("PAGE ERROR", e.message.slice(0, 200)));

  // A new account with a small library (test backend only).
  const email = uniqueEmail("feel");
  // WebKit can take the first click before the form is live: sign up again until the inbox page shows.
  await expect(async () => signUp(page, { email, name: "Feel Test" })).toPass({ timeout: 90_000 });
  await confirmEmail(page, email);
  await completeOnboarding(page);
  // The person's profile is made as the app first loads; the seed needs it.
  await expect(async () => seedDemo(email, { notes: NOTES, folders: 12, tags: 8 })).toPass({ timeout: 60_000, intervals: [1000, 2000, 4000] });
  await page.goto(`${APP}/documents`);
  await expect(noteLinks(page).first()).toBeVisible({ timeout: 120_000 });
  log("sidebar:", (await page.getByRole("navigation", { name: "Folio" }).getByRole("link").allTextContents()).map((t) => t.trim().slice(0, 20)).join(" | "));
  // The device copy of the library downloads once; measure after it.
  await page.waitForTimeout(20_000);

  for (const delay of DELAYS) {
    await setDelay(delay);
    const out: Record<string, unknown> = {};
    results[`rtt${delay * 2}`] = out;

    // ---- Start, twice (a reload of All notes with everything cached). ----
    const starts: unknown[] = [];
    for (let i = 0; i < 3; i++) {
      await page.goto(`${APP}/documents`);
      await expect(noteLinks(page).first()).toBeVisible({ timeout: 120_000 });
      await page.waitForTimeout(2500);
      starts.push(
        await page.evaluate(() => {
          const f = (window as unknown as { __feel: Feel }).__feel;
          const fcp = performance.getEntriesByName("first-contentful-paint")[0];
          return { fcp: Math.round(fcp?.startTime ?? -1), shell: Math.round(f.start.shell), firstNote: Math.round(f.start.firstNote) };
        }),
      );
    }
    out.start = starts;
    log(browserName, `rtt ${delay * 2}`, "start", JSON.stringify(starts));

    // ---- Sidebar: each view twice, so the second visit shows what is remembered. ----
    const clicks: Record<string, unknown> = {};
    for (const round of [1, 2]) {
      for (const name of ["Tasks", "All notes", "Home", "Calendar", "All notes"]) {
        // "Tasks" carries its count ("Tasks38").
        const link = name === "Tasks" ? tasksLink(page) : page.getByRole("link", { name, exact: true }).first();
        if (!(await link.count())) continue;
        const key = `${name} #${round}${clicks[`${name} #${round}`] ? "b" : ""}`;
        clicks[key] = await timed(page, () => link.click());
      }
    }
    out.clicks = clicks;
    for (const [k, v] of Object.entries(clicks)) log(browserName, `rtt ${delay * 2}`, k.padEnd(14), JSON.stringify(v));

    // ---- A click that changes something: check a task off, and on again. ----
    const tasks = tasksLink(page);
    if (await tasks.count()) {
      await tasks.click();
      const box = page.getByRole("checkbox", { name: /^Mark “.*” as done$/ }).first();
      if (await box.isVisible({ timeout: 15_000 }).catch(() => false)) {
        const toggles: unknown[] = [];
        for (let i = 0; i < 3; i++) {
          const target = page.getByRole("checkbox", { name: /^Mark “.*” as done$/ }).nth(i);
          await target.evaluate((el) => el.setAttribute("data-feel", "task"));
          const SHOWN = `() => { const el = document.querySelector('[data-feel="task"]'); return !el || el.getAttribute("aria-checked") === "true"; }`;
          toggles.push(await timed(page, () => target.click(), SHOWN));
          await page.evaluate(() => document.querySelector('[data-feel="task"]')?.removeAttribute("data-feel"));
          await page.waitForTimeout(600);
        }
        out.taskCheck = toggles;
        log(browserName, `rtt ${delay * 2}`, "task check-off", JSON.stringify(toggles.map((t) => (t as { ready: number }).ready)));
      }
      await page.getByRole("link", { name: "All notes", exact: true }).first().click();
      await expect(noteLinks(page).first()).toBeVisible();
    }

    // ---- Notes: open three by keyboard (nothing warmed by a hover), back, and the same three again. ----
    const opens: Record<string, unknown> = {};
    for (const round of [1, 2]) {
      for (let i = 0; i < 3; i++) {
        const link = noteLinks(page).nth(i + (delay ? 3 : 0));
        await link.scrollIntoViewIfNeeded();
        await link.focus();
        opens[`open ${i + 1} #${round}`] = await timed(page, () => page.keyboard.press("Enter"), EDITOR_READY);
        // Back has no click or key to time from: the stopwatch starts as history moves.
        const back = () =>
          page.evaluate(() => {
            (window as unknown as { __feel: Feel }).__feel.run!.t0 = performance.now();
            history.back();
          });
        opens[`back ${i + 1} #${round}`] = await timed(page, back, LIST_READY);
        await expect(noteLinks(page).first()).toBeVisible();
        await page.waitForTimeout(300);
      }
    }
    out.notes = opens;
    for (const [k, v] of Object.entries(opens)) log(browserName, `rtt ${delay * 2}`, k.padEnd(14), JSON.stringify(v));
  }
  await setDelay(0);
  if (process.env.PERF_OUT) writeFileSync(process.env.PERF_OUT.replace(/\.json$/, `-${browserName}.json`), JSON.stringify(results, null, 2));
});
