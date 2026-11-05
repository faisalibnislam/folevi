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
  await page.getByRole("navigation", { name: "Folio" }).getByRole("link", { name: "Foli DNA", exact: true }).click();
  await page.waitForURL(/\/graph$/);
  await expect(page.getByRole("application", { name: /Foli DNA of \d+ notes/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/The full Foli DNA, with topics, people and similar notes, is part of Pro/)).toBeVisible();
  // The first time: three tips, then never again.
  const tips = page.getByRole("dialog", { name: "Foli DNA tips" });
  await expect(tips).toContainText("This is Foli DNA");
  await tips.getByRole("button", { name: "Skip" }).click();
  await expect(tips).toHaveCount(0);
  // A fresh map hides the unlinked note and says so.
  await expect(page.getByText("1 unlinked note hidden.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Key" })).toBeVisible();
  // No entity filters below Pro: the Show menu has only the map's own choices.
  await page.getByRole("button", { name: "Show", exact: true }).click();
  await expect(page.getByRole("menuitemcheckbox", { name: /^Unlinked notes/ })).toBeVisible();
  await expect(page.getByRole("menuitemcheckbox", { name: "People" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Fit to screen" }).click();

  // The list: the link between the two notes, as text, and search narrows it.
  await page.getByRole("group", { name: "View" }).getByRole("button", { name: "List" }).click();
  await expect(page.getByRole("list", { name: "Connected to Trip planning" }).getByRole("link", { name: "Packing list" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Connected to Packing list" }).getByRole("link", { name: "Trip planning" })).toBeVisible();
  await page.getByRole("searchbox", { name: "Find in Foli DNA" }).fill("packing");
  await expect(page.getByRole("main").getByRole("link", { name: "Trip planning", exact: true })).toHaveCount(1);
  await expect(page.getByText(/1 found/)).toBeVisible();
  // A note in the list opens it.
  await page.getByRole("searchbox", { name: "Find in Foli DNA" }).fill("");
  await page.getByRole("main").getByRole("link", { name: "Trip planning", exact: true }).first().click();
  await page.waitForURL(new RegExp(`${source}$`));

  // Foli DNA of this note, from its menu: the map around it, one step out, and back to everything.
  await page.getByRole("group", { name: "Page" }).getByRole("button", { name: "Document actions" }).click();
  await page.getByRole("menuitem", { name: "Foli DNA of this note" }).click();
  await page.waitForURL(/\/graph\?note=/);
  await page.getByRole("group", { name: "View" }).getByRole("button", { name: "Map" }).click();
  await expect(page.getByText("Around")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("application", { name: /Foli DNA of 2 notes/ })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Connections" }).getByText("links to")).toBeVisible();
  await page.getByRole("button", { name: "Whole map", exact: true }).click();
  await page.waitForURL(/\/graph$/);
  // Two linked notes make no cluster (three is the least): nothing is shaded behind the map.
  await expect(page.locator('svg circle[opacity="0.06"]')).toHaveCount(0);
  // Insights: the unlinked note is listed; it's hidden on a fresh map, and showing it adds it.
  await page.getByRole("button", { name: "Insights" }).click();
  const insights = page.getByRole("complementary", { name: "Insights" });
  await expect(insights.getByRole("link", { name: "Lonely thought" })).toBeVisible();
  await expect(page.getByRole("application", { name: /Foli DNA of 2 notes/ })).toBeVisible();
  await page.getByRole("button", { name: "Show", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: /^Unlinked notes/ }).click();
  await expect(page.getByRole("application", { name: /Foli DNA of 3 notes/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show, 1 changed", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show, 1 changed", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: /^Unlinked notes/ }).click();
  // A saved view shows in the sidebar under Foli DNA.
  await page.getByRole("button", { name: "Saved views" }).click();
  await page.getByRole("menuitem", { name: "Save this view…" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Everything");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("group", { name: "Saved Foli DNA views" }).getByRole("link", { name: "Everything" })).toBeVisible({ timeout: 20_000 });

  // Narrow widths: the graph page still works.
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`${APP}/graph`);
  await expect(page.getByRole("group", { name: "View" })).toBeVisible({ timeout: 20_000 });
  await context.close();
});
