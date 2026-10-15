// The iPhone and iPad app (apps/ios) as the page sees it: before any of the page's scripts the app adds
// `window.foleviNative` and marks <html data-native="ios"> (apps/ios/ios/App/App/bridge.js). Here an init
// script does the same, with a stand-in bridge that records what the page asks for. Inside the app nothing
// may sell plans (App Store rule 3.1.1), Settings > This device holds the Face ID lock, and folevi:// links
// land where they point.
import { expect, test, type Page } from "@playwright/test";
import { APP, newPerson } from "./helpers";

/** The app's bridge, as bridge.js shapes it; calls are kept on window.__native for the test to read. */
function fakeBridge() {
  const calls: { method: string; arg?: unknown }[] = [];
  const listeners: ((c: { type: "link"; url: string }) => void)[] = [];
  let settings = { lock: false, lockAfter: 0, method: "faceID" };
  const bridge = {
    platform: "ios",
    version: "1.0",
    haptic: (kind: string) => calls.push({ method: "haptic", arg: kind }),
    setStatusBar: (theme: string) => calls.push({ method: "setStatusBar", arg: theme }),
    openExternal: async (url: string) => (calls.push({ method: "openExternal", arg: url }), true),
    getSettings: async () => settings,
    setSettings: async (patch: Record<string, unknown>) => {
      calls.push({ method: "setSettings", arg: patch });
      settings = { ...settings, ...patch };
      return settings;
    },
    onCommand: (listener: (c: { type: "link"; url: string }) => void) => {
      listeners.push(listener);
      return () => listeners.splice(listeners.indexOf(listener), 1);
    },
  };
  Object.defineProperty(window, "foleviNative", { value: bridge });
  Object.assign(window, { __native: { calls, open: (url: string) => listeners.forEach((l) => l({ type: "link", url })) } });
  // (As bridge.js does: the document may not have its <html> yet when this runs.)
  const mark = () => document.documentElement?.setAttribute("data-native", "ios");
  mark();
  if (!document.documentElement) new MutationObserver((_, watch) => document.documentElement && (mark(), watch.disconnect())).observe(document, { childList: true });
}

const PURCHASE = /upgrade|buy|choose (a |pro|core)|choose plan|see plans|manage billing|checkout|get unlimited/i;

/** Every link and button on the page whose words offer a purchase. */
async function purchaseActions(page: Page): Promise<string[]> {
  return (await page.locator("a:visible, button:visible").allTextContents()).map((t) => t.trim()).filter((t) => PURCHASE.test(t));
}

test("inside the iOS app: no plans or purchases, Settings > This device, folevi:// links", async ({ browser }) => {
  test.setTimeout(150_000);
  const { context, page } = await newPerson(browser, "Phone Person");

  // In a browser, Plan & billing sells plans (billing.spec.ts covers it in full), and Settings has no This device.
  await page.goto(`${APP}/settings/billing`);
  await expect(page.getByRole("heading", { name: "Choose a personal plan" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "This device" })).toHaveCount(0);

  // From here on, the page is in the iOS app.
  await context.addInitScript(fakeBridge);
  const app = page;
  await app.goto(`${APP}/settings/billing`);
  await expect(app.locator("html")).toHaveAttribute("data-native", "ios");
  await expect(app.getByText("Plans and billing are managed on folevi.com, not in this app.")).toBeVisible({ timeout: 20_000 });
  await expect(app.getByText("Pro AI trial", { exact: true })).toBeVisible();
  await expect(app.getByRole("heading", { name: "Choose a personal plan" })).toHaveCount(0);
  await expect(app.getByRole("heading", { name: "Billing history" })).toHaveCount(0);
  await expect(app.locator("main")).not.toContainText(/\$\d/);
  expect(await purchaseActions(app)).toEqual([]);
  await expect(app.locator('a[href*="pricing"], a[href*="checkout"], a[href*="polar"]')).toHaveCount(0);

  // The sidebar's trial pill says how long the trial lasts, and isn't a way to plans.
  await expect(app.getByText(/Pro AI trial · \d+ days? left/)).toBeVisible();
  await expect(app.getByRole("button", { name: /Pro AI trial/ })).toHaveCount(0);

  // Settings > AI and Devices offer nothing to buy either.
  for (const section of ["ai", "devices", "account"]) {
    await app.goto(`${APP}/settings/${section}`);
    await expect(app.getByRole("navigation", { name: "Settings sections" })).toBeVisible({ timeout: 20_000 });
    expect(await purchaseActions(app), section).toEqual([]);
  }

  // Settings > This device: the Face ID lock, off until turned on, kept by the app.
  await app.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "This device" }).click();
  const lock = app.getByRole("switch", { name: "Lock with Face ID" });
  await expect(lock).toHaveAttribute("aria-checked", "false");
  await lock.click();
  await expect(lock).toHaveAttribute("aria-checked", "true");
  await app.getByRole("combobox", { name: "Ask again" }).click();
  await app.getByRole("option", { name: "After 5 minutes" }).click();
  const calls = await app.evaluate(() => (window as unknown as { __native: { calls: { method: string; arg?: unknown }[] } }).__native.calls);
  expect(calls.filter((c) => c.method === "setSettings").map((c) => c.arg)).toEqual([{ lock: true }, { lockAfter: 300 }]);
  // The status bar follows the page's theme.
  expect(calls.some((c) => c.method === "setStatusBar")).toBe(true);

  // A folevi:// link from another app opens where it points.
  await app.evaluate(() => (window as unknown as { __native: { open: (u: string) => void } }).__native.open("folevi://tasks/today"));
  await expect(app).toHaveURL(/\/tasks\/today$/);

  await context.close();
});
