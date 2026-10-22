// The iPhone app in local mode (iOS polish WP5, docs/IOS_POLISH_PLAN.md §3 "Settings" and "Sign-in, first run"):
// the first-launch screens drawn as the app's own (one card style, the suggested one captioned, text buttons),
// then Settings > Library and Settings > AI as grouped lists: facts as label and value, actions as rows, the
// explanations as footers, headers in capitals, no web buttons, selects or form switches, and the app's version
// at the bottom of Settings. A FakeShell (platform "ios") with a stand-in iOS bridge, at iPhone size. Local project:
//   E2E_LOCAL_BASE_URL=http://localhost:3003 E2E_BASE_URL=http://app.localhost:3002 E2E_NO_SERVER=1 \
//     npx playwright test e2e/iphone-local-settings.spec.ts --project local
// With IPHONE_SHOTS set, each screen is also saved there in light and dark.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, prepareContext, test } from "./fixtures/localShell";

const SHOTS = process.env.IPHONE_SHOTS;

/** Saves the screen in light and dark (only with IPHONE_SHOTS). */
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(SHOTS, `${name}-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: "light" });
}

/** Saves the whole of the screen's scroll, a viewport at a time (only with IPHONE_SHOTS). */
async function shotScrolled(page: Page, name: string) {
  if (!SHOTS) return;
  // (After the push has settled.)
  await page.waitForTimeout(800);
  const main = screen(page).last();
  const steps = await main.evaluate((el) => Math.ceil(el.scrollHeight / (el.clientHeight * 0.85)));
  for (let i = 0; i < Math.min(steps, 5); i++) {
    await main.evaluate((el, n) => el.scrollTo(0, n * el.clientHeight * 0.85), i);
    await shot(page, `${name}-${i + 1}`);
  }
  await main.evaluate((el) => el.scrollTo(0, 0));
}

const IPAD_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) FoleviiOS/1.0";
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FoleviiOS/1.0";

function iosBridge() {
  const lock = { lock: false, lockAfter: 0, method: "faceID" };
  const bridge = {
    platform: "ios",
    version: "1.4",
    build: "12",
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
  const hideBadge = () => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal { display: none !important; }";
    document.head.appendChild(style);
  };
  if (document.head) hideBadge();
  else document.addEventListener("DOMContentLoaded", hideBadge, { once: true });
  if (!document.documentElement) new MutationObserver((_, watch) => document.documentElement && (mark(), watch.disconnect())).observe(document, { childList: true });
}

/** The screen on show. */
const screen = (page: Page) => page.locator("main:visible");

/** Nothing on the screen on show is a web form's control or a bordered web button. */
async function nativeOnly(page: Page) {
  await expect(screen(page).locator("select")).toHaveCount(0);
  await expect(screen(page).locator('input[type="range"], input[type="checkbox"]')).toHaveCount(0);
  await expect(screen(page).locator(".ui-btn")).toHaveCount(0);
}

test.describe("the iPhone app in local mode", { tag: "@local" }, () => {
  test.beforeEach(({ backendMode }) => {
    test.skip(backendMode !== "local", "local mode only");
  });

  test("first launch, Settings > Library and Settings > AI are the app's own screens", async ({ browser }, testInfo) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ viewport: { width: 402, height: 874 }, userAgent: IPHONE_UA, hasTouch: true });
    await prepareContext(context, testInfo, { initialMode: "unset", configured: false, platform: "ios", libraryName: `iphone-${Date.now()}`, lockMethod: "faceID" });
    await context.addInitScript(iosBridge);
    const page = await context.newPage();
    await page.goto("/documents");

    // One card style for both answers; the suggested one says so, none is drawn black.
    const choice = page.getByTestId("mode-choice");
    await expect(choice).toBeVisible({ timeout: 30_000 });
    const local = choice.getByRole("button", { name: /Keep notes on my devices/ });
    await expect(local).toContainText("Recommended");
    const bg = (name: RegExp) => choice.getByRole("button", { name }).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await bg(/Keep notes on my devices/)).toBe(await bg(/Sign in to Folevi/));
    await shot(page, "01-mode-choice");
    expect((await local.boundingBox())!.height).toBeGreaterThanOrEqual(64);
    await local.click();
    await page.getByTestId("place-device").click();
    const setup = page.getByTestId("library-setup");
    await shot(page, "02-library-ready");
    // "Choose another place" is a plain 17 pt text button, not a web button.
    const elsewhere = setup.getByRole("button", { name: "Choose another place" });
    await expect(elsewhere).toBeVisible();
    expect(await elsewhere.evaluate((el) => [el.classList.contains("ui-btn"), getComputedStyle(el).fontSize])).toEqual([false, "17px"]);
    await setup.getByRole("button", { name: "Open Folevi" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-iphone", "", { timeout: 30_000 });

    // Settings: groups headed in capitals, the version and build at the bottom.
    await page.goto(new URL("/settings", page.url()).href);
    await expect(screen(page).getByRole("heading", { level: 1, name: "Settings" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("settings-version")).toHaveText("Folevi 1.4 (12)");
    const header = screen(page).locator("section h3").first();
    expect(await header.evaluate((el) => [getComputedStyle(el).textTransform, getComputedStyle(el).fontSize])).toEqual(["uppercase", "13px"]);
    // Every row is at least 52 tall.
    const rows = await screen(page).locator(".ui-grouped > a").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
    expect(rows.length).toBeGreaterThan(2);
    for (const h of rows) expect(h).toBeGreaterThanOrEqual(52);
    await shotScrolled(page, "03-settings");

    // Settings > Library: facts as label and value on one line, actions as rows, no web buttons.
    await screen(page).getByRole("link", { name: "Library", exact: true }).click();
    const section = page.getByTestId("library-section");
    await expect(section.getByTestId("library-kind")).toHaveText("This iPhone only", { timeout: 30_000 });
    await nativeOnly(page);
    await shotScrolled(page, "04-settings-library");
    const sync = screen(page).getByRole("button", { name: "Sync now" });
    await sync.click();
    await expect(page.getByText("Library synced")).toBeVisible();
    // The long location opens on a screen of its own.
    await screen(page).getByRole("button", { name: /^Location/ }).click();
    await expect(screen(page).getByRole("heading", { level: 1, name: "Location" })).toBeVisible();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    // The lock: an iOS switch in its own row, its explanation the footer.
    const lock = screen(page).getByRole("switch", { name: "Lock with Face ID" });
    await lock.click();
    await expect(lock).toHaveAttribute("aria-checked", "true");
    expect(await lock.evaluate((el) => [el.getBoundingClientRect().width, el.getBoundingClientRect().height])).toEqual([51, 31]);
    await screen(page).getByRole("button", { name: /^Ask again/ }).click();
    await screen(page).getByRole("radio", { name: "After 5 minutes" }).click();
    const lockCalls = (await page.evaluate(() => window.__foleviTestShellControl!.log.filter((c) => c.call === "lock.setSettings").map((c) => c.detail))) as unknown[];
    expect(lockCalls).toEqual([{ lock: true }, { lockAfter: 300 }]);
    await page.getByRole("button", { name: "Back", exact: true }).click();
    // Model and keys goes to Settings > AI.
    await screen(page).getByRole("link", { name: "Model and keys" }).click();
    await expect(screen(page).getByRole("heading", { level: 1, name: "AI" })).toBeVisible();

    // Settings > AI: Foli AI on or off as a switch row, each key a row with its own screen.
    await nativeOnly(page);
    await expect(screen(page).getByRole("switch", { name: "Foli AI" })).toBeVisible();
    await expect(screen(page).getByRole("switch", { name: "Keep conversations" })).toBeVisible();
    await expect(page.getByText(/\$\d|per month|upgrade|Pro AI|free trial/i)).toHaveCount(0);
    await shotScrolled(page, "05-settings-ai");
    await context.close();
  });

  test("the iPad layout: the desktop layout in iPadOS's look, tabs kept", async ({ browser }, testInfo) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ viewport: { width: 1032, height: 1376 }, userAgent: IPAD_UA, hasTouch: true });
    await prepareContext(context, testInfo, { initialMode: "local", configured: true, platform: "ios", libraryName: `ipad-${Date.now()}` });
    await context.addInitScript(iosBridge);
    await context.addInitScript(() => Object.defineProperty(Navigator.prototype, "maxTouchPoints", { get: () => 5 }));
    const page = await context.newPage();
    await page.goto("/documents");
    await expect(page.locator("html")).toHaveAttribute("data-ipad", "", { timeout: 30_000 });
    await expect(page.locator("html")).not.toHaveAttribute("data-iphone", "");
    const strip = page.locator("[data-ipad-tabs]");
    await expect(strip).toBeVisible();
    // iPad tabs: touch-sized round buttons, Foli AI and New note in the strip, no Mac arrows, no dark New note.
    for (const name of ["Back", "Forward", "New note"]) expect((await strip.getByRole("button", { name, exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(strip.getByRole("button", { name: /Scroll tabs/ })).toHaveCount(0);
    await expect(strip.locator(".ui-btn-primary")).toHaveCount(0);
    expect((await strip.getByRole("link", { name: "Home" }).boundingBox())!.height).toBeGreaterThanOrEqual(40);
    // No floating desktop pill.
    await expect(page.locator(".ui-fab")).toHaveCount(0);
    // The sidebar: 320 wide, 44 pt rows in 17 pt text.
    const sidebar = page.getByRole("navigation", { name: "Folio" });
    expect(Math.round((await sidebar.boundingBox())!.width)).toBeGreaterThanOrEqual(300);
    const home = sidebar.getByRole("link", { name: "Home", exact: true });
    expect(await home.evaluate((el) => [el.getBoundingClientRect().height >= 44, getComputedStyle(el).fontSize])).toEqual([true, "17px"]);
    // No ⌘K without a keyboard; a key pressed with ⌘ (or Tab) says there is one.
    const kbd = sidebar.locator(".ui-kbd");
    await expect(kbd).toBeHidden();
    // A note card's "…" stays out of sight on touch (a long press opens the same menu).
    const cardMenu = page.locator("[data-card-menu]").first();
    await expect(cardMenu).toHaveCSS("opacity", "0", { timeout: 20_000 });
    await shot(page, "10-ipad-home");
    await page.keyboard.press("Tab");
    await expect(page.locator("html")).toHaveAttribute("data-hardware-keyboard", "");
    await expect(kbd).toBeVisible();
    // A note opens in its own tab.
    await page.locator("[data-card-menu]").first().locator("xpath=..").locator("a[href^='/d/']").first().click();
    await expect(page.locator(".ProseMirror").first()).toBeVisible({ timeout: 20_000 });
    await expect(strip.locator("[data-tab]")).toHaveCount(1);
    await shot(page, "11-ipad-note");
    // Settings: iPadOS Settings' two columns, the section drawn as the iPhone's grouped lists.
    await page.goto(new URL("/settings/appearance", page.url()).href);
    await expect(strip).toBeVisible({ timeout: 30_000 });
    const sections = page.getByRole("navigation", { name: "Settings sections" });
    await expect(sections.getByRole("link", { name: "Appearance" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("settings-version")).toHaveText("Folevi 1.4 (12)");
    await expect(page.locator('main input[type="range"]')).toHaveCount(0);
    await shot(page, "12-ipad-settings");
    // A choice opens on a screen of its own, with Back.
    await page.locator("main").getByRole("button", { name: /^Theme: / }).click();
    await page.locator("main").getByRole("radio", { name: "Dark", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await shot(page, "13-ipad-settings-theme");
    await page.locator("main").getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.locator("main").getByRole("button", { name: /^Theme: Dark/ })).toBeVisible();
    await page.locator("main").getByRole("button", { name: /^Theme: / }).click();
    await page.locator("main").getByRole("radio", { name: "Light", exact: true }).click();
    await sections.getByRole("link", { name: "Library" }).click();
    await expect(page.getByTestId("library-kind")).toBeVisible({ timeout: 20_000 });
    await shot(page, "14-ipad-settings-library");
    await context.close();
  });
});
