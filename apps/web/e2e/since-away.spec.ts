import { expect, test, type Page } from "@playwright/test";
import { newPerson, openShare, pick, showFolders, waitForSaved } from "./helpers";

// "Since you were away": back in a note someone else changed, a slim line says who, and can show the lines.

async function shareWith(page: Page, email: string, name: string) {
  await openShare(page);
  const share = page.getByRole("dialog", { name: /Share/ });
  await share.getByLabel("Email address").fill(email);
  await pick(share.getByLabel("Role"), "Can edit");
  await share.getByRole("button", { name: "Share", exact: true }).click();
  await expect(share.getByText(name)).toBeVisible();
  await share.getByRole("button", { name: "Close" }).click();
}

test("back in a note someone changed: who changed it, show the lines, dismiss", async ({ browser }) => {
  const owner = await newPerson(browser, "Avery Owner");
  await showFolders(owner.page);
  const guest = await newPerson(browser, "Quinn Editor");
  await showFolders(guest.page);

  await owner.page.getByRole("button", { name: "New note", exact: true }).click();
  await owner.page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  const docUrl = owner.page.url().replace(/\?.*$/, "");
  await owner.page.getByRole("textbox", { name: "Title" }).fill("Away plan");
  await owner.page.keyboard.press("Enter");
  await owner.page.keyboard.type("Where we started");
  await waitForSaved(owner.page);
  await shareWith(owner.page, guest.email, "Quinn Editor");
  const banner = owner.page.getByRole("region", { name: "Since you were last here" });
  // Their own first visit: nothing to catch up on.
  await expect(banner).toHaveCount(0);
  await owner.page.getByRole("navigation", { name: "Folio" }).getByRole("link", { name: "Home" }).click();

  // The guest adds a line while the owner is elsewhere.
  await guest.page.getByRole("navigation", { name: "Folio" }).getByRole("link", { name: "Shared with Me" }).click();
  await guest.page.getByRole("listitem").filter({ hasText: /Away plan/ }).getByRole("link").click();
  const body = guest.page.getByRole("textbox", { name: "Document body" });
  await expect(body).toHaveAttribute("contenteditable", "true");
  await body.locator("p").first().click();
  await guest.page.keyboard.press("End");
  await guest.page.keyboard.press("Enter");
  await guest.page.keyboard.type("Where we are now");
  await waitForSaved(guest.page);
  await guest.page.getByRole("navigation", { name: "Folio" }).getByRole("link", { name: "Home" }).click();

  // The owner comes back to it.
  await owner.page.goto(docUrl);
  const ownerBody = owner.page.getByRole("textbox", { name: "Document body" });
  await expect(ownerBody).toContainText("Where we are now");
  await expect(banner).toContainText("Quinn Editor changed this note since you were last here", { timeout: 20_000 });
  const show = banner.getByRole("button", { name: "Show changes" });
  await expect(show).toHaveAttribute("aria-pressed", "false");
  await expect(ownerBody).not.toHaveClass(/fb-show-editors/);

  // Show changes marks the line they added, in their colour; the owner's own line isn't marked.
  await show.click();
  await expect(show).toHaveAttribute("aria-pressed", "true");
  await expect(banner).toContainText("1 line added");
  await expect(ownerBody).toHaveClass(/fb-show-editors/);
  const marked = ownerBody.locator("p", { hasText: "Where we are now" });
  const unmarked = ownerBody.locator("p", { hasText: "Where we started" });
  await expect.poll(async () => await marked.evaluate((el) => getComputedStyle(el).getPropertyValue("--author-tint").trim())).not.toBe("");
  expect(await unmarked.evaluate((el) => getComputedStyle(el).getPropertyValue("--author-tint").trim())).toBe("");

  // Dismiss: gone, the marks too, and it stays gone after a reload.
  await banner.getByRole("button", { name: "Dismiss" }).click();
  await expect(banner).toHaveCount(0);
  await expect(ownerBody).not.toHaveClass(/fb-show-editors/);
  // (Give the dismissal a moment to reach the server before the page goes away.)
  await owner.page.waitForTimeout(1000);
  await owner.page.reload();
  await expect(owner.page.getByRole("textbox", { name: "Document body" })).toContainText("Where we are now");
  await owner.page.waitForTimeout(1500);
  await expect(banner).toHaveCount(0);
});
