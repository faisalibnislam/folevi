import { expect, test } from "@playwright/test";
import { APP, newPerson } from "./helpers";
import { PASSPHRASE, marker, migrationDone, newNote, paletteResults, turnOnEncryption } from "./e2ee-helpers";

// §11.4 e2ee-migration: turn on, edit while the notes are being encrypted, turn off with a recovery check,
// and the notes are searchable on the server again.

test("edit during the migration, then turn encryption off again", async ({ browser }) => {
  test.setTimeout(480_000);
  const { page, context } = await newPerson(browser, "Migration Person");
  const title = marker("TITLE");
  const url = await newNote(page, title, "Written before encryption.");
  await turnOnEncryption(page);
  // While it runs: an edit to the note goes in (the device seals it first).
  await page.goto(url);
  await page.getByRole("textbox", { name: "Document body" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" And one line during the migration.");
  await expect(page.getByTestId("sync-status")).toHaveAttribute("data-status", "saved", { timeout: 60_000 });
  await migrationDone(page);
  await page.goto(url);
  await expect(page.getByText("And one line during the migration.")).toBeVisible({ timeout: 30_000 });

  // Turning off needs a recovery method again.
  await page.goto(`${APP}/settings/privacy`);
  await page.getByRole("radio", { name: /^Standard/ }).click();
  await page.getByRole("button", { name: "Change to Standard" }).click();
  const dialog = page.getByRole("dialog", { name: "Turn off encryption?" });
  await expect(dialog.getByRole("button", { name: "Turn off encryption" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Enter passphrase" }).click();
  await dialog.getByLabel("Encryption passphrase").fill(PASSPHRASE);
  await dialog.getByRole("button", { name: "Unlock", exact: true }).click();
  await dialog.getByRole("button", { name: "Turn off encryption" }).click();
  await migrationDone(page, 300_000);

  // Server search (a fresh browser holds no replica) finds it again.
  const viewer = await browser.newContext({ storageState: { cookies: (await context.storageState()).cookies, origins: [] } });
  const fresh = await viewer.newPage();
  await fresh.goto(`${APP}/documents`);
  await expect((await paletteResults(fresh, title)).filter({ hasText: title })).toBeVisible({ timeout: 45_000 });
  await Promise.all([context.close(), viewer.close()]);
});
