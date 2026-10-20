import { expect, test, type Locator, type Page } from "@playwright/test";
import { newPerson, openShare, openTool, waitForSaved } from "./helpers";

// Columns (editor/columns/): a row of blocks side by side, made from the slash menu or by dragging a block
// beside another; the gaps resize the columns; phones stack them; share pages show them side by side.

const SHOTS = process.env.COLUMNS_SHOTS;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

const lines = (page: Page) => page.locator(".fb-editor > .fb");
const line = (page: Page, text: string) => lines(page).filter({ hasText: text }).first();
const box = async (l: Locator) => (await l.boundingBox())!;

async function newPage(page: Page, title: string, texts: string[]) {
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.keyboard.press("Enter");
  for (const [i, t] of texts.entries()) {
    if (i) await page.keyboard.press("Enter");
    await page.keyboard.type(t);
  }
  await waitForSaved(page);
}

/** Side by side: the same top, each to the right of the one before. */
async function expectSideBySide(page: Page, texts: string[]) {
  await expect
    .poll(async () => {
      const boxes = await Promise.all(texts.map((t) => box(line(page, t))));
      return boxes.every((b, i) => i === 0 || (Math.abs(b.y - boxes[0]!.y) < 3 && b.x > boxes[i - 1]!.x + boxes[i - 1]!.width - 1));
    })
    .toBe(true);
}

/** One under another, in this order. */
async function expectStacked(page: Page, texts: string[]) {
  await expect
    .poll(async () => {
      const boxes = await Promise.all(texts.map((t) => box(line(page, t))));
      return boxes.every((b, i) => i === 0 || b.y >= boxes[i - 1]!.y + boxes[i - 1]!.height - 1);
    })
    .toBe(true);
}

/** Hovers a line, grabs its grip and drags it with real pointer events to (x, y). */
async function dragLine(page: Page, text: string, to: { x: number; y: number }, opts: { release?: boolean } = {}) {
  const b = await box(line(page, text));
  await page.mouse.move(b.x + 30, b.y + b.height / 2);
  const grip = page.getByRole("button", { name: "Drag to move, click for block options" });
  await expect(grip).toBeVisible();
  const g = (await grip.boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 14 });
  if (opts.release !== false) await page.mouse.up();
}

test("columns from the slash menu: typing in each, resizing, after a reload, on a share page and on a phone", async ({ browser }) => {
  test.setTimeout(240_000);
  const { page } = await newPerson(browser, "Column Writer");
  await page.setViewportSize({ width: 1440, height: 900 });
  await newPage(page, "Three ways", ["Intro"]);
  await page.keyboard.press("Enter");
  await page.keyboard.type("/3 columns");
  await expect(page.getByRole("option", { name: /3 columns/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".fb-editor > .fb-columns")).toHaveCount(1);
  await expect(page.locator(".fb-editor > .fb-column")).toHaveCount(3);
  // The caret is in the first column; the others say where to write.
  await page.keyboard.type("Left plan");
  const empties = page.locator('.fb-editor > p[data-depth="2"]');
  await empties.nth(1).click();
  await page.keyboard.type("Middle notes");
  await empties.nth(2).click();
  await page.keyboard.type("Right ideas");
  // A list in a column stays in it; an empty item ends the list, still in the column.
  await page.keyboard.press("Enter");
  await page.keyboard.type("- first");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("after the list");
  await expectSideBySide(page, ["Left plan", "Middle notes", "Right ideas"]);
  await expect(line(page, "first")).toHaveClass(/fb-bulleted/);
  await expect(line(page, "first")).toHaveAttribute("data-depth", "2");
  await expect(line(page, "after the list")).toHaveAttribute("data-depth", "2");
  await expect(line(page, "after the list")).toHaveClass(/fb-paragraph/);
  // Shift+Tab at a column's own level keeps the line in its column.
  await page.keyboard.press("Shift+Tab");
  await expect(line(page, "after the list")).toHaveAttribute("data-depth", "2");
  const right = await box(line(page, "after the list"));
  const ideas = await box(line(page, "Right ideas"));
  expect(Math.abs(right.x - ideas.x)).toBeLessThan(3);
  expect(right.y).toBeGreaterThan(ideas.y);
  await waitForSaved(page);
  await shot(page, "1-three-columns");

  // Drag the first gap to the right: the first column gets wider, the second narrower.
  const before = { left: await box(line(page, "Left plan")), middle: await box(line(page, "Middle notes")) };
  const gutter = page.locator('.fb-columns-gutter[data-gap="0"]');
  const gb = await box(gutter);
  await page.mouse.move(gb.x + gb.width / 2, gb.y + 20);
  await page.mouse.down();
  await page.mouse.move(gb.x + gb.width / 2 + 120, gb.y + 20, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await box(line(page, "Left plan"))).width).toBeGreaterThan(before.left.width + 80);
  await expect.poll(async () => (await box(line(page, "Middle notes"))).width).toBeLessThan(before.middle.width - 80);
  await waitForSaved(page);
  await shot(page, "2-resized");

  // After a reload: the same columns, the same widths.
  await page.reload();
  await expectSideBySide(page, ["Left plan", "Middle notes", "Right ideas"]);
  await expect.poll(async () => (await box(line(page, "Left plan"))).width).toBeGreaterThan(before.left.width + 80);
  await expect(line(page, "first")).toHaveClass(/fb-bulleted/);

  // A share page shows the columns side by side, and stacked on a phone.
  await openShare(page);
  const share = page.getByRole("dialog", { name: /Share/ });
  await share.getByRole("button", { name: "Create link" }).click();
  const link = await share.getByLabel("Public link").inputValue();
  await page.keyboard.press("Escape");
  const anon = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const reader = await anon.newPage();
  await reader.goto(link);
  const row = reader.locator(".fb-columns-static");
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row.locator(".fb-column-static")).toHaveCount(3);
  const cols = await Promise.all([0, 1, 2].map((i) => box(row.locator(".fb-column-static").nth(i))));
  expect(Math.abs(cols[1]!.y - cols[0]!.y)).toBeLessThan(2);
  expect(cols[1]!.x).toBeGreaterThan(cols[0]!.x + cols[0]!.width - 1);
  expect(cols[0]!.width).toBeGreaterThan(cols[1]!.width);
  await expect(row.locator(".fb-column-static").nth(2)).toContainText("Right ideas");
  await expect(row.locator(".fb-column-static").nth(2).locator(".fb-bulleted")).toContainText("first");
  await shot(reader, "3-share");
  await reader.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await box(row.locator(".fb-column-static").nth(1))).y).toBeGreaterThan(cols[0]!.y + 10);
  await shot(reader, "4-share-phone");
  await anon.close();

  // On a phone the columns stack, and writing in them still works.
  await page.setViewportSize({ width: 390, height: 844 });
  await expectStacked(page, ["Left plan", "Middle notes", "Right ideas", "after the list"]);
  await line(page, "Middle notes").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" on the go");
  await expect(line(page, "Middle notes on the go")).toHaveAttribute("data-depth", "2");
  await waitForSaved(page);
  await shot(page, "5-phone");
  await page.setViewportSize({ width: 1440, height: 900 });
  await expectSideBySide(page, ["Left plan", "Middle notes on the go", "Right ideas"]);
});

test("dragging a block beside another makes columns; dragging the last block out of a column removes them", async ({ browser }) => {
  test.setTimeout(180_000);
  const { page } = await newPerson(browser, "Column Mover");
  await page.setViewportSize({ width: 1440, height: 900 });
  await newPage(page, "Moving", ["Alpha", "Bravo", "Charlie"]);

  // Charlie to the right edge of Alpha: a line stands up there, and on release the two sit side by side.
  const alpha = await box(line(page, "Alpha"));
  await dragLine(page, "Charlie", { x: alpha.x + alpha.width - 6, y: alpha.y + alpha.height / 2 }, { release: false });
  await expect(page.locator(".fb-drop-line.fb-drop-line-vertical")).toBeVisible();
  await page.mouse.up();
  await expect(page.locator(".fb-editor > .fb-columns")).toHaveCount(1);
  await expectSideBySide(page, ["Alpha", "Charlie"]);
  await expect(line(page, "Bravo")).toHaveAttribute("data-depth", "0");
  expect((await box(line(page, "Bravo"))).y).toBeGreaterThan((await box(line(page, "Alpha"))).y);
  await waitForSaved(page);
  await shot(page, "6-dragged-beside");

  // Bravo past the row's right end: a third column.
  const charlie = await box(line(page, "Charlie"));
  await dragLine(page, "Bravo", { x: charlie.x + charlie.width + 30, y: charlie.y + charlie.height / 2 });
  await expect(page.locator(".fb-editor > .fb-column")).toHaveCount(3);
  await expectSideBySide(page, ["Alpha", "Charlie", "Bravo"]);
  await waitForSaved(page);

  // Bravo out again, under the row: its column goes; then Charlie out: the row is gone, every line plain again.
  const rowBox = await box(page.locator(".fb-editor > .fb-columns"));
  await dragLine(page, "Bravo", { x: rowBox.x + 40, y: rowBox.y + rowBox.height + 30 });
  await expect(page.locator(".fb-editor > .fb-column")).toHaveCount(2);
  await expect(line(page, "Bravo")).toHaveAttribute("data-depth", "0");
  const row2 = await box(page.locator(".fb-editor > .fb-columns"));
  await dragLine(page, "Charlie", { x: row2.x + 40, y: (await box(line(page, "Bravo"))).y + 3 });
  await expect(page.locator(".fb-editor > .fb-columns")).toHaveCount(0);
  await expect(page.locator(".fb-editor > .fb-column")).toHaveCount(0);
  for (const t of ["Alpha", "Bravo", "Charlie"]) await expect(line(page, t)).toHaveAttribute("data-depth", "0");
  await expectStacked(page, ["Alpha", "Charlie", "Bravo"]);
  await waitForSaved(page);
  await page.reload();
  await expect(page.locator(".fb-editor > .fb-columns")).toHaveCount(0);
  await expect(line(page, "Charlie")).toHaveAttribute("data-depth", "0");
});

test("from the Insert panel: a table fits its column; Backspace in an emptied column removes it", async ({ browser }) => {
  test.setTimeout(180_000);
  const { page } = await newPerson(browser, "Column Builder");
  await page.setViewportSize({ width: 1440, height: 900 });
  await newPage(page, "Data side by side", ["Intro"]);
  await page.keyboard.press("Enter");
  // From the Insert panel this time.
  const panel = await openTool(page, "Insert");
  await panel.getByRole("group", { name: "Layout" }).getByRole("button", { name: "2 columns", exact: true }).click();
  await expect(page.locator(".fb-editor > .fb-column")).toHaveCount(2);
  await page.keyboard.type("/table");
  await page.keyboard.press("Enter");
  await expect(page.locator(".fb-editor .fb-table")).toBeVisible();
  const row = await box(page.locator(".fb-editor > .fb-columns"));
  const table = await box(page.locator(".fb-editor > [data-depth='2']").filter({ has: page.locator(".fb-table") }).first());
  // The table stays inside the first column (half the row, less the gap).
  expect(table.x).toBeGreaterThanOrEqual(row.x - 1);
  expect(table.x + table.width).toBeLessThan(row.x + row.width / 2 + 2);
  const empties = page.locator('.fb-editor > p[data-depth="2"]');
  await empties.last().click();
  await page.keyboard.type("Notes beside the table");
  const notes = await box(line(page, "Notes beside the table"));
  expect(notes.x).toBeGreaterThan(table.x + table.width - 1);
  await waitForSaved(page);
  await shot(page, "7-table");
  // Empty the second column and press Backspace: the column goes, and with it the row (one column left).
  await line(page, "Notes beside the table").click();
  await page.keyboard.press("End");
  for (let i = 0; i < "Notes beside the table".length; i++) await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await expect(page.locator(".fb-editor > .fb-columns")).toHaveCount(0);
  await expect(page.locator(".fb-editor .fb-table")).toBeVisible();
  await waitForSaved(page);
});
