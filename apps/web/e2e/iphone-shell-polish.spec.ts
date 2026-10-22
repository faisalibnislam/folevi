// The iPhone layout's shell, lists and Home at the polish plan's numbers (docs/IOS_POLISH_PLAN.md §2, WP1): the
// top bar's material appears once content scrolls under it and the small title fades in with the scroll, the
// floating tab bar is 64 points tall and content fades out above it, Home names no place under its title in
// Personal, note cards show one date, a tapped "…" leaves no focus ring once its menu closes (a keyboard's Tab
// still shows one), rows swipe (part way shows the actions, past 60 % runs the first, felt), Select mode puts
// Select All and the count in the bar and its actions in the tab bar's place, and empty screens are one block.
import { expect, test, type Page } from "@playwright/test";
import { APP, newPerson, seedDemo } from "./helpers";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FoleviiOS/1.0";

function fakeBridge() {
  const calls: { method: string; arg?: unknown }[] = [];
  const bridge = {
    platform: "ios",
    version: "1.0",
    haptic: (kind: string) => calls.push({ method: "haptic", arg: kind }),
    hapticPrepare: () => undefined,
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
  window.addEventListener("contextmenu", (e) => (e.isTrusted ? (e.stopImmediatePropagation(), e.preventDefault()) : undefined), true);
  const hideBadge = () => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal { display: none !important; }";
    document.head.appendChild(style);
  };
  if (document.head) hideBadge();
  else document.addEventListener("DOMContentLoaded", hideBadge, { once: true });
}

const haptics = (page: Page) => page.evaluate(() => (window as unknown as { __native: { calls: { method: string; arg?: unknown }[] } }).__native.calls.filter((c) => c.method === "haptic").map((c) => String(c.arg)));

/** A real finger (Chromium's touch input): down at a point, along a path, then up after `ms`. */
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

/** A horizontal swipe on a row from its middle by `dx` points, in small steps. */
async function swipe(page: Page, row: { x: number; y: number; width: number; height: number }, dx: number) {
  const y = row.y + row.height / 2;
  const x0 = row.x + row.width * (dx < 0 ? 0.85 : 0.15);
  const steps = 14;
  await finger(page, x0, y, 60, Array.from({ length: steps }, (_, i) => ({ x: x0 + (dx * (i + 1)) / steps, y })));
}

/** A ring drawn by Tailwind's focus utilities (a 2 px spread shadow) or an outline. */
const ringOf = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return "none";
    const cs = getComputedStyle(el);
    const ring = /0px 0px 0px [1-9]/.test(cs.boxShadow) ? cs.boxShadow : "";
    const outline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0 ? `outline ${cs.outlineWidth}` : "";
    return ring || outline || "none";
  });

test("iPhone shell polish: bar material, tab bar, Home, cards, focus rings, swipes, Select mode, empty screens", async ({ browser, browserName }) => {
  test.skip(browserName !== "chromium", "Touch input is driven through Chromium's DevTools protocol.");
  test.setTimeout(420_000);
  const { context: signedIn, email } = await newPerson(browser, "Polish Person");
  const state = await signedIn.storageState();
  await signedIn.close();
  seedDemo(email, { notes: 14, folders: 2, tags: 1 });

  const context = await browser.newContext({ storageState: state, viewport: { width: 402, height: 874 }, userAgent: IPHONE_UA, hasTouch: true, isMobile: true });
  await context.addInitScript(fakeBridge);
  const page = await context.newPage();
  await page.goto(`${APP}/documents`);
  await expect(page.locator("html")).toHaveAttribute("data-iphone", "", { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

  // Home: no "Personal" line under the title (the avatar says where you are).
  const titleBlock = page.getByRole("heading", { level: 1, name: "Home" }).locator("..");
  await expect(titleBlock).not.toContainText("Personal");

  // The tab bar: a 64-point capsule; content fades out above it.
  const tabs = page.getByRole("navigation", { name: "Tabs" });
  expect(Math.round((await tabs.boundingBox())!.height)).toBe(64);
  const edge = page.locator(".iphone-tab-edge");
  expect(await edge.evaluate((e) => getComputedStyle(e).backgroundImage)).toContain("linear-gradient");
  expect(Math.round((await edge.boundingBox())!.height)).toBeGreaterThanOrEqual(64 + 24);

  // The bar's material: none at rest, frosted with a hairline once content passes under it; the small title
  // fades in with the scroll.
  const bar = page.locator(".iphone-bar");
  await expect(bar).not.toHaveAttribute("data-on", "");
  expect(await bar.evaluate((b) => getComputedStyle(b).backdropFilter || getComputedStyle(b).getPropertyValue("-webkit-backdrop-filter"))).toContain("blur(20px)");
  const small = page.locator(".iphone-small-title");
  expect(Number(await small.evaluate((s) => getComputedStyle(s).opacity))).toBe(0);
  await page.locator("main#main").evaluate((m) => (m.scrollTop = 20));
  await expect(bar).toHaveAttribute("data-on", "");
  await page.locator("main#main").evaluate((m) => (m.scrollTop = 400));
  await expect.poll(() => small.evaluate((s) => Number(getComputedStyle(s).opacity))).toBe(1);
  await page.locator("main#main").evaluate((m) => (m.scrollTop = 0));
  await expect(bar).not.toHaveAttribute("data-on", "");

  // All notes: cards with one date (the footer's) and the title at 17 points.
  await page.getByRole("link", { name: "All notes" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "All notes" })).toBeVisible();
  const card = page.locator("main li a[href^='/d/']").first();
  await expect(card).toBeVisible();
  await expect(card.locator("[data-card='created']")).toBeHidden();
  await expect(card.locator("[data-card='title']")).toHaveCSS("font-size", "17px");

  // A tapped "…": its menu, then gone, and no ring left on the button.
  const more = page.getByRole("button", { name: "All notes options" });
  await more.tap();
  const menu = page.getByRole("menu", { name: "All notes options" });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitemradio", { name: "List" }).tap();
  await expect(menu).toHaveCount(0);
  expect(await ringOf(page)).toBe("none");
  // A keyboard's Tab shows rings again.
  await page.keyboard.press("Tab");
  await expect(page.locator("html")).toHaveAttribute("data-input", "key");
  // (Tab lands in the search field, which draws no ring; back to the bar's "…".)
  await page.keyboard.press("Shift+Tab");
  await expect(more).toBeFocused();
  await expect.poll(() => ringOf(page)).not.toBe("none");
  await page.getByRole("heading", { level: 1, name: "All notes" }).tap();
  await expect(page.locator("html")).not.toHaveAttribute("data-input", "key");

  // List rows: 64 points, a 15-point second line.
  const rows = page.locator("main ul li");
  const firstRow = rows.first();
  await expect(firstRow.locator("a[href^='/d/']")).toBeVisible();
  const rowBox = (await firstRow.boundingBox())!;
  expect(Math.round(rowBox.height)).toBeGreaterThanOrEqual(64);
  await expect(firstRow.locator("a span.text-muted").first()).toHaveCSS("font-size", "15px");

  // A part swipe left shows Archive and Trash; a tap elsewhere closes it.
  await swipe(page, rowBox, -150);
  await expect(firstRow.getByRole("button", { name: "Trash" })).toBeVisible();
  await expect(firstRow.getByRole("button", { name: "Archive" })).toBeVisible();
  await page.getByRole("heading", { level: 1, name: "All notes" }).tap();
  await expect(firstRow.getByRole("button", { name: "Trash" })).toHaveCount(0);

  // A full swipe left (past 60 %) runs Trash: felt as it crosses, then as it's deleted.
  const count = await rows.count();
  const title = (await firstRow.locator("a span.text-ink").first().textContent())!.trim();
  await swipe(page, rowBox, -rowBox.width * 0.75);
  await expect.poll(() => rows.count()).toBe(count - 1);
  await expect(page.locator("main ul").getByText(title, { exact: true })).toHaveCount(0);
  const felt = await haptics(page);
  expect(felt).toContain("rigid");
  expect(felt).toContain("warning");

  // Select mode: Select All where Back was, the count in the bar, the actions in the tab bar's place.
  await page.getByRole("button", { name: "Select", exact: true }).tap();
  await expect(page.getByRole("button", { name: "Select All" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Back" })).toHaveCount(0);
  await expect(page.locator(".iphone-small-title")).toHaveText("Select notes");
  const toolbar = page.getByRole("toolbar", { name: "Selected notes" });
  await expect(toolbar).toBeVisible();
  expect(Math.round((await toolbar.boundingBox())!.height)).toBe(64);
  await rows.nth(0).tap();
  await rows.nth(1).tap();
  await expect(page.locator(".iphone-small-title")).toHaveText("2 selected");
  await page.getByRole("button", { name: "Select All" }).tap();
  await expect(page.getByRole("button", { name: "Deselect All" })).toBeVisible();
  await page.getByRole("button", { name: "Done" }).tap();
  await expect(toolbar).toHaveCount(0);
  await expect(tabs).toBeVisible();

  // An empty screen: one centred block.
  await page.goto(`${APP}/archive`);
  await expect(page.getByRole("heading", { level: 1, name: "Archive" })).toBeVisible();
  const empty = page.locator("[data-empty-state]");
  await expect(empty).toBeVisible();
  expect(Math.round((await empty.boundingBox())!.width)).toBeLessThanOrEqual(280);
  await expect(empty.getByRole("heading", { level: 2 })).toHaveCSS("font-size", "17px");
  await context.close();
});
