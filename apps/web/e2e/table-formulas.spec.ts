// Tables like a small spreadsheet (components/editor/table): formatted text in cells, formulas with live
// results and plain explanations of errors, number formats, a totals row, a saved sort and filter, and
// rows pasted from a spreadsheet.
import { expect, test, type Page } from "@playwright/test";
import { newPerson, waitForSaved } from "./helpers";

const mod = process.platform === "darwin" ? "Meta" : "Control";
const lineEnd = process.platform === "darwin" ? "Meta+ArrowRight" : "End";

async function newTable(page: Page, title: string) {
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Document body" })).toBeFocused();
  await page.keyboard.type("/table");
  await page.keyboard.press("Enter");
  await expect(page.locator(".fb-editor table.fb-table")).toBeVisible();
}

const cell = (page: Page, r: number, c: number) => page.getByRole("textbox", { name: `Row ${r}, column ${c}` });

/** Types rows into the table from its first cell (Tab between cells, Tab at the end adds a row). */
async function fill(page: Page, rows: string[][]) {
  await cell(page, 1, 1).click();
  for (const [r, row] of rows.entries()) {
    for (const [c, text] of row.entries()) {
      if (r || c) await page.keyboard.press("Tab");
      await page.keyboard.type(text);
    }
  }
}

test.describe("tables", () => {
  test("formulas, references, errors, formats, totals and the saved view", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Table Tester");
    await newTable(page, "Fruit");
    // The new table is 3 by 3: a fourth column first.
    await page.getByRole("button", { name: "Column", exact: true }).click();
    await fill(page, [
      ["Item", "Price", "Qty", "Total"],
      ["Apples", "1.5", "4", "=Price * Qty"],
      ["Pears", "2", "3", "=B3*C3"],
    ]);
    // Writing a formula shows the columns' letters and rows' numbers.
    await expect(page.locator(".fb-table-label.is-on").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(cell(page, 2, 4)).toHaveText("6");
    await expect(cell(page, 3, 4)).toHaveText("6");
    // Numbers line up on the right.
    await expect(page.locator('[data-cell-at="1:1"]')).toHaveClass(/fb-cell-number/);

    // Clicking a cell while writing a formula puts its reference in.
    await page.getByRole("button", { name: "Row", exact: true }).click();
    await page.keyboard.type("Sum");
    await page.keyboard.press("Tab");
    await page.keyboard.type("=SUM(");
    await page.locator('[data-cell-at="1:1"]').click();
    await page.keyboard.type(":B3)");
    await page.keyboard.press("Escape");
    await expect(cell(page, 4, 2)).toHaveText("3.5");

    // An error says what's wrong when hovered.
    await cell(page, 4, 3).click();
    await page.keyboard.type("=C2/0");
    await page.keyboard.press("Escape");
    await expect(cell(page, 4, 3)).toHaveText(/#DIV\/0!/);
    await expect(page.locator(".fb-cell-error").first()).toHaveAttribute("title", /zero/);

    // A currency column.
    await cell(page, 2, 2).click();
    await page.getByRole("button", { name: /^Column B options/ }).click();
    const options = page.getByRole("dialog", { name: "Price options" });
    await options.getByRole("combobox", { name: "Number format" }).click();
    await page.getByRole("option", { name: "Currency" }).click();
    // Escape closes the options (back in the cell), then the cell.
    await page.keyboard.press("Escape");
    await expect(options).toBeHidden();
    await expect(cell(page, 2, 2)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(cell(page, 2, 2)).toHaveText("$1.50");
    await expect(cell(page, 4, 2)).toHaveText("$3.50");

    // Rich text in a cell: a word made bold with ⌘B.
    await cell(page, 3, 1).click();
    await page.keyboard.press(lineEnd);
    await page.keyboard.press("Shift+ArrowLeft");
    await page.keyboard.press("Shift+ArrowLeft");
    await expect.poll(() => page.evaluate(() => String(getSelection()))).toBe("rs");
    await page.keyboard.press(`${mod}+b`);
    await expect(page.locator(".fb-cell-editor strong")).toHaveText("rs");
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-cell-at="2:0"] strong')).toHaveText("rs");

    // The totals row adds up each numeric column, and isn't counted in it.
    await cell(page, 2, 1).click();
    await page.getByRole("button", { name: "Totals row" }).click();
    await expect(cell(page, 5, 4)).toHaveText("12");
    await expect(cell(page, 5, 1)).toHaveText("Total");

    // Sorted Z to A by Qty (a view: the rows stay where they are), then cleared.
    await cell(page, 2, 3).click();
    await page.getByRole("button", { name: /^Column C options/ }).click();
    const qty = page.getByRole("dialog", { name: "Qty options" });
    await qty.getByRole("button", { name: "Z to A" }).click();
    await page.keyboard.press("Escape");
    await expect(qty).toBeHidden();
    await expect(cell(page, 2, 3)).toBeFocused();
    await page.keyboard.press("Escape");
    const firstColumn = page.locator(".fb-editor table.fb-table tbody tr > :first-child");
    await expect(page.locator(".fb-table-viewbar")).toContainText("Sorted by Qty");
    // Text (the error) before numbers from Z to A, as in spreadsheets; the header and totals stay put.
    await expect(firstColumn).toHaveText(["Item", "Sum", "Apples", "Pears", "Total"]);
    await waitForSaved(page);
    await page.reload();
    await expect(cell(page, 2, 2)).toHaveText("$1.50");
    await expect(page.locator(".fb-table-viewbar")).toContainText("Sorted by Qty");
    await expect(page.locator('[data-cell-at="2:0"] strong')).toHaveText("rs");
    await page.locator(".fb-table-viewbar").getByRole("button", { name: "Clear" }).click();
    await expect(page.locator(".fb-table-viewbar")).toHaveCount(0);
    await context.close();
  });

  test("rows pasted from a spreadsheet keep their columns and formulas", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Sheet Paster");
    await page.getByRole("button", { name: "New note", exact: true }).click();
    await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
    await page.getByRole("textbox", { name: "Title" }).fill("From Sheets");
    await page.keyboard.press("Enter");
    // What Google Sheets puts on the clipboard: an HTML table with each formula in R1C1 on its cell.
    const html =
      '<google-sheets-html-origin><table><tbody><tr><td>Item</td><td>Price</td><td>Qty</td><td>Total</td></tr><tr><td>Tea</td><td>3</td><td>2</td><td data-sheets-formula="=R[0]C[-2]*R[0]C[-1]">6</td></tr><tr><td>Cake</td><td>4</td><td>5</td><td data-sheets-formula="=R[0]C[-2]*R[0]C[-1]">20</td></tr></tbody></table></google-sheets-html-origin>';
    await page.evaluate((h) => {
      const data = new DataTransfer();
      data.setData("text/html", h);
      data.setData("text/plain", "Item\tPrice\tQty\tTotal\nTea\t3\t2\t6\nCake\t4\t5\t20");
      document.querySelector(".fb-editor")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }, html);
    await expect(page.locator(".fb-editor table.fb-table")).toBeVisible();
    await expect(cell(page, 3, 4)).toHaveText("20");
    // It's a formula, not the number: changing Qty changes the total.
    await cell(page, 3, 3).click();
    await page.keyboard.press(`${mod}+a`);
    await page.keyboard.type("10");
    await page.keyboard.press("Escape");
    await expect(cell(page, 3, 4)).toHaveText("40");
    // The first row reads as names (headers).
    await expect(page.locator(".fb-editor table.fb-table tbody th").first()).toHaveText("Item");
    await context.close();
  });
});
