import { expect, test, type Page } from "@playwright/test";
import { APP, createWorkspace, newPerson, pick, showFolders, switcher, waitForSaved } from "./helpers";

// A team's Vault (docs/VAULT_PLAN.md) with three accounts on the dev backend (its "vault" flag on): the owner sets it
// up and adds a member, the owner's device shares the Vault's key with them, the member chooses a passcode and opens
// it; an item is shared with someone outside the workspace, who opens it from Shared with Me; a regular note moves
// into the Vault and out again.

const SHOTS = process.env.VAULT_SHOTS;
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** Sets a Vault up with a passcode and saves its recovery key (checks groups 3 and 7). */
async function setUpVault(page: Page, heading: string, passcode: string) {
  await page.goto(`${APP}/vault`);
  await expect(page.getByRole("heading", { name: heading })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Choose a passcode").fill(passcode);
  await page.getByLabel("Type it again").fill(passcode);
  await page.getByRole("button", { name: "Set up the Vault" }).click();
  await expect(page.getByRole("heading", { name: "Save your Vault recovery key" })).toBeVisible({ timeout: 60_000 });
  const groups = (await page.getByRole("list", { name: "Your recovery key" }).locator("li").allInnerTexts()).map((g) => g.replace(/^Group \d+:\s*/, "").trim());
  await page.getByLabel("Group 3").fill(groups[2]!);
  await page.getByLabel("Group 7").fill(groups[6]!);
  await page.getByRole("button", { name: "Check and continue" }).click();
  await expect(page.getByRole("tab", { name: "Passwords & Credentials" })).toBeVisible({ timeout: 30_000 });
}

async function unlock(page: Page, passcode: string) {
  await page.goto(`${APP}/vault`);
  await expect(page.getByRole("heading", { name: "The Vault is locked" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Passcode").fill(passcode);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("tab", { name: "Passwords & Credentials" })).toBeVisible({ timeout: 60_000 });
}

test("a team Vault: a member gets the key from the owner's device; an outsider opens a shared item; a note moves in and out", async ({ browser }) => {
  test.setTimeout(420_000);
  const owner = await newPerson(browser, "Vault Team Owner");
  await createWorkspace(owner.page, "Vault Studio");
  const member = await newPerson(browser, "Vault Team Member");
  await owner.page.goto(`${APP}/settings/members`);
  await owner.page.getByPlaceholder("name@example.com").fill(member.email);
  await pick(owner.page.getByLabel("Role", { exact: true }), "Member · view only");
  await owner.page.getByRole("button", { name: "Invite" }).click();
  await expect(owner.page.getByRole("status").filter({ hasText: /Invitation sent/ })).toBeVisible();
  await member.page.goto(`${APP}/documents`);
  await member.page.getByRole("button", { name: /Notifications/ }).click();
  await member.page.getByRole("button", { name: "Accept invitation" }).first().click();
  await showFolders(member.page);
  await switcher(member.page).click();
  await member.page.getByRole("menuitemradio", { name: "Vault Studio" }).click();

  // The owner sets up the team's Vault, adds a login and adds the member.
  await setUpVault(owner.page, "Set up your team's Vault", "team vault passcode");
  await owner.page.getByRole("button", { name: "Add", exact: true }).click();
  const add = owner.page.getByRole("dialog", { name: "Add to the Vault" });
  await add.getByLabel("Title").fill("Deploy key");
  await add.getByLabel("Username").fill("deploy");
  await add.getByLabel("Password", { exact: true }).fill("Staging-Deploy-7-Lantern");
  await add.getByRole("button", { name: "Save" }).click();
  await expect(owner.page.getByRole("region", { name: "Deploy key" })).toBeVisible({ timeout: 30_000 });
  await owner.page.getByRole("tab", { name: "People" }).click();
  await pick(owner.page.getByLabel("Workspace member"), "Vault Team Member");
  await owner.page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(owner.page.getByRole("region", { name: "People" })).toContainText("Vault Team Member", { timeout: 30_000 });
  await shot(owner.page, "team-1-people");

  // The member waits (their account's keys are made meanwhile); the owner's next open shares the key.
  await member.page.goto(`${APP}/vault`);
  await expect(member.page.getByRole("heading", { name: "Waiting for the Vault's key" })).toBeVisible({ timeout: 30_000 });
  await member.page.waitForTimeout(5_000);
  await unlock(owner.page, "team vault passcode");
  await expect(owner.page.getByText("Shared the Vault's key with someone who was waiting.")).toBeVisible({ timeout: 60_000 });
  await member.page.reload();
  await expect(member.page.getByRole("heading", { name: "Choose your Vault passcode" })).toBeVisible({ timeout: 60_000 });
  await member.page.getByLabel("Choose a passcode").fill("member vault passcode");
  await member.page.getByLabel("Type it again").fill("member vault passcode");
  await member.page.getByRole("button", { name: "Set passcode and open" }).click();
  await expect(member.page.getByRole("button", { name: /^Deploy key/ })).toBeVisible({ timeout: 60_000 });
  await member.page.getByRole("button", { name: /^Deploy key/ }).click();
  await member.page.getByRole("button", { name: "Show Password" }).click();
  await expect(member.page.getByRole("region", { name: "Deploy key" })).toContainText("Staging-Deploy-7-Lantern", { timeout: 30_000 });
  // A member changes only what they added: no Edit here, and People shows them as a member.
  await expect(member.page.getByRole("region", { name: "Deploy key" }).getByRole("button", { name: "Edit" })).toHaveCount(0);
  await shot(member.page, "team-2-member-open");

  // Someone outside the workspace (with their own Vault, so their account has keys) gets the item shared.
  const outsider = await newPerson(browser, "Vault Outsider");
  await setUpVault(outsider.page, "Set up your Vault", "outsider passcode");
  await owner.page.getByRole("tab", { name: "Passwords & Credentials" }).click();
  await owner.page.getByRole("button", { name: /^Deploy key/ }).click();
  await owner.page.getByRole("region", { name: "Deploy key" }).getByRole("button", { name: "Share" }).click();
  const share = owner.page.getByRole("dialog", { name: "Share Deploy key" });
  await share.getByLabel("Email").fill(outsider.email);
  await share.getByRole("button", { name: "Share", exact: true }).click();
  await expect(share).toContainText("Vault Outsider", { timeout: 30_000 });
  await expect(share).toContainText("until");
  await shot(owner.page, "team-3-shared");
  await share.getByRole("button", { name: "Done" }).click();
  await outsider.page.goto(`${APP}/shared`);
  const fromVaults = outsider.page.getByRole("region", { name: "From Vaults" });
  await expect(fromVaults).toContainText("Deploy key", { timeout: 60_000 });
  await fromVaults.getByRole("button", { name: /Deploy key/ }).click();
  const opened = outsider.page.getByRole("dialog", { name: "Deploy key" });
  await opened.getByRole("button", { name: "Show" }).click();
  await expect(opened).toContainText("Staging-Deploy-7-Lantern", { timeout: 30_000 });
  await shot(outsider.page, "team-4-outsider-open");
  await opened.getByRole("button", { name: "Close" }).first().click();

  // Edits keep the item's key: after the owner changes it, the outsider still opens it.
  await owner.page.getByRole("region", { name: "Deploy key" }).getByRole("button", { name: "Edit" }).click();
  const edit = owner.page.getByRole("dialog", { name: "Edit Deploy key" });
  await edit.getByLabel("Username").fill("deploy-bot");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(owner.page.getByRole("region", { name: "Deploy key" })).toContainText("deploy-bot", { timeout: 30_000 });
  await outsider.page.reload();
  await outsider.page.getByRole("region", { name: "From Vaults" }).getByRole("button", { name: /Deploy key/ }).click();
  await expect(outsider.page.getByRole("dialog", { name: "Deploy key" })).toContainText("deploy-bot", { timeout: 30_000 });
  await outsider.page.getByRole("dialog", { name: "Deploy key" }).getByRole("button", { name: "Close" }).first().click();

  // History: the version before the edit.
  await owner.page.getByRole("button", { name: "Earlier versions" }).click();
  const history = owner.page.getByRole("dialog", { name: "Earlier versions" });
  await expect(history).toContainText("Version 1", { timeout: 30_000 });
  await history.getByRole("button", { name: "Show" }).first().click();
  await expect(history).toContainText("deploy");
  await history.getByRole("button", { name: "Close" }).first().click();

  // A regular note moves into the Vault (the original is deleted for good) and back out again.
  await owner.page.goto(`${APP}/documents`);
  await owner.page.getByRole("button", { name: "New note", exact: true }).click();
  await owner.page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await owner.page.getByRole("textbox", { name: "Title" }).fill("Root passwords");
  await owner.page.keyboard.press("Enter");
  await owner.page.keyboard.type("The router admin is on the back.");
  await waitForSaved(owner.page);
  // Unlocked in the same page (a reload locks the Vault), then back to the note.
  await owner.page.getByRole("navigation", { name: "Folio" }).getByRole("link", { name: "Vault" }).click();
  await owner.page.getByLabel("Passcode").fill("team vault passcode");
  await owner.page.getByRole("button", { name: "Unlock" }).click();
  await expect(owner.page.getByRole("tab", { name: "Passwords & Credentials" })).toBeVisible({ timeout: 60_000 });
  await owner.page.goBack();
  await expect(owner.page.getByRole("heading", { name: "Root passwords" })).toBeVisible({ timeout: 30_000 });
  await owner.page.getByRole("button", { name: "Document actions" }).click();
  await owner.page.getByRole("menuitem", { name: "Move to the Vault…" }).click();
  const moveIn = owner.page.getByRole("dialog", { name: "Move to the Vault?" });
  await shot(owner.page, "team-5-move-in");
  await moveIn.getByRole("button", { name: "Move to the Vault" }).click();
  await expect(owner.page.getByText("Moved to the Vault. The original is deleted for good.")).toBeVisible({ timeout: 60_000 });
  await owner.page.getByRole("tab", { name: "Files & Notes" }).click();
  await owner.page.getByRole("button", { name: /^Root passwords/ }).click();
  const vaultNote = owner.page.getByRole("dialog", { name: "Root passwords" });
  await expect(vaultNote.getByRole("textbox", { name: "Note" })).toContainText("The router admin is on the back.", { timeout: 30_000 });
  await vaultNote.getByRole("button", { name: "Move out of the Vault…" }).click();
  await owner.page.getByRole("dialog", { name: "Move out of the Vault?" }).getByRole("button", { name: "Move out" }).click();
  await owner.page.waitForURL(/\/d\/[0-9A-Z]{26}/, { timeout: 60_000 });
  await expect(owner.page.getByRole("main")).toContainText("The router admin is on the back.", { timeout: 30_000 });

  // The log has all of it.
  await unlock(owner.page, "team vault passcode");
  await owner.page.getByRole("tab", { name: "Activity" }).click();
  const log = owner.page.getByRole("region", { name: "Activity" });
  for (const line of ["Shared an item", "Opened a shared item", "Moved a note into the Vault", "Moved a note out of the Vault"]) await expect(log).toContainText(line, { timeout: 30_000 });
  await expect(log).toContainText("Vault Outsider");
  await shot(owner.page, "team-6-activity");
  for (const p of [owner, member, outsider]) await p.context.close();
});
