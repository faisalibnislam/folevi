import { expect, test } from "@playwright/test";
import { APP, newPerson } from "./helpers";
import { e2eeScan, marker, migrationDone, newNote, turnOnEncryption } from "./e2ee-helpers";

// §11.4 e2ee-setup: sign up, Settings > Privacy, the wizard with a recovery key and a passphrase, the seeded
// notes encrypted in the background, titles still showing, and nothing readable left on the server.

test("turning on encryption seals what's there; the server keeps no marker", async ({ browser }) => {
  test.setTimeout(1_200_000);
  const { page, context } = await newPerson(browser, "Setup Person");
  const title = marker("TITLE");
  const body = marker("BODY");
  await newNote(page, title, body);
  await turnOnEncryption(page);
  await migrationDone(page);
  await page.goto(`${APP}/notes`);
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 30_000 });
  const scan = e2eeScan([title, body]);
  expect(scan.hits).toEqual([]);
  expect(scan.clean).toBe(true);
  await context.close();
});
