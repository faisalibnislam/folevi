import { expect, test } from "@playwright/test";
import { newPerson, waitForSaved, showFolders, pick } from "./helpers";

test("share a page with another person, comment, and publish a revocable public link", async ({ browser }) => {
  const owner = await newPerson(browser, "Owner Person");
  await showFolders(owner.page);
  const guest = await newPerson(browser, "Guest Person");
  await showFolders(guest.page);

  // Owner opens the brief and shares it with the guest as a commenter.
  await owner.page.getByRole("navigation", { name: "Folio" }).getByRole("link", { name: "Home" }).click();
  await owner.page.getByRole("link", { name: /Project Atlas Brief/ }).first().click();
  await owner.page.getByRole("button", { name: "Share" }).click();
  const share = owner.page.getByRole("dialog", { name: /Share/ });
  await share.getByLabel("Email address").fill(guest.email);
  await pick(share.getByLabel("Role"), "Can comment");
  await share.getByRole("button", { name: "Share", exact: true }).click();
  await expect(share.getByText("Guest Person")).toBeVisible();

  // Public link: create, open anonymously, revoke, and confirm it stops working.
  await share.getByRole("button", { name: "Create link" }).click();
  const link = await share.getByLabel("Public link").inputValue();
  expect(link).toMatch(/\/s\/[A-Za-z0-9_-]{20,}/);
  const anon = await browser.newContext();
  const anonPage = await anon.newPage();
  await anonPage.goto(link);
  await expect(anonPage.getByRole("heading", { name: "Project Atlas Brief" })).toBeVisible();
  // Not indexed unless the owner allows it for this link (robots meta; the page sets it per link).
  await expect(anonPage.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  expect((await anonPage.request.get(link)).headers()["referrer-policy"]).toBe("no-referrer");
  await share.getByRole("button", { name: "Revoke" }).first().click();
  // Wait for the revoke to land before reloading (on a slow runner the reload could beat it).
  await expect(share.page().getByRole("status").filter({ hasText: "Link revoked" })).toBeVisible();
  await anonPage.reload();
  await expect(anonPage.getByRole("heading", { name: "Page unavailable" })).toBeVisible();
  await share.getByRole("button", { name: "Close" }).click();

  // Guest sees it under Shared with Me, can comment but not edit.
  await guest.page.getByRole("link", { name: "Shared with Me" }).click();
  await guest.page.getByRole("link", { name: /Project Atlas Brief/ }).click();
  await expect(guest.page.getByText("View only")).toBeVisible();
  await guest.page.getByRole("button", { name: /^Comments/ }).click();
  await guest.page.getByLabel(/Comment on this document/).fill("Can we add a budget section?");
  await guest.page.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(guest.page.getByText("Can we add a budget section?")).toBeVisible();

  // Owner gets an in-app notification and sees the comment.
  await owner.page.getByRole("button", { name: /Notifications, \d+ unread/ }).click({ timeout: 15_000 });
  await expect(owner.page.getByRole("dialog", { name: "Notifications" }).getByText(/commented on Project Atlas Brief/)).toBeVisible();
  await waitForSaved(owner.page);
});
