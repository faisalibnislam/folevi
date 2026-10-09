import { expect, test, type Page } from "@playwright/test";
import { APP, newPerson, waitForSaved } from "./helpers";

// The knowledge graph on the dev backend (no model key, a trial account): the graph shows notes and their
// explicit links with a plain note that the full graph is part of Pro, the List view reads the same graph
// as text, and a note's Related panel lists its links (or says there's nothing yet).

async function newPage(page: Page, title: string) {
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  const t = page.getByRole("textbox", { name: "Title" });
  await expect(t).toBeFocused();
  await t.fill(title);
  await page.keyboard.press("Enter");
  return page.url().replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "");
}

async function openRelated(page: Page) {
  await page.getByRole("group", { name: "Page" }).getByRole("button", { name: "Document actions" }).click();
  await page.getByRole("menuitem", { name: "Related notes" }).click();
  const panel = page.getByRole("region", { name: "Related", exact: true });
  await expect(panel).toBeVisible();
  return panel;
}

test("the graph shows notes and links, the list reads it as text, and a note lists what's related", async ({ browser }) => {
  test.setTimeout(150_000);
  const { context, page } = await newPerson(browser, "Graph Person");
  await page.goto(`${APP}/documents`);

  // A note with nothing around it: the Related panel says so.
  await newPage(page, "Lonely thought");
  await page.keyboard.type("Nothing links here.");
  await waitForSaved(page);
  let panel = await openRelated(page);
  await expect(panel.getByText(/Nothing related yet/)).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByText(/part of Pro/)).toBeVisible();
  await page.keyboard.press("Escape");

  // Two notes joined by a [[ link.
  const source = await newPage(page, "Trip planning");
  await page.keyboard.type("see [[Packing list");
  await page.getByRole("option", { name: /Create page “Packing list”/ }).click();
  await waitForSaved(page);
  panel = await openRelated(page);
  await expect(panel.getByRole("link", { name: /Packing list/ })).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByText("Linked in this note")).toBeVisible();
  await page.keyboard.press("Escape");

  // The graph page, from the sidebar (a note's sidebar lists its pages, so from Home).
  await page.getByRole("link", { name: "Home", exact: true }).first().click();
  await page.getByRole("navigation", { name: "Folio" }).getByRole("link", { name: "Graph", exact: true }).click();
  await page.waitForURL(/\/graph$/);
  await expect(page.getByRole("application", { name: /Graph of \d+ notes/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/The full graph, with topics, people and similar notes, is part of Pro/)).toBeVisible();
  // No entity filters below Pro.
  await expect(page.getByRole("group", { name: "Show" })).toHaveCount(0);
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Fit to screen" }).click();

  // The list: the link between the two notes, as text, and search narrows it.
  await page.getByRole("group", { name: "View" }).getByRole("button", { name: "List" }).click();
  await expect(page.getByRole("list", { name: "Connected to Trip planning" }).getByRole("link", { name: "Packing list" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Connected to Packing list" }).getByRole("link", { name: "Trip planning" })).toBeVisible();
  await page.getByRole("searchbox", { name: "Find in the graph" }).fill("packing");
  await expect(page.getByRole("main").getByRole("link", { name: "Trip planning", exact: true })).toHaveCount(1);
  await expect(page.getByText(/1 found/)).toBeVisible();
  // A note in the list opens it.
  await page.getByRole("searchbox", { name: "Find in the graph" }).fill("");
  await page.getByRole("main").getByRole("link", { name: "Trip planning", exact: true }).first().click();
  await page.waitForURL(new RegExp(`${source}$`));

  // Narrow widths: the graph page still works.
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`${APP}/graph`);
  await expect(page.getByRole("group", { name: "View" })).toBeVisible({ timeout: 20_000 });
  await context.close();
});
