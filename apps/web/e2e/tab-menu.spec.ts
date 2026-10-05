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

test("tabs reorder by dragging, or ⌥⇧← / ⌥⇧→ from the keyboard, and a drag doesn't open the tab", async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page } = await newPerson(browser, "Dragger");
  for (const t of ["Alpha", "Bravo"]) await newPage(page, t);
  const strip = page.getByRole("navigation", { name: "Open pages" });
  const tab = (name: string) => strip.getByRole("link", { name, exact: true });
  const names = async () => (await strip.getByRole("link").allTextContents()).map((s) => s.trim()).filter((s) => s !== "Home");
  await expect.poll(names, { timeout: 20_000 }).toEqual(["Welcome to Folevi", "Alpha", "Bravo"]);
  const url = page.url();
  // Drag Bravo (showing) left past Alpha and Welcome.
  const from = (await tab("Bravo").boundingBox())!;
  const to = (await tab("Welcome to Folevi").boundingBox())!;
  await page.mouse.move(from.x + 20, from.y + from.height / 2);
  await page.mouse.down();
  for (let x = from.x + 20; x > to.x; x -= 20) await page.mouse.move(x, from.y + from.height / 2);
  await page.mouse.up();
  await expect.poll(names).toEqual(["Bravo", "Welcome to Folevi", "Alpha"]);
  // Dragging Alpha didn't open it either: still on Bravo.
  const alpha = (await tab("Alpha").boundingBox())!;
  const welcome = (await tab("Welcome to Folevi").boundingBox())!;
  await page.mouse.move(alpha.x + 20, alpha.y + alpha.height / 2);
  await page.mouse.down();
  for (let x = alpha.x + 20; x > welcome.x + 10; x -= 20) await page.mouse.move(x, alpha.y + alpha.height / 2);
  await page.mouse.up();
  await expect.poll(names).toEqual(["Bravo", "Alpha", "Welcome to Folevi"]);
  expect(page.url()).toBe(url);
  // From the keyboard.
  await tab("Bravo").focus();
  await page.keyboard.press("Alt+Shift+ArrowRight");
  await expect.poll(names).toEqual(["Alpha", "Bravo", "Welcome to Folevi"]);
  await expect(tab("Bravo")).toBeFocused();
  // The order is kept after a reload.
  await page.reload();
  await expect.poll(names, { timeout: 20_000 }).toEqual(["Alpha", "Bravo", "Welcome to Folevi"]);
  await context.close();
});
