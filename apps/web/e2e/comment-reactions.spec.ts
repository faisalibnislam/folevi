import { expect, test } from "@playwright/test";
import { newPerson, waitForSaved } from "./helpers";

test("react to a comment from the picker (keyboard too), then take it back from its chip", async ({ browser }) => {
  test.setTimeout(120_000);
  const { page, context } = await newPerson(browser, "Robin Reacts");
  // On the Welcome note, which already has text (a brand-new note's first lines can still be syncing).
  const body = page.getByRole("textbox", { name: "Document body" });
  await body.locator("p").filter({ hasText: /\w/ }).first().click();
  await waitForSaved(page);
  await page.keyboard.press("ControlOrMeta+Alt+m");
  await page.getByRole("textbox", { name: /comment|Reply/i }).first().fill("Shall we ship it?");
  await page.keyboard.press("Enter");
  await expect(page.locator(".fb-comment-chip")).toBeVisible({ timeout: 15_000 });

  const comments = page.getByRole("list", { name: "Comments in this thread" });
  const comment = comments.getByRole("listitem").filter({ hasText: "Shall we ship it?" });
  await expect(comment).toBeVisible();
  // The comment is saved (not "Sending…") before it can take reactions.
  const add = comment.getByRole("button", { name: "Add reaction to Robin Reacts's comment" });
  await comment.hover();
  await add.click();
  const picker = page.getByRole("menu", { name: "Reactions" });
  await expect(picker.getByRole("menuitemcheckbox")).toHaveCount(6);
  await expect(picker.getByRole("menuitemcheckbox", { name: "Agree" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(picker.getByRole("menuitemcheckbox", { name: "Love it" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(picker).toHaveCount(0);

  const reactions = comment.getByRole("group", { name: "Reactions" });
  const love = reactions.getByRole("button", { name: "Love it, 1" });
  await expect(love).toHaveAttribute("aria-pressed", "true");
  await expect(love).toHaveAttribute("title", "Love it: You");

  // A second kind by mouse; both stay after a reload.
  await comment.hover();
  await add.click();
  await picker.getByRole("menuitemcheckbox", { name: "Idea" }).click();
  await expect(reactions.getByRole("button", { name: "Idea, 1" })).toHaveAttribute("aria-pressed", "true");
  // Reactions are saved straight to the server (not through the note's sync); give it a moment.
  await page.waitForTimeout(1500);
  await page.reload();
  await page.locator(".fb-comment-chip").click();
  await expect(reactions.getByRole("button")).toHaveCount(2);

  // Pressing your own chip takes the reaction back.
  await reactions.getByRole("button", { name: "Love it, 1" }).click();
  await expect(reactions.getByRole("button", { name: /^Love it/ })).toHaveCount(0);
  await expect(reactions.getByRole("button", { name: "Idea, 1" })).toBeVisible();
  // No emoji: the chips are icons and numbers.
  await expect(reactions).toHaveText("1");
  await context.close();
});
