// The native UI layer from the page's side (lib/native, docs/IOS_POLISH_PLAN.md §4), with a stand-in bridge
// that records what reaches the app: a held folder tile arms its picture once the finger rests, lifts it once
// its menu is up (the page frosted behind the menu, the tile itself out of sight under the picture), and settles
// it back when the menu closes; a scroll during the press lifts nothing. Then a confirmation and a rename go to
// the app's alert, and Folevi's own dialog answers when the app has none.
import { expect, test, type Page } from "@playwright/test";
import { APP, newPerson } from "./helpers";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FoleviiOS/1.0";

type Recorded = { method: string; arg?: unknown };

function standInBridge() {
  const calls: { method: string; arg?: unknown }[] = [];
  const replies: Record<string, unknown> = {};
  const rec = (method: string, answer?: () => unknown) => (arg?: unknown) => {
    calls.push({ method, arg: arg === undefined ? undefined : JSON.parse(JSON.stringify(arg)) });
    return answer?.();
  };
  const bridge = {
    platform: "ios",
    version: "1.0",
    haptic: rec("haptic"),
    hapticPrepare: rec("hapticPrepare"),
    setStatusBar: () => undefined,
    openExternal: async () => true,
    getSettings: async () => ({ lock: false, lockAfter: 0, method: "faceID" }),
    setSettings: async () => ({ lock: false, lockAfter: 0, method: "faceID" }),
    onCommand: () => () => undefined,
    liftArm: rec("liftArm"),
    lift: rec("lift", () => Promise.resolve(true)),
    liftDrop: rec("liftDrop", () => Promise.resolve()),
    alert: rec("alert", () => Promise.resolve(replies.alert ?? null)),
    actionSheet: rec("actionSheet", () => Promise.resolve(replies.actionSheet ?? null)),
  };
  Object.defineProperty(window, "foleviNative", { value: bridge });
  Object.assign(window, { __native: { calls, replies } });
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

const calls = (page: Page) => page.evaluate(() => (window as unknown as { __native: { calls: Recorded[] } }).__native.calls);
const clearCalls = (page: Page) => page.evaluate(() => void ((window as unknown as { __native: { calls: Recorded[] } }).__native.calls.length = 0));

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

test("the app's lifted preview for a long press", async ({ browser, browserName }) => {
  test.skip(browserName !== "chromium", "Touch input is driven through Chromium's DevTools protocol.");
  test.setTimeout(180_000);
  const { context: signedIn } = await newPerson(browser, "Lifting Person");
  const state = await signedIn.storageState();
  await signedIn.close();

  const context = await browser.newContext({ storageState: state, viewport: { width: 402, height: 874 }, userAgent: IPHONE_UA, hasTouch: true, isMobile: true });
  await context.addInitScript(standInBridge);
  const page = await context.newPage();
  await page.goto(`${APP}/documents`);
  await expect(page.locator("html")).toHaveAttribute("data-iphone", "", { timeout: 30_000 });

  await page.getByRole("button", { name: "Create" }).click();
  await page.getByRole("menu", { name: "Create" }).getByRole("menuitem", { name: "New folder" }).click();
  const sheet = page.getByRole("dialog", { name: "New folder" });
  await sheet.getByPlaceholder("Folder name").fill("Lifted");
  await sheet.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Lifted" })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  const tile = page.getByRole("list", { name: "Folders" }).getByRole("listitem").filter({ hasText: "Lifted" });
  await tile.evaluate((el) => el.scrollIntoView({ block: "center", inline: "center" }));
  await page.waitForTimeout(400);
  const box = (await tile.boundingBox())!;
  const at = { x: box.x + box.width / 2, y: box.y + box.height * 0.6 };

  // A scroll during the press: nothing lifts (a picture may be taken, and is let go).
  await clearCalls(page);
  await finger(page, at.x, at.y, 300, [
    { x: at.x, y: at.y - 20 },
    { x: at.x, y: at.y - 50 },
  ]);
  await expect(page.getByRole("menu")).toHaveCount(0);
  expect((await calls(page)).filter((c) => c.method === "lift")).toHaveLength(0);
  await page.waitForTimeout(300);

  // Held: armed with the held thing's place on screen, lifted once the menu is up.
  await clearCalls(page);
  await finger(page, at.x, at.y, 700);
  const menu = page.getByRole("menu", { name: "Folder options for Lifted" });
  await expect(menu).toBeVisible();
  const seen = await calls(page);
  const arm = seen.find((c) => c.method === "liftArm")!.arg as { id: string; rect: { x: number; y: number; width: number; height: number }; radius: number };
  const held = (await page.locator("[data-held-lift]").boundingBox())!;
  // (The rectangle is of the thing at rest; it has lifted to 1.04 since.)
  expect(Math.abs(arm.rect.x + arm.rect.width / 2 - (held.x + held.width / 2))).toBeLessThan(2);
  expect(Math.abs(arm.rect.width * 1.04 - held.width)).toBeLessThan(3);
  expect(arm.radius).toBeGreaterThan(0);
  await expect.poll(async () => (await calls(page)).find((c) => c.method === "lift")?.arg).toEqual({ id: arm.id, from: 0.97 });
  // The page behind is frosted, the menu is above it (its items take taps), the tile is under the picture.
  await expect(page.locator("[data-lift-backdrop]")).toHaveCount(1);
  const item = menu.getByRole("menuitem").first();
  const ib = (await item.boundingBox())!;
  expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x!, y!)?.closest('[role="menu"]'), [ib.x + ib.width / 2, ib.y + ib.height / 2])).toBe(true);
  await expect(page.locator("[data-held-lift]")).toHaveCSS("visibility", "hidden");

  // A tap outside: the menu closes, the picture settles back, the tile shows again.
  await page.touchscreen.tap(200, 120);
  await expect(menu).toHaveCount(0);
  await expect.poll(async () => (await calls(page)).find((c) => c.method === "liftDrop")?.arg).toEqual({ id: arm.id, to: "back" });
  await expect(page.locator("[data-lift-backdrop]")).toHaveCount(0);
  await expect.poll(() => tile.evaluate((el) => [el, ...el.querySelectorAll("*")].some((n) => (n as HTMLElement).style?.visibility === "hidden"))).toBe(false);

  await context.close();
});
