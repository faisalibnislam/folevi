import { expect, test } from "@playwright/test";
import { APP, newPerson } from "./helpers";

// The writing assistant (docs/AI_ASSISTANT.md milestone 4) without calling Gemini: every selection action and
// tone is offered, the "/" AI commands open the composer in the right mode, and Templates can generate one.
// Without a model key on the server (CI, local dev) a request is refused with "isn't set up", and the note is
// left exactly as it was. With E2E_AI=1, ai.spec.ts covers real results (Replace, Insert, refinements).

test("selection actions, tones and turn-into are offered, and a refused request changes nothing", async ({ browser }) => {
  test.setTimeout(120_000);
  const { page, context } = await newPerson(browser, "Writing Tester");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.getByRole("textbox", { name: "Title" }).fill("Writing");
  await page.keyboard.press("Enter");
  await page.keyboard.type("We should maybe think about shipping the new plan next week");
  const body = page.getByRole("textbox", { name: "Document body" });
  await body.locator("p.fb-paragraph").first().click({ clickCount: 3 });
  await page.getByRole("toolbar", { name: "Text formatting" }).getByRole("button", { name: /^Ask Foli/ }).click();

  const ai = page.getByRole("dialog", { name: "Foli" });
  const box = ai.getByRole("combobox", { name: "Ask Foli to write or edit" });
  await expect(box).toBeFocused();
  const list = ai.getByRole("listbox", { name: "AI suggestions" });
  for (const name of ["Improve writing", "Fix spelling & grammar", "Make shorter", "Make longer", "Simplify language", "Change tone…", "Translate to…", "Turn into a list", "Turn into a table", "Turn into a checklist", "Summarize", "Explain", "Continue writing", "Extract action items"]) {
    await expect(list.getByRole("option", { name, exact: true })).toBeVisible();
  }
  // Tones are a list of their own; Escape goes back.
  await list.getByRole("option", { name: "Change tone…" }).click();
  const tones = ai.getByRole("listbox", { name: "Tones" });
  for (const name of ["Professional", "Casual", "Friendly", "Confident", "Direct", "Academic"]) await expect(tones.getByRole("option", { name, exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(ai.getByRole("listbox", { name: "AI suggestions" })).toBeVisible();
  // A custom instruction is offered first as you type.
  await box.fill("make it sound decisive");
  await expect(ai.getByRole("option", { name: "Edit: make it sound decisive" })).toBeVisible();
  await box.fill("");
  // Keyboard: arrow down to "Fix spelling & grammar" and run it. Refused (no key), and the note is untouched.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(ai.getByRole("alert")).toContainText(/isn.t set up/i, { timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(ai).toHaveCount(0);
  await expect(body.locator("p.fb-paragraph").first()).toHaveText("We should maybe think about shipping the new plan next week");
  await context.close();
});

test("the slash menu's AI commands open the composer ready to write", async ({ browser }) => {
  test.setTimeout(120_000);
  const { page, context } = await newPerson(browser, "Slash Writer");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.keyboard.press("Enter");
  await page.keyboard.type("/ai");
  for (const name of ["Foli: Continue writing", "Foli: Summarize page", "Foli: Action items", "Foli: Outline", "Foli: Brainstorm", "Foli: Draft from prompt", "Foli: Generate page"]) {
    await expect(page.getByRole("option", { name })).toBeVisible();
  }
  await page.getByRole("option", { name: "Foli: Generate page" }).click();
  const ai = page.getByRole("dialog", { name: "Foli" });
  const describe = ai.getByRole("combobox", { name: "Describe the page" });
  await expect(describe).toBeFocused();
  await page.keyboard.type("A packing list for a weekend hike");
  await expect(ai.getByRole("option", { name: "Write a page: A packing list for a weekend hike" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(ai.getByRole("alert")).toContainText(/isn.t set up/i, { timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(ai).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Document body" })).toBeFocused();

  // "Draft from prompt" opens on an empty prompt (nothing runs until you say what to write).
  await page.keyboard.type("/draft");
  await page.getByRole("option", { name: "Foli: Draft from prompt" }).click();
  await expect(ai.getByRole("combobox", { name: "Ask Foli to write or edit" })).toBeFocused();
  await expect(ai.getByRole("combobox", { name: "Ask Foli to write or edit" })).toHaveAttribute("placeholder", "Describe what to write…");
  await page.keyboard.press("Escape");
  await context.close();
});

test("Templates: generate a template with AI (refused without a model key, nothing saved)", async ({ browser }) => {
  test.setTimeout(120_000);
  const { page, context } = await newPerson(browser, "Template Maker");
  await page.goto(`${APP}/templates`);
  await page.getByRole("button", { name: "Generate with AI" }).click();
  const dialog = page.getByRole("dialog", { name: "Generate a template" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Weekly team meeting" }).click();
  await expect(dialog.getByRole("textbox", { name: "What's the template for?" })).toHaveValue("Weekly team meeting");
  await dialog.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(/isn.t set up/i, { timeout: 30_000 });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await context.close();
});
