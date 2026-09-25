import { expect, test } from "@playwright/test";
import { newPersonWithWorkspace, waitForSaved } from "./helpers";

test("share a page with another person, comment, and publish a revocable public link", async ({ browser }) => {
  const owner = await newPersonWithWorkspace(browser, "Owner Person");
  const guest = await newPersonWithWorkspace(browser, "Guest Person");

  // Owner opens the brief and shares it with the guest as a commenter.
  await owner.page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "All Documents" }).click();
  await owner.page.getByRole("link", { name: /Project Atlas Brief/ }).first().click();
  await owner.page.getByRole("button", { name: "Share" }).click();
  const share = owner.page.getByRole("dialog", { name: /Share/ });
  await share.getByLabel("Email address").fill(guest.email);
  await share.getByLabel("Role").selectOption("commenter");
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
  const robots = (await anonPage.request.get(link)).headers()["x-robots-tag"];
  expect(robots).toContain("noindex");
  await share.getByRole("button", { name: "Revoke" }).first().click();
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
