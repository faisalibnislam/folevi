import { expect, test } from "@playwright/test";
import { newPersonWithWorkspace, showFolders } from "./helpers";

test("folders, starring, archive, trash and restore", async ({ browser }) => {
  const { page } = await newPersonWithWorkspace(browser, "Organizer");
  await showFolders(page);
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Home" }).click();
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();

  // New folder
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill("Letters");
  await page.getByRole("button", { name: "Create folder" }).click();
  const nav = page.getByRole("navigation", { name: "Workspace" });
  await expect(nav.getByRole("link", { name: "Letters" })).toBeVisible();

  // Star + move via document menu
  // Home shows recent notes, starred notes and recent folders; act on the Recent notes section.
  const recent = page.getByRole("region", { name: "Recent notes" });
  const card = recent.getByRole("listitem").filter({ hasText: "Field Notes: A Quiet Morning" });
  await card.hover();
  await card.getByRole("button", { name: /Actions for Field Notes/ }).click();
  await page.getByRole("menuitem", { name: "Star" }).click();
  await expect(page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: /Field Notes: A Quiet Morning/ })).toBeVisible();
  await card.hover();
  await card.getByRole("button", { name: /Actions for Field Notes/ }).click();
  await page.getByRole("menuitem", { name: "Move to folder…" }).click();
  await page.getByRole("dialog", { name: "Move to folder" }).getByRole("button", { name: "Letters" }).click();
  await nav.getByRole("link", { name: "Letters" }).click();
  await expect(page.getByRole("main").getByText("Field Notes: A Quiet Morning")).toBeVisible();

  // Archive then trash then restore
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Home" }).click();
  const trip = recent.getByRole("listitem").filter({ hasText: "Trip Sketch: Coastal Weekend" });
  await trip.hover();
  await trip.getByRole("button", { name: /Actions for Trip Sketch/ }).click();
  await page.getByRole("menuitem", { name: "Move to Trash" }).click();
  await expect(recent.getByRole("listitem").filter({ hasText: "Trip Sketch: Coastal Weekend" })).toHaveCount(0);
  await page.getByRole("link", { name: "Trash" }).click();
  await expect(page.getByRole("main").getByText("Trip Sketch: Coastal Weekend")).toBeVisible();
  await page.getByRole("button", { name: /Actions for Trip Sketch/ }).click();
  await page.getByRole("menuitem", { name: "Restore" }).click();
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Home" }).click();
  await expect(recent.getByRole("listitem").filter({ hasText: "Trip Sketch: Coastal Weekend" })).toHaveCount(1);
});

test("search finds text inside documents with highlighted matches", async ({ browser }) => {
  const { page } = await newPersonWithWorkspace(browser, "Searcher");
  await showFolders(page);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  const box = page.getByRole("combobox", { name: /Search documents/ });
  await box.fill("magpies");
  const option = page.getByRole("option").filter({ hasText: "Field Notes" });
  await expect(option).toBeVisible();
  await expect(option.locator("mark").first()).toHaveText(/magpies/i);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Field Notes: A Quiet Morning");
});
