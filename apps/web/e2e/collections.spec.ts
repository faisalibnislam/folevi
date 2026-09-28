import { expect, test } from "@playwright/test";
import { newPersonWithWorkspace, waitForSaved, pick } from "./helpers";

test("collections: inline names, typed filters (option and date pickers), persistent view, confirmed deletes", async ({ browser }) => {
  const { page } = await newPersonWithWorkspace(browser, "Collector");
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
  await coll.getByLabel("Date for Dune").fill("2026-10-05");

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
  await filter.getByLabel("Value").fill("2026-10-01");
  await settings.getByRole("button", { name: "Close" }).click();
  await expect(coll.getByRole("textbox", { name: "Row name" })).toHaveCount(1);
  await expect(coll.getByRole("textbox", { name: "Row name" })).toHaveValue("Dune");

  // Relations: pick linked pages by searching the workspace.
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
  await expect(coll.getByRole("tab", { name: "Board" })).toHaveAttribute("aria-selected", "true");
  await page.reload();
  const again = page.getByRole("region", { name: "Collection Reading list" });
  await expect(again.getByRole("tab", { name: "Board" })).toHaveAttribute("aria-selected", "true");
  await again.getByRole("tab", { name: "Table" }).click();
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
