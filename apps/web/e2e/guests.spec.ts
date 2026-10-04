import { expect, test, type Page } from "@playwright/test";
import { APP, completeOnboarding, createAccount, createWorkspace, newPerson, pick, showFolders, switcher, uniqueEmail, waitForSaved, openShare } from "./helpers";

// Members vs guests (docs/ACCOUNT_MODEL_PLAN.md, Phase D): sharing one page with an address that has no
// account, accepting it as a guest who sees only that page, the Guests list, and making a guest a member.

async function newNote(page: Page, title: string): Promise<string> {
  const before = page.url();
  await page.getByRole("button", { name: "New note", exact: true }).click();
  // The previous new note's URL also ends in ?new=1: wait for this note's own URL and empty title.
  await page.waitForURL((url) => url.href !== before && /^\/d\/[0-9A-Z]{26}$/.test(url.pathname) && url.searchParams.get("new") === "1");
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("");
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.keyboard.press("Enter");
  await page.keyboard.type(`${title} body`);
  await waitForSaved(page);
  return page.url().replace(/\?.*$/, "");
}

test("share a page with a new address → they sign up, accept, and see only that page; then become a member", async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = await newPerson(browser, "Studio Owner");
  await showFolders(owner.page);
  await createWorkspace(owner.page, "Guest Studio");
  const privateUrl = await newNote(owner.page, "Internal budget");
  const sharedUrl = await newNote(owner.page, "Garden plan");

  // Share with someone who has no Folevi account yet: an invitation by email, nothing granted yet.
  const guestEmail = uniqueEmail("guest");
  await openShare(owner.page);
  const share = owner.page.getByRole("dialog", { name: /Share/ });
  await share.getByLabel("Email address").fill(guestEmail);
  await pick(share.getByLabel("Role"), "Can edit");
  await share.getByRole("button", { name: "Share", exact: true }).click();
  await expect(owner.page.getByRole("status").filter({ hasText: `Invitation sent to ${guestEmail}` })).toBeVisible();
  await expect(share.getByText("Invited by email")).toBeVisible();
  await expect(share.getByRole("listitem").filter({ hasText: guestEmail })).toContainText("waiting to accept");
  await share.getByRole("button", { name: "Close" }).click();

  // They sign up with that address; a notice waits for them. Accepting opens the page.
  const guestContext = await browser.newContext();
  const { page: guest } = await createAccount(guestContext, { email: guestEmail, name: "Garden Guest" });
  await completeOnboarding(guest);
  await guest.getByRole("button", { name: /Notifications/ }).click();
  await guest.getByRole("button", { name: "Accept and open" }).first().click();
  await expect(guest.getByRole("textbox", { name: "Title" })).toHaveValue("Garden plan", { timeout: 20_000 });
  const body = guest.getByRole("textbox", { name: "Document body" });
  await expect(body).toHaveAttribute("contenteditable", "true");
  await body.click();
  await guest.keyboard.press("ControlOrMeta+End");
  await guest.keyboard.press("Enter");
  await guest.keyboard.type("Guest was here");
  await waitForSaved(guest);

  // Only that page: another page of the workspace by URL is unavailable, and the guest has no workspace.
  await guest.goto(privateUrl);
  await expect(guest.getByRole("heading", { name: "This page isn’t available" })).toBeVisible({ timeout: 20_000 });
  await showFolders(guest);
  await switcher(guest).click();
  await expect(guest.getByRole("menuitemradio", { name: "Guest Studio" })).toHaveCount(0);
  await guest.keyboard.press("Escape");
  await guest.getByRole("link", { name: "Shared with Me" }).click();
  await expect(guest.getByRole("listitem").filter({ hasText: "Garden plan" })).toContainText("Guest Studio");
  await expect(guest.getByRole("listitem").filter({ hasText: "Internal budget" })).toHaveCount(0);
  // The share dialog shows the guest only their own access.
  await guest.goto(sharedUrl);
  await openShare(guest);
  const guestShare = guest.getByRole("dialog", { name: /Share/ });
  await expect(guestShare.getByText(/You’re a guest on this page/)).toBeVisible();
  await expect(guestShare.getByLabel("Email address")).toHaveCount(0);
  await guestShare.getByRole("button", { name: "Close" }).click();

  // The owner sees the guest in Settings → Guests (not billed), with the page and its access.
  await owner.page.goto(`${APP}/settings/members`);
  await expect(owner.page.getByRole("link", { name: "Guests: 1 · Not billed" })).toBeVisible({ timeout: 30_000 });
  await owner.page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Guests" }).click();
  const row = owner.page.getByRole("listitem").filter({ hasText: "Garden Guest" }).first();
  await expect(row).toContainText(guestEmail);
  await expect(row.getByRole("list", { name: "Pages Garden Guest can open" })).toContainText("Garden plan");

  // Convert to member: an invitation; once accepted, they're a member and keep the page.
  await row.getByRole("button", { name: "Convert to member" }).click();
  await owner.page.getByRole("button", { name: "Send invitation" }).click();
  await expect(owner.page.getByRole("status").filter({ hasText: "Invitation sent to Garden Guest" })).toBeVisible();
  await guest.goto(`${APP}/documents`);
  await guest.getByRole("button", { name: /Notifications/ }).click();
  await guest.getByRole("button", { name: "Accept invitation" }).first().click();
  await showFolders(guest);
  await switcher(guest).click();
  await expect(guest.getByRole("menuitemradio", { name: "Guest Studio" })).toBeVisible();
  await guest.keyboard.press("Escape");
  await owner.page.goto(`${APP}/settings/members`);
  await expect(owner.page.getByRole("listitem").filter({ hasText: guestEmail })).toBeVisible({ timeout: 30_000 });
  await owner.context.close();
  await guestContext.close();
});

test("members see roles, but only owners and admins see Guests and Import & export", async ({ browser }) => {
  test.setTimeout(180_000);
  const owner = await newPerson(browser, "Roles Owner");
  await createWorkspace(owner.page, "Roles Studio");
  const member = await newPerson(browser, "Viewing Member");
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
  await member.page.getByRole("menuitemradio", { name: "Roles Studio" }).click();

  await member.page.goto(`${APP}/settings/members`);
  const sections = member.page.getByRole("navigation", { name: "Settings sections" });
  await expect(sections.getByRole("link", { name: "Members" })).toBeVisible({ timeout: 30_000 });
  await expect(sections.getByRole("link", { name: "Guests" })).toHaveCount(0);
  // Only the Personal "Import & export": none for this workspace.
  await expect(sections.getByRole("link", { name: "Import & export" })).toHaveCount(1);
  await expect(member.page.getByRole("listitem").filter({ hasText: "Viewing Member" })).toContainText("View only");
  await expect(member.page.getByText("Only owners and admins can invite people or change roles.")).toBeVisible();
  await member.page.goto(`${APP}/settings/workspace-guests`);
  await expect(member.page.getByRole("heading", { name: "Not found" })).toBeVisible({ timeout: 30_000 });

  // The owner can't leave: the page explains transfer or deletion.
  await owner.page.goto(`${APP}/settings/workspace`);
  await expect(owner.page.getByText(/You own this workspace, so you can’t leave it/)).toBeVisible({ timeout: 30_000 });
  await expect(owner.page.getByRole("button", { name: "Delete Roles Studio…" })).toBeVisible();
  await owner.context.close();
  await member.context.close();
});
