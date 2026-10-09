import { expect, test, type Page } from "@playwright/test";
import { APP, newPerson, pick, waitForSaved } from "./helpers";

// Memory, suggestions and digests on the dev backend (no model key needed, a trial account): Settings > AI
// adds, edits and deletes what the assistant remembers; a note shows an action item it found as a quiet
// chip that can be dismissed for good; and the digest's schedule saves.

async function newPage(page: Page, title: string) {
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  const t = page.getByRole("textbox", { name: "Title" });
  await expect(t).toBeFocused();
  await t.fill(title);
  await page.keyboard.press("Enter");
}

test("memory in Settings > AI: add, edit and delete", async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page } = await newPerson(browser, "Memory Person");
  await page.goto(`${APP}/settings/ai`);
  const card = page.getByRole("region", { name: "Memory", exact: true });
  await expect(card.getByText("Nothing yet.")).toBeVisible();

  await pick(card.getByRole("combobox", { name: "Kind" }), "Language");
  await card.getByRole("textbox", { name: "What to remember" }).fill("Use British spelling");
  await card.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Remembered")).toBeVisible();
  const list = card.getByRole("list", { name: "What the assistant remembers" });
  await expect(list.getByRole("listitem")).toHaveText(["LanguageUse British spelling"]);

  await list.getByRole("button", { name: 'Edit "Use British spelling"' }).click();
  await list.getByRole("textbox", { name: "What to remember" }).fill("Use Canadian spelling");
  await list.getByRole("button", { name: "Save" }).click();
  await expect(list.getByRole("listitem")).toHaveText(["LanguageUse Canadian spelling"]);

  // Kept across a reload, then deleted.
  await page.reload();
  await expect(list.getByRole("listitem")).toHaveText(["LanguageUse Canadian spelling"], { timeout: 30_000 });
  await list.getByRole("button", { name: 'Delete "Use Canadian spelling"' }).click();
  await expect(card.getByText("Nothing yet.")).toBeVisible();

  // Memory off: the card says so.
  await page.getByRole("switch", { name: "Memory" }).click();
  await expect(card.getByText(/Memory is off/)).toBeVisible();
  await expect(card.getByRole("textbox", { name: "What to remember" })).toHaveCount(0);
  await context.close();
});

test("an action item in a note shows as a quiet chip, and stays dismissed", async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page } = await newPerson(browser, "Suggestion Person");
  await page.goto(`${APP}/documents`);
  await newPage(page, "Launch meeting");
  await page.keyboard.type("TODO: send the deck to Sam");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Who owns the launch checklist?");
  await waitForSaved(page);

  const chips = page.getByRole("region", { name: "Suggestions", exact: true });
  const action = chips.getByRole("listitem", { name: "Action item: send the deck to Sam" });
  await expect(action).toBeVisible({ timeout: 20_000 });
  await expect(chips.getByRole("listitem", { name: "Open question: Who owns the launch checklist?" })).toBeVisible();

  await action.getByRole("button", { name: "Dismiss" }).click();
  await expect(action).toHaveCount(0);
  // The chip hides at once; give the dismissal a moment to reach the server before reloading.
  await page.waitForTimeout(1_500);
  await page.reload();
  await expect(chips.getByRole("listitem", { name: "Open question: Who owns the launch checklist?" })).toBeVisible({ timeout: 20_000 });
  await expect(chips.getByRole("listitem", { name: "Action item: send the deck to Sam" })).toHaveCount(0);

  // Suggestions off: none show.
  await page.goto(`${APP}/settings/ai`);
  await page.getByRole("switch", { name: "Suggestions" }).click();
  await expect(page.getByText("Suggestions turned off")).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Launch meeting");
  await expect(page.getByRole("region", { name: "Suggestions", exact: true })).toHaveCount(0);
  await context.close();
});

test("digest settings save", async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page } = await newPerson(browser, "Digest Person");
  await page.goto(`${APP}/settings/ai`);
  // Off by default: no schedule shown.
  await expect(page.getByRole("region", { name: "Digest", exact: true })).toHaveCount(0);
  await page.getByRole("switch", { name: "Digests" }).click();
  await expect(page.getByText("Digests turned on")).toBeVisible();
  const card = page.getByRole("region", { name: "Digest", exact: true });
  await expect(card.getByText(/^Next one: /)).toBeVisible();

  await pick(card.getByRole("combobox", { name: "How often" }), "Every week");
  await expect(card.getByRole("combobox", { name: "Day" })).toBeVisible();
  await pick(card.getByRole("combobox", { name: "Day" }), "Friday");
  await expect(card.getByText(/^Next one: Friday/)).toBeVisible();

  await page.reload();
  await expect(card.getByRole("combobox", { name: "How often" })).toHaveText(/Every week/);
  await expect(card.getByRole("combobox", { name: "Day" })).toHaveText(/Friday/);

  // Off again: the schedule goes away.
  await page.getByRole("switch", { name: "Digests" }).click();
  await expect(page.getByText("Digests turned off")).toBeVisible();
  await expect(card).toHaveCount(0);
  await context.close();
});
