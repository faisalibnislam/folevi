import { expect, test } from "@playwright/test";
import { newPerson, waitForSaved, pick, pickDate } from "./helpers";

test("collections: inline names, typed filters (option and date pickers), persistent view, confirmed deletes", async ({ browser }) => {
  const { page } = await newPerson(browser, "Collector");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.getByRole("textbox", { name: "Title" }).fill("Library");
  await page.keyboard.press("Enter");
  await waitForSaved(page);
  await page.keyboard.type("/collection");
  await expect(page.getByRole("option", { name: /Collection/ })).toBeVisible();
  await page.keyboard.press("Enter");

  const coll = page.getByRole("region", { name: /^Collection / });
  await expect(coll).toBeVisible();
  // Inline collection name.
  const name = coll.getByRole("textbox", { name: "Collection name" });
  await name.fill("Reading list");
  await name.press("Enter");
  await expect(page.getByRole("region", { name: "Collection Reading list" })).toBeVisible();

  // Two rows, renamed inline.
  await coll.getByRole("button", { name: "New row" }).click();
  await expect(coll.getByRole("textbox", { name: "Row name" })).toHaveCount(1);
  await coll.getByRole("button", { name: "New row" }).click();
  await expect(coll.getByRole("textbox", { name: "Row name" })).toHaveCount(2);
  await coll.getByRole("textbox", { name: "Row name" }).nth(0).fill("Middlemarch");
  await coll.getByRole("textbox", { name: "Row name" }).nth(0).press("Enter");
  await coll.getByRole("textbox", { name: "Row name" }).nth(1).fill("Dune");
  await coll.getByRole("textbox", { name: "Row name" }).nth(1).press("Enter");
  await expect(coll.getByRole("combobox", { name: "Status for Dune" })).toBeVisible();

  await pick(coll.getByRole("combobox", { name: "Status for Middlemarch" }), "In progress");
  await coll.getByRole("button", { name: /^Date for Dune/ }).click();
  await pickDate(page.getByRole("dialog", { name: "Choose date for dune" }), "2026-10-05");

  // Filter by a select option (picked from the options, not typed).
  await coll.getByRole("button", { name: /View settings/ }).click();
  const settings = page.getByRole("dialog", { name: /settings/ });
  await settings.getByRole("button", { name: "Add filter" }).click();
  const filter = settings.getByRole("group", { name: "Filter 1" });
  await pick(filter.getByLabel("Property"), "Status");
  await pick(filter.getByLabel("Condition"), "is");
  await pick(filter.getByLabel("Value"), "In progress");
  await settings.getByRole("button", { name: "Close" }).click();
  await expect(coll.getByRole("textbox", { name: "Row name" })).toHaveCount(1);
  await expect(coll.getByRole("textbox", { name: "Row name" })).toHaveValue("Middlemarch");

  // Quick successive changes compose: switch to a date filter "is after".
  await coll.getByRole("button", { name: /View settings/ }).click();
  await pick(filter.getByLabel("Property"), "Date");
  await pick(filter.getByLabel("Condition"), "is after");
  await filter.getByRole("button", { name: /^Value/ }).click();
  await pickDate(page.getByRole("dialog", { name: "Choose value" }), "2026-10-01");
  await settings.getByRole("button", { name: "Close" }).click();
  await expect(coll.getByRole("textbox", { name: "Row name" })).toHaveCount(1);
  await expect(coll.getByRole("textbox", { name: "Row name" })).toHaveValue("Dune");

  // Relations: pick linked pages by searching the collection's scope (here, Personal).
  await coll.getByRole("button", { name: /View settings/ }).click();
  await settings.getByLabel("New property").fill("Related");
  await pick(settings.getByLabel("Property type"), "Relation");
  await settings.getByRole("button", { name: "Add", exact: true }).click();
  await settings.getByRole("button", { name: "Close" }).click();
  await coll.getByRole("group", { name: "Related for Dune" }).getByRole("button", { name: "+ Link page" }).click();
  const picker = page.getByRole("dialog", { name: "Link a page" });
  await picker.getByRole("combobox", { name: "Search pages" }).fill("Atlas Brief");
  await picker.getByRole("option", { name: /Project Atlas Brief/ }).click();
  await picker.getByRole("button", { name: "Close" }).click();
  await expect(coll.getByRole("group", { name: "Related for Dune" }).getByRole("link", { name: "Project Atlas Brief" })).toBeVisible();

  // A board view stays selected across reloads.
  await pick(coll.getByRole("combobox", { name: "Add view" }), "Board");
  await expect(coll.getByRole("group", { name: "Views" }).getByRole("button", { name: "Board" })).toHaveAttribute("aria-pressed", "true");
  const again = page.getByRole("region", { name: "Collection Reading list" });
  await expect(again.getByRole("group", { name: "Views" }).getByRole("button", { name: "Board" })).toHaveAttribute("aria-pressed", "true");
  await again.getByRole("group", { name: "Views" }).getByRole("button", { name: "Table" }).click();
  await expect(again.getByRole("textbox", { name: "Row name" })).toHaveValue("Dune");

  // Each row opens as its own page.
  await again.getByRole("link", { name: "Open Dune" }).click();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Dune");
  await page.goBack();

  // Deleting asks first.
  const table = page.getByRole("region", { name: "Collection Reading list" });
  await table.getByRole("button", { name: /View settings/ }).click();
  await page.getByRole("dialog", { name: /settings/ }).getByRole("button", { name: "Remove filter" }).click();
  await page.getByRole("dialog", { name: /settings/ }).getByRole("button", { name: "Close" }).click();
  await expect(table.getByRole("textbox", { name: "Row name" })).toHaveCount(2);
  await table.getByRole("button", { name: "Delete Middlemarch" }).click();
  const confirm = page.getByRole("dialog", { name: "Delete “Middlemarch”?" });
  await confirm.getByRole("button", { name: "Delete row" }).click();
  await expect(table.getByRole("textbox", { name: "Row name" })).toHaveCount(1);
  await expect(table.getByRole("textbox", { name: "Row name" })).toHaveValue("Dune");
});

test("collections: a calendar view places rows by date; drag to move, New on a day, the No date tray", async ({ browser }) => {
  const { page } = await newPerson(browser, "Calendar Collector");
  // Tall enough for the whole month and the tray: drags start and end on screen.
  await page.setViewportSize({ width: 1440, height: 1500 });
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.getByRole("textbox", { name: "Title" }).fill("Launch plan");
  await page.keyboard.press("Enter");
  await waitForSaved(page);
  await page.keyboard.type("/calendar");
  await expect(page.getByRole("option", { name: /^Calendar/ })).toBeVisible();
  await page.keyboard.press("Enter");

  const coll = page.getByRole("region", { name: "Collection Calendar" });
  await expect(coll).toBeVisible({ timeout: 20_000 });
  await expect(coll.getByRole("button", { name: /Calendar/ })).toHaveAttribute("aria-pressed", "true");
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const day = (date: string) => coll.locator(`[role="gridcell"][data-date="${date}"]`);
  const other = await page.evaluate((t) => {
    const [y, m, d] = t.split("-").map(Number) as [number, number, number];
    // Another day in the same month: the 10th, or the 20th when today is the 10th.
    return `${y}-${String(m).padStart(2, "0")}-${d === 10 ? "20" : "10"}`;
  }, today);

  // New on a day adds a row dated that day.
  await day(today).hover();
  await day(today).getByRole("button", { name: /^New row on / }).click();
  await expect(day(today).getByRole("link", { name: "Untitled" })).toBeVisible();

  // Drag it to another day: its date changes.
  await day(today).getByRole("link", { name: "Untitled" }).dragTo(day(other));
  await expect(day(other).getByRole("link", { name: "Untitled" })).toBeVisible();
  await expect(day(today).getByRole("link", { name: "Untitled" })).toHaveCount(0);

  // Dropped on the No date tray, it loses its date.
  const tray = coll.getByRole("region", { name: "No date" });
  await day(other).getByRole("link", { name: "Untitled" }).dragTo(tray);
  await expect(tray.getByRole("link", { name: "Untitled" })).toBeVisible();
  await expect(day(other).getByRole("link", { name: "Untitled" })).toHaveCount(0);
  // Saved, not just shown.
  await page.waitForTimeout(1000);
  await page.reload();
  await expect(tray.getByRole("link", { name: "Untitled" })).toBeVisible({ timeout: 20_000 });

  // The table view shows the same rows.
  await pick(coll.getByRole("combobox", { name: "Add view" }), "Table");
  await expect(coll.getByRole("textbox", { name: "Row name" })).toHaveCount(1);
  await coll.getByRole("button", { name: /Calendar/ }).click();

  // A chip opens the row's page.
  await tray.getByRole("link", { name: "Untitled" }).click();
  await expect(page.getByRole("region", { name: "Properties in Calendar" })).toBeVisible();
});
