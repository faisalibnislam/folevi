import { expect, test } from "@playwright/test";
import { newPerson } from "./helpers";

// Milestone 8's study, meeting, translation and framework tools (docs/AI_ASSISTANT.md) without calling
// Gemini: the new actions are offered in the "/" menu, the inline composer and the note's AI panel, and
// without a model key on the server (CI, local dev) each is refused with "isn't set up" and the note is left
// exactly as it was. Study mode shows its empty state when the note has no flashcards or quiz yet.

const TEXT = "We chose the harbour hall. Sam sends the deck by Friday.";

test("the new actions in the '/' menu and the composer are refused without a model key, and the note is untouched", async ({ browser }) => {
  test.setTimeout(120_000);
  const { page, context } = await newPerson(browser, "Study Tester");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.getByRole("textbox", { name: "Title" }).fill("Weekly sync");
  await page.keyboard.press("Enter");
  await page.keyboard.type(TEXT);
  const body = page.getByRole("textbox", { name: "Document body" });
  const first = body.locator("p.fb-paragraph").first();
  await expect(first).toHaveText(TEXT);

  // "/" menu: every tool, on the whole note.
  await page.keyboard.press("Enter");
  await page.keyboard.type("/ai");
  for (const name of ["AI: Meeting summary", "AI: Flashcards", "AI: Quiz", "AI: Pros and cons", "AI: Decision matrix", "AI: SWOT analysis", "AI: Risks and mitigations", "AI: Pre-mortem", "AI: Mind map", "AI: How might we", "AI: SCAMPER", "AI: Six thinking hats"]) {
    await expect(page.getByRole("option", { name, exact: true })).toBeVisible();
  }
  await page.getByRole("option", { name: "AI: Meeting summary", exact: true }).click();
  const ai = page.getByRole("dialog", { name: "AI Assistant" });
  await expect(ai.getByRole("alert")).toContainText(/isn.t set up/i, { timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(ai).toHaveCount(0);
  await expect(body).toBeFocused();
  await expect(first).toHaveText(TEXT);

  // "Think it through" from the slash menu by keyword.
  await page.keyboard.type("/swot");
  await page.getByRole("option", { name: "AI: SWOT analysis", exact: true }).click();
  await expect(ai.getByRole("alert")).toContainText(/isn.t set up/i, { timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(ai).toHaveCount(0);
  await expect(body).toBeFocused();

  // The composer on a selection: meeting and study tools, then the frameworks.
  await first.click({ clickCount: 3 });
  await page.getByRole("toolbar", { name: "Text formatting" }).getByRole("button", { name: /^Ask AI/ }).click();
  const list = ai.getByRole("listbox", { name: "AI suggestions" });
  for (const name of ["Meeting summary", "Flashcards", "Quiz", "Pros and cons", "Decision matrix", "SWOT analysis", "Risks and mitigations", "Pre-mortem", "Mind map", "How might we", "SCAMPER", "Six thinking hats"]) {
    await expect(list.getByRole("option", { name, exact: true })).toBeVisible();
  }
  await list.getByRole("option", { name: "Flashcards", exact: true }).click();
  await expect(ai.getByRole("alert")).toContainText(/isn.t set up/i, { timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(ai).toHaveCount(0);
  await expect(first).toHaveText(TEXT);
  await context.close();
});

test("the AI panel: study mode's empty state, the frameworks and translation, all refused without a model key", async ({ browser }) => {
  test.setTimeout(120_000);
  const { page, context } = await newPerson(browser, "Panel Studier");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.getByRole("textbox", { name: "Title" }).fill("Cells");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Cells divide by mitosis.");
  const body = page.getByRole("textbox", { name: "Document body" });
  const first = body.locator("p.fb-paragraph").first();

  await page.getByRole("toolbar", { name: "Page tools" }).getByRole("button", { name: "AI" }).click();
  const modes = page.getByRole("group", { name: "What the AI should do" });
  await modes.getByRole("button", { name: "Study", exact: true }).click();
  const studyArea = page.getByRole("region", { name: "Study", exact: true });
  await expect(studyArea.getByText("Nothing to study yet")).toBeVisible();
  await expect(studyArea.getByRole("button", { name: "Make a quiz" })).toBeVisible();
  // Making flashcards goes through the preview in Write, and is refused here.
  await studyArea.getByRole("button", { name: "Make flashcards" }).click();
  await expect(modes.getByRole("button", { name: "Write", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("alert").filter({ hasText: /isn.t set up/i })).toBeVisible({ timeout: 30_000 });

  // The frameworks and the meeting summary.
  for (const name of ["Pros and cons", "Decision matrix", "SWOT analysis", "Risks and mitigations", "Pre-mortem", "Mind map", "How might we", "SCAMPER", "Six thinking hats"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "Meeting summary", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: /isn.t set up/i })).toBeVisible({ timeout: 30_000 });

  // Translate the whole note, in place: refused before anything changes.
  const translate = page.getByRole("region", { name: "Translate this note" });
  await translate.getByRole("group", { name: "Where the translation goes" }).getByRole("button", { name: "Replace text" }).click();
  await translate.getByRole("button", { name: "Translate", exact: true }).click();
  await expect(translate.getByRole("alert")).toContainText(/isn.t set up/i, { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Replace note text" })).toHaveCount(0);
  await expect(first).toHaveText("Cells divide by mitosis.");
  await context.close();
});
