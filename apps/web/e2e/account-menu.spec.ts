// The account menu at the bottom of the sidebar (docs/MULTI_ACCOUNT_PLAN.md): places first (each account with its
// workspaces under it, the library "On this Mac"), then Settings, Sign in to another account, Move or copy notes,
// Help, then Sign out. With ACCOUNT_MENU_SHOTS=<dir> it also saves screenshots of each state there.
//
//   E2E_BASE_URL=http://app.localhost:3002 E2E_LOCAL_BASE_URL=http://localhost:3003 E2E_NO_SERVER=1 \
//     npx playwright test e2e/account-menu.spec.ts --project account --project local --workers=1
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures/localShell";
import { APP, completeOnboarding, confirmEmail, createWorkspace, newPerson, PASSWORD, switcher, uniqueEmail } from "./helpers";

const SHOTS = process.env.ACCOUNT_MENU_SHOTS;
const PREFIX = process.env.ACCOUNT_MENU_PREFIX ?? "after";

/** Saves the open menu and the button it came from (light, then dark when asked). */
async function shot(page: Page, name: string, menu: Locator, button: Locator) {
  if (!SHOTS) return;
  await page.waitForTimeout(250);
  const a = (await menu.boundingBox())!;
  const b = (await button.boundingBox())!;
  const vp = page.viewportSize()!;
  const x = Math.max(0, Math.min(a.x, b.x) - 24);
  const y = Math.max(0, Math.min(a.y, b.y) - 24);
  const right = Math.min(vp.width, Math.max(a.x + a.width, b.x + b.width) + 24);
  const bottom = Math.min(vp.height, Math.max(a.y + a.height, b.y + b.height) + 24);
  await page.screenshot({ path: `${SHOTS}/${PREFIX}-${name}.png`, clip: { x, y, width: right - x, height: bottom - y } });
}

async function inDark(page: Page, run: () => Promise<void>) {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await run();
  await page.emulateMedia({ colorScheme: "light" });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
}

async function openMenu(page: Page) {
  await switcher(page).click();
  const menu = page.getByRole("menu", { name: /: Personal, workspaces and account$/ });
  await expect(menu).toBeVisible();
  return menu;
}

test.describe("account mode", { tag: "@account-menu" }, () => {
  test.beforeEach(({ backendMode }) => {
    test.skip(backendMode !== "account", "account mode only");
  });

  test("one account, then a workspace, then a second account; desktop and phone width, light and dark", async ({ browser }) => {
    test.setTimeout(300_000);
    const { page, context } = await newPerson(browser, "Faisal Menu");
    await page.goto(`${APP}/documents`);
    await expect(switcher(page)).toBeVisible({ timeout: 30_000 });

    let menu = await openMenu(page);
    // Places first: you (name and email; "Personal" to assistive tech), checked, and New workspace under you.
    await expect(menu.getByText("Places", { exact: true })).toBeVisible();
    const me = menu.getByRole("menuitemradio", { name: "Personal", exact: true });
    await expect(me).toHaveAttribute("aria-checked", "true");
    await expect(me).toContainText("Faisal Menu");
    await expect(me).toHaveAttribute("aria-description", /@example\.com/);
    expect((await me.boundingBox())!.height).toBeGreaterThanOrEqual(50);
    // Then the actions, then Sign out; the rest lives in Settings.
    const names = await menu.getByRole("menuitem").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? e.querySelector("[data-menu-part=label]")?.textContent?.trim() ?? ""));
    expect(names).toEqual(["New workspace…", "Settings", "Sign in to another account…", "Help", "Sign out of Faisal Menu"]);
    for (const moved of ["Plan & billing", "Security", "Devices", "Contact support…", "Admin console", "Light", "Dark", "Match system", "Members", "Workspace settings", "Invite people…"]) {
      await expect(menu.getByRole("menuitem", { name: moved, exact: true })).toHaveCount(0);
      await expect(menu.getByRole("menuitemradio", { name: moved, exact: true })).toHaveCount(0);
    }
    const settingsRow = (await menu.getByRole("menuitem", { name: /^Settings/ }).boundingBox())!;
    expect(Math.round(settingsRow.height)).toBe(32);
    // About 300 wide, above the button without covering it (measured once it has risen into place).
    await page.waitForTimeout(300);
    const box = (await menu.boundingBox())!;
    const button = (await switcher(page).boundingBox())!;
    expect(Math.round(box.width)).toBe(300);
    expect(box.y + box.height).toBeLessThanOrEqual(button.y);
    // The keyboard: arrows move, and the row it's on is highlighted.
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name: "New workspace…" })).toBeFocused();
    await shot(page, "1-one-account", menu, switcher(page));
    await page.keyboard.press("Escape");

    // Everything that left the menu is in Settings.
    await page.goto(`${APP}/settings`);
    const sections = page.getByRole("navigation", { name: "Settings sections" });
    for (const link of ["Plan & billing", "Security", "Devices", "Appearance"]) await expect(sections.getByRole("link", { name: link, exact: true })).toBeVisible();
    await expect(sections.getByRole("link", { name: "Help", exact: true })).toBeVisible();
    await sections.getByRole("button", { name: "Contact support…" }).click();
    await expect(page.getByRole("dialog", { name: "Contact support" })).toBeVisible();
    await page.keyboard.press("Escape");
    await sections.getByRole("link", { name: "Appearance", exact: true }).click();
    await expect(page.getByRole("radio", { name: "Dark" }).first()).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${PREFIX}-8-settings-support.png`, clip: { x: 0, y: 0, width: 900, height: 900 } });
    // ⌘, opens Settings, as the menu says.
    await page.goto(`${APP}/documents`);
    await expect(switcher(page)).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press(process.platform === "darwin" ? "Meta+Comma" : "Control+Comma");
    await page.waitForURL(/\/settings/);
    await page.goto(`${APP}/documents`);

    await createWorkspace(page, "Airly Studio");
    await page.goto(`${APP}/documents`);
    menu = await openMenu(page);
    // The workspace under you, its plan as a quiet caption, checked; Personal not.
    const studio = menu.getByRole("menuitemradio", { name: "Airly Studio", exact: true });
    await expect(studio).toHaveAttribute("aria-checked", "true");
    await expect(studio).toContainText("Free");
    await expect(menu.getByRole("menuitemradio", { name: "Personal", exact: true })).toHaveAttribute("aria-checked", "false");
    await shot(page, "2-workspace", menu, switcher(page));
    await page.keyboard.press("Escape");

    // A second account in this browser.
    const ben = { email: uniqueEmail("menu-ben"), name: "Ben Second" };
    menu = await openMenu(page);
    await menu.getByRole("menuitem", { name: /^Sign in to another account/ }).click();
    await page.waitForURL(/\/signin\?add=1/);
    await page.getByRole("link", { name: "Create an account" }).click();
    await page.waitForURL(/\/signup\?add=1/);
    await page.getByLabel("Your name").fill(ben.name);
    await page.getByLabel("Email").fill(ben.email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible({ timeout: 20_000 });
    await confirmEmail(page, ben.email);
    await completeOnboarding(page);
    await page.goto(`${APP}/documents`);
    await expect(switcher(page)).toBeVisible({ timeout: 30_000 });
    menu = await openMenu(page);
    await expect(menu.getByRole("menuitem", { name: "Faisal Menu" })).toBeVisible({ timeout: 20_000 });
    // The other account's workspace under it, and Move or copy notes now that there's somewhere to move to.
    await expect(menu.getByRole("menuitem", { name: "Airly Studio", exact: true })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Move or copy notes…" })).toBeVisible();
    await shot(page, "3-two-accounts", menu, switcher(page));
    await page.keyboard.press("Escape");
    await inDark(page, async () => {
      const m = await openMenu(page);
      await shot(page, "4-two-accounts-dark", m, switcher(page));
      await page.keyboard.press("Escape");
    });

    // Phone width: the sidebar is a drawer.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${APP}/documents`);
    await page.getByRole("button", { name: "Show sidebar" }).click();
    menu = await openMenu(page);
    await shot(page, "5-phone", menu, switcher(page));
    await page.keyboard.press("Escape");

    // The iPhone app's account sheet: the same contents, in the phone's measure.
    const state = await context.storageState();
    await context.close();
    const phone = await browser.newContext({ storageState: state, viewport: { width: 402, height: 874 }, userAgent: IPHONE_UA, hasTouch: true });
    await phone.addInitScript(fakeBridge);
    const app = await phone.newPage();
    await app.goto(`${APP}/documents`);
    await expect(app.locator("html")).toHaveAttribute("data-iphone", "", { timeout: 30_000 });
    await app.locator("button[aria-label$='account and places']").first().click();
    const sheet = app.getByRole("dialog", { name: "Account" });
    await expect(sheet.getByRole("button", { name: "Personal", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(sheet.getByRole("button", { name: "Faisal Menu" })).toBeVisible({ timeout: 20_000 });
    for (const row of ["Settings", "Sign in to another account…", "Move or copy notes…", "Help", "Sign out of Ben Second"]) {
      const b = (await sheet.getByRole("button", { name: row, exact: true }).boundingBox())!;
      expect(b.height).toBeGreaterThanOrEqual(44);
    }
    for (const moved of ["Contact support", "Admin console", "Members", "Workspace settings", "Invite people"]) await expect(sheet.getByRole("button", { name: moved, exact: true })).toHaveCount(0);
    await expect(sheet.getByRole("radiogroup", { name: "Appearance" })).toHaveCount(0);
    await app.waitForTimeout(900);
    if (SHOTS) await app.screenshot({ path: `${SHOTS}/${PREFIX}-9-iphone-sheet.png` });
    await inDark(app, async () => {
      if (SHOTS) await app.screenshot({ path: `${SHOTS}/${PREFIX}-10-iphone-sheet-dark.png` });
    });
    await sheet.getByRole("button", { name: "Sign out of Ben Second" }).scrollIntoViewIfNeeded();
    await app.waitForTimeout(400);
    if (SHOTS) await app.screenshot({ path: `${SHOTS}/${PREFIX}-11-iphone-sheet-actions.png` });
    await phone.close();

    // The iPad: the sidebar's menu, in the iOS app's menu style.
    const tablet = await browser.newContext({ storageState: state, viewport: { width: 1180, height: 820 }, userAgent: IPAD_UA, hasTouch: true });
    await tablet.addInitScript(fakeBridge);
    const pad = await tablet.newPage();
    await pad.goto(`${APP}/documents`);
    await expect(pad.locator("html")).toHaveAttribute("data-native", "ios", { timeout: 30_000 });
    const padButton = switcher(pad);
    if (await padButton.isVisible()) {
      await padButton.click();
      const padMenu = pad.getByRole("menu", { name: /: Personal, workspaces and account$/ });
      await expect(padMenu.getByRole("menuitemradio", { name: "Personal", exact: true })).toBeVisible();
      await shot(pad, "12-ipad", padMenu, padButton);
    }
    await tablet.close();
  });
});

const IPAD_UA = "Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FoleviiOS/1.0";
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FoleviiOS/1.0";

/** What the iOS app gives the page before its first script (as iphone-app.spec.ts does). */
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
  const hideBadge = () => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal { display: none !important; }";
    document.head.appendChild(style);
  };
  if (document.head) hideBadge();
  else document.addEventListener("DOMContentLoaded", hideBadge, { once: true });
  if (!document.documentElement) new MutationObserver((_, watch) => document.documentElement && (mark(), watch.disconnect())).observe(document, { childList: true });
}

/** Another account beside the library, as the Mac app's host lists them. */
function placesHost() {
  const list = [
    { kind: "library", id: "library", configured: true, syncs: "icloud", displayPath: "iCloud Drive", unread: 0, reminders: 0, waiting: 0 },
    { kind: "account", id: "acct:ana", userId: "ana", profileId: null, name: "Ana Example", email: "ana.example.long.address@studio-example.com", avatarUrl: null, workspaces: [{ id: "w1", name: "Ana Studio", logoUrl: null }], unread: 2, reminders: 0, waiting: 0 },
  ];
  const attach = () => {
    const s = (window as unknown as { __foleviTestShell?: Record<string, unknown> }).__foleviTestShell;
    if (!s) return false;
    s.places = {
      current: "library",
      list: async () => list,
      onChange: () => () => undefined,
      switchTo: async () => undefined,
      signIn: async () => null,
      describe: async () => undefined,
      signOut: async () => undefined,
      forgetLibrary: async () => undefined,
      convexToken: async () => null,
    };
    return true;
  };
  if (!attach()) {
    const t = setInterval(() => attach() && clearInterval(t), 1);
  }
}

function macMark() {
  const mark = () => document.documentElement?.setAttribute("data-desktop", "mac");
  mark();
  document.addEventListener("DOMContentLoaded", mark);
}

test.describe("local mode", { tag: "@local" }, () => {
  test.beforeEach(({ backendMode }) => {
    test.skip(backendMode !== "local", "local mode only");
  });

  test("the library and another account, in the Mac app's look, light and dark", async ({ page }) => {
    test.setTimeout(150_000);
    await page.addInitScript(placesHost);
    await page.addInitScript(macMark);
    await page.goto("/documents");
    const nav = page.getByRole("navigation", { name: "Folio" });
    await expect(nav.getByRole("link", { name: "Home", exact: true })).toBeVisible({ timeout: 60_000 });
    const button = nav.getByRole("button", { name: /settings and help/ });
    await button.click();
    const menu = page.getByRole("menu");
    await expect(menu.getByText("Ana Example").first()).toBeVisible();
    // The library is where you are: "On this Mac", where it syncs, checked; the account and its workspace open it.
    const library = menu.getByRole("menuitemradio", { name: "On this Mac" });
    await expect(library).toHaveAttribute("aria-checked", "true");
    await expect(library).toContainText("Syncs with iCloud Drive");
    await expect(menu.getByRole("menuitem", { name: "Ana Studio" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Ana Example" })).toHaveAttribute("aria-description", /2 unread/);
    const rows = await menu.getByRole("menuitem").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? e.querySelector("[data-menu-part=label]")?.textContent?.trim() ?? ""));
    expect(rows).toEqual(["Ana Example", "Ana Studio", "Settings", "Sign in to another account…", "Move or copy notes…", "Help"]);
    // No "Sign in to Folevi to share and collaborate" line above the button: signing in is in this menu.
    await expect(nav.getByText("Sign in to Folevi to share and collaborate")).toHaveCount(0);
    // The menu doesn't cover the button.
    expect((await menu.boundingBox())!.y + (await menu.boundingBox())!.height).toBeLessThanOrEqual((await button.boundingBox())!.y);
    await shot(page, "6-library-mac", menu, button);
    await page.keyboard.press("Escape");
    await inDark(page, async () => {
      await button.click();
      await shot(page, "7-library-mac-dark", page.getByRole("menu"), button);
      await page.keyboard.press("Escape");
    });
  });
});
