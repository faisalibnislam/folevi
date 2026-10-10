import { expect, test } from "@playwright/test";
import { newPerson } from "./helpers";

test("Back and Forward work like a browser's, across tabs, and are greyed out with nowhere to go", async ({ browser }) => {
  const { page, context } = await newPerson(browser, "Back Walker");
  await page.goto("/documents");
  const history = page.getByRole("group", { name: "History" });
  const back = history.getByRole("button", { name: "Back" });
  const forward = history.getByRole("button", { name: "Forward" });
  await expect(back).toBeDisabled();
  await expect(forward).toBeDisabled();

  // A note, then Graph: each keeps its tab.
  await page.getByRole("link", { name: /Trip Sketch: Coastal Weekend/ }).first().click();
  await expect(page).toHaveURL(/\/d\//);
  const note = page.url();
  await page.getByRole("link", { name: "Home", exact: true }).first().click();
  await page.getByRole("navigation", { name: "Folio" }).getByRole("link", { name: "Graph", exact: true }).click();
  await expect(page).toHaveURL(/\/graph$/);
  const strip = page.getByRole("navigation", { name: "Open pages" });
  await expect(strip.getByRole("link", { name: "Graph" })).toBeVisible();
  await expect(strip.getByRole("link", { name: /Trip Sketch/ })).toBeVisible();

  // Back: Home, then the note (its tab); Forward: Home again.
  await back.click();
  await expect(page).toHaveURL(/\/documents$/);
  await back.click();
  await expect(page).toHaveURL(note);
  await expect(strip.locator('[aria-current="page"]')).toHaveText(/Trip Sketch/);
  await forward.click();
  await expect(page).toHaveURL(/\/documents$/);
  // ⌘[ / ⌘] too.
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("ControlOrMeta+BracketRight");
  await expect(page).toHaveURL(/\/graph$/);
  await expect(forward).toBeDisabled();
  await page.keyboard.press("ControlOrMeta+BracketLeft");
  await expect(page).toHaveURL(/\/documents$/);
  await context.close();
});
