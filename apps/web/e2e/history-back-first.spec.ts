// Back to the first screen of the history stays in the page (lib/app/historyNav.ts keepInPage): an entry Next.js
// never marked with its own router state (the iPhone app sets its start page before any page script runs)
// made Next reload the whole page when Back landed on it, a restart, and offline the browser's error page.
// The iPhone layout (its Back button) and the desktop layout (the browser's Back), online and offline. Local
// mode, a FakeShell:
//   E2E_LOCAL_BASE_URL=http://localhost:3003 E2E_BASE_URL=http://app.localhost:3002 E2E_NO_SERVER=1 \
//     npx playwright test e2e/history-back-first.spec.ts --project local
import type { Page } from "@playwright/test";
import { expect, prepareContext, test } from "./fixtures/localShell";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FoleviiOS/1.0";

function iosBridge() {
  Object.defineProperty(window, "foleviNative", {
    value: { platform: "ios", version: "1.0", haptic() {}, hapticPrepare() {}, setStatusBar() {}, openExternal: async () => true, getSettings: async () => ({ lock: false, lockAfter: 0, method: "faceID" }), setSettings: async () => ({}), onCommand: () => () => undefined },
  });
  const mark = () => document.documentElement?.setAttribute("data-native", "ios");
  mark();
  if (!document.documentElement) new MutationObserver((_, watch) => document.documentElement && (mark(), watch.disconnect())).observe(document, { childList: true });
}

/** Marks the page's JavaScript, and takes Next.js's state off the history entry on screen (the first one). */
async function markAndStrip(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __alive: number }).__alive = 1;
    // (The browser's own replaceState: Next.js's would put its state back.)
    History.prototype.replaceState.call(window.history, { foleviAt: 0 }, "");
  });
}
const alive = (page: Page) => page.evaluate(() => (window as unknown as { __alive?: number }).__alive ?? null);

test.describe("Back to the first screen", { tag: "@local" }, () => {
  test.beforeEach(({ backendMode }) => {
    test.skip(backendMode !== "local", "local mode only");
  });

  for (const offline of [false, true]) {
    test(`the iPhone app's Back to its first screen stays in the page${offline ? ", offline" : ""} @local`, async ({ browser }, testInfo) => {
      test.setTimeout(120_000);
      const context = await browser.newContext({ viewport: { width: 440, height: 956 }, userAgent: IPHONE_UA, hasTouch: true, isMobile: true });
      await prepareContext(context, testInfo, { libraryName: `back-first-${Date.now()}`, platform: "ios" });
      await context.addInitScript(iosBridge);
      const page = await context.newPage();
      await page.goto("/documents");
      const card = page.locator("main a[href^='/d/']").first();
      await expect(card).toBeVisible({ timeout: 60_000 });
      await markAndStrip(page);
      await card.tap();
      await expect(page.getByRole("textbox", { name: "Document body" })).toBeVisible();
      if (offline) await context.setOffline(true);
      await page.getByRole("button", { name: "Back", exact: true }).tap();
      await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
      await page.waitForTimeout(800);
      expect(await alive(page)).toBe(1);
      expect(new URL(page.url()).pathname).toBe("/documents");
      // And on again, and back again.
      await card.tap();
      await expect(page.getByRole("textbox", { name: "Document body" })).toBeVisible();
      await page.getByRole("button", { name: "Back", exact: true }).tap();
      await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
      expect(await alive(page)).toBe(1);
      await context.close();
    });
  }

  test("the browser's Back to the first screen stays in the page, offline too @local", async ({ browser }, testInfo) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await prepareContext(context, testInfo, { libraryName: `back-first-web-${Date.now()}`, platform: "mac" });
    const page = await context.newPage();
    await page.goto("/documents");
    const card = page.locator("main a[href^='/d/']").first();
    await expect(card).toBeVisible({ timeout: 60_000 });
    await markAndStrip(page);
    await card.click();
    await expect(page).toHaveURL(/\/d\//);
    await context.setOffline(true);
    await page.goBack();
    await expect(page).toHaveURL(/\/documents$/);
    await page.waitForTimeout(800);
    expect(await alive(page)).toBe(1);
    await expect(page.locator("main a[href^='/d/']").first()).toBeVisible();
    await context.close();
  });
});
