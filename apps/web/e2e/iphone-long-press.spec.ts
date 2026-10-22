// The iPhone layout's long press and small controls, from the owner's device (2026-10-22): a held folder tile
// lifts, its menu opens beside it and stays open when the finger lifts (the lift opens neither the folder nor
// the item under it), nothing nearby gets selected, a scroll during the press opens nothing, the tile shows
// its name at rest, the top bar's "…" is a plain ellipsis, and the Notifications sheet's header actions are
// 44 pt targets with no ring round the first notification.
import { expect, test, type Page } from "@playwright/test";
import { APP, newPerson } from "./helpers";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FoleviiOS/1.0";

function fakeBridge() {
  const calls: { method: string; arg?: unknown }[] = [];
  const bridge = {
    platform: "ios",
    version: "1.0",
    haptic: (kind: string) => calls.push({ method: "haptic", arg: kind }),
    setStatusBar: () => undefined,
    openExternal: async () => true,
    getSettings: async () => ({ lock: false, lockAfter: 0, method: "faceID" }),
    setSettings: async () => ({ lock: false, lockAfter: 0, method: "faceID" }),
    onCommand: () => () => undefined,
  };
  Object.defineProperty(window, "foleviNative", { value: bridge });
  Object.assign(window, { __native: { calls } });
  const mark = () => document.documentElement?.setAttribute("data-native", "ios");
  mark();
  if (!document.documentElement) new MutationObserver((_, watch) => document.documentElement && (mark(), watch.disconnect())).observe(document, { childList: true });
  // Like Safari on iOS: no right-click of the browser's own for a long press (Chromium sends one).
  window.addEventListener("contextmenu", (e) => (e.isTrusted ? (e.stopImmediatePropagation(), e.preventDefault()) : undefined), true);
  const hideBadge = () => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal { display: none !important; }";
    document.head.appendChild(style);
  };
  if (document.head) hideBadge();
  else document.addEventListener("DOMContentLoaded", hideBadge, { once: true });
}

/** A real finger (Chromium's touch input): down at a point, an optional path, then up after `ms`. */
async function finger(page: Page, x: number, y: number, ms: number, path: { x: number; y: number }[] = []) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (const p of path) {
    await page.waitForTimeout(40);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [p] });
  }
  await page.waitForTimeout(ms);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

test("iPhone: holding a folder tile, the more button, and the Notifications sheet's header", async ({ browser, browserName }) => {
  test.skip(browserName !== "chromium", "Touch input is driven through Chromium's DevTools protocol.");
  test.setTimeout(180_000);
  const { context: signedIn } = await newPerson(browser, "Holding Person");
  const state = await signedIn.storageState();
  await signedIn.close();

  const context = await browser.newContext({ storageState: state, viewport: { width: 402, height: 874 }, userAgent: IPHONE_UA, hasTouch: true, isMobile: true });
  await context.addInitScript(fakeBridge);
  const page = await context.newPage();
  await page.goto(`${APP}/documents`);
  await expect(page.locator("html")).toHaveAttribute("data-iphone", "", { timeout: 30_000 });

  // The top bar's "…": a plain ellipsis (no ring drawn inside the round glass button).
  const more = page.getByRole("button", { name: "More", exact: true });
  await expect(more).toBeVisible();
  expect(await more.evaluate((b) => [b.querySelectorAll(".border-current").length, b.querySelector("svg")?.getAttribute("width")])).toEqual([0, "24"]);
  // Its menu grows out of it: right-aligned under it, from its top-right corner.
  await more.click();
  const moreMenu = page.getByRole("menu", { name: "More" });
  await expect(moreMenu).toBeVisible();
  const [button, menuBox] = [(await more.boundingBox())!, (await moreMenu.boundingBox())!];
  expect(Math.abs(menuBox.x + menuBox.width - (button.x + button.width))).toBeLessThan(10);
  expect(menuBox.y).toBeGreaterThan(button.y + button.height);
  expect(await moreMenu.evaluate((m) => Math.abs(parseFloat(getComputedStyle(m).transformOrigin) - m.offsetWidth) < 1.5 && parseFloat(getComputedStyle(m).transformOrigin.split(" ")[1]!) === 0)).toBe(true);
  await page.keyboard.press("Escape");

  // A folder to hold.
  await page.getByRole("button", { name: "Create" }).click();
  await page.getByRole("menu", { name: "Create" }).getByRole("menuitem", { name: "New folder" }).click();
  const sheet = page.getByRole("dialog", { name: "New folder" });
  await sheet.getByPlaceholder("Folder name").fill("Brainstorming");
  await sheet.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Brainstorming" })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  const tile = page.getByRole("list", { name: "Folders" }).getByRole("listitem").filter({ hasText: "Brainstorming" });
  await tile.evaluate((el) => el.scrollIntoView({ block: "center", inline: "center" }));
  await page.waitForTimeout(400);
  // Its name is on the front cover at rest, drawn by the cover itself (not under its frosted layer).
  const name = tile.getByText("Brainstorming", { exact: true });
  await expect(name).toBeVisible();
  expect(await name.evaluate((el) => getComputedStyle(el.parentElement!).backdropFilter.includes("blur"))).toBe(true);

  const box = (await tile.boundingBox())!;
  const at = { x: box.x + box.width / 2, y: box.y + box.height * 0.6 };

  // A scroll during the press opens nothing.
  await finger(page, at.x, at.y, 300, [
    { x: at.x, y: at.y - 20 },
    { x: at.x, y: at.y - 50 },
  ]);
  await expect(page.getByRole("menu")).toHaveCount(0);

  // Held: the folder's menu, the tile lifted (and felt), nothing selected, still Home after the lift.
  await finger(page, at.x, at.y, 700);
  const menu = page.getByRole("menu", { name: "Folder options for Brainstorming" });
  await expect(menu).toBeVisible();
  await expect(tile.locator("[data-held-lift]")).toHaveCount(1);
  expect(await page.evaluate(() => (window as unknown as { __native: { calls: { method: string; arg?: unknown }[] } }).__native.calls.some((c) => c.method === "haptic"))).toBe(true);
  expect(await page.evaluate(() => getSelection()?.toString() ?? "")).toBe("");
  await page.waitForTimeout(600);
  await expect(menu).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  // Beside the tile, not over it.
  const menuBox2 = (await menu.boundingBox())!;
  const tileBox = (await tile.boundingBox())!;
  expect(menuBox2.y >= tileBox.y + tileBox.height - 1 || menuBox2.y + menuBox2.height <= tileBox.y + 1).toBe(true);
  // An item needs its own tap.
  await menu.getByRole("menuitem", { name: "Rename…" }).tap();
  await expect(page.getByRole("dialog", { name: "Rename folder" })).toBeVisible();
  await page.getByRole("dialog", { name: "Rename folder" }).getByRole("button", { name: "Cancel" }).click();
  // The menu has gone: no lift left, and the tile's "…" isn't left showing.
  await expect(tile.locator("[data-held-lift]")).toHaveCount(0);
  expect(await tile.locator('button[aria-haspopup="menu"]').evaluate((b) => getComputedStyle(b.parentElement!.parentElement!).opacity)).toBe("0");

  // Notifications: 44 pt header actions, and focus on the title (no ring round the first notification).
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const panel = page.getByRole("dialog", { name: "Notifications" }).last();
  await expect(panel.getByRole("button", { name: "Mark all read" })).toBeVisible();
  for (const control of [panel.getByRole("button", { name: "Mark all read" }), panel.getByRole("button", { name: "Notification settings" })]) {
    const b = (await control.boundingBox())!;
    expect(b.height).toBeGreaterThanOrEqual(44);
    expect(b.width).toBeGreaterThanOrEqual(44);
  }
  expect(await panel.getByRole("button", { name: "Mark all read" }).evaluate((b) => parseFloat(getComputedStyle(b).fontSize))).toBeGreaterThanOrEqual(15);
  expect(await page.evaluate(() => document.activeElement?.hasAttribute("data-nav-item") ?? false)).toBe(false);
  await context.close();
});
