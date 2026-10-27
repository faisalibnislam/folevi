import { expect, test, type Page } from "@playwright/test";
import { APP, newPerson } from "./helpers";

// The Vault (docs/VAULT_PLAN.md) on the website, end to end on the dev backend (its "vault" flag on): set it up with a
// passcode, save the recovery key, add a login, reveal and copy its password, lock, unlock again, read the log.

const SHOTS = process.env.VAULT_SHOTS;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

test("set up a Personal Vault, add a password, lock and unlock it, and see it all in the log", async ({ browser }) => {
  test.setTimeout(240_000);
  const { page, context } = await newPerson(browser, "Vault Owner");
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP });
  await page.goto(`${APP}/vault`);
  await expect(page.getByRole("heading", { name: "Set up your Vault" })).toBeVisible({ timeout: 30_000 });
  await shot(page, "1-setup");

  await page.getByLabel("Choose a passcode").fill("short");
  await expect(page.getByText("Use at least 8 characters.")).toBeVisible();
  await page.getByLabel("Choose a passcode").fill("a strong vault passcode");
  await page.getByLabel("Type it again").fill("a strong vault passcode");
  await page.getByRole("button", { name: "Set up the Vault" }).click();

  // The recovery key, once: groups 3 and 7 typed back.
  await expect(page.getByRole("heading", { name: "Save your Vault recovery key" })).toBeVisible({ timeout: 60_000 });
  await shot(page, "2-recovery-key");
  const groups = (await page.getByRole("list", { name: "Your recovery key" }).locator("li").allInnerTexts()).map((g) => g.replace(/^Group \d+:\s*/, "").trim());
  await page.getByLabel("Group 3").fill(groups[2]!);
  await page.getByLabel("Group 7").fill(groups[6]!);
  await page.getByRole("button", { name: "Check and continue" }).click();

  // Open: add a login.
  await expect(page.getByRole("tab", { name: "Passwords & Credentials" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add to the Vault" });
  await dialog.getByLabel("Title").fill("Bank");
  await dialog.getByLabel("Username").fill("sam@example.com");
  await dialog.getByLabel("Password", { exact: true }).fill("Correct-Horse-9-Battery");
  await dialog.getByLabel("Website").fill("https://bank.example");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("region", { name: "Bank" })).toBeVisible({ timeout: 30_000 });
  // Hidden until revealed; revealing and copying are logged.
  await expect(page.getByRole("region", { name: "Bank" })).toContainText("••••");
  await page.getByRole("button", { name: "Show Password" }).click();
  await expect(page.getByRole("region", { name: "Bank" })).toContainText("Correct-Horse-9-Battery");
  await page.getByRole("button", { name: "Copy Password" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Correct-Horse-9-Battery");
  await shot(page, "3-password");

  // Lock: nothing of the Vault stays on the page; unlock with the passcode.
  await page.getByRole("button", { name: "Lock", exact: true }).click();
  await expect(page.getByRole("heading", { name: "The Vault is locked" })).toBeVisible();
  await expect(page.getByText("Bank")).toHaveCount(0);
  await page.getByLabel("Passcode").fill("not the passcode");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "That isn't right" })).toBeVisible();
  await page.getByLabel("Passcode").fill("a strong vault passcode");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("button", { name: /^Bank/ })).toBeVisible({ timeout: 60_000 });

  // The log: every step, the failed unlock too, and it verifies.
  await page.getByRole("tab", { name: "Activity" }).click();
  const log = page.getByRole("region", { name: "Activity" });
  for (const line of ["Set up the Vault", "Added an item", "Opened an item", "Revealed a hidden field", "Copied a field", "Locked the Vault", "Unlocked the Vault (failed: wrong passcode)"]) await expect(log).toContainText(line);
  await page.getByRole("button", { name: "Check the log" }).click();
  await expect(log).toContainText("Log verified");
  await shot(page, "4-activity");
  await context.close();
});
