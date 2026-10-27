import { expect, test, type Page } from "@playwright/test";
import { APP, newPerson } from "./helpers";

// The Vault (docs/VAULT_PLAN.md) on the website, end to end on the dev backend (its "vault" flag on): set it up with a
// passcode, save the recovery key, add a login, reveal and copy its password, lock, unlock again, read the log.

const SHOTS = process.env.VAULT_SHOTS;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

test("set up a Personal Vault, add a password, lock and unlock it, and see it all in the log", async ({ browser }) => {
  test.setTimeout(360_000);
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
  await page.getByRole("button", { name: "I've saved it" }).click();
  await page.getByLabel("Group 3").fill(groups[2]!);
  await shot(page, "2b-recovery-check");
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

  // Health: a weak password and a reused one show up without opening anything.
  await page.getByRole("tab", { name: "Passwords & Credentials" }).click();
  for (const [title, password] of [["Old forum", "letmein1"], ["Bank copy", "Correct-Horse-9-Battery"]] as const) {
    await page.getByRole("button", { name: "Add", exact: true }).click();
    const d = page.getByRole("dialog", { name: "Add to the Vault" });
    await d.getByLabel("Title").fill(title);
    await d.getByLabel("Password", { exact: true }).fill(password);
    await d.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("region", { name: title })).toBeVisible({ timeout: 30_000 });
  }
  await page.getByRole("tab", { name: "Health" }).click();
  const health = page.getByRole("region", { name: "Health" });
  await expect(health.getByRole("heading", { name: /Weak/ })).toBeVisible({ timeout: 30_000 });
  await expect(health.getByRole("heading", { name: /Used more than once \(2\)/ })).toBeVisible();
  await expect(health).toContainText("Old forum");
  await shot(page, "5-health");

  // Trash: delete one, restore it, delete it again and empty the Trash.
  await expect(health.getByRole("heading", { name: /Found in a data breach/ })).toBeVisible();
  await health.getByRole("button", { name: /^Old forum/ }).first().click();
  await page.getByRole("button", { name: "Move to the Vault's Trash" }).click();
  await page.getByRole("tab", { name: "Trash" }).click();
  const trash = page.getByRole("region", { name: "Trash" });
  await expect(trash).toContainText("Old forum", { timeout: 30_000 });
  await expect(trash).toContainText("30 days left");
  await shot(page, "6-trash");
  await trash.getByRole("button", { name: "Restore" }).click();
  await expect(trash.getByText("The Trash is empty")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("tab", { name: "Passwords & Credentials" }).click();
  await page.getByRole("button", { name: /^Old forum/ }).click();
  await page.getByRole("button", { name: "Move to the Vault's Trash" }).click();
  await page.getByRole("tab", { name: "Trash" }).click();
  await trash.getByRole("button", { name: "Empty Trash" }).click();
  await page.getByRole("dialog", { name: "Empty the Trash?" }).getByRole("button", { name: "Delete for good" }).click();
  await expect(trash.getByText("The Trash is empty")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("tab", { name: "Activity" }).click();
  for (const line of ["Moved an item to the Trash", "Restored an item", "Emptied the Vault's Trash"]) await expect(log).toContainText(line);

  // A one-time link: made in the Share dialog, opened by someone without Folevi, then it's ended.
  await page.getByRole("tab", { name: "Passwords & Credentials" }).click();
  await page.getByRole("button", { name: /^Bank Login/ }).click();
  await page.getByRole("region", { name: "Bank" }).getByRole("button", { name: "Share" }).click();
  const share = page.getByRole("dialog", { name: "Share Bank" });
  await share.getByRole("button", { name: "Make link" }).click();
  const linkBox = share.getByLabel("Link to send");
  await expect(linkBox).toHaveValue(/\/vault-link\/[A-Za-z0-9_-]+#k=/, { timeout: 30_000 });
  const url = await linkBox.inputValue();
  await shot(page, "7-share");
  const stranger = await browser.newContext();
  const visitor = await stranger.newPage();
  await visitor.goto(url);
  await expect(visitor.getByRole("heading", { name: "Someone shared something with you" })).toBeVisible({ timeout: 30_000 });
  expect(visitor.url()).not.toContain("#k=");
  await visitor.getByRole("button", { name: "Reveal" }).click();
  await expect(visitor.getByRole("region", { name: "Bank" })).toContainText("Correct-Horse-9-Battery", { timeout: 30_000 });
  await expect(visitor.getByRole("region", { name: "Bank" })).toContainText("the link has now ended");
  await visitor.screenshot(SHOTS ? { path: `${SHOTS}/8-link-opened.png` } : {});
  const again = await stranger.newPage();
  await again.goto(url);
  await again.getByRole("button", { name: "Reveal" }).click();
  await expect(again.getByRole("heading", { name: "This link has ended" })).toBeVisible({ timeout: 30_000 });
  await stranger.close();
  await share.getByRole("button", { name: "Done" }).click();
  await page.getByRole("tab", { name: "Activity" }).click();
  for (const line of ["Made a one-time link", "Someone opened a one-time link", "A one-time link was used up"]) await expect(log).toContainText(line);

  // A note: written with the editor's blocks, saved sealed, and the same when opened again.
  await page.getByRole("tab", { name: "Files & Notes" }).click();
  await page.getByRole("button", { name: "Note", exact: true }).click();
  await page.getByRole("dialog", { name: "New note" }).getByLabel("Title").fill("Server notes");
  await page.getByRole("dialog", { name: "New note" }).getByRole("button", { name: "Create" }).click();
  await page.getByRole("button", { name: /^Server notes/ }).click();
  const noteDialog = page.getByRole("dialog", { name: "Server notes" });
  const body = noteDialog.getByRole("textbox", { name: "Note" });
  await body.click();
  await page.keyboard.type("## Root access");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- [ ] rotate the keys");
  await noteDialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await shot(page, "9-note");
  await noteDialog.getByRole("button", { name: "Close" }).first().click();
  await page.getByRole("button", { name: /^Server notes/ }).click();
  await expect(noteDialog.locator("h3, h2, h4").filter({ hasText: "Root access" })).toBeVisible({ timeout: 30_000 });
  await expect(noteDialog.getByRole("checkbox")).toHaveCount(1);
  await noteDialog.getByRole("button", { name: "Close" }).first().click();

  // Settings > Notifications has the Vault's switch.
  await page.goto(`${APP}/settings/notifications`);
  await expect(page.getByRole("switch", { name: "Vault in the app" })).toBeVisible({ timeout: 30_000 });
  await shot(page, "10-notifications");
  await context.close();
});
