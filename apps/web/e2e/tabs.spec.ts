import { expect, test, type Page } from "@playwright/test";
import { newPerson, openShare, waitForSaved } from "./helpers";

// Tabs inside a note (/tabs): a tabs block splits part of the note into named tabs, each with its own lines.
// Adding, renaming, reordering and deleting tabs; the strip is a keyboard tablist; the open tab is each
// viewer's own and remembered; readers of a shared page switch tabs too.

const strip = (page: Page) => page.locator(".fb-editor").getByRole("tablist", { name: "Tabs" });
const tab = (page: Page, name: string) => strip(page).getByRole("tab", { name, exact: true });

async function newNoteWithTabs(page: Page, title: string) {
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.keyboard.type(title);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Before the tabs");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/tabs");
  await expect(page.getByRole("option", { name: /Tabs/ }).first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(strip(page)).toBeVisible();
}

test("tabs: add, write, switch with the keyboard, rename, reorder and delete; the open tab is remembered", async ({ browser }) => {
  test.setTimeout(150_000);
  const { page, context } = await newPerson(browser, "Tab Keeper");
  await newNoteWithTabs(page, "Trip plan");

  // Two tabs to start, the caret in the first.
  await expect(strip(page).getByRole("tab")).toHaveCount(2);
  await expect(tab(page, "Tab 1")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.type("Flights and hotels");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Pack light");

  // The second tab holds its own lines.
  await tab(page, "Tab 2").click();
  await expect(tab(page, "Tab 2")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".fb-editor").getByText("Flights and hotels")).toBeHidden();
  await page.locator(".fb-editor .fb-in-tab").first().click();
  await page.keyboard.type("Museum on Tuesday");
  await expect(page.locator(".fb-editor").getByText("Museum on Tuesday")).toBeVisible();

  // Arrow keys move along the strip and open each tab (a tablist); Enter goes into the tab's text.
  await tab(page, "Tab 2").focus();
  await page.keyboard.press("ArrowLeft");
  await expect(tab(page, "Tab 1")).toBeFocused();
  await expect(tab(page, "Tab 1")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".fb-editor").getByText("Flights and hotels")).toBeVisible();
  await expect(page.locator(".fb-editor").getByText("Museum on Tuesday")).toBeHidden();
  await page.keyboard.press("End");
  await expect(tab(page, "Tab 2")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(tab(page, "Tab 1")).toHaveAttribute("aria-selected", "true");

  // Rename with a double-click.
  await tab(page, "Tab 1").dblclick();
  const field = page.getByRole("textbox", { name: "Tab name" });
  await field.fill("Booking");
  await field.press("Enter");
  await expect(tab(page, "Booking")).toBeVisible();

  // Add a third tab: it opens, named in place.
  await page.getByRole("button", { name: "Add a tab" }).click();
  await page.getByRole("textbox", { name: "Tab name" }).fill("Food");
  await page.getByRole("textbox", { name: "Tab name" }).press("Enter");
  await expect(tab(page, "Food")).toHaveAttribute("aria-selected", "true");
  await page.locator(".fb-editor .fb-in-tab").first().click();
  await page.keyboard.type("Try the market");

  // Reorder: Option+Shift+Left moves the focused tab; the tab's menu moves it too.
  await tab(page, "Food").focus();
  await page.keyboard.press("Alt+Shift+ArrowLeft");
  await expect(strip(page).getByRole("tab")).toHaveText(["Booking", "Food", "Tab 2"]);
  await tab(page, "Food").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move left" }).click();
  await expect(strip(page).getByRole("tab")).toHaveText(["Food", "Booking", "Tab 2"]);

  // Delete the second tab from its menu (its lines go with it).
  await tab(page, "Tab 2").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete tab" }).click();
  await expect(strip(page).getByRole("tab")).toHaveText(["Food", "Booking"]);

  // After the tabs block, the note goes on.
  await expect(page.locator(".fb-editor").getByText("Before the tabs")).toBeVisible();
  await waitForSaved(page);

  // The open tab is remembered on this device; the lines are where they were.
  await tab(page, "Booking").click();
  await page.reload();
  await expect(tab(page, "Booking")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".fb-editor").getByText("Pack light")).toBeVisible();
  await expect(page.locator(".fb-editor").getByText("Try the market")).toBeHidden();
  await expect(page.locator(".fb-editor").getByText("Museum on Tuesday")).toHaveCount(0);

  // Find opens the tab that has the match.
  await page.keyboard.press("ControlOrMeta+Alt+f");
  await page.getByRole("search", { name: "Find in note" }).getByRole("textbox", { name: "Find", exact: true }).fill("market");
  await expect(tab(page, "Food")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".fb-editor").getByText("Try the market")).toBeVisible();
  await context.close();
});

test("tabs on a shared page: readers switch tabs; the strip scrolls sideways on a phone", async ({ browser }) => {
  test.setTimeout(150_000);
  const { page, context } = await newPerson(browser, "Tab Sharer");
  await newNoteWithTabs(page, "Recipes");
  await page.keyboard.type("Pancakes need eggs");
  await tab(page, "Tab 2").click();
  await page.locator(".fb-editor .fb-in-tab").first().click();
  await page.keyboard.type("Soup needs stock");
  await waitForSaved(page);

  await openShare(page);
  const share = page.getByRole("dialog", { name: /Share/ });
  await share.getByRole("button", { name: "Create link" }).click();
  const link = await share.getByLabel("Public link").inputValue();

  const anon = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const reader = await anon.newPage();
  await reader.goto(link);
  const list = reader.getByRole("tablist", { name: "Tabs" });
  await expect(list.getByRole("tab", { name: "Tab 1" })).toHaveAttribute("aria-selected", "true");
  await expect(reader.getByRole("tabpanel", { name: "Tab 1" })).toContainText("Pancakes need eggs");
  await expect(reader.getByText("Soup needs stock")).toBeHidden();
  await list.getByRole("tab", { name: "Tab 2" }).tap();
  await expect(reader.getByRole("tabpanel", { name: "Tab 2" })).toContainText("Soup needs stock");
  await expect(reader.getByText("Pancakes need eggs")).toBeHidden();
  // Touch-sized tabs, and the strip scrolls rather than widening the page.
  const box = (await list.getByRole("tab", { name: "Tab 2" }).boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(await reader.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(await list.evaluate((el) => getComputedStyle(el).overflowX)).toBe("auto");
  await anon.close();
  await context.close();
});
