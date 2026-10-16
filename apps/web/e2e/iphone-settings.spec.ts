// The iPhone app's Settings (components/iphone/SettingsKit.tsx): every section a native grouped list, every
// choice a pushed screen with checks, text in rows or on an edit screen with Done, destructive actions in an
// action sheet. Walks the whole tree in an iPhone-sized window with an iPhone user agent and a stand-in bridge
// (as iphone-app.spec.ts does), and checks nothing falls back to a web form's controls.
import { expect, test, type Page } from "@playwright/test";
import { APP, newPerson } from "./helpers";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FoleviiOS/1.0";

function fakeBridge() {
  const lock = { lock: false, lockAfter: 0, method: "faceID" };
  const bridge = {
    platform: "ios",
    version: "1.0",
    haptic: () => undefined,
    setStatusBar: () => undefined,
    openExternal: async () => true,
    getSettings: async () => ({ ...lock }),
    setSettings: async (patch: { lock?: boolean; lockAfter?: number }) => Object.assign(lock, patch) && { ...lock },
    onCommand: () => () => undefined,
  };
  Object.defineProperty(window, "foleviNative", { value: bridge });
  const mark = () => document.documentElement?.setAttribute("data-native", "ios");
  mark();
  // The dev server's badge (bottom right) sits over the tab bar's + on a phone-sized window: out of the way.
  const hideBadge = () => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal { display: none !important; }";
    document.head.appendChild(style);
  };
  if (document.head) hideBadge();
  else document.addEventListener("DOMContentLoaded", hideBadge, { once: true });
  if (!document.documentElement) new MutationObserver((_, watch) => document.documentElement && (mark(), watch.disconnect())).observe(document, { childList: true });
}

/** The screen on show: its large title. */
const title = (page: Page, name: string) => page.locator("main:visible").getByRole("heading", { level: 1, name, exact: true });
/** A row of the screen on show. */
const row = (page: Page, name: string | RegExp) => page.locator("main:visible").getByRole("button", { name }).first();

/** No web form controls on the screen on show: no select, no range, no checkbox (only the app's rows). */
async function nativeOnly(page: Page) {
  const main = page.locator("main:visible");
  await expect(main.locator("select")).toHaveCount(0);
  await expect(main.locator('input[type="range"], input[type="checkbox"]')).toHaveCount(0);
  await expect(main.locator(".ui-btn")).toHaveCount(0);
}

test("the iPhone app's Settings: every section a native list, choices and edits as pushed screens", async ({ browser }) => {
  test.setTimeout(240_000);
  const { context: signedIn } = await newPerson(browser, "Settings Walker");
  const state = await signedIn.storageState();
  await signedIn.close();
  const context = await browser.newContext({ storageState: state, viewport: { width: 402, height: 874 }, userAgent: IPHONE_UA, hasTouch: true });
  await context.addInitScript(fakeBridge);
  const page = await context.newPage();
  await page.goto(`${APP}/settings`);
  await expect(title(page, "Settings")).toBeVisible({ timeout: 30_000 });

  // Every section opens as its own screen with Back, and is made of the app's rows only.
  const sections = ["Account", "AI", "Plan & billing", "Security", "Devices", "Connected apps", "Appearance", "Notifications", "Offline & sync", "Import & export", "This device"];
  for (const name of sections) {
    await page.locator("main:visible").getByRole("link", { name, exact: true }).click();
    await expect(title(page, name)).toBeVisible();
    await nativeOnly(page);
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(title(page, "Settings")).toBeVisible();
  }

  // A choice is a pushed screen with a check by the chosen one; Back returns to the row, which shows it.
  await page.locator("main:visible").getByRole("link", { name: "Appearance", exact: true }).click();
  await row(page, /^Theme: /).click();
  await expect(title(page, "Theme")).toBeVisible();
  await expect(page).toHaveURL(/\?screen=theme$/);
  const themes = page.locator("main:visible").getByRole("radiogroup", { name: "Theme" });
  await themes.getByRole("radio", { name: "Dark", exact: true }).click();
  await expect(themes.getByRole("radio", { name: "Dark", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(title(page, "Appearance")).toBeVisible();
  await expect(row(page, /^Theme: /)).toHaveAccessibleName("Theme: Dark");
  // The edge swipe's way back is the browser's Back: the same.
  await row(page, /^Editor text size: /).click();
  await expect(title(page, "Editor text size")).toBeVisible();
  await page.goBack();
  await expect(title(page, "Appearance")).toBeVisible();
  await row(page, /^Theme: /).click();
  await page.locator("main:visible").getByRole("radio", { name: /^System/ }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();

  // Account: the name is a field in its row, saved when it's left; the time zone a searchable choice.
  await page.locator("main:visible").getByRole("link", { name: "Account", exact: true }).click();
  const nameField = page.locator("main:visible").getByLabel("Name", { exact: true });
  await nameField.fill("Settings Walker Two");
  await nameField.press("Enter");
  await expect(page.getByText("Saved")).toBeVisible();
  await row(page, /^Time zone: /).click();
  await expect(title(page, "Time zone")).toBeVisible();
  await page.locator("main:visible").getByLabel("Search time zone").fill("Tokyo");
  await page.locator("main:visible").getByRole("radio", { name: "Asia/Tokyo", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(row(page, /^Time zone: /)).toHaveAccessibleName("Time zone: Asia/Tokyo");
  await page.getByRole("button", { name: "Back", exact: true }).click();

  // Security: two-step, passkeys and the password each a screen; deleting the account asks in an action sheet.
  await page.locator("main:visible").getByRole("link", { name: "Security", exact: true }).click();
  await row(page, "Two-step verification").click();
  await expect(title(page, "Two-step verification")).toBeVisible();
  // (On or off, depending on the account: its actions follow.)
  await expect(row(page, /^(Turn on two-step verification|Get new backup codes)$/)).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await row(page, "Change password").click();
  await expect(title(page, "Change password")).toBeVisible();
  await expect(page.locator("header:visible").getByRole("button", { name: "Done", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await row(page, "Delete account").click();
  await expect(title(page, "Delete account")).toBeVisible();
  const schedule = row(page, "Schedule deletion");
  await expect(schedule).toBeDisabled();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();

  // Notifications: each topic's In the app and By email are switches on a screen of their own.
  await page.locator("main:visible").getByRole("link", { name: "Notifications", exact: true }).click();
  await row(page, /^Mentions/).click();
  await expect(title(page, "Mentions")).toBeVisible();
  const byEmail = page.locator("main:visible").getByRole("switch", { name: "By email" });
  await expect(byEmail).toHaveAttribute("aria-checked", "true");
  await byEmail.click();
  await expect(byEmail).toHaveAttribute("aria-checked", "false");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(row(page, /^Mentions/)).toContainText("In app");
  await page.getByRole("button", { name: "Back", exact: true }).click();

  // Connected apps: a new token is a screen with Create in its bar; picking when it expires keeps what's typed.
  await page.locator("main:visible").getByRole("link", { name: "Connected apps", exact: true }).click();
  await row(page, "Tokens").click();
  await row(page, "New token").click();
  await expect(title(page, "New token")).toBeVisible();
  await page.locator("main:visible").getByLabel("Name", { exact: true }).fill("Walk script");
  await row(page, /^Expires: /).click();
  await page.locator("main:visible").getByRole("radio", { name: "In a year", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.locator("main:visible").getByLabel("Name", { exact: true })).toHaveValue("Walk script");
  await page.locator("header:visible").getByRole("button", { name: "Create", exact: true }).click();
  await expect(title(page, "Your new token")).toBeVisible();
  await expect(page.locator("main:visible").getByText(/^fvpat_/)).toBeVisible();
  await page.locator("header:visible").getByRole("button", { name: "Done", exact: true }).click();
  await expect(title(page, "Tokens")).toBeVisible();
  await row(page, /Walk script/).click();
  // Revoking asks in an action sheet.
  await row(page, "Revoke token").click();
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Revoke", exact: true }) });
  await expect(sheet.getByRole("button", { name: "Cancel" })).toBeVisible();
  await sheet.getByRole("button", { name: "Revoke", exact: true }).click();
  await expect(title(page, "Tokens")).toBeVisible();
  await expect(row(page, /Walk script/)).toHaveCount(0);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();

  // AI: memory added on its own screen, the kind a choice.
  await page.locator("main:visible").getByRole("link", { name: "AI", exact: true }).click();
  await row(page, /^Memories/).click();
  await expect(title(page, "Memories")).toBeVisible();
  await row(page, /^Kind: /).click();
  await page.locator("main:visible").getByRole("radio", { name: "Tone", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.locator("main:visible").getByLabel("Remember", { exact: true }).fill("Warm and brief");
  await row(page, "Add").click();
  await expect(row(page, /Warm and brief/)).toBeVisible();

  // Plan & billing in the app: the plan and usage, nothing to buy.
  await page.goto(`${APP}/settings/billing`);
  await expect(title(page, "Plan & billing")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("main:visible")).not.toContainText(/\$|Buy|Upgrade|Choose a plan/);
  await nativeOnly(page);

  // This device: the lock is a switch, and once on, when to ask again is a choice.
  await page.goto(`${APP}/settings/this-device`);
  const lock = page.locator("main:visible").getByRole("switch", { name: "Lock with Face ID" });
  await lock.click();
  await expect(lock).toHaveAttribute("aria-checked", "true");
  await row(page, /^Ask again: /).click();
  await page.locator("main:visible").getByRole("radio", { name: "After 5 minutes", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(row(page, /^Ask again: /)).toHaveAccessibleName("Ask again: After 5 minutes");

  await context.close();
});
