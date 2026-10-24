// A tap on a folder tile opens the folder; only a long press opens its menu (owner's device, 2026-10-24: "Tapping
// on the folder randomly brings up the context menu"). The tile's "…" is out of sight on the iPhone but sat in the
// middle of the cover still taking taps, so a tap that landed there opened the menu. Now: quick taps anywhere on
// the tile open the folder, a tap right after flinging the row opens no menu, a still 600 ms press opens it, and a
// press that moves on is a scroll, not a hold.
import { expect, test, type Page } from "@playwright/test";
import { APP, newPerson } from "./helpers";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FoleviiOS/1.0";

function fakeBridge() {
  const bridge = {
    platform: "ios",
    version: "1.0",
    haptic: () => undefined,
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
  // Like Safari on iOS: no right-click of the browser's own for a long press (Chromium sends one). A trackpad's
  // or mouse's right-click is sent as usual.
  let lastPointer = "";
  window.addEventListener("pointerdown", (e) => (lastPointer = e.pointerType), true);
  window.addEventListener("contextmenu", (e) => (e.isTrusted && lastPointer === "touch" ? (e.stopImmediatePropagation(), e.preventDefault()) : undefined), true);
  const hideBadge = () => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal { display: none !important; }";
    document.head.appendChild(style);
  };
  if (document.head) hideBadge();
  else document.addEventListener("DOMContentLoaded", hideBadge, { once: true });
}

/** A real finger (Chromium's touch input): down at a point, along an optional path, up after `ms`. */
async function finger(page: Page, x: number, y: number, ms: number, path: { x: number; y: number }[] = []) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (const p of path) {
    await page.waitForTimeout(16);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [p] });
  }
  await page.waitForTimeout(ms);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

test("iPhone Home: a tap on a folder tile opens it, never its menu; a still hold does", async ({ browser, browserName }) => {
  test.skip(browserName !== "chromium", "Touch input is driven through Chromium's DevTools protocol.");
  test.setTimeout(240_000);
  const { context: signedIn, page: setup } = await newPerson(browser, "Tapping Person");
  const state = await signedIn.storageState();
  void setup;
  await signedIn.close();

  const context = await browser.newContext({ storageState: state, viewport: { width: 402, height: 874 }, userAgent: IPHONE_UA, hasTouch: true, isMobile: true });
  await context.addInitScript(fakeBridge);
  const page = await context.newPage();
  await page.goto(`${APP}/documents`);
  await expect(page.locator("html")).toHaveAttribute("data-iphone", "", { timeout: 30_000 });

  // A folder of its own (the account also starts with two), named as on the owner's phone.
  await page.getByRole("button", { name: "Create" }).click();
  await page.getByRole("menu", { name: "Create" }).getByRole("menuitem", { name: "New folder" }).click();
  const sheet = page.getByRole("dialog", { name: "New folder" });
  await sheet.getByPlaceholder("Folder name").fill("Airly.io");
  await sheet.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Airly.io" })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

  const row = page.getByRole("list", { name: "Folders" });
  const tiles = row.getByRole("listitem");
  await expect(tiles).toHaveCount(3, { timeout: 20_000 });
  const menu = page.getByRole("menu");

  const tileAt = async (i: number) => {
    const tile = tiles.nth(i);
    await tile.evaluate((el) => el.scrollIntoView({ block: "center", inline: "nearest" }));
    // (Still, after the screen's push or pop and the scroll.)
    let last = "";
    for (;;) {
      await page.waitForTimeout(150);
      const b = (await tile.boundingBox())!;
      const key = JSON.stringify(b);
      if (key === last) return b;
      last = key;
    }
  };

  // The hidden "…" in the middle of the cover takes no taps: what's under a finger there is the folder's link.
  const box = await tileAt(0);
  const hit = await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x!, y!);
    return { link: !!el?.closest('a[href^="/folders/"]'), button: !!el?.closest('button[aria-haspopup="menu"]') };
  }, [box.x + box.width / 2, box.y + box.height * 0.7]);
  expect(hit).toEqual({ link: true, button: false });

  // 20 quick taps, over each tile and at different spots on it (the cover's middle where the "…" sits too): each
  // opens the folder and none opens a menu.
  const spots = [
    [0.5, 0.7],
    [0.5, 0.5],
    [0.3, 0.85],
    [0.7, 0.3],
    [0.5, 0.6],
  ] as const;
  for (let i = 0; i < 20; i++) {
    const b = await tileAt(i % 3);
    const [fx, fy] = spots[i % spots.length]!;
    await finger(page, b.x + b.width * fx, b.y + b.height * fy, 60 + (i % 4) * 70);
    await expect(page, `tap ${i}`).toHaveURL(/\/folders\/[0-9A-Z]{26}$/, { timeout: 10_000 });
    await expect(menu).toHaveCount(0);
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  }

  // A fling along the row, then a tap at once: no menu.
  const r = await tileAt(1);
  const y = r.y + r.height / 2;
  await finger(page, 360, y, 0, [
    { x: 300, y },
    { x: 220, y },
    { x: 140, y },
    { x: 60, y },
  ]);
  await finger(page, 200, y, 80);
  await page.waitForTimeout(700);
  await expect(menu).toHaveCount(0);
  if (/\/folders\//.test(page.url())) await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

  // A press that moves on 30 px (a scroll) opens nothing.
  const m = await tileAt(0);
  await finger(page, m.x + m.width / 2, m.y + m.height / 2, 600, [{ x: m.x + m.width / 2, y: m.y + m.height / 2 - 30 }]);
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

  // A still 600 ms press: the folder's menu, and Home stays.
  const h = await tileAt(0);
  await finger(page, h.x + h.width / 2, h.y + h.height * 0.7, 600);
  await expect(page.getByRole("menu", { name: /^Folder options for / })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  await context.close();
});

const IPAD_UA = "Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FoleviiOS/1.0";

/** An Apple Pencil tap (Chromium's pen input): down and up at a point. */
async function pencil(page: Page, x: number, y: number) {
  const cdp = await page.context().newCDPSession(page);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"] as const) {
    await cdp.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1, pointerType: "pen" });
    await page.waitForTimeout(40);
  }
  await cdp.detach();
}

test("iPad: a finger or Pencil tap on a folder card opens it, a still hold or a right-click opens its menu", async ({ browser, browserName }) => {
  test.skip(browserName !== "chromium", "Touch input is driven through Chromium's DevTools protocol.");
  test.setTimeout(240_000);
  const { context: signedIn } = await newPerson(browser, "iPad Tapper");
  const state = await signedIn.storageState();
  await signedIn.close();

  // A touch-only iPad (no trackpad).
  const context = await browser.newContext({ storageState: state, viewport: { width: 1180, height: 820 }, userAgent: IPAD_UA, hasTouch: true, isMobile: true });
  await context.addInitScript(fakeBridge);
  const page = await context.newPage();
  await page.goto(`${APP}/folders`);
  await expect(page.locator("html")).toHaveAttribute("data-native", "ios", { timeout: 30_000 });
  const cards = page.getByRole("list", { name: "Folders" }).getByRole("listitem");
  await expect(cards.first()).toBeVisible({ timeout: 30_000 });
  const count = Math.min(await cards.count(), 2);
  const menu = page.getByRole("menu");
  const cardAt = async (i: number) => {
    const card = cards.nth(i);
    await card.evaluate((el) => el.scrollIntoView({ block: "center" }));
    let last = "";
    for (;;) {
      await page.waitForTimeout(150);
      const b = (await card.boundingBox())!;
      const key = JSON.stringify(b);
      if (key === last) return b;
      last = key;
    }
  };
  const backToFolders = async () => {
    await page.goto(`${APP}/folders`);
    await expect(cards.first()).toBeVisible({ timeout: 30_000 });
  };

  // The hidden "…" over the middle of the cover takes no taps.
  const box = await cardAt(0);
  const hit = await page.evaluate(([x, y]) => !!document.elementFromPoint(x!, y!)?.closest('a[href^="/folders/"]'), [box.x + box.width / 2, box.y + box.height * 0.7]);
  expect(hit).toBe(true);

  // Quick finger taps (including where the "…" sits), then Pencil taps: each opens the folder, never a menu.
  for (let i = 0; i < 10; i++) {
    const b = await cardAt(i % count);
    await finger(page, b.x + b.width / 2, b.y + b.height * (i % 2 ? 0.7 : 0.5), 60 + (i % 4) * 70);
    await expect(page, `tap ${i}`).toHaveURL(/\/folders\/[0-9A-Z]{26}$/, { timeout: 10_000 });
    await expect(menu).toHaveCount(0);
    await backToFolders();
  }
  for (let i = 0; i < 3; i++) {
    const b = await cardAt(i % count);
    await pencil(page, b.x + b.width / 2, b.y + b.height * 0.7);
    await expect(page, `pencil ${i}`).toHaveURL(/\/folders\/[0-9A-Z]{26}$/, { timeout: 10_000 });
    await expect(menu).toHaveCount(0);
    await backToFolders();
  }

  // A press that moves on 30 px opens nothing.
  const m = await cardAt(0);
  await finger(page, m.x + m.width / 2, m.y + m.height / 2, 600, [{ x: m.x + m.width / 2, y: m.y + m.height / 2 - 30 }]);
  await expect(menu).toHaveCount(0);

  // A still 600 ms hold: the folder's menu.
  const h = await cardAt(0);
  await finger(page, h.x + h.width / 2, h.y + h.height * 0.7, 600);
  await expect(page.getByRole("menu", { name: /^Folder options for / })).toBeVisible();
  await expect(page).toHaveURL(/\/folders$/);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  // A trackpad or mouse right-click: the same menu. (Not within half a second of the held finger lifting: clicks
  // that soon belong to the hold, lib/touchContextMenu.ts.)
  await page.waitForTimeout(600);
  const r = await cardAt(0);
  await page.mouse.click(r.x + r.width / 2, r.y + r.height * 0.4, { button: "right" });
  await expect(page.getByRole("menu", { name: /^Folder options for / })).toBeVisible();
  await expect(page).toHaveURL(/\/folders$/);
  await context.close();
});
