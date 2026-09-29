import { expect, test, type Page } from "@playwright/test";
import { newPerson, waitForSaved, openTool } from "./helpers";

const blocks = (page: Page) => page.locator(".fb-editor > .fb");
const texts = async (page: Page) => (await blocks(page).allTextContents()).map((t) => t.trim()).filter(Boolean);

async function newPage(page: Page, lines: string[]) {
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await expect(page.getByRole("textbox", { name: "Title" })).toBeFocused();
  await page.getByRole("textbox", { name: "Title" }).fill("Drag test");
  await page.keyboard.press("Enter");
  for (const [i, line] of lines.entries()) {
    if (i) await page.keyboard.press("Enter");
    await page.keyboard.type(line);
  }
  await waitForSaved(page);
}

/** Hovers a block, grabs its grip and drags with real pointer events to (x, y). */
async function dragBlock(page: Page, text: string, to: { x: number; y: number }, opts: { release?: boolean } = {}) {
  const block = blocks(page).filter({ hasText: text }).first();
  const box = (await block.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + box.height / 2);
  const grip = page.getByRole("button", { name: "Drag to move, click for block options" });
  await expect(grip).toBeVisible();
  const g = (await grip.boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  if (opts.release !== false) await page.mouse.up();
}

test("blocks can be dragged to reorder and re-indent, and the order syncs", async ({ browser }) => {
  const { page } = await newPerson(browser, "Drag Tester");
  await newPage(page, ["Alpha", "Bravo", "Charlie"]);
  expect(await texts(page)).toEqual(["Alpha", "Bravo", "Charlie"]);

  // Charlie → above Alpha.
  const alpha = (await blocks(page).filter({ hasText: "Alpha" }).boundingBox())!;
  await dragBlock(page, "Charlie", { x: alpha.x + 60, y: alpha.y + 3 });
  await expect.poll(() => texts(page)).toEqual(["Charlie", "Alpha", "Bravo"]);
  await expect(page.locator(".fb-drag-ghost")).toHaveCount(0);
  await expect(page.locator(".fb-drop-line")).toHaveCount(0);

  // Drag Bravo in place but ~2 indents to the right → nested one level under Alpha (the maximum).
  const bravo = (await blocks(page).filter({ hasText: "Bravo" }).boundingBox())!;
  const grip0 = await (async () => {
    await page.mouse.move(bravo.x + 40, bravo.y + bravo.height / 2);
    return (await page.getByRole("button", { name: "Drag to move, click for block options" }).boundingBox())!;
  })();
  await page.mouse.move(grip0.x + grip0.width / 2, grip0.y + grip0.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip0.x + 60, bravo.y + bravo.height / 2 + 1, { steps: 10 });
  await page.mouse.up();
  await expect(blocks(page).filter({ hasText: "Bravo" })).toHaveAttribute("data-depth", "1");

  // Escape cancels a drag without changing anything.
  const charlie = (await blocks(page).filter({ hasText: "Charlie" }).boundingBox())!;
  await dragBlock(page, "Alpha", { x: charlie.x + 60, y: charlie.y + 2 }, { release: false });
  await expect(page.locator(".fb-drop-line")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect.poll(() => texts(page)).toEqual(["Charlie", "Alpha", "Bravo"]);

  await waitForSaved(page);
  await page.reload();
  await expect.poll(() => texts(page)).toEqual(["Charlie", "Alpha", "Bravo"]);
  await expect(blocks(page).filter({ hasText: "Bravo" })).toHaveAttribute("data-depth", "1");
});

test("blocks can be dragged from the Insert panel into the page", async ({ browser }) => {
  const { page } = await newPerson(browser, "Insert Tester");
  await newPage(page, ["First", "Second"]);
  await openTool(page, "Insert");
  const tile = page.getByRole("button", { name: /^To-do/ });
  await tile.scrollIntoViewIfNeeded();
  const t = (await tile.boundingBox())!;
  const second = (await blocks(page).filter({ hasText: "Second" }).boundingBox())!;
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
  await page.mouse.down();
  await page.mouse.move(second.x + 20, second.y + 3, { steps: 16 });
  await expect(page.locator(".fb-drag-chip")).toHaveText(/To-do/);
  await page.mouse.up();
  // A to-do now sits between First and Second, with the cursor in it.
  await expect(blocks(page).nth(1)).toHaveClass(/fb-todo/);
  await page.keyboard.type("Dropped task");
  await expect(blocks(page).nth(1)).toContainText("Dropped task");
  await expect(blocks(page).nth(2)).toContainText("Second");
  // Clicking an item inserts below the current block.
  await page.getByRole("button", { name: "Divider, regular" }).click();
  await expect(blocks(page).nth(2)).toHaveClass(/fb-divider/);
  await waitForSaved(page);
});
