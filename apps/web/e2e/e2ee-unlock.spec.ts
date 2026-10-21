import { expect, test } from "@playwright/test";
import { APP, newPerson, signIn } from "./helpers";
import { HAS_BACKEND, NEEDS_BACKEND, turnOnEncryption, unlockWithPassphrase } from "./e2ee-stub";

// §11.4 e2ee-unlock: a second browser unlocks with the passphrase and is trusted; a reload unlocks by itself;
// public computer mode forgets the key.
test.skip(!HAS_BACKEND, NEEDS_BACKEND);

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
  await unlockWithPassphrase(kiosk, "public");
  await kiosk.reload();
  await expect(kiosk.getByRole("heading", { name: "Unlock your encrypted notes" })).toBeVisible({ timeout: 30_000 });

  await Promise.all([first.context.close(), second.close(), shared.close()]);
});
