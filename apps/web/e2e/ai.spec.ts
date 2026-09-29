import { expect, test } from "@playwright/test";
import { newPerson } from "./helpers";

// These call Google Gemini for real (the backend's GEMINI_API_KEY), so they only run when asked:
//   E2E_AI=1 pnpm exec playwright test e2e/ai.spec.ts
test.skip(!process.env.E2E_AI, "Set E2E_AI=1 to run the AI tests (they call Gemini).");
test.describe.configure({ timeout: 120_000 });

test("Ask AI answers from your notes, with sources", async ({ browser }) => {
  const { page } = await newPerson(browser, "Ask Tester");
  await page.keyboard.press("Meta+j");
  const dialog = page.getByRole("dialog", { name: "Ask AI" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: /Ask a question/ }).fill("When is the coastal weekend trip and how do we get there?");
  await page.keyboard.press("Enter");
  // An answer, citing the trip note as a source.
  const source = dialog.getByRole("button", { name: /Trip Sketch: Coastal Weekend/ });
  await expect(source).toBeVisible({ timeout: 60_000 });
  await expect(dialog.locator(".fb-ai-answer")).toContainText(/ferry/i);
  await source.click();
  await expect(page).toHaveURL(/\/d\//);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Trip Sketch: Coastal Weekend");
});

test("rewrite a selection and write from a prompt in a note", async ({ browser }) => {
  const { page } = await newPerson(browser, "Writer Tester");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.getByRole("textbox", { name: "Title" }).fill("AI test");
  await page.keyboard.press("Enter");
  await page.keyboard.type("i has went to the market yesterday and buyed three apple");
  const body = page.getByRole("textbox", { name: "Document body" });
  await body.locator("p.fb-paragraph").first().click({ clickCount: 3 });
  // Selection → toolbar → Ask AI: the inline composer, on the selected text.
  const toolbar = page.getByRole("toolbar", { name: "Text formatting" });
  await toolbar.getByRole("button", { name: /^Ask AI/ }).click();
  const ai = page.getByRole("dialog", { name: "AI Assistant" });
  await expect(ai.getByRole("combobox", { name: "Ask AI to write or edit" })).toBeFocused();
  await ai.getByRole("option", { name: "Fix spelling & grammar" }).click();
  await expect(ai.getByRole("button", { name: "Replace" })).toBeVisible({ timeout: 60_000 });
  await ai.getByRole("button", { name: "Replace" }).click();
  await expect(ai).toHaveCount(0);
  await expect(body.locator("p.fb-paragraph").first()).toContainText(/went to the market yesterday and bought three apples/i);

  // ⌘J at the cursor, type an instruction: a to-do list goes in as real to-do blocks.
  await body.locator("p.fb-paragraph").first().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Meta+j");
  await expect(ai.getByRole("combobox", { name: "Ask AI to write or edit" })).toBeFocused();
  await page.keyboard.type("A to-do list with exactly three items for a picnic, as Markdown '- [ ]' to-dos, nothing else");
  await page.keyboard.press("Enter");
  await expect(ai.getByRole("button", { name: "Insert" })).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press("Enter"); // ⏎ accepts
  await expect(body.locator(".fb-todo")).toHaveCount(3);

  // "/" AI command runs right away; a quick refinement revises the result; Discard leaves the note alone.
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter"); // an empty to-do turns back into a paragraph
  await page.keyboard.type("/summarize");
  await page.getByRole("option", { name: /AI · Summarize note/ }).click();
  await expect(ai.getByRole("button", { name: "Insert" })).toBeVisible({ timeout: 60_000 });
  await ai.getByRole("button", { name: "Shorter" }).click();
  await expect(ai.getByText("Shorter", { exact: true }).first()).toBeVisible();
  await expect(ai.getByRole("button", { name: "Insert" })).toBeVisible({ timeout: 60_000 });
  await ai.getByRole("button", { name: "Discard" }).click();
  await expect(ai).toHaveCount(0);
  await expect(body.locator(".fb-todo")).toHaveCount(3);
});

test("AI text streams in word by word, and Stop keeps what's written so far", async ({ browser }) => {
  const { page } = await newPerson(browser, "Stream Tester");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.getByRole("textbox", { name: "Title" }).fill("Streaming");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Meta+j");
  const ai = page.getByRole("dialog", { name: "AI Assistant" });
  await page.keyboard.type("Write six detailed paragraphs about the history of lighthouses");
  await page.keyboard.press("Enter");
  // Partial text appears (with its caret) before the reply is finished…
  const live = ai.locator(".fb-ai-streaming");
  await expect(live).toContainText(/\w+ \w+ \w+/, { timeout: 60_000 });
  const early = (await live.textContent())!.length;
  await expect.poll(async () => ((await live.textContent()) ?? "").length, { timeout: 30_000 }).toBeGreaterThan(early);
  // …and Stop keeps what was written.
  await ai.getByRole("button", { name: "Stop" }).click();
  await expect(ai.getByRole("button", { name: "Insert" })).toBeVisible({ timeout: 30_000 });
  const kept = (await ai.locator(".fb-ai-answer").first().textContent())!.length;
  expect(kept).toBeGreaterThan(20);
  expect(kept).toBeLessThan(6000);
});

test("Catch me up on Home, and Ask AI about one folder", async ({ browser }) => {
  const { page } = await newPerson(browser, "Brief Tester");
  await page.goto("/documents");
  await page.getByRole("button", { name: "Catch me up" }).click();
  const brief = page.getByRole("region", { name: "Catch-up brief" });
  await expect(brief.getByRole("heading", { name: "Your week" })).toBeVisible();
  await expect(brief.locator(".fb-ai-answer")).toContainText(/\w{4,}/, { timeout: 60_000 });

  const nav = page.getByRole("navigation", { name: "Folio" });
  await nav.getByRole("link", { name: "Projects" }).hover();
  await nav.getByRole("button", { name: "Folder options for Projects" }).click();
  await page.getByRole("menuitem", { name: "Ask AI about this folder…" }).click();
  const dialog = page.getByRole("dialog", { name: "Ask AI" });
  await expect(dialog.getByText("In folder")).toBeVisible();
  await dialog.getByRole("button", { name: "Summarize this folder" }).click();
  await expect(dialog.getByRole("button", { name: /Project Atlas Brief/ })).toBeVisible({ timeout: 60_000 });
});
