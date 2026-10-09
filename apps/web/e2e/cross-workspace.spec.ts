import { expect, test, type Page } from "@playwright/test";
import { createWorkspace, newPerson, waitForSaved, showFolders, pick, openShare } from "./helpers";

// docs/SYNC_PROTOCOL.md §Routing: a page from someone's Personal or from a workspace you're not in is
// edited through your own (account-wide) queue, whatever context you have open.

async function shareWith(page: Page, email: string, name: string) {
  await openShare(page);
  const share = page.getByRole("dialog", { name: /Share/ });
  await share.getByLabel("Email address").fill(email);
  await pick(share.getByLabel("Role"), "Can edit");
  await share.getByRole("button", { name: "Share", exact: true }).click();
  await expect(share.getByText(name)).toBeVisible();
  return share;
}

async function editShared(guest: Page, title: RegExp, where: string, line: string) {
  await guest.getByRole("link", { name: "Shared with Me" }).click();
  const row = guest.getByRole("listitem").filter({ hasText: title });
  await expect(row).toContainText(where);
  await row.getByRole("link").click();
  const body = guest.getByRole("textbox", { name: "Document body" });
  await expect(body).toHaveAttribute("contenteditable", "true");
  // Click into the first paragraph: the middle of a long page can be a table, whose cells are fields of
  // their own (Ctrl/⌘+End there only reaches the end of the cell).
  await body.locator("p").first().click();
  await guest.keyboard.press("ControlOrMeta+End");
  await guest.keyboard.press("Enter");
  await guest.keyboard.type(line);
  await waitForSaved(guest);
  await expect(guest.getByText("Not saved")).toHaveCount(0);
}

test("an outsider with “Can edit” edits a page shared from someone's Personal; the owner sees it live", async ({ browser }) => {
  const owner = await newPerson(browser, "Owner Person");
  await showFolders(owner.page);
  const guest = await newPerson(browser, "Outside Editor");
  await showFolders(guest.page);

  await owner.page.getByRole("navigation", { name: "Folio" }).getByRole("link", { name: "Home" }).click();
  await owner.page.getByRole("link", { name: /Project Atlas Brief/ }).first().click();
  const docUrl = owner.page.url();
  const share = await shareWith(owner.page, guest.email, "Outside Editor");
  // Personal has no members: only the owner and the people added can open it.
  await expect(share.getByText(/This page is in a Personal space/)).toBeVisible();
  await expect(share.getByRole("radiogroup", { name: "Access" })).toHaveCount(0);
  await share.getByRole("button", { name: "Close" }).click();

  // The guest opens it from Shared with Me while their own Personal stays open; it says whose Personal it's from.
  await editShared(guest.page, /Project Atlas Brief/, "Personal · Owner Person", "Edited by a guest");
  // It isn’t in the guest’s own Personal.
  await showFolders(guest.page);
  await guest.page.getByRole("navigation", { name: "Folio" }).getByRole("link", { name: "Home" }).click();
  await expect(guest.page.getByRole("list", { name: "Recent notes" }).getByRole("link", { name: /Welcome to Folevi/ })).toBeVisible();

  // The owner sees it without reloading, and it survives a reload.
  await expect(owner.page.getByRole("textbox", { name: "Document body" })).toContainText("Edited by a guest", { timeout: 20_000 });
  await owner.page.goto(docUrl);
  await expect(owner.page.getByRole("textbox", { name: "Document body" })).toContainText("Edited by a guest");
});

test("an outsider with “Can edit” edits a page shared from a workspace they're not in", async ({ browser }) => {
  const owner = await newPerson(browser, "Studio Owner");
  await showFolders(owner.page);
  const guest = await newPerson(browser, "Studio Guest");
  await showFolders(guest.page);

  // The owner writes a page in a team workspace and shares just that page.
  await createWorkspace(owner.page, "Harbor Studio");
  await owner.page.getByRole("button", { name: "New note", exact: true }).click();
  await owner.page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await owner.page.getByRole("textbox", { name: "Title" }).fill("Harbor plan");
  await owner.page.keyboard.press("Enter");
  await owner.page.keyboard.type("First line");
  await waitForSaved(owner.page);
  const docUrl = owner.page.url().replace(/\?.*$/, "");
  const share = await shareWith(owner.page, guest.email, "Studio Guest");
  await expect(share.getByRole("radiogroup", { name: "Access" })).toBeVisible();
  await share.getByRole("button", { name: "Close" }).click();

  // The guest isn't a member: the page shows the workspace's name, and edits sync from their Personal.
  await editShared(guest.page, /Harbor plan/, "Harbor Studio", "Edited from outside the workspace");
  await expect(owner.page.getByRole("textbox", { name: "Document body" })).toContainText("Edited from outside the workspace", { timeout: 20_000 });
  // Both on the page: each one's bar shows who's here (you and the other), and the page reads as shared.
  const ownerBar = owner.page.getByRole("toolbar", { name: "Page tools" });
  await expect(ownerBar.getByRole("group", { name: /^Here now: .*Studio Owner \(you\).*Studio Guest/ })).toBeVisible({ timeout: 20_000 });
  await expect(ownerBar.getByRole("button", { name: "Shared" })).toBeVisible();
  await expect(guest.page.getByRole("toolbar", { name: "Page tools" }).getByRole("group", { name: /^Here now: .*Studio Guest \(you\).*Studio Owner/ })).toBeVisible({ timeout: 20_000 });

  // A deep link keeps working after a reload on the guest's side too (the queue is account-wide), and the
  // guest still has no workspaces of their own.
  await guest.page.goto(docUrl);
  await expect(guest.page.getByRole("textbox", { name: "Document body" })).toContainText("Edited from outside the workspace");
  await waitForSaved(guest.page);
  await showFolders(guest.page);
  await guest.page.getByRole("navigation", { name: "Folio" }).getByRole("button", { name: /: Personal, workspaces and account$/ }).click();
  await expect(guest.page.getByRole("menuitemradio", { name: "Harbor Studio" })).toHaveCount(0);
});
