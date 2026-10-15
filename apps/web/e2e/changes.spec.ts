import { expect, request, test, type Page } from "@playwright/test";
import { APP, newPerson, openShare, pick, showFolders, waitForSaved } from "./helpers";

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

test("with review turned on, a token's addition to a note waits in Changes until it's accepted", async ({ browser }) => {
  test.setTimeout(120_000);
  const { page, context } = await newPerson(browser, "Careful Person");
  await page.goto(`${APP}/settings/connected-apps`);
  const review = page.getByRole("switch", { name: "Ask me before changes are made to existing notes" });
  await expect(review).toHaveAttribute("aria-checked", "false");
  await review.click();
  await expect(review).toHaveAttribute("aria-checked", "true");

  const card = page.getByRole("region", { name: "Personal access tokens" });
  await card.getByRole("button", { name: "New token" }).click();
  const dialog = page.getByRole("dialog", { name: "New personal access token" });
  await dialog.getByLabel("Name").fill("Journal script");
  await dialog.getByRole("checkbox", { name: "Create notes and add to them" }).click();
  await dialog.getByRole("button", { name: "Create token" }).click();
  const shown = page.getByRole("dialog", { name: "Copy your new token" });
  const token = await shown.getByLabel("Your new token").inputValue();
  await shown.getByRole("button", { name: "Done" }).click();

  const api = await request.newContext();
  const auth = { authorization: `Bearer ${token}` };
  // A new note is made at once; adding to it is proposed.
  const made = await api.post(`${APP}/api/v1/notes`, { headers: auth, data: { title: "Field journal", markdown: "Day one." } });
  expect(made.status(), await made.text()).toBe(201);
  const note = await made.json();
  const appended = await api.post(`${APP}/api/v1/notes/${note.id}/append`, { headers: auth, data: { markdown: "Day two: saw the heron." } });
  expect(appended.status(), await appended.text()).toBe(202);
  const answer = await appended.json();
  expect(answer).toMatchObject({ id: note.id, proposed: true, status: "pending" });
  expect(answer.message).toContain("Changes page");
  await api.dispose();

  // Not in the note yet.
  await page.goto(`${APP}/d/${note.id}`);
  const body = page.getByRole("textbox", { name: "Document body" });
  await expect(body).toContainText("Day one.");
  await expect(body).not.toContainText("Day two");

  await page.goto(`${APP}/changes`);
  // Counted in the sidebar until it's answered.
  await expect(page.getByRole("navigation", { name: "Folio" }).getByRole("link", { name: /Changes/ })).toContainText("1");
  const proposed = page.getByRole("list", { name: "Proposed changes" });
  const item = proposed.getByRole("article", { name: "Field journal" });
  await expect(item).toContainText("Journal script");
  await expect(item.getByRole("group", { name: "What Journal script would add to Field journal" })).toContainText("Day two: saw the heron.");
  await item.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Added to “Field journal”" })).toBeVisible();
  await expect(proposed).toHaveCount(0);

  await page.goto(`${APP}/d/${note.id}`);
  await expect(body).toContainText("Day two: saw the heron.");
  await waitForSaved(page);
  await context.close();
});
