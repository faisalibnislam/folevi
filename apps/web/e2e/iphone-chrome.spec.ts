// The iPhone app's chrome around the content (docs/IOS_PERFORMANCE.md, owner's requests of 2026-10-24): nothing
// fades the content out above the floating tab bar; the large title never runs under the bar's avatar or its
// buttons at any scroll; a note fills the screen's width under a neutral top bar (its colour starts below the
// bar, never behind the status bar or the buttons). Local mode, a FakeShell and a stand-in iOS bridge, at the
// iPhone 16 Pro Max's size:
//   E2E_LOCAL_BASE_URL=http://localhost:3003 E2E_BASE_URL=http://app.localhost:3002 E2E_NO_SERVER=1 \
//     npx playwright test e2e/iphone-chrome.spec.ts --project local
import type { Browser, Page, TestInfo } from "@playwright/test";
import { expect, prepareContext, test } from "./fixtures/localShell";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FoleviiOS/1.0";

function iosBridge() {
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
  // A production export reads only the app's own `foleviShell`: the FakeShell is it.
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
}

let n = 0;
async function iphone(browser: Browser, testInfo: TestInfo, colorScheme: "light" | "dark" = "light") {
  const context = await browser.newContext({ viewport: { width: 440, height: 956 }, userAgent: IPHONE_UA, hasTouch: true, isMobile: true, colorScheme });
  await prepareContext(context, testInfo, { libraryName: `iphone-chrome-${Date.now()}-${n++}`, platform: "ios" });
  await context.addInitScript(iosBridge);
  const page = await context.newPage();
  await page.goto("/documents");
  await expect(page.locator("html")).toHaveAttribute("data-iphone", "", { timeout: 60_000 });
  await expect(page.locator("main a[href^='/d/']").first()).toBeVisible({ timeout: 60_000 });
  return { context, page };
}

/** Whether two boxes overlap (by more than half a point). */
const overlaps = (a: DOMRect | { left: number; right: number; top: number; bottom: number }, b: { left: number; right: number; top: number; bottom: number }) =>
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;

/**
 * What lies over the bottom 140 points of the screen besides the tab bar's capsules: a fade, a scrim, any wide
 * layer with a colour or a gradient that isn't the screen's own content (should be nothing).
 */
function bottomCovers(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const pills = [...document.querySelectorAll<HTMLElement>(".iphone-tab-pill")];
    const band = innerHeight - 140;
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (el.closest("main") || pills.some((p) => p.contains(el) || el.contains(p))) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom <= band || r.top >= innerHeight || r.width < innerWidth * 0.4) continue;
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) continue;
      const fill = st.backgroundImage !== "none" || !/rgba\(0, 0, 0, 0\)|transparent/.test(st.backgroundColor);
      // (The screen's own frame fills the whole screen under the content; only what sits over it counts.)
      if (fill && r.height < innerHeight * 0.9) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`);
    }
    return out;
  });
}

test.describe("the iPhone app's chrome", { tag: "@local" }, () => {
  test.beforeEach(({ backendMode }) => {
    test.skip(backendMode !== "local", "local mode only");
  });

  test("no fade over the bottom of the screen, and the large title never under the bar's buttons @local", async ({ browser }, testInfo) => {
    test.setTimeout(180_000);
    for (const scheme of ["light", "dark"] as const) {
      const { context, page } = await iphone(browser, testInfo, scheme);
      // Content shows at full strength right down to the tab bar's capsules, which are glass of their own.
      expect(await bottomCovers(page)).toEqual([]);
      await expect(page.locator(".iphone-tab-pill")).toHaveCount(2);
      const main = page.locator("main#main");
      await main.evaluate((m) => (m.scrollTop = m.scrollHeight));
      await page.waitForTimeout(200);
      expect(await bottomCovers(page)).toEqual([]);

      // The large title, at every scroll near the top: wherever it shows, it's clear of the avatar and the "…" pill.
      const title = page.getByRole("heading", { level: 1, name: "Home" });
      const avatar = page.getByRole("button", { name: /account and places/ });
      const more = page.locator("header [role='group'], header .ui-liquid").last();
      for (const y of [0, 4, 8, 12, 16, 20, 24, 30, 36, 42, 48, 56, 64, 80, 120]) {
        await main.evaluate((m, v) => (m.scrollTop = v), y);
        await page.waitForTimeout(80);
        const [t, a, p, shown, bar] = await Promise.all([
          title.evaluate((el) => el.getBoundingClientRect().toJSON()),
          avatar.evaluate((el) => el.getBoundingClientRect().toJSON()),
          more.evaluate((el) => el.getBoundingClientRect().toJSON()),
          // Visible: neither faded out nor hidden under the bar's (solid) material.
          title.evaluate((el) => Number(getComputedStyle(el).opacity)),
          page.locator(".iphone-bar").first().evaluate((el) => ({ on: el.hasAttribute("data-on"), bottom: el.getBoundingClientRect().bottom })),
        ]);
        if (shown < 0.05) continue;
        // What of the title is drawn: below the bar once the bar's material is on.
        const drawn = bar.on ? { ...t, top: Math.max(t.top, bar.bottom) } : t;
        if (drawn.bottom <= drawn.top) continue;
        expect(overlaps(drawn, a), `the title under the avatar at ${y}`).toBe(false);
        expect(overlaps(drawn, p), `the title under the "…" pill at ${y}`).toBe(false);
      }
      // Scrolled away, the small title sits centred in the bar between the avatar and the pill.
      await main.evaluate((m) => (m.scrollTop = 400));
      const small = page.locator(".iphone-small-title");
      await expect.poll(() => small.evaluate((el) => Number(getComputedStyle(el).opacity))).toBe(1);
      const s = await small.evaluate((el) => el.getBoundingClientRect().toJSON());
      expect(overlaps(s, await avatar.evaluate((el) => el.getBoundingClientRect().toJSON()))).toBe(false);
      expect(overlaps(s, await more.evaluate((el) => el.getBoundingClientRect().toJSON()))).toBe(false);
      await context.close();
    }
  });

  test("a note with a theme fills the screen's width under a neutral bar, its colour starting below it @local", async ({ browser }, testInfo) => {
    test.setTimeout(180_000);
    for (const scheme of ["light", "dark"] as const) {
      const { context, page } = await iphone(browser, testInfo, scheme);
      await page.locator("main a[href^='/d/']", { hasText: /Welcome to Folevi/ }).first().tap();
      await expect(page.getByRole("textbox", { name: "Document body" })).toBeVisible();
      // A dark theme with its own artwork.
      await page.getByRole("button", { name: "Style", exact: true }).tap();
      const style = page.getByRole("dialog", { name: "Style" });
      await style.getByRole("radiogroup", { name: "Note theme" }).getByRole("radio", { name: "Navy crackle" }).tap();
      await style.getByRole("button", { name: "Close" }).first().tap();
      await expect(style).toHaveCount(0);
      const scroller = page.locator("#doc-scroll");
      await expect(scroller).toHaveAttribute("data-backdrop", /on|blur/);
      const canvas = await page.evaluate(() => {
        const probe = document.createElement("div");
        probe.style.background = "var(--color-canvas)";
        document.body.appendChild(probe);
        const c = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return c;
      });
      // The page edge to edge.
      const sheet = scroller.locator("> .fb-sheet");
      const box = await sheet.evaluate((el) => el.getBoundingClientRect().toJSON());
      expect(Math.round(box.left)).toBe(0);
      expect(Math.round(box.right)).toBe(440);
      // Above it, under the status bar and the bar's buttons: the app's neutral colour, not the note's.
      expect(await scroller.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(canvas);
      const back = page.getByRole("button", { name: "Back", exact: true });
      const nav = await back.evaluate((el) => el.closest("header")!.getBoundingClientRect().toJSON());
      // The cover band (the sheet's top) starts right below the bar's row.
      expect(Math.abs(box.top - (nav.bottom + 4))).toBeLessThanOrEqual(4);
      // Scrolled, the bar's material is the neutral colour too.
      await scroller.evaluate((el) => (el.scrollTop = 400));
      const bar = page.locator(".iphone-bar").last();
      await expect(bar).toHaveAttribute("data-on", "");
      expect(await bar.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(canvas);
      await context.close();
    }
  });

  test("a note opens out of its card and Back shrinks it into the card again; Reduce Motion cross-fades @local", async ({ browser }, testInfo) => {
    test.setTimeout(180_000);
    const { context, page } = await iphone(browser, testInfo);
    // Every animation started, with its keyframes.
    await page.evaluate(() => {
      const seen: { target: string; frames: Keyframe[] }[] = [];
      (window as unknown as { __anims: typeof seen }).__anims = seen;
      const orig = Element.prototype.animate;
      Element.prototype.animate = function (this: Element, keyframes, options) {
        const frames = (Array.isArray(keyframes) ? keyframes : []) as Keyframe[];
        seen.push({ target: this.hasAttribute("data-iphone-zoom") ? "note" : this.hasAttribute("data-iphone-picture") ? "picture" : this.tagName, frames: JSON.parse(JSON.stringify(frames)) });
        return orig.call(this, keyframes, options);
      };
    });
    const anims = () => page.evaluate(() => (window as unknown as { __anims: { target: string; frames: Keyframe[] }[] }).__anims.splice(0));
    const card = page.locator("main a[href^='/d/']", { hasText: /Welcome to Folevi/ }).first();
    const box = (await card.boundingBox())!;
    await card.tap();
    await expect(page.getByRole("textbox", { name: "Document body" })).toBeVisible();
    const opened = await anims();
    const grow = opened.find((a) => a.target === "note" && String(a.frames[0]?.transform ?? "").includes("scale("));
    expect(grow, JSON.stringify(opened.map((a) => a.target))).toBeTruthy();
    // From the card's box (as pressed: a few points in from its resting box)...
    const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/.exec(String(grow!.frames[0]!.transform))!;
    expect(Math.abs(Number(m[1]) - box.x)).toBeLessThan(8);
    expect(Math.abs(Number(m[2]) - box.y)).toBeLessThan(8);
    expect(Math.abs(Number(m[3]) - box.width / 440)).toBeLessThan(0.03);
    // ...to the whole screen.
    expect(String(grow!.frames.at(-1)!.transform)).toContain("scale(1)");
    expect(String(grow!.frames.at(-1)!.clipPath)).toContain("inset(0px 0px 0px 0px");
    // The screen behind steps back.
    expect(opened.some((a) => a.target === "picture" && String(a.frames.at(-1)?.transform).includes("scale(0.94)"))).toBe(true);
    await page.waitForTimeout(800);

    // Back: the note shrinks into the card (the picture of it ends at the card's resting box).
    await page.getByRole("button", { name: "Back", exact: true }).tap();
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    const closed = await anims();
    const shrink = closed.find((a) => a.target === "picture" && String(a.frames.at(-1)?.transform ?? "").includes("translate("));
    expect(shrink, JSON.stringify(closed.map((a) => a.target))).toBeTruthy();
    // (Measured once Home has stepped forward again.)
    await page.waitForTimeout(900);
    const back = (await card.boundingBox())!;
    const e = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(String(shrink!.frames.at(-1)!.transform))!;
    expect(Math.abs(Number(e[1]) - back.x)).toBeLessThan(4);
    expect(Math.abs(Number(e[2]) - back.y)).toBeLessThan(4);
    await page.waitForTimeout(800);

    // Reduce Motion: a cross-fade, nothing grows or moves.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await card.tap();
    await expect(page.getByRole("textbox", { name: "Document body" })).toBeVisible();
    const faded = await anims();
    expect(faded.some((a) => a.frames.some((f) => "transform" in f))).toBe(false);
    expect(faded.some((a) => a.frames.some((f) => "opacity" in f))).toBe(true);
    await context.close();
  });
});
