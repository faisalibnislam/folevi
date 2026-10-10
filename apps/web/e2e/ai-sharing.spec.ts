import { expect, test } from "@playwright/test";
import { APP, createWorkspace, newPerson, switchTo } from "./helpers";

// Sharing, export and usage (docs/AI_ASSISTANT.md milestone 9, part A), as far as it works without a model
// key on the server: a refused question still makes a conversation, which its person shares with their
// workspace; a second member finds it under "Shared with you", read-only; unsharing hides it again. The
// conversation downloads as Markdown, and Settings > AI shows the usage card.
test("a conversation shared with the workspace shows under Shared with you, read-only, until it's unshared", async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = await newPerson(browser, "Sharing Owner");
  await createWorkspace(owner.page, "Shared Studio");
  const member = await newPerson(browser, "Sharing Member");
  await owner.page.goto(`${APP}/settings/members`);
  await owner.page.getByPlaceholder("name@example.com").fill(member.email);
  await owner.page.getByRole("button", { name: "Invite" }).click();
  await expect(owner.page.getByRole("status").filter({ hasText: /Invitation sent/ })).toBeVisible();
  await member.page.goto(`${APP}/documents`);
  await member.page.getByRole("button", { name: /Notifications/ }).click();
  await member.page.getByRole("button", { name: "Accept invitation" }).first().click();
  await switchTo(member.page, "Shared Studio");

  // A question in the workspace (refused without a key, but kept).
  await owner.page.goto(`${APP}/ai`);
  const box = owner.page.getByPlaceholder("Ask anything, or ask Foli to tidy or organize…");
  await box.fill("What did we decide about the launch?");
  await owner.page.getByRole("button", { name: "Ask", exact: true }).click();
  await owner.page.waitForURL(/\/ai\/[0-9A-Z]{26}/, { timeout: 30_000 });
  await expect(owner.page.getByText(/isn.t set up|couldn.t|try again/i).first()).toBeVisible({ timeout: 30_000 });
  const url = owner.page.url();

  // Download it as Markdown.
  const options = owner.page.getByRole("button", { name: "Conversation options" });
  await options.click();
  const downloading = owner.page.waitForEvent("download");
  await owner.page.getByRole("menuitem", { name: "Download Markdown" }).click();
  expect((await downloading).suggestedFilename()).toMatch(/\.md$/);

  // Share it (asked first).
  await options.click();
  await owner.page.getByRole("menuitem", { name: "Share with workspace…" }).click();
  const dialog = owner.page.getByRole("dialog", { name: "Share this Foli conversation?" });
  await dialog.getByRole("button", { name: "Share", exact: true }).click();
  await expect(owner.page.getByRole("status").filter({ hasText: "Shared with the workspace" })).toBeVisible();

  // The member finds it under Shared with you and reads it, with nothing to ask in.
  await member.page.goto(`${APP}/ai`);
  const shared = member.page.getByRole("region", { name: "Shared with you" });
  // A refused question doesn't get a title, so it's still "New chat", shared by its person.
  const link = shared.getByRole("link", { name: /Sharing Owner/ });
  await expect(link).toBeVisible({ timeout: 30_000 });
  await link.click();
  await expect(member.page.getByRole("note").filter({ hasText: "Shared by Sharing Owner" })).toBeVisible({ timeout: 30_000 });
  await expect(member.page.getByText("What did we decide about the launch?").first()).toBeVisible();
  await expect(member.page.getByPlaceholder(/Ask/)).toHaveCount(0);
  await expect(member.page.getByRole("button", { name: /Regenerate|Try again/ })).toHaveCount(0);

  // Unshared: gone for the member.
  await owner.page.goto(url);
  await owner.page.getByRole("button", { name: "Conversation options" }).click();
  await owner.page.getByRole("menuitem", { name: "Stop sharing" }).click();
  await expect(owner.page.getByRole("status").filter({ hasText: "Stopped sharing" })).toBeVisible();
  await member.page.goto(`${APP}/ai`);
  await member.page.reload();
  await expect(member.page.getByRole("navigation", { name: "Conversations" })).toBeVisible({ timeout: 30_000 });
  await expect(member.page.getByRole("region", { name: "Shared with you" })).toHaveCount(0);

  // A Personal conversation can't be shared, and the menu says so.
  await switchTo(owner.page, "Personal");
  await owner.page.goto(`${APP}/ai`);
  await owner.page.getByPlaceholder("Ask anything, or ask Foli to tidy or organize…").fill("A personal question");
  await owner.page.getByRole("button", { name: "Ask", exact: true }).click();
  await owner.page.waitForURL(/\/ai\/[0-9A-Z]{26}/, { timeout: 30_000 });
  await owner.page.getByRole("button", { name: "Conversation options" }).click();
  await expect(owner.page.getByRole("menuitem", { name: /Share with workspace/ })).toBeDisabled();
  await expect(owner.page.getByText("Personal conversations can't be shared.")).toBeVisible();
  await owner.page.keyboard.press("Escape");

  // Settings > AI: the usage card.
  await owner.page.goto(`${APP}/settings/ai`);
  const usage = owner.page.getByRole("region", { name: "Usage" });
  await expect(usage).toBeVisible({ timeout: 30_000 });
  await expect(usage.getByText("Used this period")).toBeVisible();
  await expect(usage.getByRole("img", { name: /Credits used per day/ }).or(usage.getByText(/No credits used yet this period|Nothing to show by day yet/))).toBeVisible();
  await expect(owner.page.getByRole("button", { name: "Export all conversations" })).toBeVisible();

  await owner.context.close();
  await member.context.close();
});
