import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { APP, newPerson, openShare, settle, waitForSaved } from "./helpers";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FoleviiOS/1.0";

/** What the iOS app gives the page before its first script (as iphone-app.spec.ts does): a stand-in bridge. */
function fakeBridge() {
  const calls: string[] = [];
  Object.defineProperty(window, "foleviNative", { value: { platform: "ios", version: "1.0", haptic: (kind: string) => calls.push(kind), setStatusBar: () => undefined, openExternal: async () => true, getSettings: async () => null, setSettings: async () => null, onCommand: () => () => undefined } });
  Object.assign(window, { __haptics: calls });
  const mark = () => document.documentElement?.setAttribute("data-native", "ios");
  mark();
  if (!document.documentElement) new MutationObserver((_, watch) => document.documentElement && (mark(), watch.disconnect())).observe(document, { childList: true });
}

async function newPage(page: Page, title: string) {
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Intro");
  await waitForSaved(page);
}

async function insertBoard(page: Page) {
  await page.keyboard.press("Enter");
  await page.keyboard.type("/sticky");
  await page.getByRole("option", { name: /Sticky notes/ }).first().click();
  const board = page.getByRole("application", { name: /Sticky notes/ });
  await expect(board).toBeVisible();
  return board;
}

test.describe("Sticky notes", () => {
  test.setTimeout(150_000);

  test("add notes in bulk, write, vote, arrange, undo: it persists and publishes", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Sticky Tester");
    await newPage(page, "Retro");
    const board = await insertBoard(page);
    const tools = page.getByRole("toolbar", { name: "Sticky notes tools" });
    await expect(page.getByText("Double-click anywhere to add a note")).toBeVisible();

    // Add several: typed lines and pasted spreadsheet rows, each a note (colours and tags read).
    await tools.getByRole("button", { name: "Add several notes" }).click();
    const bulk = page.getByRole("dialog", { name: "Add several notes" });
    await bulk.getByRole("textbox", { name: "Ideas, one per line" }).fill("- Faster sign up #ux\n[pink] Dark mode\nOffline mode\tLater\tgreen");
    await bulk.getByRole("button", { name: "Add 3 notes" }).click();
    await expect(board.getByRole("button", { name: /^Faster sign up, yellow note, by you, tagged ux/ })).toBeVisible();
    await expect(board.getByRole("button", { name: /^Dark mode, pink note/ })).toBeVisible();
    await expect(board.getByRole("button", { name: /^Offline mode · Later, green note/ })).toBeVisible();
    await expect(page.getByRole("application", { name: "Sticky notes, 3 notes" })).toBeVisible();

    // Write on a note: double-click, type, Enter.
    await board.getByRole("button", { name: /^Dark mode/ }).dblclick();
    await page.keyboard.press("End");
    await page.keyboard.type(" everywhere");
    await page.keyboard.press("Enter");
    await expect(board.getByRole("button", { name: /^Dark mode everywhere, pink note/ })).toBeVisible();

    // Vote twice from the selection bar; the toolbar shows the votes left.
    await board.getByRole("button", { name: /^Dark mode everywhere/ }).click();
    const bar = page.getByRole("toolbar", { name: "Selected note" });
    await bar.getByRole("button", { name: /^Vote/ }).click();
    await bar.getByRole("button", { name: /^Vote/ }).click();
    await expect(board.getByRole("button", { name: /^Dark mode everywhere, pink note, by you, 2 votes, 2 yours/ })).toBeVisible();
    await expect(tools.getByRole("button", { name: "Votes, 3 of 5 left" })).toBeVisible();

    // Colour from the selection bar; undo inside the board puts it back.
    await bar.getByRole("button", { name: "Blue" }).click();
    await expect(board.locator('.st-note[data-color="blue"]')).toHaveCount(1);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(board.locator('.st-note[data-color="blue"]')).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(board.locator('.st-note[data-color="blue"]')).toHaveCount(1);

    // Arrange by votes: labelled groups, most votes first.
    await tools.getByRole("button", { name: "Arrange" }).click();
    await page.getByRole("menuitem", { name: "By votes" }).click();
    await expect(board.getByRole("button", { name: /^Group: 2 votes, 1 note/ })).toBeVisible();
    await expect(board.getByRole("button", { name: /^Group: No votes, 2 notes/ })).toBeVisible();

    // A workshop timer everyone sees.
    await tools.getByRole("button", { name: "Timer" }).click();
    await page.getByRole("menuitem", { name: "5 minutes", exact: true }).click();
    await expect(tools.getByRole("button", { name: /^Timer, 4 minutes \d+ seconds left. Pause/ })).toBeVisible();

    // The board and its toolbars pass axe in light and dark.
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.evaluate((t) => (document.documentElement.dataset.theme = t), scheme);
      await settle(page);
      const results = await new AxeBuilder({ page }).include(".fb-stickies").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
    }
    await page.emulateMedia({ colorScheme: "light" });
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));

    // Full canvas and back.
    await board.click({ position: { x: 20, y: 120 } });
    await page.keyboard.press("ControlOrMeta+Shift+f");
    await expect(page.locator(".fb-stickies .fb-canvas-card[data-full]")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".fb-stickies .fb-canvas-card[data-full]")).toHaveCount(0);

    await waitForSaved(page);
    await page.waitForTimeout(800);
    await waitForSaved(page);
    await page.reload();
    const again = page.getByRole("application", { name: "Sticky notes, 3 notes" });
    await expect(again).toBeVisible();
    await expect(again.getByRole("button", { name: /^Dark mode everywhere, blue note, by you, 2 votes, 2 yours/ })).toBeVisible();
    await expect(page.getByRole("toolbar", { name: "Sticky notes tools" }).getByRole("button", { name: /^Timer, 4 minutes/ })).toBeVisible();

    // The public share page draws the board, read-only, with zoom.
    await openShare(page);
    const share = page.getByRole("dialog", { name: /Share/ });
    await share.getByRole("button", { name: "Create link" }).click();
    const link = await share.getByLabel("Public link").inputValue();
    const anon = await browser.newContext();
    const anonPage = await anon.newPage();
    await anonPage.goto(link);
    const shared = anonPage.getByRole("group", { name: "Sticky notes board, 3 notes" });
    await expect(shared).toBeVisible();
    await expect(shared.getByText("Dark mode everywhere").first()).toBeVisible();
    await shared.getByRole("button", { name: "Zoom in" }).click();
    await anon.close();
    await context.close();
  });

  test("keyboard: Enter adds a note, Tab while writing adds the next, Delete removes; selected notes become to-dos", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Sticky Keys");
    await newPage(page, "Ideas");
    const board = await insertBoard(page);
    await board.click({ position: { x: 200, y: 200 } });
    await page.keyboard.press("Enter");
    await page.keyboard.type("First idea");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Second idea");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("application", { name: "Sticky notes, 2 notes" })).toBeVisible();
    // ⌘A then Turn into to-dos: to-do blocks under the board.
    await page.keyboard.press("ControlOrMeta+a");
    await page.getByRole("toolbar", { name: "2 selected notes" }).getByRole("button", { name: "Turn into to-dos in the note" }).click();
    await expect(page.locator(".fb-editor .fb-todo").getByText("First idea", { exact: true })).toBeVisible();
    await expect(page.locator(".fb-editor .fb-todo")).toHaveCount(2);
    // Back on the board, Delete removes the chosen note.
    await board.getByRole("button", { name: /^Second idea/ }).click();
    await page.keyboard.press("Delete");
    await expect(page.getByRole("application", { name: "Sticky notes, 1 note" })).toBeVisible();
    // Pasting spreadsheet rows (or a list) on the board makes a note for each row.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.evaluate(() => navigator.clipboard.writeText("Hire a designer\tTeam\nPlan the offsite\tTeam\tblue\n"));
    await board.click({ position: { x: 30, y: 300 } });
    await page.keyboard.press("ControlOrMeta+v");
    await expect(page.getByRole("application", { name: "Sticky notes, 3 notes" })).toBeVisible();
    await expect(board.getByRole("button", { name: /^Plan the offsite · Team, blue note/ })).toBeVisible();
    await context.close();
  });

  test("iPhone app: tap to choose, drag a note with a finger, panels are sheets, 44 point controls", async ({ browser }) => {
    const { context: desk, page: deskPage } = await newPerson(browser, "Sticky Phone");
    await newPage(deskPage, "Phone board");
    await insertBoard(deskPage);
    await deskPage.getByRole("toolbar", { name: "Sticky notes tools" }).getByRole("button", { name: "Add several notes" }).click();
    await deskPage.getByRole("dialog", { name: "Add several notes" }).getByRole("textbox").fill("Call the bank\nBook flights");
    await deskPage.getByRole("button", { name: "Add 2 notes" }).click();
    await waitForSaved(deskPage);
    const url = deskPage.url().replace(/\?.*$/, "");
    const state = await desk.storageState();
    await desk.close();

    const context = await browser.newContext({ storageState: state, viewport: { width: 402, height: 874 }, userAgent: IPHONE_UA, hasTouch: true });
    await context.addInitScript(fakeBridge);
    const page = await context.newPage();
    await page.goto(url.replace(/^https?:\/\/[^/]+/, APP));
    await expect(page.locator("html")).toHaveAttribute("data-iphone", "", { timeout: 30_000 });
    const board = page.getByRole("application", { name: "Sticky notes, 2 notes" });
    await expect(board).toBeVisible({ timeout: 30_000 });
    const note = board.getByRole("button", { name: /^Call the bank/ });
    await note.tap();
    await expect(note).toHaveAttribute("aria-pressed", "true");
    const bar = page.getByRole("toolbar", { name: "Selected note" });
    const size = await bar.getByRole("button", { name: "Duplicate" }).boundingBox();
    expect(size!.height).toBeGreaterThanOrEqual(44);
    // A finger drags the note (touch events, as the iPhone sends them).
    const before = await note.boundingBox();
    const cdp = await context.newCDPSession(page);
    const at = (dx: number) => [{ x: before!.x + before!.width / 2 + dx, y: before!.y + before!.height / 2 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(0) });
    for (const dx of [10, 30, 60, 90]) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(dx) });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(async () => (await note.boundingBox())!.x - before!.x).toBeGreaterThan(40);
    expect(await page.evaluate(() => (window as unknown as { __haptics: string[] }).__haptics)).toContain("light");
    // Panels open as the app's sheets.
    await page.getByRole("toolbar", { name: "Sticky notes tools" }).getByRole("button", { name: "Add several notes" }).click();
    await expect(page.getByRole("dialog", { name: "Add several notes" })).toBeVisible();
    await context.close();
  });
});
