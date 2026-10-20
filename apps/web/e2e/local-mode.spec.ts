// The whole product in local mode (docs/LOCAL_MODE_PLAN.md §5.2, WP10): every main view opens and works on the
// library with a FakeShell in the page and Folevi and Convex blocked (e2e/fixtures/localShell.ts), no server-only
// function is ever called, and every account-only surface is gone (the one "Sign in to Folevi to share and
// collaborate" note stands where it helps). Local project only:
//   E2E_LOCAL_BASE_URL=http://localhost:3003 E2E_BASE_URL=http://app.localhost:3002 E2E_NO_SERVER=1 \
//     npx playwright test e2e/local-mode.spec.ts --project local
import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures/localShell";
import { settle } from "./helpers";

const NOTE = "Sign in to Folevi to share and collaborate";

/**
 * What went wrong in the page: a call to a function local mode doesn't have (lib/local/registry.ts logs each one
 * in development), an uncaught error, or the "This page couldn't load" screen.
 */
function watchPage(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && m.text().startsWith("[local mode]")) problems.push(m.text());
  });
  page.on("pageerror", (e) => problems.push(`uncaught: ${e.message}`));
  return problems;
}

async function expectNoProblems(page: Page, problems: string[]) {
  await expect(page.getByText("This page couldn’t load")).toHaveCount(0);
  expect(problems, "local mode called a server-only function or failed").toEqual([]);
}

const sidebar = (page: Page) => page.getByRole("navigation", { name: "Folio" });

async function openHome(page: Page) {
  await page.goto("/documents");
  await expect(sidebar(page).getByRole("link", { name: "Home", exact: true })).toBeVisible({ timeout: 60_000 });
}

/** Everything an account has that a library doesn't, checked wherever the page is. */
async function expectNoAccountChrome(page: Page) {
  const nav = sidebar(page);
  await expect(nav.getByRole("link", { name: "Shared with Me" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: /^Changes/ })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Work with Foli AI" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Notifications/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Personal, workspaces and account/ })).toHaveCount(0);
  await expect(page.getByText(/Upgrade to Pro|See plans|Choose plan|trial ·/)).toHaveCount(0);
}

async function scan(page: Page, label: string) {
  await settle(page);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).disableRules(["region"]).analyze();
  expect(results.violations.map((v) => `${label}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

async function newNote(page: Page, title: string) {
  await page.getByRole("button", { name: "New note", exact: true }).first().click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}/);
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Intro");
}

async function caretToEnd(page: Page) {
  await page.locator(".fb-editor > p.fb:visible").last().click();
  await page.keyboard.press("End");
}

/** The caret at the end of the note's first line ("Intro"): an insert lands right under it, at the top level. */
async function caretToIntro(page: Page) {
  await page.locator(".fb-editor > p.fb", { hasText: "Intro" }).first().click();
  await page.keyboard.press("End");
}

/** Closes whatever an insert opened (a prompt, a picker, a popover). */
async function dismiss(page: Page) {
  for (let i = 0; i < 2; i++) {
    if (!(await page.getByRole("dialog").count())) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
  }
}

test.describe("local mode", { tag: "@local" }, () => {
  test.beforeEach(({ backendMode }) => {
    test.skip(backendMode !== "local", "local mode only");
  });

  test("Home, the sidebar and the workspace switcher's place have no account surfaces", async ({ page }) => {
    test.setTimeout(150_000);
    const problems = watchPage(page);
    await openHome(page);
    await expectNoAccountChrome(page);
    // The one note sits where the workspace switcher was; the menu there has the library's own items.
    await expect(sidebar(page).getByText(NOTE)).toBeVisible();
    await sidebar(page).getByRole("button", { name: /settings and help/ }).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { name: "Settings" })).toBeVisible();
    for (const gone of ["New workspace…", "Account settings", "Plan & billing", "Security", "Devices", "Sign out", "Invite people…"]) await expect(menu.getByRole("menuitem", { name: gone, exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expectNoProblems(page, problems);
  });

  test("a note: typing, every block from the Insert panel, Share and Comments say what needs an account", async ({ page }) => {
    test.setTimeout(240_000);
    const problems = watchPage(page);
    page.on("filechooser", (chooser) =>
      void chooser
        .setFiles({ name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("local file") })
        .catch(() => undefined),
    );
    await openHome(page);
    await newNote(page, "Local blocks");
    await expect(page.locator(".fb-editor")).toContainText("Intro");

    // Share: the note, not the dialog.
    await page.getByRole("group", { name: "Page" }).getByRole("button", { name: /^Share/ }).click();
    const share = page.getByRole("dialog", { name: "Share" });
    await expect(share.getByText(NOTE)).toBeVisible();
    await expect(page.getByRole("button", { name: "Create link" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // No Foli AI in the dock, and the @ menu has dates and pages but no people.
    await expect(page.getByRole("toolbar", { name: "Page tools" }).getByRole("button", { name: "Foli AI" })).toHaveCount(0);
    await caretToEnd(page);
    await page.keyboard.type(" @");
    const mention = page.getByRole("listbox");
    await expect(mention.getByRole("option", { name: /Today/ })).toBeVisible();
    await expect(mention.getByRole("option", { name: /you$/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");

    // Every tile in the Insert panel, one after another, at the end of the note.
    const tools = page.getByRole("toolbar", { name: "Page tools" });
    await tools.getByRole("button", { name: "Insert", exact: true }).click();
    const panel = page.getByRole("region", { name: "Insert", exact: true });
    await expect(panel.getByText("Drag and drop any item to the document")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Image from Unsplash" })).toHaveCount(0);
    const titles = [...new Set(await panel.locator("button[title]").evaluateAll((els) => els.map((el) => el.getAttribute("title") ?? "")))].filter(Boolean);
    expect(titles.length).toBeGreaterThan(30);
    // A page or a card opens the new page: those go last.
    const order = [...titles.filter((t) => t !== "Page" && t !== "Card"), "Card", "Page"];
    const start = page.url();
    for (const title of order) {
      await caretToIntro(page);
      const before = await page.locator(".fb-editor > *").count();
      await panel.locator(`button[title="${title}"]`).first().click();
      if (title === "Page" || title === "Card") {
        await page.waitForURL((url) => url.href !== start && /\/d\/[0-9A-Z]{26}/.test(url.pathname));
        break;
      }
      // A bookmark or an embed asks for its address.
      if (title === "Bookmark" || title === "Embed") {
        const field = page.getByRole("dialog").getByRole("textbox").first();
        await field.fill(title === "Bookmark" ? "https://example.com/" : "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
        await field.press("Enter");
      }
      await page.waitForTimeout(300);
      await dismiss(page);
      // Something went in (a recording, a date or a synced block waits for a choice first).
      if (!["Audio recording", "Date", "Synced block"].includes(title)) await expect.poll(() => page.locator(".fb-editor > *").count(), { message: title }).toBeGreaterThan(before);
    }
    await page.goto(start);
    await expect(page.locator(".fb-editor")).toContainText("Intro");

    // The page sidebar's Comments tab: the note.
    await page.getByRole("tablist", { name: "Page tools" }).getByRole("tab", { name: /^Comments/ }).click();
    await expect(page.getByRole("tabpanel").getByText(NOTE)).toBeVisible();
    await expectNoProblems(page, problems);
  });

  test("Tasks, Calendar, Search, Settings, Trash, Templates and a collection open", async ({ page }) => {
    test.setTimeout(240_000);
    const problems = watchPage(page);
    await openHome(page);

    await sidebar(page).getByRole("link", { name: /^Tasks/ }).click();
    await expect(page).toHaveURL(/\/tasks\/today/);
    await expect(page.getByRole("heading", { name: "Tasks", level: 1 })).toBeVisible();
    await expectNoAccountChrome(page);

    await sidebar(page).getByRole("link", { name: "Calendar", exact: true }).click();
    await expect(page).toHaveURL(/\/calendar/);
    await expect(page.getByRole("button", { name: "Subscribe" })).toHaveCount(0);

    // ⌘K: the palette searches the library.
    await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
    const palette = page.getByRole("dialog").filter({ has: page.getByRole("combobox") }).first();
    await expect(palette).toBeVisible();
    await page.keyboard.type("welcome");
    await expect(palette.getByRole("option").first()).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press("Escape");

    // Settings: the library's sections only.
    await page.goto("/settings");
    const sections = page.getByRole("navigation", { name: "Settings sections" });
    // Local mode's Settings opens on the library's own section (WP10b).
    await expect(sections.getByRole("link", { name: "Library" })).toHaveAttribute("aria-current", "page");
    for (const gone of ["Account", "AI", "Plan & billing", "Security", "Devices", "Connected apps", "Notifications"]) await expect(sections.getByRole("link", { name: gone, exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create a workspace" })).toHaveCount(0);
    await sections.getByRole("link", { name: "Import & export" }).click();
    await expect(page.getByRole("heading", { name: "Import & export", level: 2 })).toBeVisible();
    await expect(page.getByText("Save from anywhere")).toHaveCount(0);
    // An account's section by its address: back to the first one here.
    await page.goto("/settings/billing");
    await expect(page).toHaveURL(/\/settings\/library/);

    // Account-only pages say what they need.
    for (const path of ["/changes", "/shared"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: NOTE })).toBeVisible();
    }

    for (const [path, heading] of [
      ["/trash", "Trash"],
      ["/templates", "Templates"],
      ["/help", "Help"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
    }
    await expect(page.getByRole("link", { name: "Email support" })).toHaveAttribute("href", "mailto:support@folevi.com");

    // A collection, with a row.
    await openHome(page);
    await newNote(page, "Local collection");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/collection");
    await expect(page.getByRole("option", { name: /Collection/ }).first()).toBeVisible();
    await page.keyboard.press("Enter");
    const coll = page.getByRole("region", { name: /^Collection / });
    await expect(coll).toBeVisible({ timeout: 20_000 });
    await coll.getByRole("button", { name: "New row" }).click();
    await coll.getByRole("textbox", { name: "Row name" }).first().fill("A local row");
    await coll.getByRole("textbox", { name: "Row name" }).first().press("Enter");
    await expect(coll.getByRole("textbox", { name: "Row name" }).first()).toHaveValue("A local row");
    await expectNoProblems(page, problems);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`axe: Home, a note, Settings and Tasks (${scheme})`, async ({ page }) => {
      test.setTimeout(180_000);
      const problems = watchPage(page);
      await page.emulateMedia({ colorScheme: scheme });
      await openHome(page);
      await scan(page, "home");
      await newNote(page, `Axe ${scheme}`);
      await scan(page, "note");
      await page.goto("/settings");
      await expect(page.getByRole("navigation", { name: "Settings sections" })).toBeVisible();
      await scan(page, "settings");
      await page.goto("/tasks/today");
      await expect(page.getByRole("heading", { name: "Tasks", level: 1 })).toBeVisible();
      await scan(page, "tasks");
      await page.goto("/changes");
      await expect(page.getByRole("heading", { name: NOTE })).toBeVisible();
      await scan(page, "changes");
      await expectNoProblems(page, problems);
    });
  }

  test("phone width: Home, a note and Settings", async ({ page }) => {
    test.setTimeout(150_000);
    const problems = watchPage(page);
    const noScroll = async (where: string) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), where).toBeLessThanOrEqual(1);
    await openHome(page);
    await newNote(page, "Phone note");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".fb-editor")).toContainText("Intro");
    await noScroll("note");
    await page.goto("/documents");
    await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible({ timeout: 30_000 });
    await noScroll("home");
    // The sidebar is a drawer on a phone.
    await page.getByRole("button", { name: "Show sidebar" }).click();
    const drawer: Locator = sidebar(page);
    await expect(drawer.getByText(NOTE)).toBeVisible();
    await expect(drawer.getByRole("link", { name: "Shared with Me" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.goto("/settings");
    await expect(page.getByRole("navigation", { name: "Settings sections" })).toBeVisible();
    await noScroll("settings");
    await expectNoProblems(page, problems);
  });
});
