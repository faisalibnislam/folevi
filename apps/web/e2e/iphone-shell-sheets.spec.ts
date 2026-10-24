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
async function personWithNews(browser: Browser): Promise<{ state: Awaited<ReturnType<BrowserContext["storageState"]>>; close: () => Promise<void> }> {
  const reader = await newPerson(browser, "Sam Reader");
  const owner = await newPerson(browser, "Avery Owner");
  await shareWelcome(owner.page, reader.email, "Sam Reader");
  const state = await reader.context.storageState();
  return {
    state,
    close: async () => {
      await reader.context.close();
      await owner.context.close();
    },
  };
}

async function device(browser: Browser, state: Awaited<ReturnType<BrowserContext["storageState"]>>, kind: "iphone" | "ipad") {
  const context = await browser.newContext({
    storageState: state,
    viewport: kind === "iphone" ? { width: 402, height: 874 } : { width: 1180, height: 820 },
    userAgent: kind === "iphone" ? IPHONE_UA : IPAD_UA,
    hasTouch: true,
    isMobile: kind === "iphone",
  });
  await context.addInitScript(fakeBridge);
  await context.addInitScript(installFrameProbe);
  const page = await context.newPage();
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
