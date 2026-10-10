import { expect, test } from "@playwright/test";
import { APP, newPerson } from "./helpers";

// The AI agent in the chat. Without a model key on the server (CI, local dev) the agent can't plan, so
// this covers what works without one: switching the chat to Agent, sending a request, and the answer
// saying the assistant isn't set up (nothing proposed, nothing changed).
test("the chat's Agent mode sends a request and says plainly when the assistant isn't set up", async ({ browser }) => {
  test.setTimeout(120_000);
  const { page, context } = await newPerson(browser, "Agent Person");
  await page.goto(`${APP}/ai`);
  await expect(page.getByRole("heading", { name: "Meet Foli", level: 2 })).toBeVisible();
  const modes = page.getByRole("group", { name: "How Foli helps" });
  await expect(modes.getByRole("button", { name: "Chat", exact: true })).toHaveAttribute("aria-pressed", "true");
  await modes.getByRole("button", { name: "Agent", exact: true }).click();
  await expect(modes.getByRole("button", { name: "Agent", exact: true })).toHaveAttribute("aria-pressed", "true");
  const box = page.getByPlaceholder("Ask Foli to organize, edit or create notes…");
  await expect(box).toBeVisible();
  await box.fill("Put my travel notes in a Travel folder");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByText("Put my travel notes in a Travel folder").first()).toBeVisible();
  await expect(page.getByText(/isn.t set up|couldn.t|try again/i).first()).toBeVisible({ timeout: 30_000 });
  // Nothing was proposed.
  await expect(page.getByRole("heading", { name: "Proposed changes" })).toHaveCount(0);
  await context.close();
});

// A request to change the note (in Write, or from Ask's "Fix in note") goes to the agent, which edits the
// note's own blocks in place, instead of a corrected copy being written at the cursor.
test("asking Foli to fix the note hands it to the agent, not a draft at the cursor", async ({ browser }) => {
  test.setTimeout(120_000);
  const { page, context } = await newPerson(browser, "Fix Person");
  await page.getByRole("toolbar", { name: "Page tools" }).getByRole("button", { name: "Foli", exact: true }).click();
  const panel = page.locator("#document-inspector");
  const modes = panel.getByRole("group", { name: "What Foli should do" });
  await expect(modes.getByRole("button", { name: "Write" })).toHaveAttribute("aria-pressed", "true");
  await panel.getByRole("textbox", { name: "Tell Foli what to write" }).fill("The section numbers are all messed up. Please fix.");
  await panel.getByRole("button", { name: "Write", exact: true }).last().click();
  // The Agent tab opens with the request sent.
  await expect(modes.getByRole("button", { name: "Agent" })).toHaveAttribute("aria-pressed", "true");
  await expect(panel.getByText("The section numbers are all messed up. Please fix.").first()).toBeVisible({ timeout: 20_000 });
  await context.close();
});
