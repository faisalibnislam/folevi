import { expect, test, type Page } from "@playwright/test";
import { newPerson, waitForSaved } from "./helpers";

async function newPage(page: Page, title: string) {
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  // The new page's own (empty, focused) title, not the previous page's still on screen.
  const field = page.getByRole("textbox", { name: "Title" });
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("");
  await field.fill(title);
  await page.keyboard.press("Enter");
  await waitForSaved(page);
}

test("the tab menu closes a tab, the tabs to its right or left, or all of them", async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page } = await newPerson(browser, "Tabber");
  for (const t of ["Alpha", "Bravo", "Charlie", "Delta"]) await newPage(page, t);
  const strip = page.getByRole("navigation", { name: "Open pages" });
  const tab = (name: string) => strip.getByRole("link", { name, exact: true });
  const names = async () => (await strip.getByRole("link").allTextContents()).map((s) => s.trim()).filter((s) => s !== "Home");
  await expect.poll(names, { timeout: 20_000 }).toEqual(["Welcome to Folevi", "Alpha", "Bravo", "Charlie", "Delta"]);
  const open = async (name: string) => {
    await tab(name).click({ button: "right" });
    return page.getByRole("menu", { name: "Tab options" });
  };
  // To the right of Bravo: Charlie and Delta go; Delta was showing, so Bravo shows.
  await (await open("Bravo")).getByRole("menuitem", { name: "Close tabs to the right" }).click();
  await expect.poll(names).toEqual(["Welcome to Folevi", "Alpha", "Bravo"]);
  await expect(page).toHaveURL(new RegExp((await tab("Bravo").getAttribute("href"))!));
  // To the left of Bravo: the others go.
  await (await open("Bravo")).getByRole("menuitem", { name: "Close tabs to the left" }).click();
  await expect.poll(names).toEqual(["Bravo"]);
  // Nothing to the left or right of the only tab.
  const menu = await open("Bravo");
  await expect(menu.getByRole("menuitem", { name: "Close tabs to the left" })).toBeDisabled();
  await expect(menu.getByRole("menuitem", { name: "Close tabs to the right" })).toBeDisabled();
  await menu.getByRole("menuitem", { name: "Close all tabs" }).click();
  await expect.poll(names).toEqual([]);
  await expect(page).toHaveURL(/\/documents/);
  await context.close();
});
