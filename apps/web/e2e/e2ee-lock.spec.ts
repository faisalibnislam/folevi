import { expect, test } from "@playwright/test";
import { APP, createWorkspace, newPerson, showFolders, switchTo } from "./helpers";
import { e2eeScan, hideDevOverlay, marker, migrationDone, paletteResults, turnOnEncryption } from "./e2ee-helpers";

// §11.4 e2ee-lock: in a Standard space, lock a folder; its notes are sealed, server search can't find them,
// search on the device can. Until launch the folder menu offers "Always fully encrypted" only to accounts
// that have keys (LOCK_MENU_FOR_EVERYONE in components/e2ee/LockDialog.tsx), so the account gets its keys by
// encrypting a workspace first; Personal stays Standard. Once the flag is on, the first lock opens the wizard.

test("a locked folder in a Standard space", async ({ browser }) => {
  test.setTimeout(1_200_000);
  const { page, context, email } = await newPerson(browser, "Lock Person");
  await hideDevOverlay(context);
  const since = Date.now();
  await createWorkspace(page, "Key Team");
  await turnOnEncryption(page, { workspace: true });
  await switchTo(page, "Personal");
  await page.goto(`${APP}/documents`);
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
  await showFolders(page);

  await nav.getByRole("link", { name: new RegExp(`^${folder}`) }).hover();
  await nav.getByRole("button", { name: `Folder options for ${folder}` }).click();
  await page.getByRole("menuitemcheckbox", { name: "Always fully encrypted" }).click();
  await page.getByRole("dialog", { name: `Always fully encrypt ${folder}?` }).getByRole("button", { name: "Encrypt" }).click();
  await expect(nav.getByRole("link", { name: `${folder} Always fully encrypted` })).toBeVisible({ timeout: 60_000 });
  await migrationDone(page);

  // This device finds it; a browser without the replica (locked: server search only) doesn't, and opens.
  await page.goto(`${APP}/documents`);
  await expect.poll(async () => {
    const n = await (await paletteResults(page, title)).filter({ hasText: title }).filter({ hasNotText: "Ask Foli AI" }).count();
    await page.keyboard.press("Escape");
    return n;
  }, { timeout: 120_000, intervals: [5_000] }).toBeGreaterThan(0);
  const viewer = await browser.newContext({ storageState: { cookies: (await context.storageState()).cookies, origins: [] } });
  await hideDevOverlay(viewer);
  const fresh = await viewer.newPage();
  // The folder's notes are sealed in the background (a lock job): once done, server search has nothing.
  await expect.poll(async () => {
    await fresh.goto(`${APP}/documents`);
    const results = await paletteResults(fresh, title);
    await fresh.waitForTimeout(3000);
    // The palette always offers "Ask Foli AI: <what you typed>": only documents count.
    return await results.filter({ hasText: title }).filter({ hasNotText: "Ask Foli AI" }).count();
  }, { timeout: 240_000, intervals: [10_000] }).toBe(0);
  await expect.poll(() => e2eeScan([title, folder], { since, email }).clean, { timeout: 600_000, intervals: [30_000] }).toBe(true);
  await Promise.all([context.close(), viewer.close()]);
});
