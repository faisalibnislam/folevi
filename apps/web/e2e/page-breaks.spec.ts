import { expect, test } from "@playwright/test";
import { newPerson, openTool, waitForSaved } from "./helpers";

test("a page break cuts the sheet into pages, and Unbreak page joins them", async ({ browser }) => {
  test.setTimeout(120_000);
  const { page, context } = await newPerson(browser, "Page Breaker");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.keyboard.type("Breaks");
  await page.keyboard.press("Enter");
  await page.keyboard.type("First page text");
  await page.keyboard.press("Enter");
  const panel = await openTool(page, "Insert");
  await panel.getByRole("button", { name: "Page break" }).click();
  await openTool(page, "Insert");
  await page.locator(".fb-editor p").last().click();
  await page.keyboard.type("Second page text");
  await waitForSaved(page);
  // The sheet is masked into two pages; the gap between them is the note's background.
  const sheet = page.locator("article.fb-sheet");
  await expect.poll(() => sheet.evaluate((el) => el.style.maskImage || el.style.getPropertyValue("-webkit-mask-image"))).toContain("svg");
  // The label shows on hover.
  const brk = page.locator(".fb-page-break");
  await brk.scrollIntoViewIfNeeded();
  const box = (await brk.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator(".fb-page-break-label")).toHaveCSS("opacity", "1");
  // Right-click → Unbreak page.
  await brk.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Unbreak page" }).click();
  await expect(brk).toHaveCount(0);
  await expect.poll(() => sheet.evaluate((el) => el.style.maskImage)).toBe("");
  await context.close();
});
