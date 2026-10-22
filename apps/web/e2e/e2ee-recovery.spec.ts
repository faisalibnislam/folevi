import { expect, test } from "@playwright/test";
import { APP, newPerson, signIn } from "./helpers";
import { turnOnEncryption } from "./e2ee-helpers";

// §11.4 e2ee-recovery: the recovery key unlocks with no other device's help, and a browser removed from
// encryption can't unlock any more; a wrong key says so; too many tries give the rate-limit text.

test("the recovery key unlocks a new browser, which then removes the old one from encryption", async ({ browser }) => {
  test.setTimeout(300_000);
  const first = await newPerson(browser, "Recovery Person");
  const { recoveryKey } = await turnOnEncryption(first.page);
  const other = await browser.newContext();
  const page = await signIn(other, first.account);
  await page.goto(`${APP}/documents`);
  const card = page.getByRole("region", { name: "Unlock your encrypted notes" });
  await card.getByRole("button", { name: "Enter recovery key" }).click();
  // The right shape, the wrong check value.
  await card.getByLabel("Recovery key").fill("0000-0000-0000-0000-0000-0000-0000-0000-0000");
  await card.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(card.getByRole("alert")).toBeVisible();
  // Typed in lower case without dashes still reads.
  await card.getByLabel("Recovery key").fill(recoveryKey.replace(/-/g, "").toLowerCase());
  await card.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(page.getByRole("radiogroup", { name: "Your notes are unlocked" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Continue" }).click();
  // Trusting the browser registers it; the app opens once that's done.
  await expect(page.getByRole("navigation", { name: "Folio" })).toBeVisible({ timeout: 30_000 });

  // From here, the first browser can't unlock any more; removing it also signs it out.
  await page.goto(`${APP}/settings/devices`);
  await page.getByRole("button", { name: /^Options for / }).first().click();
  await page.getByRole("menuitem", { name: "Remove from encryption" }).click();
  await page.getByRole("dialog", { name: /^Remove / }).getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText(/can't unlock encrypted notes any more/)).toBeVisible();
  await first.page.reload();
  await expect(first.page).toHaveURL(/\/signin/, { timeout: 30_000 });
  await Promise.all([first.context.close(), other.close()]);
});

test("too many wrong passphrases give the rate-limit text", async ({ browser }) => {
  test.setTimeout(300_000);
  const first = await newPerson(browser, "Rate Person");
  await turnOnEncryption(first.page);
  const other = await browser.newContext();
  const page = await signIn(other, first.account);
  await page.goto(`${APP}/documents`);
  const card = page.getByRole("region", { name: "Unlock your encrypted notes" });
  await card.getByRole("button", { name: "Enter passphrase" }).click();
  for (let i = 0; i < 11; i++) {
    await card.getByLabel("Encryption passphrase").fill(`not the passphrase ${i}`);
    await card.getByRole("button", { name: "Unlock", exact: true }).click();
    await expect(card.getByRole("alert")).toBeVisible();
  }
  await expect(card.getByRole("alert")).toHaveText("Too many tries. Try again in an hour, or use another way to unlock.");
  await Promise.all([first.context.close(), other.close()]);
});
