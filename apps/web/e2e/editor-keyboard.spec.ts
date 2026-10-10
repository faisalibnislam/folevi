import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { newPerson, pickDate, waitForSaved } from "./helpers";

const mod = process.platform === "darwin" ? "Meta" : "Control";
const lineEnd = process.platform === "darwin" ? "Meta+ArrowRight" : "End";
const blocks = (page: Page) => page.locator(".fb-editor > *");
const texts = async (page: Page) => (await blocks(page).allTextContents()).map((t) => t.trim());

async function newPage(page: Page, title: string, lines: string[] = []) {
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  const t = page.getByRole("textbox", { name: "Title" });
  await expect(t).toBeFocused();
  await t.fill(title);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Document body" })).toBeFocused();
  for (const [i, line] of lines.entries()) {
    if (i) await page.keyboard.press("Enter");
    await page.keyboard.type(line);
  }
}

test.describe("editor keyboard", () => {
  test("inline Markdown shortcuts keep the text before them", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Shortcut Tester");
    await newPage(page, "Shortcuts");
    await page.keyboard.type("Say **bold** and _it_ or `code` ~~no~~ end");
    const body = page.getByRole("textbox", { name: "Document body" });
    await expect(body.locator("p").first()).toHaveText("Say bold and it or code no end");
    await expect(body.locator("strong")).toHaveText("bold");
    await expect(body.locator("em")).toHaveText("it");
    await expect(body.locator("code")).toHaveText("code");
    await expect(body.locator("s")).toHaveText("no");
    // The page title is the page's h1.
    await expect(page.getByRole("heading", { level: 1, name: "Shortcuts" })).toBeVisible();
    await context.close();
  });

  test("⌘. block menu takes focus, arrows move within it, Escape returns to the text", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Block Menu Tester");
    await newPage(page, "Block menu", ["Alpha", "Bravo"]);
    const body = page.getByRole("textbox", { name: "Document body" });
    await page.keyboard.press(`${mod}+.`);
    const menu = page.getByRole("menu", { name: "Block options" });
    await expect(menu).toBeVisible();
    const items = menu.getByRole("menuitem");
    await expect(items.first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp"); // wraps to the last item
    await expect(menu.getByRole("menuitem", { name: /Delete/ })).toBeFocused();
    expect(await texts(page)).toEqual(["Alpha", "Bravo"]); // the caret didn't move the text
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(body).toBeFocused();
    // Enter runs the focused item.
    await page.keyboard.press(`${mod}+.`);
    await expect(items.first()).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await expect.poll(() => texts(page)).toEqual(["Alpha"]);
    await expect(body).toBeFocused();
    await context.close();
  });

  test("⌘⇧K adds a link without opening the command palette; ⌥F10 reaches the formatting toolbar", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Link Tester");
    await newPage(page, "Links", ["Read the docs"]);
    const body = page.getByRole("textbox", { name: "Document body" });
    for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowLeft");
    await page.keyboard.press(`${mod}+Shift+k`);
    const address = page.getByRole("textbox", { name: "Link address" });
    await expect(address).toBeFocused();
    await expect(page.getByRole("combobox", { name: /Search documents/ })).toHaveCount(0);
    await page.keyboard.type("example.com/docs");
    await page.keyboard.press("Enter");
    await expect(body.locator("a.fb-link")).toHaveText("docs");
    await expect(body.locator("a.fb-link")).toHaveAttribute("href", "https://example.com/docs");
    await expect(body).toBeFocused();
    // With no selection the address is inserted as a link.
    await page.keyboard.press(lineEnd);
    await page.keyboard.type(" and ");
    await page.keyboard.press(`${mod}+Shift+k`);
    await expect(address).toBeFocused();
    await page.keyboard.type("https://folevi.app");
    await page.keyboard.press("Enter");
    await expect(body.locator("a.fb-link").nth(1)).toHaveText("https://folevi.app");
    await expect(body).toBeFocused();

    // Select "Read", then ⌥F10 → toolbar, → to Italic, Enter.
    // To the start of the line, at a human pace (ProseMirror reads the caret on "selectionchange").
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("ArrowLeft");
      await page.waitForTimeout(10);
    }
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Shift+ArrowRight");
      await page.waitForTimeout(10);
    }
    await page.keyboard.press("Alt+F10");
    const toolbar = page.getByRole("toolbar", { name: "Text formatting" });
    await expect(toolbar.getByRole("button", { name: /^Bold/ })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(toolbar.getByRole("button", { name: /^Italic/ })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(body.locator("em")).toHaveText("Read");
    await expect(body).toBeFocused();
    // Colors from the keyboard.
    await page.keyboard.press("Alt+F10");
    await expect(toolbar.getByRole("button", { name: /^Bold/ })).toBeFocused();
    for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
    await expect(toolbar.getByRole("button", { name: "Color and highlight" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(toolbar.getByRole("button", { name: "Text color: Gray" })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    // The third swatch is the note theme's second text colour (named after its hue, so it varies).
    await expect(toolbar.getByRole("button", { name: /^Text color: / }).nth(2)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(body.locator(".fb-color-moss")).toHaveText("Read");
    await expect(body).toBeFocused();
    await waitForSaved(page);
    await context.close();
  });

  test("block selection: Escape, Shift+↓, move, duplicate and delete several blocks", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Selection Tester");
    await newPage(page, "Select blocks", ["A", "B", "C", "D"]);
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp"); // in B
    await page.keyboard.press("Escape");
    await expect(page.locator(".fb-editor > .fb-selected")).toHaveCount(1);
    await page.keyboard.press("Shift+ArrowDown");
    await expect(page.locator(".fb-editor > .fb-selected")).toHaveCount(2);
    await expect(page.getByText("2 blocks selected")).toBeAttached();
    await page.keyboard.press("Alt+Shift+ArrowDown");
    await expect.poll(() => texts(page)).toEqual(["A", "D", "B", "C"]);
    await page.keyboard.press(`${mod}+d`);
    await expect.poll(() => texts(page)).toEqual(["A", "D", "B", "C", "B", "C"]);
    await page.keyboard.press("Backspace");
    await expect.poll(() => texts(page)).toEqual(["A", "D", "B", "C"]);
    // ⌘. on a block selection offers bulk actions.
    await page.keyboard.press("ArrowUp"); // leave selection, caret in D
    await page.keyboard.press("Escape");
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press(`${mod}+.`);
    await expect(page.getByRole("menu", { name: "Options for 2 blocks" })).toBeVisible();
    await page.getByRole("menuitem", { name: "To-do" }).click();
    await expect(page.locator(".fb-editor > .fb-todo")).toHaveCount(2);
    await waitForSaved(page);
    await page.reload();
    await expect.poll(() => texts(page)).toEqual(["A", "D", "B", "C"]);
    await expect(page.locator(".fb-editor > .fb-todo")).toHaveCount(2);
    await context.close();
  });

  test("slash menu: the active option is announced and axe finds no serious issues", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Slash A11y Tester");
    await newPage(page, "Slash");
    await page.keyboard.type("/");
    const list = page.getByRole("listbox", { name: "Insert block" });
    await expect(list).toBeVisible();
    const body = page.getByRole("textbox", { name: "Document body" });
    const first = list.getByRole("option").first();
    await expect(first).toHaveAttribute("aria-selected", "true");
    await expect(body).toHaveAttribute("aria-activedescendant", (await first.getAttribute("id"))!);
    await expect(body).toHaveAttribute("aria-controls", (await list.getAttribute("id"))!);
    await page.keyboard.press("ArrowDown");
    await expect(body).toHaveAttribute("aria-activedescendant", (await list.getByRole("option").nth(1).getAttribute("id"))!);
    // Colours must be checked once the theme has settled, not halfway through the light/dark transition:
    // switch transitions off for the check, wait for the app to apply the theme, then for any finite
    // animation still running (the listbox stays open throughout).
    await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; }" });
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
      await page.evaluate(async () => {
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        const finite = document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity);
        await Promise.all(finite.map((a) => a.finished.catch(() => undefined)));
      });
      await expect(list).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).disableRules(["region"]).analyze();
      const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
    }
    await page.keyboard.press("Escape");
    await expect(list).toBeHidden();
    await expect(body).not.toHaveAttribute("aria-activedescendant", /.+/);
    await context.close();
  });

  test("dates can be picked and changed after inserting; tables can drop and reorder rows and columns", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Date Tester");
    await newPage(page, "Dates and tables");
    await page.keyboard.type("Due @pick");
    await page.getByRole("option", { name: "Pick a date…" }).click();
    const picker = page.getByRole("dialog", { name: "Insert a date" });
    await pickDate(picker, "2026-03-14");
    const body = page.getByRole("textbox", { name: "Document body" });
    await expect(body.locator("time[data-date]")).toHaveAttribute("datetime", "2026-03-14");
    await body.locator("time[data-date]").click();
    const change = page.getByRole("dialog", { name: "Change date" });
    await pickDate(change, "2026-04-01");
    await expect(body.locator("time[data-date]")).toHaveAttribute("datetime", "2026-04-01");

    await page.keyboard.press(lineEnd);
    await page.keyboard.press("Enter");
    await page.keyboard.type("/table");
    await page.keyboard.press("Enter");
    const cell = (r: number, c: number) => page.getByRole("textbox", { name: `Row ${r}, column ${c}` });
    await cell(1, 1).fill("H1");
    await cell(1, 2).fill("H2");
    await cell(2, 1).fill("a");
    await cell(3, 1).fill("b");
    await page.getByRole("button", { name: "Move row 3 up" }).click();
    await expect(cell(2, 1)).toHaveValue("b");
    await page.getByRole("button", { name: "Move column 1 right" }).click();
    await expect(cell(1, 2)).toHaveValue("H1");
    await page.getByRole("button", { name: "Delete column 3" }).click();
    await expect(page.getByRole("textbox", { name: /column 3/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Delete row 3" }).click();
    await expect(page.getByRole("textbox", { name: /^Row 3/ })).toHaveCount(0);
    await waitForSaved(page);
    await page.reload();
    await expect(page.locator("time[data-date]")).toHaveAttribute("datetime", "2026-04-01");
    await expect(cell(1, 2)).toHaveValue("H1");
    await expect(cell(2, 2)).toHaveValue("b");
    await context.close();
  });
});
