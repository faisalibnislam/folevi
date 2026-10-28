import { expect, test, type Browser, type Page } from "@playwright/test";
import { APP, createWorkspace, newPerson, switchTo } from "./helpers";
import { PASSPHRASE, hideDevOverlay, turnOnEncryption } from "./e2ee-helpers";

// The Vault on a browser without the account's encryption keys (components/vault/VaultEncryptionStep.tsx): one card
// with the ways to unlock, unlocked in place, then the trust choice and straight on to the Vault passcode, never
// another page. On the dev backend with a fresh account: encrypting a workspace gives it keys, a recovery key and a
// passphrase (Personal stays Standard, so nothing else asks first); the Personal Vault is set up on that browser.

const PASSCODE = "246813";
const SHOTS = process.env.VAULT_SHOTS;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** A fresh account with keys and a Personal Vault, and a second browser that's signed in but has no keys. */
async function lockedVault(browser: Browser) {
  const { page, context } = await newPerson(browser, "Vault Unlock");
  await hideDevOverlay(context);
  await createWorkspace(page, "Key Team");
  const { recoveryKey } = await turnOnEncryption(page, { workspace: true });
  await switchTo(page, "Personal");
  await page.goto(`${APP}/vault`);
  await expect(page.getByRole("heading", { name: "Set up your Vault" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Choose a passcode").fill(PASSCODE);
  await page.getByLabel("Type it again").fill(PASSCODE);
  await page.getByRole("button", { name: "Set up the Vault" }).click();
  await expect(page.getByRole("heading", { name: "Save your Vault recovery key" })).toBeVisible({ timeout: 60_000 });
  const groups = (await page.getByRole("list", { name: "Your recovery key" }).locator("li").allInnerTexts()).map((g) => g.replace(/^Group \d+:\s*/, "").trim());
  await page.getByRole("button", { name: "I've saved it" }).click();
  await page.getByLabel("Group 3").fill(groups[2]!);
  await page.getByLabel("Group 7").fill(groups[6]!);
  await page.getByRole("button", { name: "Check and continue" }).click();
  await expect(page.getByRole("tab", { name: "Files & Notes" })).toBeVisible({ timeout: 30_000 });

  // Signed in, no keys: the cookies only (the keys live in this browser's IndexedDB).
  const other = await browser.newContext({ storageState: { cookies: (await context.storageState()).cookies, origins: [] } });
  await hideDevOverlay(other);
  const fresh = await other.newPage();
  await fresh.goto(`${APP}/vault`);
  return { context, other, fresh, recoveryKey };
}

/** The one card, its ways to unlock (a passkey on the web), and no second card inside it. */
async function unlockCard(page: Page) {
  const title = page.getByRole("heading", { name: "Unlock the Vault on this browser" });
  await expect(title).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Your Vault is end-to-end encrypted. This browser needs your account's encryption keys once, then your Vault passcode.")).toBeVisible();
  for (const name of ["Approve from another device", "Use a passkey", "Enter passphrase", "Enter recovery key"]) await expect(page.getByRole("button", { name })).toBeVisible();
  await expect(page.getByRole("region", { name: "Unlock your encrypted notes" })).toHaveCount(0);
}

/** After the keys: the trust choice in the same card, then the passcode, then the open Vault. */
async function trustThenPasscode(page: Page) {
  const choice = page.getByRole("radiogroup", { name: "Your notes are unlocked" });
  await expect(choice).toBeVisible({ timeout: 30_000 });
  await shot(page, "unlock-3-trust");
  await choice.getByRole("radio", { name: /^Trust this browser/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "The Vault is locked" })).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/vault/);
  await shot(page, "unlock-4-passcode");
  await page.getByLabel("Passcode").fill(PASSCODE);
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Files & Notes" })).toBeVisible({ timeout: 30_000 });
}

test("the locked Vault unlocks in place with the passphrase", async ({ browser }) => {
  test.setTimeout(600_000);
  const { context, other, fresh } = await lockedVault(browser);
  await unlockCard(fresh);
  await shot(fresh, "unlock-1-card");
  await fresh.getByRole("button", { name: "Enter passphrase" }).click();
  // A wrong one says what to do next, and the card stays.
  await fresh.getByLabel("Encryption passphrase").fill("not the passphrase");
  await fresh.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(fresh.getByRole("alert").filter({ hasText: "That passphrase didn't unlock your notes. Check it and try again." })).toBeVisible({ timeout: 30_000 });
  await shot(fresh, "unlock-2-wrong");
  await fresh.getByLabel("Encryption passphrase").fill(PASSPHRASE);
  await fresh.getByRole("button", { name: "Unlock", exact: true }).click();
  await trustThenPasscode(fresh);
  await Promise.all([context.close(), other.close()]);
});

test("the locked Vault unlocks in place with the recovery key", async ({ browser }) => {
  test.setTimeout(600_000);
  const { context, other, fresh, recoveryKey } = await lockedVault(browser);
  await unlockCard(fresh);
  await fresh.getByRole("button", { name: "Enter recovery key" }).click();
  // Not shaped like a recovery key: what one looks like.
  await fresh.getByLabel("Recovery key").fill("ABCD");
  await fresh.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(fresh.getByRole("alert").filter({ hasText: "A recovery key has 36 letters and numbers in 9 groups of 4. Check it and try again." })).toBeVisible({ timeout: 30_000 });
  // Other ways goes back to the choices, in the same card.
  await fresh.getByRole("button", { name: "Other ways to unlock" }).click();
  await unlockCard(fresh);
  await fresh.getByRole("button", { name: "Enter recovery key" }).click();
  await fresh.getByLabel("Recovery key").fill(recoveryKey);
  await fresh.getByRole("button", { name: "Unlock", exact: true }).click();
  await trustThenPasscode(fresh);
  await Promise.all([context.close(), other.close()]);
});
