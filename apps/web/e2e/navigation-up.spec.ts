import { expect, test } from "@playwright/test";
import { newPerson } from "./helpers";

test("the Up button goes up a level: note → its folder → Folders → Home (disabled there)", async ({ browser }) => {
  const { page } = await newPerson(browser, "Up Walker");
  await page.goto("/documents");
  await page.getByRole("link", { name: /Trip Sketch: Coastal Weekend/ }).first().click();
  await expect(page).toHaveURL(/\/d\//);
  await page.getByRole("button", { name: "Up to Personal" }).click();
  await expect(page).toHaveURL(/\/folders\/[0-9A-Z]{26}$/);
  await page.getByRole("button", { name: "Up to Folders" }).click();
  await expect(page).toHaveURL(/\/folders$/);
  await page.getByRole("button", { name: "Up to Home" }).click();
  await expect(page).toHaveURL(/\/documents$/);
  await expect(page.getByRole("button", { name: "Up", exact: true })).toBeDisabled();
});
