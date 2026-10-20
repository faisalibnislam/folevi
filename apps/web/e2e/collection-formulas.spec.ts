import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { newPerson, pick, waitForSaved } from "./helpers";

async function addProperty(page: Page, coll: Locator, name: string, type: string) {
  await coll.getByRole("button", { name: /View settings/ }).click();
  const settings = page.getByRole("dialog", { name: /settings/ });
  await settings.getByLabel("New property").fill(name);
  await pick(settings.getByLabel("Property type"), type);
  await settings.getByRole("button", { name: "Add", exact: true }).click();
  return settings;
}

async function setNumber(coll: Locator, label: string, value: string) {
  const input = coll.getByRole("spinbutton", { name: label });
  await input.fill(value);
  await input.press("Enter");
}

test("collection formulas: suggestions, live preview, loops refused, errors explained, formats, summaries, filters, sorts, boards and exports", async ({ browser }) => {
  const { page } = await newPerson(browser, "Formula Person");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.getByRole("textbox", { name: "Title" }).fill("Orders");
  await page.keyboard.press("Enter");
  await waitForSaved(page);
  await page.keyboard.type("/collection");
  await expect(page.getByRole("option", { name: /Collection/ })).toBeVisible();
  await page.keyboard.press("Enter");
  const coll = page.getByRole("region", { name: /^Collection / });
  await expect(coll).toBeVisible();

  // Two number properties and three rows.
  let settings = await addProperty(page, coll, "Price", "Number");
  await settings.getByLabel("New property").fill("Qty");
  await pick(settings.getByLabel("Property type"), "Number");
  await settings.getByRole("button", { name: "Add", exact: true }).click();
  await settings.getByRole("button", { name: "Close" }).click();
  for (const [i, name] of ["Apples", "Pears", "Plums"].entries()) {
    await coll.getByRole("button", { name: "New row" }).click();
    await expect(coll.getByRole("textbox", { name: "Row name" })).toHaveCount(i + 1);
    await coll.getByRole("textbox", { name: "Row name" }).nth(i).fill(name);
    await coll.getByRole("textbox", { name: "Row name" }).nth(i).press("Enter");
  }
  await setNumber(coll, "Price for Apples", "2");
  await setNumber(coll, "Qty for Apples", "3");
  await setNumber(coll, "Price for Pears", "5");
  await setNumber(coll, "Qty for Pears", "4");
  await setNumber(coll, "Price for Plums", "1");
  await setNumber(coll, "Qty for Plums", "0");

  // A formula property opens its editor; suggestions complete names as you type.
  settings = await addProperty(page, coll, "Total", "Formula");
  const editor = page.getByRole("dialog", { name: "Formula for “Total”" });
  await expect(editor).toBeVisible();
  const formula = editor.getByRole("combobox", { name: "Formula" });
  await formula.pressSequentially("Pri");
  await expect(editor.getByRole("listbox", { name: "Suggestions" }).getByRole("option", { name: /^Price/ })).toBeVisible();
  await formula.press("Enter");
  await expect(formula).toHaveValue("Price");
  await formula.pressSequentially(' * prop("Q');
  await expect(editor.getByRole("option", { name: /^Qty/ })).toBeVisible();
  await formula.press("Tab");
  await expect(formula).toHaveValue('Price * prop("Qty")');
  // The live preview works it out on the first rows.
  const preview = editor.getByRole("region", { name: "Preview" });
  await expect(preview.getByRole("row", { name: /Apples/ })).toContainText("6");
  await expect(preview.getByRole("row", { name: /Pears/ })).toContainText("20");

  // A formula can't use its own property (or loop through others): explained, and Save is off.
  await formula.fill("Total * 2");
  await expect(editor.getByRole("alert")).toContainText("can't use its own property");
  await expect(editor.getByRole("button", { name: "Save formula" })).toBeDisabled();
  // Sheets-style errors with a plain explanation.
  await formula.fill("Price / Qty");
  await expect(preview.getByRole("row", { name: /Plums/ })).toContainText("#DIV/0!");
  await expect(preview.getByRole("row", { name: /Plums/ })).toContainText("divides by zero");
  await formula.fill("Price * Qty");
  await pick(editor.getByRole("combobox", { name: "Number format" }), "Currency");
  await expect(preview.getByRole("row", { name: /Apples/ })).toContainText("$6.00");
  await editor.getByRole("button", { name: "Save formula" }).click();
  await expect(editor).toBeHidden();
  await settings.getByRole("button", { name: "Close" }).click();

  // The table shows the results.
  const row = (name: string) => coll.locator("tbody tr").nth(["Apples", "Pears", "Plums"].indexOf(name));
  await expect(row("Apples")).toContainText("$6.00");
  await expect(row("Pears")).toContainText("$20.00");
  await expect(row("Plums")).toContainText("$0.00");
  // Results follow the values they come from.
  await setNumber(coll, "Qty for Plums", "10");
  await expect(row("Plums")).toContainText("$10.00");

  // A summary under the column, saved with the view.
  await coll.getByRole("button", { name: "Summary for Total" }).click();
  await page.getByRole("menuitemradio", { name: "Sum" }).click();
  await expect(coll.getByRole("button", { name: "Summary for Total" })).toContainText("$36.00");
  await coll.getByRole("button", { name: "Summary for Name" }).click();
  await page.getByRole("menuitemradio", { name: "Count all" }).click();
  await expect(coll.getByRole("button", { name: "Summary for Name" })).toContainText("3");

  // Filter and sort on the formula's results.
  await coll.getByRole("button", { name: /View settings/ }).click();
  settings = page.getByRole("dialog", { name: /settings/ });
  await settings.getByRole("button", { name: "Add filter" }).click();
  const filter = settings.getByRole("group", { name: "Filter 1" });
  await pick(filter.getByLabel("Property"), "Total");
  await pick(filter.getByLabel("Condition"), "is greater than");
  await filter.getByRole("textbox", { name: "Value" }).fill("8");
  await filter.getByRole("textbox", { name: "Value" }).press("Enter");
  await settings.getByRole("button", { name: "Add sort" }).click();
  await pick(settings.getByLabel("Sort property"), "Total");
  await pick(settings.getByLabel("Direction"), "Descending");
  await settings.getByRole("button", { name: "Close" }).click();
  await expect(coll.getByRole("textbox", { name: "Row name" })).toHaveCount(2);
  await expect(coll.getByRole("textbox", { name: "Row name" }).nth(0)).toHaveValue("Pears");
  await expect(coll.getByRole("textbox", { name: "Row name" }).nth(1)).toHaveValue("Plums");
  // The summary is of the rows the view shows.
  await expect(coll.getByRole("button", { name: "Summary for Total" })).toContainText("$30.00");

  // Export: the view's rows with formula results.
  const download = page.waitForEvent("download");
  await coll.getByRole("button", { name: "Export" }).click();
  await page.getByRole("menuitem", { name: "Download CSV" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.csv$/);
  const csv = (await readFile((await file.path())!, "utf8")).replace(/^\uFEFF/, "");
  expect(csv.split("\r\n").slice(0, 3)).toEqual([expect.stringMatching(/^Name,.*Total/), expect.stringMatching(/^Pears,.*,20$/), expect.stringMatching(/^Plums,.*,10$/)]);

  // Saved: still there after a reload.
  await page.waitForTimeout(800);
  await page.goto(page.url().replace(/\?.*$/, ""));
  const again = page.getByRole("region", { name: /^Collection / });
  await expect(again.getByRole("button", { name: "Summary for Total" })).toContainText("$30.00", { timeout: 20_000 });

  // A board grouped by the formula: a column per result.
  await pick(again.getByRole("combobox", { name: "Add view" }), "Board");
  await again.getByRole("button", { name: /View settings/ }).click();
  settings = page.getByRole("dialog", { name: /settings/ });
  await pick(settings.getByRole("combobox", { name: /Group by/ }), "Total");
  await settings.getByRole("button", { name: "Close" }).click();
  await expect(again.getByRole("region", { name: /^\$6\.00/ })).toBeVisible();
  await expect(again.getByRole("region", { name: /^\$20\.00/ })).toContainText("Pears");

  // Renaming a property it uses keeps the formula working.
  await again.getByRole("button", { name: /View settings/ }).click();
  await settings.getByRole("textbox", { name: "Name of property Price" }).fill("Unit cost");
  await settings.getByRole("textbox", { name: "Name of property Price" }).press("Enter");
  await settings.getByRole("button", { name: "Edit formula Total" }).click();
  await expect(page.getByRole("dialog", { name: "Formula for “Total”" }).getByRole("combobox", { name: "Formula" })).toHaveValue("[Unit cost] * Qty");
});
