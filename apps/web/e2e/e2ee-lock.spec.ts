import { expect, test } from "@playwright/test";
import { APP, newPerson, showFolders } from "./helpers";
import { e2eeScan, marker, paletteResults } from "./e2ee-helpers";

// §11.4 e2ee-lock: in a Standard space, lock a folder; its notes are sealed, server search can't find them,
// search on the device can. Needs LOCK_MENU_FOR_EVERYONE on (components/e2ee/LockDialog.tsx), which is off until launch.

test("a locked folder in a Standard space", async ({ browser }) => {
  test.setTimeout(420_000);
  const { page, context } = await newPerson(browser, "Lock Person");
  await showFolders(page);
  const nav = page.getByRole("navigation", { name: "Folio" });
  const folder = marker("FOLDER");
  const title = marker("TITLE");
  await nav.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill(folder);
  await page.getByRole("button", { name: "Create folder" }).click();
  await nav.getByRole("link", { name: new RegExp(`^${folder}`) }).hover();
  await nav.getByRole("button", { name: `Folder options for ${folder}` }).click();
  await page.getByRole("menuitem", { name: `New note in folder` }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}/);
  await page.keyboard.type(title);
  await expect(page.getByTestId("sync-status")).toHaveAttribute("data-status", "saved", { timeout: 20_000 });

  // The first lock sets up encryption (two ways to unlock), then asks.
  await nav.getByRole("link", { name: new RegExp(`^${folder}`) }).hover();
  await nav.getByRole("button", { name: `Folder options for ${folder}` }).click();
  await page.getByRole("menuitemcheckbox", { name: "Always fully encrypted" }).click();
  const w = page.getByRole("dialog", { name: "Turn on encryption" });
  await expect(w.getByText("To encrypt this folder, set up encryption first.")).toBeVisible();
  await w.getByRole("button", { name: "Continue" }).click();
  await w.getByRole("button", { name: "Add Recovery key" }).click();
  const groups = (await w.getByRole("list", { name: "Your recovery key" }).getByRole("listitem").allTextContents()).map((t) => t.replace(/^Group \d+: /, "").trim());
  await w.getByLabel("Group 3").fill(groups[2]!);
  await w.getByLabel("Group 7").fill(groups[6]!);
  await w.getByRole("button", { name: "Check and continue" }).click();
  await w.getByRole("button", { name: "Add Encryption passphrase" }).click();
  await w.getByLabel("Passphrase", { exact: true }).fill("lantern orchard velvet compass");
  await w.getByLabel("Type it again").fill("lantern orchard velvet compass");
  await w.getByRole("button", { name: "Save passphrase" }).click();
  await w.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("dialog", { name: `Always fully encrypt ${folder}?` }).getByRole("button", { name: "Encrypt" }).click();
  await expect(nav.getByRole("link", { name: `${folder} Always fully encrypted` })).toBeVisible({ timeout: 60_000 });

  // This device finds it; a browser without the replica (server search only) doesn't.
  await expect((await paletteResults(page, title)).filter({ hasText: title })).toBeVisible({ timeout: 45_000 });
  await page.keyboard.press("Escape");
  const viewer = await browser.newContext({ storageState: { cookies: (await context.storageState()).cookies, origins: [] } });
  const fresh = await viewer.newPage();
  await fresh.goto(`${APP}/documents`);
  const results = await paletteResults(fresh, title);
  await fresh.waitForTimeout(3000);
  await expect(results.filter({ hasText: title })).toHaveCount(0);
  await expect.poll(() => e2eeScan([title, folder]).clean, { timeout: 120_000 }).toBe(true);
  await Promise.all([context.close(), viewer.close()]);
});
