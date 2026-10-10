import { expect, test } from "@playwright/test";
import { APP, newPerson, waitForSaved } from "./helpers";

// Meet Foli and the empty states (docs/AI_ASSISTANT.md milestone 9). Was: a small card in
// whichever AI surface someone opens first, with starters that fit the place; dismissing it (or using a
// starter) is remembered on the server, so no other surface shows it again, even after a reload. With AI
// turned off there's no card, and the AI page says how to turn it on. Every surface has an empty state.

test("the AI page and the floating chat open on Meet Foli: what it does, where requests go, credits, and things to try", async ({ browser }) => {
  test.setTimeout(150_000);
  const { page, context } = await newPerson(browser, "Intro Person");
  await page.goto(`${APP}/ai`);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Meet Foli", level: 2 })).toBeVisible({ timeout: 30_000 });
  await expect(main).toContainText("never changes a note without showing you the change first");
  await expect(main).toContainText("Google Gemini");
  await expect(main).toContainText("AI credits");
  await expect(main.getByText("Try asking")).toBeVisible();
  // Empty /ai: the conversation list says what goes there.
  await expect(page.getByText("Your conversations will show up here.")).toBeVisible();
  // Still there after a reload (it's the welcome of an empty chat, not a one-time card).
  await page.reload();
  await expect(main.getByRole("heading", { name: "Meet Foli", level: 2 })).toBeVisible({ timeout: 30_000 });

  await page.goto(`${APP}/documents`);
  await page.getByRole("button", { name: "Ask Foli" }).click();
  const chat = page.getByRole("dialog", { name: "Foli" });
  await expect(chat.getByRole("heading", { name: "Meet Foli" })).toBeVisible();
  await expect(chat).toContainText("Foli is AI and can make mistakes.");
  await page.keyboard.press("Escape");
  await context.close();
});

test("a note's Foli panel has no introduction card, just its empty states; the AI page still introduces Foli", async ({ browser }) => {
  test.setTimeout(150_000);
  const { page, context } = await newPerson(browser, "Note Intro");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.getByRole("textbox", { name: "Title" }).fill("Kickoff");
  await page.keyboard.press("Enter");
  await page.keyboard.type("We meet on Monday. Ana books the room.");
  await waitForSaved(page);

  await page.getByRole("toolbar", { name: "Page tools" }).getByRole("button", { name: "Foli" }).click();
  const modes = page.getByRole("group", { name: "What Foli should do" });
  await expect(modes).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("region", { name: "Meet Foli" })).toHaveCount(0);

  // Ask, before anything is asked: questions that fit this note.
  await modes.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ask Foli about this note" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Who is mentioned, and why?" })).toBeVisible();
  // Study, with nothing made yet.
  await modes.getByRole("button", { name: "Study", exact: true }).click();
  await expect(page.getByRole("region", { name: "Study", exact: true }).getByText("Nothing to study yet")).toBeVisible();

  // Opening the note panel doesn't count as having seen the introduction.
  await page.goto(`${APP}/ai`);
  await expect(page.getByRole("heading", { name: "Meet Foli", level: 2 })).toBeVisible({ timeout: 30_000 });
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
  await expect(page.getByRole("heading", { name: "Meet Foli", level: 2 })).toHaveCount(0);

  // On again: Foli introduces itself.
  await page.goto(`${APP}/settings/ai`);
  await page.getByRole("switch", { name: "Foli" }).click();
  await expect(page.getByText("Foli turned on")).toBeVisible();
  await page.goto(`${APP}/ai`);
  await expect(page.getByRole("heading", { name: "Meet Foli", level: 2 })).toBeVisible({ timeout: 30_000 });
  await context.close();
});
