import { expect, test, type Page } from "@playwright/test";
import { newPerson, openShare, pick, showFolders, waitForSaved } from "./helpers";

// Live carets: two people in one note see where the other one's caret is, in their colour with their name.

async function shareWith(page: Page, email: string, name: string) {
  await openShare(page);
  const share = page.getByRole("dialog", { name: /Share/ });
  await share.getByLabel("Email address").fill(email);
  await pick(share.getByLabel("Role"), "Can edit");
  await share.getByRole("button", { name: "Share", exact: true }).click();
  await expect(share.getByText(name)).toBeVisible();
  await share.getByRole("button", { name: "Close" }).click();
}

test("two people in a note see each other's caret and name", async ({ browser }) => {
  const owner = await newPerson(browser, "Robin Owner");
  await showFolders(owner.page);
  const guest = await newPerson(browser, "Sasha Guest");
  await showFolders(guest.page);

  await owner.page.getByRole("button", { name: "New note", exact: true }).click();
  await owner.page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await owner.page.getByRole("textbox", { name: "Title" }).fill("Caret plan");
  await owner.page.keyboard.press("Enter");
  await owner.page.keyboard.type("The first line of the plan");
  await owner.page.keyboard.press("Enter");
  await owner.page.keyboard.type("A second line");
  await waitForSaved(owner.page);
  await shareWith(owner.page, guest.email, "Sasha Guest");

  await guest.page.getByRole("link", { name: "Shared with Me" }).click();
  await guest.page.getByRole("listitem").filter({ hasText: /Caret plan/ }).getByRole("link").click();
  const guestBody = guest.page.getByRole("textbox", { name: "Document body" });
  await expect(guestBody).toContainText("A second line");
  await expect(guestBody).toHaveAttribute("contenteditable", "true");
  await guestBody.locator("p").first().click();

  // Both are here: each sees the other's caret, labelled with their first name.
  const ownerBody = owner.page.getByRole("textbox", { name: "Document body" });
  await expect(ownerBody.locator('[data-remote-caret="Sasha"]')).toBeVisible({ timeout: 30_000 });
  await ownerBody.locator("p").last().click();
  await expect(guestBody.locator('[data-remote-caret="Robin"]')).toBeVisible({ timeout: 30_000 });

  // The guest's caret follows them to the second line, as they type.
  await guestBody.locator("p").last().click();
  await guest.page.keyboard.press("End");
  await guest.page.keyboard.type(" and more");
  await expect(ownerBody.locator("p").last().locator('[data-remote-caret="Sasha"]')).toHaveCount(1, { timeout: 20_000 });
  // Carets are decoration only: they're never part of the note's text.
  await waitForSaved(guest.page);
  await expect(ownerBody.locator("p").last()).toContainText("A second line and more", { timeout: 20_000 });
  expect(await ownerBody.locator("p").last().evaluate((p) => [...p.childNodes].filter((n) => !(n instanceof HTMLElement && n.dataset.remoteCaret)).map((n) => n.textContent).join(""))).toBe("A second line and more");

  // When the guest leaves, their caret goes with them.
  await guest.page.getByRole("navigation", { name: "Folio" }).getByRole("link", { name: "Shared with Me" }).click();
  await expect(ownerBody.locator('[data-remote-caret="Sasha"]')).toHaveCount(0, { timeout: 30_000 });
});
