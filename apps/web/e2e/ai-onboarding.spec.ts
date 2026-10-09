import { expect, test } from "@playwright/test";
import { APP, newPerson, waitForSaved } from "./helpers";

// Foli's first-time introduction and the empty states (docs/AI_ASSISTANT.md milestone 9): a small card in
// whichever AI surface someone opens first, with starters that fit the place; dismissing it (or using a
// starter) is remembered on the server, so no other surface shows it again, even after a reload. With AI
// turned off there's no card, and the AI page says how to turn it on. Every surface has an empty state.

test("the introduction shows once: a starter fills the box, and it's gone everywhere after", async ({ browser }) => {
  test.setTimeout(150_000);
  const { page, context } = await newPerson(browser, "Intro Person");
  await page.goto(`${APP}/ai`);
  const card = page.getByRole("region", { name: "Meet Foli" });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText("never changes a note without showing you the change first");
  await expect(card).toContainText("Google Gemini");
  await expect(card).toContainText("AI credits");
  // Empty /ai: the conversation list says what goes there.
  await expect(page.getByText("Your conversations will show up here.")).toBeVisible();

  // A starter goes into the box (nothing is sent), and the card is gone.
  await card.getByRole("button", { name: "What did I work on this week?" }).click();
  await expect(card).toHaveCount(0);
  const box = page.getByRole("textbox", { name: /Ask a question/ });
  await expect(box).toHaveValue("What did I work on this week?");
  await expect(box).toBeFocused();

  // Remembered on the server: not after a reload, not in the floating chat, not in a note's AI panel.
  // (The card hides at once; give the dismissal a moment to reach the server before reloading.)
  await page.waitForTimeout(1_500);
  await page.reload();
  await expect(page.getByRole("heading", { name: "What can I help you with?" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("region", { name: "Meet Foli" })).toHaveCount(0);
  await page.goto(`${APP}/documents`);
  await page.getByRole("button", { name: "Ask Foli" }).click();
  await expect(page.getByRole("dialog", { name: "Foli" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Meet Foli" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await context.close();
});

test("opened first in a note: note starters; Got it dismisses it for the AI page too; the note's empty states", async ({ browser }) => {
  test.setTimeout(150_000);
  const { page, context } = await newPerson(browser, "Note Intro");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.getByRole("textbox", { name: "Title" }).fill("Kickoff");
  await page.keyboard.press("Enter");
  await page.keyboard.type("We meet on Monday. Ana books the room.");
  await waitForSaved(page);

  await page.getByRole("toolbar", { name: "Page tools" }).getByRole("button", { name: "Foli" }).click();
  const card = page.getByRole("region", { name: "Meet Foli" });
  await expect(card).toBeVisible({ timeout: 30_000 });
  for (const s of ["Summarize this note", "List the action items", "What's still unclear here?"]) await expect(card.getByRole("button", { name: s })).toBeVisible();

  // Ask, before anything is asked: questions that fit this note.
  const modes = page.getByRole("group", { name: "What Foli should do" });
  await modes.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ask Foli about this note" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Who is mentioned, and why?" })).toBeVisible();
  // Study, with nothing made yet.
  await modes.getByRole("button", { name: "Study", exact: true }).click();
  await expect(page.getByRole("region", { name: "Study", exact: true }).getByText("Nothing to study yet")).toBeVisible();

  await card.getByRole("button", { name: "Got it" }).click();
  await expect(card).toHaveCount(0);
  await page.waitForTimeout(1_500);
  await page.goto(`${APP}/ai`);
  await expect(page.getByRole("heading", { name: "What can I help you with?" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("region", { name: "Meet Foli" })).toHaveCount(0);
  await context.close();
});

test("with AI off there's no card, and the AI page and the note's panel say how to turn it on", async ({ browser }) => {
  test.setTimeout(150_000);
  const { page, context } = await newPerson(browser, "Off Intro");
  await page.goto(`${APP}/settings/ai`);
  await page.getByRole("switch", { name: "Foli" }).click();
  await expect(page.getByText("Foli turned off")).toBeVisible();

  await page.goto(`${APP}/ai`);
  await expect(page.getByRole("heading", { name: "Foli is turned off" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: "Open AI settings" })).toHaveAttribute("href", /\/settings\/ai$/);
  await expect(page.getByRole("region", { name: "Meet Foli" })).toHaveCount(0);

  // On again: the introduction was never dismissed, so it's there.
  await page.goto(`${APP}/settings/ai`);
  await page.getByRole("switch", { name: "Foli" }).click();
  await expect(page.getByText("Foli turned on")).toBeVisible();
  await page.goto(`${APP}/ai`);
  await expect(page.getByRole("region", { name: "Meet Foli" })).toBeVisible({ timeout: 30_000 });
  await context.close();
});
