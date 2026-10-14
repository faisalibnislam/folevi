import { expect, test, type Page } from "@playwright/test";
import { newPerson, openShare, pick, showFolders, waitForSaved } from "./helpers";

// Changes: what someone else changed in a note you've opened shows up in one place until you've seen it.

async function shareWith(page: Page, email: string, name: string) {
  await openShare(page);
  const share = page.getByRole("dialog", { name: /Share/ });
  await share.getByLabel("Email address").fill(email);
  await pick(share.getByLabel("Role"), "Can edit");
  await share.getByRole("button", { name: "Share", exact: true }).click();
  await expect(share.getByText(name)).toBeVisible();
  await share.getByRole("button", { name: "Close" }).click();
}

/** Adds a line after the first one, as someone who just opened the note. */
async function addLine(page: Page, line: string) {
  const body = page.getByRole("textbox", { name: "Document body" });
  await expect(body).toHaveAttribute("contenteditable", "true");
  await body.locator("p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type(line);
  await waitForSaved(page);
  await expect(page.getByText("Not saved")).toHaveCount(0);
  return body;
}

test("someone edits your shared note: it shows in Changes with what changed, until you mark it seen", async ({ browser }) => {
  const owner = await newPerson(browser, "Morgan Owner");
  await showFolders(owner.page);
  const guest = await newPerson(browser, "Jules Editor");
  await showFolders(guest.page);

  await owner.page.getByRole("button", { name: "New note", exact: true }).click();
  await owner.page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await owner.page.getByRole("textbox", { name: "Title" }).fill("Changes plan");
  await owner.page.keyboard.press("Enter");
  await owner.page.keyboard.type("The owner's first line");
  await waitForSaved(owner.page);
  await shareWith(owner.page, guest.email, "Jules Editor");

  // The owner moves on: nothing new yet.
  const nav = owner.page.getByRole("navigation", { name: "Folio" });
  await nav.getByRole("link", { name: "Changes" }).click();
  await expect(owner.page.getByText("You’re all caught up.")).toBeVisible();

  // The guest adds a line.
  await guest.page.getByRole("navigation", { name: "Folio" }).getByRole("link", { name: "Shared with Me" }).click();
  await guest.page.getByRole("listitem").filter({ hasText: /Changes plan/ }).getByRole("link").click();
  await expect(guest.page.getByRole("textbox", { name: "Document body" })).toContainText("The owner's first line");
  await addLine(guest.page, "Added by the editor");

  // It shows up for the owner, by note: who, and the line marked as added.
  const card = owner.page.getByRole("article", { name: "Changes plan" });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText("Jules Editor");
  await expect(card).toContainText("1 line added");
  const diff = card.getByRole("group", { name: "What changed in Changes plan" });
  await expect(diff).toContainText("Added by the editor");
  await expect(diff.locator('[data-change="added"]')).toHaveCount(1);
  await expect(diff).not.toContainText("The owner's first line");
  await expect(nav.getByRole("link", { name: /Changes/ })).toContainText("1");
  await expect(card.getByRole("button", { name: "Undo this change" })).toBeVisible();

  // Marked as seen, it's gone.
  await card.getByRole("button", { name: "Mark as seen" }).click();
  await expect(card).toHaveCount(0);
  await expect(owner.page.getByText("You’re all caught up.")).toBeVisible();
  await expect(nav.getByRole("link", { name: /Changes/ })).not.toContainText("1");
});

test("undo a change from Changes, then put it back", async ({ browser }) => {
  const owner = await newPerson(browser, "Riley Owner");
  await showFolders(owner.page);
  const guest = await newPerson(browser, "Casey Editor");
  await showFolders(guest.page);

  await owner.page.getByRole("button", { name: "New note", exact: true }).click();
  await owner.page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  const docUrl = owner.page.url().replace(/\?.*$/, "");
  await owner.page.getByRole("textbox", { name: "Title" }).fill("Undo plan");
  await owner.page.keyboard.press("Enter");
  await owner.page.keyboard.type("Keep this line");
  await waitForSaved(owner.page);
  await shareWith(owner.page, guest.email, "Casey Editor");
  await owner.page.getByRole("navigation", { name: "Folio" }).getByRole("link", { name: "Changes" }).click();
  await expect(owner.page.getByText("You’re all caught up.")).toBeVisible();

  await guest.page.getByRole("navigation", { name: "Folio" }).getByRole("link", { name: "Shared with Me" }).click();
  await guest.page.getByRole("listitem").filter({ hasText: /Undo plan/ }).getByRole("link").click();
  const body = await addLine(guest.page, "An unwanted line");

  const card = owner.page.getByRole("article", { name: "Undo plan" });
  await expect(card.getByRole("button", { name: "Undo this change" })).toBeVisible({ timeout: 30_000 });
  await card.getByRole("button", { name: "Undo this change" }).click();
  await expect(card).toHaveCount(0);
  await expect(owner.page.getByText(/Undid the changes/)).toBeVisible();

  // The note is back to the owner's line alone, for both of them.
  await expect(body).not.toContainText("An unwanted line", { timeout: 20_000 });
  await owner.page.goto(docUrl);
  const ownerBody = owner.page.getByRole("textbox", { name: "Document body" });
  await expect(ownerBody).toContainText("Keep this line");
  await expect(ownerBody).not.toContainText("An unwanted line");
});
