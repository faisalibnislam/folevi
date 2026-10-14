import { expect, test } from "@playwright/test";
import { createWorkspace, newPerson, pick, switcher, switchTo, waitForSaved } from "./helpers";

test("copy a Personal note to a workspace and open the copy there", async ({ browser }) => {
  const { page } = await newPerson(browser, "Copier");
  await createWorkspace(page, "Acme Studio");
  await switchTo(page, "Personal");

  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  const original = page.url().match(/\/d\/([0-9A-Z]{26})/)![1]!;
  await page.getByRole("textbox", { name: "Title" }).fill("Trip plan");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Pack the tent and the stove.");
  await waitForSaved(page);

  await page.getByRole("button", { name: "Document actions" }).click();
  await page.getByRole("menuitem", { name: "Copy to…" }).click();
  const dialog = page.getByRole("dialog", { name: "Copy “Trip plan”" });
  // Another place is picked to start with; Personal is where the note is now.
  const place = dialog.getByRole("combobox", { name: "Copy to" });
  await expect(place).toContainText("Acme Studio");
  await pick(place, "Personal (here)");
  await pick(place, "Acme Studio");
  await expect(dialog.getByRole("checkbox", { name: "Include sub-pages" })).toHaveAttribute("aria-checked", "true");
  await dialog.getByRole("button", { name: "Copy", exact: true }).click();

  const toast = page.getByRole("status").filter({ hasText: "Copied to Acme Studio" });
  await expect(toast).toBeVisible();
  await toast.getByRole("button", { name: "Open" }).click();

  // The copy opens in the workspace: a new note with the same content.
  await page.waitForURL((url) => /\/d\/[0-9A-Z]{26}/.test(url.pathname) && !url.pathname.includes(original));
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Trip plan");
  await expect(page.getByRole("textbox", { name: "Document body" })).toContainText("Pack the tent and the stove.");
  await expect(switcher(page)).toHaveAccessibleName("Acme Studio: Personal, workspaces and account");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Document body" })).toContainText("Pack the tent and the stove.");

  // The original is still in Personal.
  await page.goto(page.url().replace(/\/d\/[0-9A-Z]{26}.*/, `/d/${original}`));
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Trip plan");
});
