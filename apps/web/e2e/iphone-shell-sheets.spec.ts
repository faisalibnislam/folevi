// The iPhone app's Notifications and Account sheets, frame by frame (CPU slowed 4x), and the iPad's bell
// popover: a sheet comes up from the bottom on its first frame (it was drawn at the top of the screen first and
// then snapped down: WebKit misplaced its calc() keyframes), Notifications opens on the list itself (kept warm,
// no placeholder) with All / Unread, Mark all read and the settings on one toolbar row, both sheets slide away
// when closed, and on iPad the bell's popover appears in place under the bell. Strips of frames go to
// $FOLEVI_SHOTS when it's set.
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { newPerson, openShare, pick } from "./helpers";
import { cameInFromBelow, installFrameProbe, record, saveFrames, saveStrip, turnsBack, type Recording } from "./sheetFrames";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FoleviiOS/1.0";
const IPAD_UA = "Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FoleviiOS/1.0";
const SHOTS = process.env.FOLEVI_SHOTS;

function fakeBridge() {
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
  };
  Object.defineProperty(window, "foleviNative", { value: bridge });
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

async function shareWelcome(page: Page, email: string, name: string) {
  await openShare(page);
  const share = page.getByRole("dialog", { name: /Share/ });
  await share.getByLabel("Email address").fill(email);
  await pick(share.getByLabel("Role"), "Can edit");
  await share.getByRole("button", { name: "Share", exact: true }).click();
  await expect(share.getByText(name)).toBeVisible();
  await share.getByRole("button", { name: "Close" }).click();
}

/** Someone with a notification waiting (a note shared with them), signed in on a phone or a tablet. */
async function personWithNews(browser: Browser, notes = 1): Promise<{ state: Awaited<ReturnType<BrowserContext["storageState"]>>; close: () => Promise<void> }> {
  const reader = await newPerson(browser, "Sam Reader");
  const owner = await newPerson(browser, "Avery Owner");
  await shareWelcome(owner.page, reader.email, "Sam Reader");
  // More notes shared, one notification each (enough to fill a sheet).
  for (let i = 1; i < notes; i++) {
    await owner.page.getByRole("button", { name: "New note", exact: true }).first().click();
    await owner.page.waitForURL(/\/d\/[0-9A-Z]{26}/);
    await owner.page.getByRole("textbox", { name: "Title" }).fill(`Shared plan ${i}`);
    await owner.page.waitForTimeout(400);
    await shareWelcome(owner.page, reader.email, "Sam Reader");
  }
  const state = await reader.context.storageState();
  return {
    state,
    close: async () => {
      await reader.context.close();
      await owner.context.close();
    },
  };
}

async function device(browser: Browser, state: Awaited<ReturnType<BrowserContext["storageState"]>>, kind: "iphone" | "ipad", opts: { viewport?: { width: number; height: number }; safe?: { top: number; bottom: number } } = {}) {
  const context = await browser.newContext({
    storageState: state,
    viewport: opts.viewport ?? (kind === "iphone" ? { width: 402, height: 874 } : { width: 1180, height: 820 }),
    userAgent: kind === "iphone" ? IPHONE_UA : IPAD_UA,
    hasTouch: true,
    isMobile: kind === "iphone",
  });
  await context.addInitScript(fakeBridge);
  await context.addInitScript(installFrameProbe);
  const page = await context.newPage();
  // The status bar's and the home indicator's insets, as the phone has them (env(safe-area-inset-*)).
  if (opts.safe) await (await context.newCDPSession(page)).send("Emulation.setSafeAreaInsetsOverride" as never, { insets: { top: opts.safe.top, bottom: opts.safe.bottom, left: 0, right: 0 } } as never);
  await page.goto("/documents");
  if (kind === "iphone") {
    await expect(page.locator("html")).toHaveAttribute("data-iphone", "", { timeout: 60_000 });
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible({ timeout: 60_000 });
  } else {
    await expect(page.locator("html")).toHaveAttribute("data-ipad", "", { timeout: 60_000 });
  }
  return { context, page };
}

async function keep(browser: Browser, rec: Recording, name: string) {
  if (!SHOTS) return;
  await saveStrip(browser, rec, `${SHOTS}/${name}.png`);
  saveFrames(rec, `${SHOTS}/${name}.json`);
}

const PROBE = { panel: '[data-iphone-sheet="sheet"]', skeleton: '[aria-label="Loading notifications"]', show: '[data-iphone-sheet] [role="group"][aria-label="Show"]', markAll: "[data-iphone-sheet] [data-mark-all]" };

test("iPhone: Notifications and Account come up from the bottom, open on their content and slide away", async ({ browser, browserName }) => {
  test.skip(browserName !== "chromium", "Frames go through Chromium's DevTools protocol.");
  test.setTimeout(240_000);
  const news = await personWithNews(browser);
  const { context, page } = await device(browser, news.state, "iphone");
  const H = 874;
  const sheet = page.locator('[data-iphone-sheet="sheet"]');
  // The bell's list is kept warm in the background.
  await page.waitForTimeout(1500);

  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    // Notifications.
    let rec = await record(page, PROBE);
    await page.getByRole("button", { name: /^Notifications/ }).tap();
    await expect(sheet.getByText("shared", { exact: false }).first()).toBeVisible();
    await page.waitForTimeout(900);
    let r = await rec.stop();
    await keep(browser, r, `notifications-open-${theme}`);
    expect(cameInFromBelow(r.frames, "panel", H)).toEqual([]);
    // Never the placeholder: the list was already there.
    expect(r.frames.filter((f) => f.boxes.skeleton).length).toBe(0);
    // All / Unread and Mark all read on one row.
    const last = r.frames[r.frames.length - 1]!;
    expect(Math.abs((last.boxes.show!.top + last.boxes.show!.bottom) / 2 - (last.boxes.markAll!.top + last.boxes.markAll!.bottom) / 2)).toBeLessThanOrEqual(2);
    rec = await record(page, PROBE);
    await sheet.getByRole("button", { name: "Close" }).tap();
    await expect(sheet).toHaveCount(0);
    r = await rec.stop();
    await keep(browser, r, `notifications-close-${theme}`);
    expect(turnsBack(r.frames, "panel")).toEqual([]);
    expect(r.frames.filter((f) => f.boxes.panel).length).toBeGreaterThan(4);

    // Account.
    rec = await record(page, PROBE);
    await page.getByRole("button", { name: /account and places$/ }).tap();
    await expect(sheet.getByRole("heading", { name: "Account" })).toBeVisible();
    await page.waitForTimeout(900);
    r = await rec.stop();
    await keep(browser, r, `account-open-${theme}`);
    expect(cameInFromBelow(r.frames, "panel", H)).toEqual([]);
    rec = await record(page, PROBE);
    await sheet.getByRole("button", { name: "Close" }).tap();
    await expect(sheet).toHaveCount(0);
    r = await rec.stop();
    await keep(browser, r, `account-close-${theme}`);
    expect(turnsBack(r.frames, "panel")).toEqual([]);
  }
  await context.close();
  await news.close();
});

test("iPad: the bell's popover and the account menu appear in place, anchored to their buttons", async ({ browser, browserName }) => {
  test.skip(browserName !== "chromium", "Frames go through Chromium's DevTools protocol.");
  test.setTimeout(240_000);
  const news = await personWithNews(browser);
  const { context, page } = await device(browser, news.state, "ipad");
  const probe = { pop: "[popover]:popover-open, [role='menu']" };
  for (const [w, h] of [
    [1180, 820],
    [820, 1180],
  ]) {
    await page.setViewportSize({ width: w!, height: h! });
    await page.waitForTimeout(500);
    const bell = page.getByRole("button", { name: /^Notifications/ }).first();
    await expect(bell).toBeVisible();
    const b = (await bell.boundingBox())!;
    const rec = await record(page, probe);
    await bell.tap();
    await expect(page.getByRole("dialog", { name: "Notifications" })).toBeVisible();
    await page.waitForTimeout(700);
    const r = await rec.stop();
    await keep(browser, r, `ipad-notifications-${w}x${h}`);
    const shown = r.frames.filter((f) => f.boxes.pop);
    expect(shown.length).toBeGreaterThan(0);
    // From its first frame it's under the bell, and it doesn't move off somewhere else.
    for (const f of shown) {
      expect(Math.abs(f.boxes.pop!.top - (b.y + b.height + 8))).toBeLessThanOrEqual(10);
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  await context.close();
  await news.close();
});

/** How far the screen's pixels in a box stray from a colour (the largest channel difference, 0 to 255). */
async function strayFrom(page: Page, box: { x: number; y: number; width: number; height: number }, color: string): Promise<number> {
  const png = (await page.screenshot({ clip: box })).toString("base64");
  return page.evaluate(
    async ({ png, color }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d")!;
      g.drawImage(img, 0, 0);
      const probe = document.createElement("canvas").getContext("2d")!;
      probe.fillStyle = color;
      probe.fillRect(0, 0, 1, 1);
      const [r, gg, b] = probe.getImageData(0, 0, 1, 1).data;
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let worst = 0;
      for (let i = 0; i < d.length; i += 4) worst = Math.max(worst, Math.abs(d[i]! - r!), Math.abs(d[i + 1]! - gg!), Math.abs(d[i + 2]! - b!));
      return worst;
    },
    { png, color },
  );
}

for (const size of [
  { width: 440, height: 956, safe: { top: 62, bottom: 34 }, name: "16 Pro Max" },
  { width: 375, height: 667, safe: { top: 20, bottom: 0 }, name: "SE" },
]) test(`iPhone ${size.name}: sheets reach the screen's bottom edge, their lists scroll clear of the home indicator`, async ({ browser, browserName }) => {
  test.skip(browserName !== "chromium", "The safe-area insets are set through Chromium's DevTools protocol.");
  test.setTimeout(300_000);
  const news = await personWithNews(browser, 6);
  const { context, page } = await device(browser, news.state, "iphone", { viewport: { width: size.width, height: size.height }, safe: size.safe });
  const W = size.width;
  const H = size.height;
  const sheet = page.locator('[data-iphone-sheet="sheet"]');
  await page.waitForTimeout(1500);
  const edges = async () => {
    const b = (await sheet.boundingBox())!;
    expect(Math.abs(b.y + b.height - H)).toBeLessThanOrEqual(1);
    expect(b.x).toBeLessThanOrEqual(1);
    expect(Math.abs(b.x + b.width - W)).toBeLessThanOrEqual(1);
  };
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    // Notifications: the list scrolls its last row clear of the home indicator, and below it is the sheet.
    await page.getByRole("button", { name: /^Notifications/ }).tap();
    await expect(sheet.getByText("shared", { exact: false }).first()).toBeVisible();
    await page.waitForTimeout(900);
    await edges();
    const surface = await sheet.evaluate((el) => getComputedStyle(el).backgroundColor);
    const list = sheet.locator('section[role="dialog"] > div.overflow-y-auto');
    await list.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.waitForTimeout(300);
    const last = (await sheet.locator("li").last().boundingBox())!;
    expect(last.y + last.height).toBeLessThanOrEqual(H - size.safe.bottom + 1);
    const below = { x: 24, y: Math.ceil(last.y + last.height + 2), width: W - 48, height: Math.max(1, Math.floor(H - (last.y + last.height) - 4)) };
    expect(await strayFrom(page, below, surface)).toBeLessThanOrEqual(6);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/edge-notifications-${size.width}-${scheme}.png` });
    await sheet.getByRole("button", { name: "Close" }).tap();
    await expect(sheet).toHaveCount(0);

    // Account: the same, its last row (Sign out) clear of the home indicator once scrolled to the end.
    await page.getByRole("button", { name: /account and places$/ }).tap();
    await expect(sheet.getByRole("heading", { name: "Account" })).toBeVisible();
    await page.waitForTimeout(900);
    await edges();
    const body = sheet.locator("header + div, header ~ div.overflow-y-auto").last();
    await body.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.waitForTimeout(300);
    const out = (await sheet.getByRole("button", { name: /^Sign out/ }).boundingBox())!;
    expect(out.y + out.height).toBeLessThanOrEqual(H - size.safe.bottom + 1);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/edge-account-${size.width}-${scheme}.png` });
    await sheet.getByRole("button", { name: "Close" }).tap();
    await expect(sheet).toHaveCount(0);

    // Foli AI: the composer sits above the home indicator, the sheet below it to the edge.
    await page.getByRole("group", { name: "Create" }).getByRole("button", { name: "Foli AI" }).tap();
    await expect(sheet.getByRole("textbox")).toBeVisible();
    await page.waitForTimeout(900);
    await edges();
    const dock = (await sheet.locator("[data-sheet-dock]").boundingBox())!;
    expect(dock.y + dock.height).toBeLessThanOrEqual(H - size.safe.bottom + 1);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/edge-ai-${size.width}-${scheme}.png` });
    await sheet.getByRole("button", { name: "Close" }).tap();
    await expect(sheet).toHaveCount(0);
  }
  await context.close();
  await news.close();
});
