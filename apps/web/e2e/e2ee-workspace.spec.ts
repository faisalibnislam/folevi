import { expect, test } from "@playwright/test";
import { APP, createWorkspace, newPerson, signIn, switchTo } from "./helpers";
import { addTwoMethods, marker, newNote, turnOnEncryption, unlockWithPassphrase } from "./e2ee-helpers";

// §11.4 e2ee-workspace: an encrypted workspace; a new member waits for the key until an admin's device is
// open, then reads; removing them changes the key, and they can't open the workspace any more.

test("members of an encrypted workspace get the key from an admin's device; removal rotates it", async ({ browser }) => {
  test.setTimeout(480_000);
  const admin = await newPerson(browser, "Admin Person");
  await turnOnEncryption(admin.page);
  await createWorkspace(admin.page, "Cipher Team");
  await turnOnEncryption(admin.page, { workspace: true });
  const title = marker("TITLE");
  await newNote(admin.page, title, "For the team only.");

  const member = await newPerson(browser, "Member Person");
  await admin.page.goto(`${APP}/settings/members`);
  await expect(admin.page.getByText("This workspace is end-to-end encrypted.", { exact: false })).toBeVisible();
  await admin.page.getByPlaceholder("name@example.com").fill(member.email);
  await admin.page.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(admin.page.getByRole("status").filter({ hasText: /Invitation sent/ })).toBeVisible();
  await admin.context.close();

  // The invitation, accepted while no admin device is open: the member has no keys yet, then waits.
  await member.page.goto(`${APP}/documents`);
  await member.page.getByRole("button", { name: /Notifications/ }).click();
  await member.page.getByRole("button", { name: "Accept invitation" }).first().click();
  await switchTo(member.page, "Cipher Team");
  await expect(member.page.getByText("This workspace is end-to-end encrypted. Set up encryption to open it.")).toBeVisible({ timeout: 30_000 });
  await member.page.getByRole("button", { name: "Set up encryption" }).click();
  const w = member.page.getByRole("dialog", { name: "Turn on encryption" });
  await w.getByRole("button", { name: "Continue" }).click();
  await addTwoMethods(member.page, w);
  await w.getByRole("button", { name: "Continue" }).click();
  await expect(member.page.getByText("Waiting for an admin's device to share the key.", { exact: false })).toBeVisible({ timeout: 30_000 });

  // An admin opens Folevi: the key is shared and the member reads the note.
  const back = await browser.newContext();
  const adminPage = await signIn(back, admin.account);
  await adminPage.goto(`${APP}/documents`);
  await unlockWithPassphrase(adminPage);
  await expect(member.page.getByText(title).first()).toBeVisible({ timeout: 60_000 });

  // Removing the member changes the key.
  await adminPage.goto(`${APP}/settings/members`);
  await adminPage.getByRole("button", { name: "Remove" }).last().click();
  await adminPage.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
  await expect(adminPage.getByText(/Changing the workspace key/)).toBeVisible({ timeout: 30_000 });
  await member.page.reload();
  await expect(member.page.getByText(title)).toHaveCount(0, { timeout: 30_000 });
  await Promise.all([back.close(), member.context.close()]);
});
