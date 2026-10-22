import { expect, test } from "@playwright/test";
import { APP, newPerson, signIn } from "./helpers";
import { PASSPHRASE, turnOnEncryption, unlockWithPassphrase } from "./e2ee-helpers";

// §11.4 e2ee-unlock: a second browser unlocks with the passphrase and is trusted; a reload unlocks by itself;
// public computer mode forgets the key.

test("unlock in a second browser, trust it, and public computer mode", async ({ browser }) => {
  test.setTimeout(300_000);
  const first = await newPerson(browser, "Unlock Person");
  await turnOnEncryption(first.page);

  const second = await browser.newContext();
  const page = await signIn(second, first.account);
  await page.goto(`${APP}/documents`);
  await unlockWithPassphrase(page, "browser");
  await page.reload();
  await expect(page.getByRole("navigation", { name: "Folio" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Unlock your encrypted notes" })).toHaveCount(0);

  const shared = await browser.newContext();
  const kiosk = await signIn(shared, first.account);
  await kiosk.goto(`${APP}/documents`);
  // The account's database opened on disk when this tab signed in, before the choice: picking "public
  // computer" reloads the tab so it starts again in memory, and that load deletes what was written. It asks
  // to unlock once more; from then on this browser opens as a public computer.
  const card = kiosk.getByRole("region", { name: "Unlock your encrypted notes" });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByRole("button", { name: "Enter passphrase" }).click();
  await card.getByLabel("Encryption passphrase").fill(PASSPHRASE);
  await card.getByRole("button", { name: "Unlock", exact: true }).click();
  await kiosk.getByRole("radiogroup", { name: "Your notes are unlocked" }).getByRole("radio", { name: /^This is a public or shared computer/ }).click();
  await Promise.all([kiosk.waitForEvent("load"), kiosk.getByRole("button", { name: "Continue" }).click()]);
  await unlockWithPassphrase(kiosk, "public");
  // Nothing of the account is on this computer's disk.
  await expect.poll(() => kiosk.evaluate(async () => (await indexedDB.databases()).map((d) => d.name ?? "").filter((n) => n.startsWith("folevi-") && !n.startsWith("folevi-local-")))).toEqual([]);
  await kiosk.reload();
  await expect(kiosk.getByRole("heading", { name: "Unlock your encrypted notes" })).toBeVisible({ timeout: 30_000 });

  await Promise.all([first.context.close(), second.close(), shared.close()]);
});
