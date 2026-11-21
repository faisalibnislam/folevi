import { expect, test } from "@playwright/test";
import { newPerson } from "./helpers";

test("Back and Forward: each tab keeps its own, Back goes to the tab a page came from, greyed out with nowhere to go", async ({ browser }) => {
  const { page, context } = await newPerson(browser, "Back Walker");
  await page.goto("/documents");
  const history = page.getByRole("group", { name: "History" });
  const back = history.getByRole("button", { name: "Back" });
  const forward = history.getByRole("button", { name: "Forward" });
  await expect(back).toBeDisabled();
  await expect(forward).toBeDisabled();

  // A note opened from Home gets a tab of its own, which remembers it came from Home: Back closes it and shows Home
  // again, as Safari does (the owner, 21 November 2026).
  await page.getByRole("link", { name: /Trip Sketch: Coastal Weekend/ }).first().click();
  await expect(page).toHaveURL(/\/d\//);
  const strip = page.getByRole("navigation", { name: "Open pages" });
  await expect(strip.getByRole("link", { name: /Trip Sketch/ })).toBeVisible();
  await expect(back).toBeEnabled();
  await back.click();
  await expect(page).toHaveURL(/\/documents$/);
  await expect(strip.getByRole("link", { name: /Trip Sketch/ })).toHaveCount(0);
  await expect(back).toBeDisabled();

  // A view opened from the sidebar starts a fresh tab, with nowhere to go back to.
  const nav = page.getByRole("navigation", { name: "Folio" });
  await nav.getByRole("link", { name: "Foli DNA", exact: true }).click();
  await expect(page).toHaveURL(/\/graph$/);
  await expect(strip.getByRole("link", { name: "Foli DNA" })).toBeVisible();
  await expect(back).toBeDisabled();
  await expect(forward).toBeDisabled();

  // A folder tab goes from folder to folder in place: Back and Forward step through that tab's own history.
  await nav.getByRole("link", { name: "Projects", exact: true }).click();
  await expect(page).toHaveURL(/\/folders\/[0-9A-Z]{26}$/);
  const projects = page.url();
  await expect(back).toBeDisabled();
  await nav.getByRole("link", { name: "Personal", exact: true }).click();
  await expect(page).toHaveURL(/\/folders\/[0-9A-Z]{26}$/);
  await expect(page).not.toHaveURL(projects);
  const personal = page.url();
  await expect(strip.getByRole("link", { name: "Personal", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(strip.getByRole("link", { name: "Projects", exact: true })).toHaveCount(0);
  await back.click();
  await expect(page).toHaveURL(projects);
  await expect(strip.locator('[aria-current="page"]')).toHaveText("Projects");
  await expect(back).toBeDisabled();
  await forward.click();
  await expect(page).toHaveURL(personal);
  await expect(forward).toBeDisabled();
  // ⌘[ / ⌘] too.
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("ControlOrMeta+BracketLeft");
  await expect(page).toHaveURL(projects);
  await expect(forward).toBeEnabled();
  await page.keyboard.press("ControlOrMeta+BracketRight");
  await expect(page).toHaveURL(personal);
  await expect(forward).toBeDisabled();
  await context.close();
});
