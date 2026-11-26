// Folevi's own spell check and next-word prediction in the note (docs/SPELLING_PLAN.md), in a real browser:
// the red underline (one: the browser's own is off), the suggestions in the right-click menu and in the bubble
// under a clicked word, Add to dictionary and Ignore, the gray next word that Tab takes (and Tab, Tab), Esc,
// and Tab indenting as before when nothing is showing. Local mode (a FakeShell), in Chromium and WebKit:
//   npx playwright test e2e/spelling.spec.ts --project local --project mac-webkit
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures/localShell";

async function newNote(page: Page, title: string): Promise<Locator> {
  // (WebKit in local mode now and then ignores the first click while the library is still opening.)
  await expect(async () => {
    await page.getByRole("button", { name: "New note", exact: true }).first().click();
    await page.waitForURL(/\/d\/[0-9A-Z]{26}/, { timeout: 10_000 });
  }).toPass({ timeout: 60_000 });
  const t = page.getByRole("textbox", { name: "Title" });
  await expect(t).toBeFocused();
  await t.fill(title);
  await page.keyboard.press("Enter");
  const body = page.getByRole("textbox", { name: "Document body" });
  await expect(body).toBeFocused();
  return body;
}

/** To the line's end or start (WebKit on a Mac moves with ⌘← and ⌘→; End and Home scroll there). */
async function lineKey(page: Page, browserName: string, to: "end" | "start") {
  const mac = browserName === "webkit" && process.platform === "darwin";
  await page.keyboard.press(mac ? (to === "end" ? "Meta+ArrowRight" : "Meta+ArrowLeft") : to === "end" ? "End" : "Home");
}

const underlined = (page: Page, word: string) => page.locator(".fb-misspelt", { hasText: new RegExp(`^${word}$`) });

test.describe("spell check and prediction", { tag: ["@local", "@mac"] }, () => {
  test.beforeEach(async ({ page, backendMode }) => {
    test.skip(backendMode !== "local", "local mode only");
    test.setTimeout(180_000);
    await page.goto("/documents");
    await expect(page.getByRole("button", { name: "New note", exact: true }).first()).toBeVisible({ timeout: 60_000 });
  });

  test("underlines, suggestions in the menu and the bubble, Add to dictionary and Ignore", async ({ page, browserName }) => {
    const body = await newNote(page, "Spelling");
    // The browser's own spelling is off in the note: there's only Folevi's underline.
    await expect(body).toHaveAttribute("spellcheck", "false");
    await page.keyboard.type("This sentense has a mispelled word and a zorblat here. ");

    // The red underline, announced as a spelling error.
    await expect(underlined(page, "sentense")).toBeVisible({ timeout: 30_000 });
    await expect(underlined(page, "sentense")).toHaveAttribute("aria-invalid", "spelling");
    await expect(underlined(page, "mispelled")).toBeVisible();
    await expect(underlined(page, "has")).toHaveCount(0);

    // Right-click: the suggestions first, then Add to dictionary and Ignore.
    await underlined(page, "sentense").click({ button: "right" });
    const menu = page.getByRole("menu").last();
    await expect(menu.getByRole("menuitem", { name: "sentence", exact: true })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Add to dictionary" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Ignore", exact: true })).toBeVisible();
    await menu.getByRole("menuitem", { name: "sentence", exact: true }).click();
    await expect(body).toContainText("This sentence has");
    await expect(underlined(page, "sentense")).toHaveCount(0);

    // A click on an underlined word: the bubble, without leaving the note.
    await underlined(page, "mispelled").click();
    const bubble = page.getByRole("toolbar", { name: "Spelling suggestions for mispelled" });
    await expect(bubble.getByRole("button", { name: "misspelled" })).toBeVisible();
    await expect(body).toBeFocused();
    await bubble.getByRole("button", { name: "misspelled" }).click();
    await expect(body).toContainText("a misspelled word");

    // Add to dictionary: the word is right from then on, in this note and the next.
    await underlined(page, "zorblat").click({ button: "right" });
    await page.getByRole("menu").last().getByRole("menuitem", { name: "Add to dictionary" }).click();
    await expect(underlined(page, "zorblat")).toHaveCount(0);
    await lineKey(page, browserName, "end");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Another zorblat, and a blorptane. ");
    await expect(underlined(page, "blorptane")).toBeVisible({ timeout: 30_000 });
    await expect(underlined(page, "zorblat")).toHaveCount(0);

    // Ignore, from the bubble.
    await underlined(page, "blorptane").click();
    await page.getByRole("toolbar", { name: "Spelling suggestions for blorptane" }).getByRole("button", { name: "Ignore" }).click();
    await expect(underlined(page, "blorptane")).toHaveCount(0);

    // F7: to the next misspelt word, with its suggestions in a menu (from the keyboard alone).
    await lineKey(page, browserName, "end");
    await page.keyboard.type(" Teh end. ");
    await expect(underlined(page, "Teh")).toBeVisible({ timeout: 30_000 });
    await lineKey(page, browserName, "start");
    await page.keyboard.press("F7");
    await expect(page.getByRole("menu").last().getByRole("menuitem", { name: "The", exact: true })).toBeFocused({ timeout: 15_000 });
    await page.keyboard.press("Enter");
    await expect(body).toContainText("The end.");
  });

  test("short English lines in an English or a Portuguese note aren't checked as another language", async ({ page }) => {
    await newNote(page, "Campaign");
    // Fragments with few little words (a note like this once read as Portuguese, and "Lead" was underlined).
    await page.keyboard.type("Category wise email campaign");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Email Content - Lead generation, a do no");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Add pricing section with a mispelled word");
    await page.keyboard.press("Enter");
    await expect(underlined(page, "mispelled")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".fb-misspelt")).toHaveCount(1);
    // A Portuguese note with a short English line: the English words are right, a Portuguese slip is still marked.
    await newNote(page, "Notas");
    await page.keyboard.type("Eles também são muito bonitos, como sempre são, e a casa está linda.");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Lead generation");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Ela não sabe se vai para a casa hojje, mas também quer ir.");
    await page.keyboard.press("Enter");
    await expect(underlined(page, "hojje")).toBeVisible({ timeout: 30_000 });
    await expect(underlined(page, "Lead")).toHaveCount(0);
    await expect(underlined(page, "generation")).toHaveCount(0);
  });

  test("the next word: Tab takes it, Tab again takes the next, Esc dismisses; Tab still indents", async ({ page }) => {
    // The on-device model learns from what's written (twice before it predicts anything).
    const body = await newNote(page, "Prediction");
    await page.keyboard.type("Let me know if you need anything else.");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Let me know if you have questions.");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Let me know if you can come.");
    await page.keyboard.press("Enter");
    // (Learnt a few seconds after writing stops, the line being written aside.)
    await page.waitForTimeout(5500);

    await page.keyboard.type("Let me ");
    const ghost = page.locator(".fb-ghost");
    await expect(ghost).toHaveAttribute("data-ghost", "know", { timeout: 15_000 });
    await page.keyboard.press("Tab");
    await expect(body).toContainText("Let me know");
    await expect(ghost).toHaveAttribute("data-ghost", " if");
    await page.keyboard.press("Tab");
    await expect(ghost).toHaveAttribute("data-ghost", " you");
    await expect(page.locator(".fb-editor p").last()).toHaveText(/^Let me know if/);
    // The line wasn't indented by those Tabs.
    await expect(page.locator(".fb-editor p").last()).toHaveAttribute("data-depth", "0");

    // Esc: gone, and the text as it was.
    await page.keyboard.press("Escape");
    await expect(ghost).toHaveCount(0);
    await expect(page.locator(".fb-editor p").last()).toHaveText(/^Let me know if$/);

    // Nothing showing: Tab indents the line, as it always has.
    await page.keyboard.press("Enter");
    await page.keyboard.type("Qwxz");
    await page.waitForTimeout(300);
    await expect(ghost).toHaveCount(0);
    await page.keyboard.press("Tab");
    await expect(page.locator(".fb-editor p").last()).toHaveAttribute("data-depth", "1");
    await expect(page.locator(".fb-editor p").last()).toHaveText("Qwxz");
  });

  test("Settings: spell check off takes the underlines away; a note's own switch does too", async ({ page }) => {
    await newNote(page, "Switches");
    await page.keyboard.type("A mispelled word. ");
    await expect(underlined(page, "mispelled")).toBeVisible({ timeout: 30_000 });
    // The note's own switch, in its right-click menu.
    await page.locator(".fb-editor p").first().click({ button: "right", position: { x: 2, y: 4 } });
    const menu = page.getByRole("menu").last();
    await menu.getByRole("menuitem", { name: "Spelling and prediction" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Check spelling in this note" }).or(page.getByRole("menuitem", { name: "Check spelling in this note" })).click();
    await expect(underlined(page, "mispelled")).toHaveCount(0);
  });

  test("a 5,000-word note: typing doesn't wait for spelling or prediction", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "long tasks are measured in Chromium");
    await newNote(page, "Long note");
    const words = ["garden", "tomorow", "the", "flowers", "and", "wether", "we", "plant", "seeds", "shoud", "water", "them"];
    const lines = Array.from({ length: 100 }, (_, i) => Array.from({ length: 50 }, (_, j) => words[(i * 7 + j * 5) % words.length]).join(" ") + ".");
    await page.keyboard.insertText(lines.join("\n"));
    // Every misspelling underlined (checked off the page's thread, in the worker).
    await expect(page.locator(".fb-misspelt").first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2000);
    await page.evaluate(() => {
      const w = window as unknown as { __long: number[] };
      w.__long = [];
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) w.__long.push(e.duration);
      }).observe({ type: "longtask" });
    });
    const start = Date.now();
    await page.keyboard.type(" and then we wrote some more words at the end of the long note", { delay: 30 });
    await page.waitForTimeout(1500);
    const long = await page.evaluate(() => (window as unknown as { __long: number[] }).__long);
    const typedIn = Date.now() - start;
    console.log(`[spelling perf] typed in ${typedIn} ms, long tasks: ${JSON.stringify(long.map(Math.round))}`);
    // No frame held up long enough to feel (a development build, so the budget is generous).
    expect(Math.max(0, ...long)).toBeLessThan(200);
  });
});
