import { expect, test } from "@playwright/test";
import { newPerson } from "./helpers";

// "Find to-dos" (docs/AI_ASSISTANT.md, notes that schedule themselves) without calling Gemini: the "/" menu,
// the composer and the AI panel open the proposal, and without a model key on the server (CI, local dev)
// the request is refused with "isn't set up", nothing is added, and the note is left as it was. Dates and
// owners are covered by unit tests (test/action-items.test.ts, tests/convex/ai-todos.test.ts).

test("Find to-dos opens from the slash menu and the composer; a refused request adds nothing", async ({ browser }) => {
  test.setTimeout(120_000);
  const { page, context } = await newPerson(browser, "Todo Finder");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.getByRole("textbox", { name: "Title" }).fill("Weekly sync");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Sam to send the deck by Friday.");
  await page.keyboard.press("Enter");
  const body = page.getByRole("textbox", { name: "Document body" });

  // The "/" menu.
  await page.keyboard.type("/find to-dos");
  await page.getByRole("option", { name: "Foli AI: Find to-dos" }).click();
  const dialog = page.getByRole("dialog", { name: "Find to-dos" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText(/isn.t set up/i, { timeout: 30_000 });
  await expect(dialog.getByRole("button", { name: "Add 0 to-dos" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(body.locator(".fb-todo")).toHaveCount(0);

  // The composer on a selection offers it with the other things to do with the text.
  await body.locator("p.fb-paragraph").first().click({ clickCount: 3 });
  await page.getByRole("toolbar", { name: "Text formatting" }).getByRole("button", { name: /^Ask Foli AI/ }).click();
  const ai = page.getByRole("dialog", { name: "Foli AI" });
  await ai.getByRole("listbox", { name: "AI suggestions" }).getByRole("option", { name: "Find to-dos in the selection" }).click();
  await expect(ai).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("in the selected text");
  await expect(dialog.getByRole("alert")).toContainText(/isn.t set up/i, { timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(body.locator("p.fb-paragraph").first()).toHaveText("Sam to send the deck by Friday.");
  await context.close();
});
