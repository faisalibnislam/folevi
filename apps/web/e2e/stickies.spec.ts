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

  test("phone width: the toolbar folds into More instead of scrolling; Escape closes a panel from a toolbar button", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Sticky Narrow");
    await newPage(page, "Narrow board");
    const board = await insertBoard(page);
    const tools = page.getByRole("toolbar", { name: "Sticky notes tools" });

    // Wide: every tool fits, nothing folds. Escape with the keyboard on a toolbar button closes the open
    // panel, and the keyboard stays on that button.
    await expect(tools.getByRole("button", { name: "More sticky notes tools" })).toHaveCount(0);
    const bulkButton = tools.getByRole("button", { name: "Add several notes" });
    await bulkButton.click();
    const bulk = page.getByRole("dialog", { name: "Add several notes" });
    await expect(bulk).toBeVisible();
    await bulkButton.focus();
    await page.keyboard.press("Escape");
    await expect(bulk).toHaveCount(0);
    await expect(bulkButton).toBeFocused();
    // From inside the panel, Escape closes it and the keyboard goes back to the board.
    await bulkButton.click();
    await expect(bulk.getByRole("textbox")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(bulk).toHaveCount(0);
    await expect(page.locator(".fb-stickies .fb-canvas-body")).toBeFocused();

    // A phone's width: the toolbar fits the card (no sideways scrolling), and what doesn't fit is in More.
    await page.setViewportSize({ width: 375, height: 812 });
    const fits = () => tools.evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && [...el.querySelectorAll("button")].filter((b) => b.offsetParent).every((b) => b.getBoundingClientRect().right <= el.getBoundingClientRect().right + 1));
    await expect.poll(fits).toBe(true);
    const more = tools.getByRole("button", { name: "More sticky notes tools" });
    await expect(more).toBeVisible();
    await expect(tools.getByRole("button", { name: "Add a note" })).toBeVisible();
    // The block's name goes first; the toolbar still says it.
    await expect(page.locator(".fb-stickies .fb-vc-name")).toHaveAttribute("data-squeezed", "");

    // Group area is a checkbox in More (on or off), and stays checked.
    await more.click();
    await page.getByRole("menuitemcheckbox", { name: "Group area" }).click();
    await more.click();
    await expect(page.getByRole("menuitemcheckbox", { name: "Group area" })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await expect(more).toBeFocused();
    // Escape on the board ends the group tool.
    await board.click({ position: { x: 60, y: 200 } });
    await page.keyboard.press("Escape");

    // A timer started from More shows its countdown in the bar (a running timer always stays in sight).
    await more.click();
    await page.getByRole("menuitem", { name: "5 minutes", exact: true }).click();
    await expect(tools.getByRole("button", { name: /^Timer, 4 minutes \d+ seconds left. Pause/ })).toBeVisible();
    await expect.poll(fits).toBe(true);

    // A panel opened from More closes with Escape from a toolbar button too.
    const openBulk = async () => {
      if (await tools.getByRole("button", { name: "Add several notes" }).isVisible()) await tools.getByRole("button", { name: "Add several notes" }).click();
      else {
        await more.click();
        await page.getByRole("menuitem", { name: "Add several notes" }).click();
      }
    };
    await openBulk();
    await expect(bulk).toBeVisible();
    await tools.getByRole("button", { name: "Add a note" }).focus();
    await page.keyboard.press("Escape");
    await expect(bulk).toHaveCount(0);
    await expect(tools.getByRole("button", { name: "Add a note" })).toBeFocused();

    // The selection bar fits too.
    await openBulk();
    await bulk.getByRole("textbox").fill("One\nTwo");
    await bulk.getByRole("button", { name: "Add 2 notes" }).click();
    await board.getByRole("button", { name: /^One, yellow note/ }).click();
    const selBar = page.getByRole("toolbar", { name: "Selected note" });
    await expect(selBar).toBeVisible();
    await expect.poll(() => selBar.evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && el.getBoundingClientRect().left >= el.parentElement!.getBoundingClientRect().left - 1 && el.getBoundingClientRect().right <= el.parentElement!.getBoundingClientRect().right + 1)).toBe(true);
    await expect(selBar.getByRole("button", { name: "Delete" })).toBeVisible();

    // Full canvas at a phone's width: the toolbar fits the window.
    await board.click({ position: { x: 20, y: 300 } });
    await page.keyboard.press("ControlOrMeta+Shift+f");
    await expect(page.locator(".fb-stickies .fb-canvas-card[data-full]")).toBeVisible();
    await expect.poll(fits).toBe(true);
    await page.keyboard.press("Escape");
    await context.close();
  });

  test("the workshop timer counts down from server time, so a device whose clock is off agrees", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Sticky Clock");
    await newPage(page, "Timed board");
    await insertBoard(page);
    await waitForSaved(page);
    const url = page.url().replace(/\?.*$/, "");
    const tools = page.getByRole("toolbar", { name: "Sticky notes tools" });

    // A second device of the same person whose clock runs two and a half minutes fast.
    const skewed = await browser.newContext({ storageState: await context.storageState() });
    await skewed.addInitScript(() => {
      const real = Date.now.bind(Date);
      Date.now = () => real() + 150_000;
    });
    const other = await skewed.newPage();
    await other.goto(url);
    const otherTools = other.getByRole("toolbar", { name: "Sticky notes tools" });
    await expect(otherTools).toBeVisible({ timeout: 30_000 });
    // It works out how far its clock is from the server's, once (kept for the session).
    await expect.poll(() => other.evaluate(() => sessionStorage.getItem("folevi:server-clock")), { timeout: 15_000 }).not.toBeNull();
    const offset = Number(await other.evaluate(() => sessionStorage.getItem("folevi:server-clock")));
    expect(Math.abs(offset + 150_000)).toBeLessThan(5_000);

    // Started on the first device, the skewed one shows the same time left (not two and a half minutes less).
    await tools.getByRole("button", { name: "Timer" }).click();
    await page.getByRole("menuitem", { name: "5 minutes", exact: true }).click();
    await expect(tools.getByRole("button", { name: /^Timer, 4 minutes \d+ seconds left/ })).toBeVisible();
    await expect(otherTools.getByRole("button", { name: /^Timer, 4 minutes \d+ seconds left/ })).toBeVisible({ timeout: 15_000 });

    // Restarted on the skewed device, the first agrees.
    await otherTools.getByRole("button", { name: "Timer options" }).click();
    await other.getByRole("menuitem", { name: "Restart at 10 minutes" }).click();
    await expect(otherTools.getByRole("button", { name: /^Timer, 9 minutes \d+ seconds left/ })).toBeVisible();
    await expect(tools.getByRole("button", { name: /^Timer, 9 minutes \d+ seconds left/ })).toBeVisible({ timeout: 15_000 });
    await skewed.close();
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
    const size = await bar.getByRole("button", { name: "Delete" }).boundingBox();
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
    // The toolbar fits the phone: what doesn't fit is in More, with 44 point rows.
    const tools = page.getByRole("toolbar", { name: "Sticky notes tools" });
    await expect.poll(() => tools.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    const more = tools.getByRole("button", { name: "More sticky notes tools" });
    expect((await more.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await more.tap();
    const row = page.getByRole("menu", { name: "More sticky notes tools" }).getByRole("menuitemcheckbox", { name: "Group area" });
    await expect(row).toBeVisible();
    await settle(page);
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // Taller than the phone, it starts on screen and scrolls inside (its first items were above the screen).
    const menuBox = (await page.getByRole("menu", { name: "More sticky notes tools" }).boundingBox())!;
    expect(menuBox.y).toBeGreaterThanOrEqual(0);
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(874);
    await page.keyboard.press("Escape");
    // Panels open as the app's sheets.
    if (await tools.getByRole("button", { name: "Add several notes" }).isVisible()) await tools.getByRole("button", { name: "Add several notes" }).tap();
    else {
      await more.tap();
      await page.getByRole("menuitem", { name: "Add several notes" }).tap();
    }
    await expect(page.getByRole("dialog", { name: "Add several notes" })).toBeVisible();
    await context.close();
  });
});
