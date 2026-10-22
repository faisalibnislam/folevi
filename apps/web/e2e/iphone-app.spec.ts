// The iPhone app's own interface (components/iphone): inside the iOS app on an iPhone, the web app becomes a
// navigation stack with large titles, a floating glass tab bar and sheets. Here the page gets what the app
// gives it before its first script (a stand-in bridge, <html data-native="ios">, as ios-app.spec.ts does) in
// an iPhone-sized window with an iPhone's user agent. The same account in an ordinary phone browser keeps the
// mobile web layout.
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

const haptics = (page: Page) => page.evaluate(() => (window as unknown as { __native: { calls: { method: string; arg?: unknown }[] } }).__native.calls.filter((c) => c.method === "haptic").map((c) => c.arg));

test("the iPhone app: tab bar, large titles, Back, the + menu and sheets", async ({ browser }) => {
  test.setTimeout(180_000);
  const { context: signedIn } = await newPerson(browser, "iPhone Person");
  const state = await signedIn.storageState();
  await signedIn.close();

  // In a phone's browser: the mobile web layout, no tab bar.
  const web = await browser.newContext({ storageState: state, viewport: { width: 390, height: 844 }, userAgent: IPHONE_UA, hasTouch: true });
  const browserPage = await web.newPage();
  await browserPage.goto(`${APP}/documents`);
  await expect(browserPage.getByRole("button", { name: "Show sidebar" })).toBeVisible({ timeout: 30_000 });
  await expect(browserPage.getByRole("navigation", { name: "Tabs" })).toHaveCount(0);
  await expect(browserPage.locator("html")).not.toHaveAttribute("data-iphone", "");
  await web.close();

  // In the iPhone app.
  const context = await browser.newContext({ storageState: state, viewport: { width: 402, height: 874 }, userAgent: IPHONE_UA, hasTouch: true });
  await context.addInitScript(fakeBridge);
  const page = await context.newPage();
  await page.goto(`${APP}/documents`);
  await expect(page.locator("html")).toHaveAttribute("data-iphone", "", { timeout: 30_000 });

  // Home: a large title, the account button, search, and the floating tab bar (Home is the current tab).
  const tabs = page.getByRole("navigation", { name: "Tabs" });
  await expect(tabs).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Personal: account and places" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Search in Personal" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show sidebar" })).toHaveCount(0);
  // Tab roots have no Back button.
  await expect(page.getByRole("button", { name: "Back", exact: true })).toHaveCount(0);

  // All notes is pushed: its own large title and a Back button that returns Home.
  await page.getByRole("link", { name: "All notes" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "All notes" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Select" })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

  // The account sheet: places, Settings, Sign out.
  await page.getByRole("button", { name: "Personal: account and places" }).click();
  const account = page.getByRole("dialog", { name: "Account" });
  await expect(account).toBeVisible();
  await expect(account.getByRole("button", { name: /^Personal/ })).toHaveAttribute("aria-pressed", "true");
  await expect(account.getByRole("button", { name: "Sign out" })).toBeVisible();
  await account.getByRole("button", { name: "Close" }).click();
  await expect(account).toHaveCount(0);

  // The + menu: New note, From template, New folder, Quick task.
  await page.getByRole("button", { name: "Create" }).click();
  const menu = page.getByRole("menu", { name: "Create" });
  for (const item of ["New note", "From template", "New folder", "Quick task"]) await expect(menu.getByRole("menuitem", { name: item })).toBeVisible();
  await menu.getByRole("menuitem", { name: "New folder" }).click();
  // New folder is a glass card: a name, a colour, Create.
  const sheet = page.getByRole("dialog", { name: "New folder" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Create" })).toBeDisabled();
  await sheet.getByPlaceholder("Folder name").fill("Garden plans");
  await sheet.getByRole("radiogroup", { name: "Color" }).getByRole("radio").nth(3).click();
  await sheet.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Garden plans" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Back", exact: true })).toBeVisible();

  // Tasks: its own tab, a large title, the views as chips, + goes straight to Quick task (a sheet).
  await tabs.getByRole("link", { name: "Tasks" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Tasks" })).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Tasks" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "Task views" }).getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Quick task" }).click();
  const quick = page.getByRole("dialog", { name: "Quick add task" });
  await expect(quick).toBeVisible();
  await expect(quick.locator("[data-iphone-sheet]")).toHaveCount(1);
  // The sheet has no Close button (it sits on the keyboard): a tap on the dimmed page above it closes it.
  await quick.locator("[data-sheet-scrim]").click({ position: { x: 200, y: 40 } });
  await expect(quick).toHaveCount(0);
  // Picking another tab is felt.
  expect(await haptics(page)).toContain("light");

  // Calendar: the agenda under the week strip, today picked in it.
  await tabs.getByRole("link", { name: "Calendar" }).click();
  await expect(page.getByRole("button", { name: /^Today, / })).toHaveAttribute("aria-pressed", "true");

  // Each tab keeps its own stack: Home comes back on the folder it was showing, with Back to Home; Tasks
  // still on Today. Tapping the tab you're on goes back to its first screen.
  await tabs.getByRole("link", { name: "Home" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Garden plans" })).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  await tabs.getByRole("link", { name: "Tasks" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Tasks" })).toBeVisible();
  await tabs.getByRole("link", { name: "Home" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Garden plans" })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Back", exact: true })).toHaveCount(0);
  // Home's folders are the app's own folder cards, and their "…" stays hidden (a long press opens it).
  const card = page.getByRole("list", { name: "Folders" }).getByRole("link", { name: /^Garden plans, / });
  await expect(card).toBeVisible();
  const dots = page.getByRole("list", { name: "Folders" }).getByRole("button", { name: "Folder options for Garden plans" });
  expect(await dots.evaluate((b) => getComputedStyle(b.closest(".pointer-coarse\\:opacity-100") ?? b).opacity)).toBe("0");
  // Back again has nowhere to go in this tab: the history is only Home's stack.
  expect(await page.evaluate(() => (history.state as { foleviAt?: number } | null)?.foleviAt)).toBe(0);
  await page.getByRole("link", { name: "All notes" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "All notes" })).toBeVisible();
  await tabs.getByRole("link", { name: "Home" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

  // A note: full screen, Back and its actions at the top, its tools in floating bars (no tab bar).
  await page.getByRole("button", { name: "Create" }).click();
  await page.getByRole("menuitem", { name: "New note" }).click();
  await expect(page).toHaveURL(/\/d\//);
  // A new note starts in its title, with the keyboard up: the bars wait until it goes down.
  await expect(page.getByRole("toolbar", { name: "Note tools" })).toBeHidden();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect(page.getByRole("toolbar", { name: "Note tools" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Tabs" })).toBeHidden();
  await expect(page.getByRole("group", { name: "Note actions" }).getByRole("button", { name: "Document actions" })).toBeVisible();
  // Format opens as a sheet.
  await page.getByRole("toolbar", { name: "Note tools" }).getByRole("button", { name: "Format" }).click();
  await expect(page.getByRole("dialog", { name: "Format" })).toBeVisible();
  await page.getByRole("dialog", { name: "Format" }).getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog", { name: "Format" })).toHaveCount(0);
  // Back goes to where the note was opened from.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

  // Settings is a grouped list; a section is its own screen.
  await page.goto(`${APP}/settings`);
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("link", { name: "Appearance" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Appearance" })).toBeVisible();

  await context.close();
});

const IPAD_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) FoleviiOS/1.0";

test("the iPad app in a narrow window (Slide Over, a third of Split View) takes the compact interface, and the sidebar back when wider", async ({ browser }) => {
  test.setTimeout(120_000);
  const { context: signedIn } = await newPerson(browser, "iPad Person");
  const state = await signedIn.storageState();
  await signedIn.close();
  const context = await browser.newContext({ storageState: state, viewport: { width: 375, height: 900 }, userAgent: IPAD_UA, hasTouch: true });
  await context.addInitScript(fakeBridge);
  // An iPad's web view reports a Mac with a touch screen.
  await context.addInitScript(() => Object.defineProperty(Navigator.prototype, "maxTouchPoints", { get: () => 5 }));
  const page = await context.newPage();
  await page.goto(`${APP}/documents`);
  await expect(page.locator("html")).toHaveAttribute("data-iphone", "", { timeout: 30_000 });
  await expect(page.getByRole("navigation", { name: "Tabs" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  // Wider (a half or two thirds of Split View, full screen): the sidebar layout again, in place.
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(page.getByRole("navigation", { name: "Tabs" })).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute("data-iphone", "");
  await expect(page.getByRole("navigation", { name: "Folio" })).toBeVisible();
  // ...in iPadOS's look (WP5): <html data-ipad>, the tabs kept as iPad tabs with 44 pt round buttons, no
  // floating Ask Foli AI pill, no ⌘K hint without a keyboard.
  await expect(page.locator("html")).toHaveAttribute("data-ipad", "");
  const strip = page.locator("[data-ipad-tabs]");
  await expect(strip).toBeVisible();
  expect((await strip.getByRole("button", { name: "New note", exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(page.locator(".ui-fab")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Folio" }).locator(".ui-kbd")).toBeHidden();
  // Settings: iPadOS Settings' two columns, every account section drawn as the iPhone's grouped lists.
  await page.goto(`${APP}/settings/account`);
  const sections = page.getByRole("navigation", { name: "Settings sections" });
  await expect(sections.getByRole("link", { name: "Account", exact: true })).toHaveAttribute("aria-current", "page", { timeout: 30_000 });
  for (const name of ["Account", "AI", "Security", "Appearance", "Notifications"]) {
    await sections.getByRole("link", { name, exact: true }).click();
    await expect(page.locator("main").getByRole("heading", { level: 2, name, exact: true })).toBeVisible();
    await expect(page.locator("main select, main input[type=range], main input[type=checkbox]")).toHaveCount(0);
  }
  if (process.env.IPAD_SHOTS) await page.screenshot({ path: `${process.env.IPAD_SHOTS}/ipad-settings-account.png` });
  await page.goto(`${APP}/documents`);
  await expect(page.getByRole("navigation", { name: "Folio" })).toBeVisible({ timeout: 30_000 });
  // And narrow again.
  await page.setViewportSize({ width: 360, height: 900 });
  await expect(page.getByRole("navigation", { name: "Tabs" })).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-ipad", "");
  await context.close();
});
