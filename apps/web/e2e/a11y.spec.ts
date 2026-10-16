import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { SITE, newPerson, settle } from "./helpers";

const VIEWS = ["/documents", "/tasks/today", "/calendar", "/settings/account", "/settings/security", "/settings/devices", "/help"];

for (const scheme of ["light", "dark"] as const) {
  test(`no serious accessibility violations in the app (${scheme})`, async ({ browser }) => {
    // Eight pages, each scanned by axe: slower CI machines need more than the default minute.
    test.setTimeout(180_000);
    const { context, page } = await newPerson(browser, "A11y Tester");
    await page.evaluate((s) => localStorage.setItem("folevi:appearance", s), scheme);
    const pages = [...VIEWS, page.url().replace(/^https?:\/\/[^/]+/, "")];
    for (const path of pages) {
      await page.goto(path);
      await page.waitForTimeout(1500);
      await settle(page);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).disableRules(["region"]).analyze();
      const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${path}: ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
    }
    await context.close();
  });
}

test("marketing home has no serious accessibility violations", async ({ page }) => {
  await page.goto(`${SITE}/`);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
});

test("keyboard: skip link, command palette and editor are reachable without a pointer", async ({ browser }) => {
  const { page } = await newPerson(browser, "Keyboard Tester");
  await page.goto("/documents");
  await page.waitForTimeout(1000);
  // In development, Next's dev-tools button may take the first tab stop; the skip link must come right after.
  const skip = page.getByRole("link", { name: "Skip to content" });
  for (let i = 0; i < 3 && !(await skip.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  await expect(page.getByRole("combobox", { name: /Search documents/ })).toBeFocused();
  await page.keyboard.type("welcome");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Welcome to Folevi");
});

// The iPhone app's own interface (components/iphone): the tab bar, large titles, glass bars and sheets.
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FoleviiOS/1.0";
function iphoneBridge() {
  const bridge = { platform: "ios", version: "1.0", haptic: () => undefined, setStatusBar: () => undefined, openExternal: async () => true, getSettings: async () => ({ lock: false, lockAfter: 0, method: "faceID" }), setSettings: async () => ({ lock: false, lockAfter: 0, method: "faceID" }), onCommand: () => () => undefined };
  Object.defineProperty(window, "foleviNative", { value: bridge });
  const mark = () => document.documentElement?.setAttribute("data-native", "ios");
  mark();
  if (!document.documentElement) new MutationObserver((_, watch) => document.documentElement && (mark(), watch.disconnect())).observe(document, { childList: true });
}

for (const scheme of ["light", "dark"] as const) {
  test(`the iPhone app has no serious accessibility violations (${scheme})`, async ({ browser }) => {
    test.setTimeout(180_000);
    const { context: signedIn } = await newPerson(browser, "iPhone A11y");
    const state = await signedIn.storageState();
    await signedIn.close();
    const context = await browser.newContext({ storageState: state, viewport: { width: 402, height: 874 }, userAgent: IPHONE_UA, hasTouch: true, colorScheme: scheme });
    await context.addInitScript(iphoneBridge);
    await context.addInitScript((s) => localStorage.setItem("folevi:appearance", s), scheme);
    const page = await context.newPage();
    const scan = async (where: string) => {
      await page.waitForTimeout(1200);
      await settle(page);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).disableRules(["region"]).analyze();
      const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${where}: ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
    };
    for (const path of ["/documents", "/notes", "/tasks/today", "/calendar", "/settings", "/settings/account", "/settings/security?screen=password", "/settings/notifications", "/settings/appearance?screen=theme"]) {
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("data-iphone", "", { timeout: 30_000 });
      await scan(path);
    }
    // A sheet (the account) and the + menu.
    await page.goto("/documents");
    await page.getByRole("button", { name: "Personal: account and places" }).click();
    await expect(page.getByRole("dialog", { name: "Account" })).toBeVisible();
    await scan("account sheet");
    await context.close();
  });
}
