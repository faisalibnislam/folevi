import { expect, test } from "@playwright/test";
import { APP, newPerson } from "./helpers";

// The AI page: the conversation list beside the chat. Without a model key on the server (CI, local dev) a question
// is still kept, and its answer says the assistant isn't set up, instead of failing silently.
test("the AI page lists conversations and keeps a question even when the assistant can't answer", async ({ browser }) => {
  test.setTimeout(120_000);
  const { page } = await newPerson(browser, "Chat Person");
  await page.goto(`${APP}/documents`);
  await page.getByRole("navigation", { name: "Folio" }).getByRole("link", { name: "Work with Foli", exact: true }).click();
  await page.waitForURL(/\/ai(\/|$)/);
  await expect(page.getByRole("heading", { name: "What can I help you with?" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Conversations" })).toBeVisible();
  const box = page.getByPlaceholder("Ask anything about your notes…");
  await box.fill("What am I working on this week?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByText("What am I working on this week?").first()).toBeVisible();
  await expect(page.getByText(/isn.t set up|couldn.t|try again/i).first()).toBeVisible({ timeout: 30_000 });
  // It's in the list, and comes back after a reload.
  await page.reload();
  await expect(page.getByText("What am I working on this week?").first()).toBeVisible({ timeout: 20_000 });
});
