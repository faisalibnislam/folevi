import { expect, test, type Page } from "@playwright/test";
import { completeOnboarding, createAccount, newPerson, pick, showFolders, uniqueEmail, waitForSaved, openShare } from "./helpers";
import { folderLink, nav, newFolder } from "./folderDragHelpers";

// Folder sharing (docs/SHARING.md): a folder shared with someone reaches every note in it, notes added later
// too; their own Share dialog shows the access as coming from the folder; moving a note out warns first and
// ends it; removing them ends the folder for them. An address with no account gets an invitation by email.

/** A new note in `folder` from the folder's "…" menu, titled and saved; returns its URL. */
async function noteInFolder(page: Page, folder: string, title: string): Promise<string> {
  const before = page.url();
  await nav(page).getByRole("button", { name: `Folder options for ${folder}` }).click();
  await page.getByRole("menuitem", { name: "New note in folder" }).click();
  await page.waitForURL((url) => url.href !== before && /^\/d\/[0-9A-Z]{26}$/.test(url.pathname));
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("");
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.keyboard.press("Enter");
  await page.keyboard.type(`${title} body`);
  await waitForSaved(page);
  await showFolders(page);
  return page.url().replace(/\?.*$/, "");
}

/** The folder's Share dialog, from its "…" menu in the sidebar, or from the Share button on the folder's page. */
async function openFolderShare(page: Page, folder: string, from: "menu" | "page" = "menu") {
  await showFolders(page);
  if (from === "page") {
    await folderLink(page, folder).click();
    await page.waitForURL(/\/folders\/[0-9A-Z]{26}$/);
    await page.getByRole("button", { name: "Share", exact: true }).click();
  } else {
    await nav(page).getByRole("button", { name: `Folder options for ${folder}` }).click();
    await page.getByRole("menuitem", { name: "Share…" }).click();
  }
  const dialog = page.getByRole("dialog", { name: `Share “${folder}”` });
  await expect(dialog.getByTestId("folder-share-dialog")).toBeVisible({ timeout: 20_000 });
  return dialog;
}

async function shareFolder(page: Page, folder: string, email: string, role: "Can view" | "Can comment" | "Can edit", from: "menu" | "page" = "menu") {
  const dialog = await openFolderShare(page, folder, from);
  await dialog.getByLabel("Email address").fill(email);
  await pick(dialog.getByLabel("Role"), role);
  await dialog.getByRole("button", { name: "Share", exact: true }).click();
  return dialog;
}

test("share a folder: later notes follow, the note says where access comes from, moving out warns, removing ends it", async ({ browser }) => {
  test.setTimeout(300_000);
  const owner = await newPerson(browser, "Folder Owner");
  const friend = await newPerson(browser, "Folder Friend");
  await showFolders(owner.page);
  await newFolder(owner.page, "Garden club");
  await noteInFolder(owner.page, "Garden club", "Seed list");

  // Share it with an existing account: access right away, and they're told.
  const dialog = await shareFolder(owner.page, "Garden club", friend.email, "Can edit");
  await expect(owner.page.getByRole("status").filter({ hasText: "Shared" }).first()).toBeVisible();
  const people = dialog.getByRole("list", { name: "People with access" });
  await expect(people.getByRole("listitem").filter({ hasText: "Folder Friend" })).toBeVisible();
  await expect(dialog.getByTestId("folder-share-summary")).toContainText("shared with 1 person");
  await dialog.getByRole("button", { name: "Close" }).click();

  // The friend's bell leads to the folder; Shared with Me lists it.
  await friend.page.getByRole("button", { name: /Notifications/ }).click();
  await friend.page.getByRole("button", { name: /shared the folder .?Garden club.? with you/ }).click();
  await friend.page.waitForURL(/\/shared\/[0-9A-Z]{26}$/);
  const sharedUrl = friend.page.url();
  const folderPage = friend.page.getByTestId("shared-folder");
  await expect(folderPage.getByRole("link", { name: /Seed list/ })).toBeVisible({ timeout: 20_000 });
  await friend.page.goto(sharedUrl.replace(/\/shared\/.*$/, "/shared"));
  await expect(friend.page.getByTestId("shared-folders").getByRole("listitem").filter({ hasText: "Garden club" })).toContainText("Can edit");

  // A note added later shows up for them too.
  const laterUrl = await noteInFolder(owner.page, "Garden club", "Later note");
  await friend.page.goto(sharedUrl);
  await expect(folderPage.getByRole("link", { name: /Later note/ })).toBeVisible({ timeout: 20_000 });

  // They can edit a note in it, and its Share dialog says the access comes from the folder.
  await folderPage.getByRole("link", { name: /Seed list/ }).click();
  await expect(friend.page.getByRole("textbox", { name: "Title" })).toHaveValue("Seed list", { timeout: 20_000 });
  await expect(friend.page.getByRole("textbox", { name: "Document body" })).toHaveAttribute("contenteditable", "true");
  await openShare(friend.page);
  const noteShare = friend.page.getByRole("dialog", { name: /Share/ });
  await expect(noteShare.getByTestId("share-from-folders")).toContainText("Through the folder Garden club");
  await noteShare.getByRole("button", { name: "Close" }).click();

  // Moving a note out of the folder warns who loses it; Cancel keeps it, Move ends it for them.
  await owner.page.goto(laterUrl);
  const moveOut = async () => {
    await owner.page.getByRole("button", { name: "Document actions" }).click();
    await owner.page.getByRole("menuitem", { name: "Move…" }).click();
    await owner.page.getByRole("dialog", { name: /^Move “/ }).getByRole("option", { name: /No folder \(Drafts\)/ }).click();
    const warning = owner.page.getByRole("dialog", { name: "Move and stop sharing?" });
    await expect(warning).toContainText("Folder Friend will no longer see this note");
    return warning;
  };
  await (await moveOut()).getByRole("button", { name: "Cancel" }).click();
  await expect(owner.page.getByRole("status").filter({ hasText: "Moved to Drafts" })).toHaveCount(0);
  await (await moveOut()).getByTestId("move-warning-confirm").click();
  await expect(owner.page.getByRole("status").filter({ hasText: "Moved to Drafts" })).toBeVisible();
  await friend.page.goto(sharedUrl);
  await expect(folderPage.getByRole("link", { name: /Seed list/ })).toBeVisible({ timeout: 20_000 });
  await expect(folderPage.getByRole("link", { name: /Later note/ })).toHaveCount(0);

  // Removing them ends the folder for them.
  const again = await openFolderShare(owner.page, "Garden club");
  await again.getByRole("button", { name: "Remove Folder Friend" }).click();
  await expect(again.getByRole("list", { name: "People with access" })).toContainText("No one has been added to this folder yet.");
  await again.getByRole("button", { name: "Close" }).click();
  await friend.page.goto(sharedUrl);
  await expect(friend.page.getByRole("heading", { name: "You can’t open this folder" })).toBeVisible({ timeout: 20_000 });

  await owner.context.close();
  await friend.context.close();
});

test("share a folder with a new address: they sign up, accept from the bell, and see its notes", async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = await newPerson(browser, "Folder Inviter");
  await showFolders(owner.page);
  await newFolder(owner.page, "Recipes");
  await noteInFolder(owner.page, "Recipes", "Bread");

  const email = uniqueEmail("folder-guest");
  // This time from the Share button on the folder's own page.
  const dialog = await shareFolder(owner.page, "Recipes", email, "Can view", "page");
  await expect(owner.page.getByRole("status").filter({ hasText: `Invitation sent to ${email}` })).toBeVisible();
  await expect(dialog.getByRole("list", { name: "Invited by email" }).getByRole("listitem").filter({ hasText: email })).toContainText("waiting to accept");
  await dialog.getByRole("button", { name: "Close" }).click();

  const context = await browser.newContext();
  const { page } = await createAccount(context, { email, name: "Recipe Guest" });
  await completeOnboarding(page);
  await page.getByRole("button", { name: /Notifications/ }).click();
  await page.getByRole("button", { name: "Accept and open" }).first().click();
  await page.waitForURL(/\/shared\/[0-9A-Z]{26}$/, { timeout: 20_000 });
  await expect(page.getByTestId("shared-folder").getByRole("link", { name: /Bread/ })).toContainText("Can view", { timeout: 20_000 });

  // The owner sees them as a guest now, and the invitation is used up.
  const after = await openFolderShare(owner.page, "Recipes");
  await expect(after.getByRole("list", { name: "People with access" }).getByRole("listitem").filter({ hasText: "Recipe Guest" })).toContainText("Guest");
  await expect(after.getByRole("list", { name: "Invited by email" })).toHaveCount(0);
  await expect(folderLink(owner.page, "Recipes")).toBeVisible();

  await owner.context.close();
  await context.close();
});
