import { expect, test } from "@playwright/test";
import { APP, newPerson, openTool } from "./helpers";

test("pages open in tabs with their own sidebar; the sidebar can switch to folders", async ({ browser }) => {
  const { page } = await newPerson(browser, "Tab Person");
  const tabs = page.getByRole("navigation", { name: "Open pages" });
  // Onboarding opened the Welcome page: it has a tab, and the page sidebar replaces the app navigation.
  await expect(tabs.getByRole("link", { name: "Welcome to Folevi" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "Folio" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Table of contents" })).toBeVisible();
  // Search everywhere is at the top of the page sidebar too.
  await page.getByRole("button", { name: /Search or jump to/ }).click();
  await expect(page.getByRole("dialog", { name: /Search|Command/ })).toBeVisible();
  await page.keyboard.press("Escape");

  // Tasks and Find work on the page's own content.
  await page.getByRole("tab", { name: "Tasks in this page" }).click();
  await expect(page.getByText(/of \d+ done/)).toBeVisible();
  await page.getByRole("tab", { name: "Find in page" }).click();
  await page.getByLabel("Find text in this page").fill("backlinks");
  await expect(page.getByRole("status").filter({ hasText: /^1 of / })).toBeVisible();
  await page.getByLabel("Find text in this page").fill("zzz-not-here");
  await expect(page.getByText("No results in this page")).toBeVisible();

  // A second page opens in its own tab; closing it returns to its neighbour.
  await page.goto(`${APP}/documents`);
  await page.getByRole("link", { name: /Reading Shelf/ }).first().click();
  await expect(tabs.getByRole("link", { name: /Reading Shelf/ })).toHaveAttribute("aria-current", "page");
  await expect(tabs.getByRole("link", { name: "Welcome to Folevi" })).toBeVisible();
  await tabs.getByRole("button", { name: /Close Reading Shelf/ }).click();
  await expect(page).toHaveURL(/\/d\//);
  await expect(tabs.getByRole("link", { name: /Reading Shelf/ })).toHaveCount(0);

  // The left sidebar can show the app folders instead of the page tools.
  await page.getByRole("button", { name: "Sidebar", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Show folders" }).click();
  await expect(page.getByRole("navigation", { name: "Folio" })).toBeVisible();
  await page.getByRole("button", { name: "Sidebar", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Show document" }).click();
  // …and back to the page tools, on the tab that was last open.
  await expect(page.getByRole("tab", { name: "Find in page" })).toHaveAttribute("aria-selected", "true");
});

test("a nested page opens inside the note's tab; a new page opens its own tab; no back/forward pills", async ({ browser }) => {
  const { page } = await newPerson(browser, "Nested Tabs");
  const tabs = page.getByRole("navigation", { name: "Open pages" });
  await expect(tabs.getByRole("link", { name: "Welcome to Folevi" })).toHaveAttribute("aria-current", "page");
  const before = await tabs.getByRole("button", { name: /^Close / }).count();
  await expect(page.getByRole("group", { name: "History" })).toHaveCount(0);

  // A page added inside this note (Insert → Page) opens inside the note's tab: nested pages never get
  // a tab of their own, and the tab reads "Note › Page".
  await openTool(page, "Insert");
  await page.getByRole("textbox", { name: "Document body" }).locator("p").first().click();
  await page.getByRole("button", { name: "Page", exact: true }).click();
  await page.waitForURL(/\?new=1/);
  await expect(tabs.getByRole("button", { name: /^Close / })).toHaveCount(before);
  await page.getByRole("textbox", { name: "Title" }).fill("Inner page");
  await expect(tabs.getByRole("link", { name: "Welcome to Folevi › Inner page" })).toHaveAttribute("aria-current", "page");
  // The page says where it is, the sidebar lists the note's pages, and the way back is one click.
  const path = page.getByRole("navigation", { name: "Page path" });
  await expect(path).toContainText("Welcome to Folevi");
  await expect(path).toContainText("Inner page");
  const pages = page.getByRole("navigation", { name: "Pages in this note" });
  await expect(pages.getByRole("link", { name: "Inner page" })).toHaveAttribute("aria-current", "page");
  await expect(pages.getByRole("link", { name: "Welcome to Folevi" })).toBeVisible();
  const inner = page.url().split("?")[0]!;
  await path.getByRole("link", { name: "Back to Welcome to Folevi" }).click();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Welcome to Folevi");
  await expect(tabs.getByRole("link", { name: "Welcome to Folevi" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "Page path" })).toHaveCount(0);

  // "+" starts a new page in a new tab.
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\?new=1/);
  await expect(tabs.getByRole("button", { name: /^Close / })).toHaveCount(before + 1);

  // Opening the nested page from elsewhere goes back to the note's tab rather than adding one.
  await page.goto(inner);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Inner page");
  await expect(tabs.getByRole("link", { name: "Welcome to Folevi › Inner page" })).toHaveAttribute("aria-current", "page");
  await expect(tabs.getByRole("button", { name: /^Close / })).toHaveCount(before + 1);
});
