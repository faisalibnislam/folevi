import { expect, test } from "@playwright/test";
import { APP, newPerson, pick, showFolders, waitForSaved } from "./helpers";

// Reviews (spaced repetition, convex/study.ts): a toggle turned into a flashcard from its block menu shows up
// in Reviews (the sidebar and Home say so); Space shows the answer, a key rates it, and it's scheduled away.

const mod = process.platform === "darwin" ? "Meta" : "Control";

test("a toggle made a flashcard is reviewed: Space shows the answer, 3 rates it Good", async ({ browser }) => {
  test.setTimeout(120_000);
  const { page, context } = await newPerson(browser, "Card Reviewer");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  const noteUrl = page.url().split("?")[0]!;
  await page.getByRole("textbox", { name: "Title" }).fill("Cells");
  await page.keyboard.press("Enter");
  const body = page.getByRole("textbox", { name: "Document body" });

  // A toggle with the question, and the answer inside it.
  await page.keyboard.type("/toggle");
  await page.getByRole("option", { name: "Toggle", exact: true }).click();
  await page.keyboard.type("What do cells divide by?");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Mitosis");
  const answer = body.locator(".fb-paragraph", { hasText: "Mitosis" });
  if ((await answer.getAttribute("data-depth")) !== "1") await page.keyboard.press("Tab");
  await expect(answer).toHaveAttribute("data-depth", "1");

  // The toggle's block menu turns it into a flashcard.
  const toggle = body.locator(".fb-toggle", { hasText: "What do cells divide by?" });
  await toggle.click();
  await page.keyboard.press(`${mod}+.`);
  const menu = page.getByRole("menu", { name: "Block options" });
  await menu.getByRole("menuitem", { name: "Use as flashcard" }).click();
  await expect(toggle).toHaveAttribute("data-study", "card");
  await waitForSaved(page);

  // The note's menu offers its cards; Reviews appears in the sidebar with one card waiting.
  await page.getByRole("button", { name: "Document actions" }).first().click();
  await expect(page.getByRole("menuitem", { name: "Review 1 card in this note" })).toBeVisible();
  await page.keyboard.press("Escape");
  await showFolders(page);
  const nav = page.getByRole("navigation", { name: "Folio" });
  const reviews = nav.getByRole("link", { name: /^Reviews/ });
  await expect(reviews).toContainText("1", { timeout: 20_000 });
  await reviews.click();
  await page.waitForURL(/\/review$/);

  const region = page.getByRole("region", { name: "Review cards" });
  await expect(region.getByText("What do cells divide by?")).toBeVisible();
  await expect(region.getByText("Mitosis")).toHaveCount(0);
  await expect(region.getByText("Card 1 of 1")).toBeVisible();
  await page.keyboard.press("Space");
  await expect(region.getByText("Mitosis")).toBeVisible();
  const ratings = region.getByRole("group", { name: "How well did you know it?" });
  for (const name of ["Again", "Hard", "Good", "Easy"]) await expect(ratings.getByRole("button", { name: new RegExp(`^${name}, back in \\d`) })).toBeVisible();
  await expect(ratings.getByRole("button", { name: /^Easy, back in \d+ days?/ })).toBeVisible();
  await page.keyboard.press("3");
  await expect(region.getByRole("heading", { name: "Done for now" })).toBeVisible();
  await expect(region.getByText(/You reviewed 1 card\. 1 card more later today\./)).toBeVisible();

  // Home shows today's reviews; the note's own review has nothing due now.
  await page.goto(new URL("/documents", noteUrl).toString());
  await expect(page.getByRole("region", { name: "Today’s reviews" })).toContainText("All caught up.");
  await page.goto(noteUrl);
  await page.getByRole("button", { name: "Document actions" }).first().click();
  await page.getByRole("menuitem", { name: "Review this note’s cards" }).click();
  await page.waitForURL(/\/review\?note=/);
  await expect(region.getByRole("heading", { name: "Nothing to review" })).toBeVisible();
  await expect(region.getByRole("link", { name: "Cells" })).toBeVisible();
  await context.close();
});

test("new cards a day: picked in the Reviews header, kept for the person", async ({ browser }) => {
  const { page, context } = await newPerson(browser, "Card Pacer");
  await page.goto(`${APP}/review`);
  const perDay = page.getByRole("combobox", { name: "New cards a day" });
  await expect(perDay).toHaveText(/20 new cards a day/);
  await pick(perDay, "50 new cards a day");
  await expect(perDay).toHaveText(/50 new cards a day/);
  // Saved on the account, not the page: still there after a reload.
  await page.reload();
  await expect(page.getByRole("combobox", { name: "New cards a day" })).toHaveText(/50 new cards a day/);
  await pick(page.getByRole("combobox", { name: "New cards a day" }), "No new cards");
  await expect(page.getByRole("combobox", { name: "New cards a day" })).toHaveText(/No new cards/);
  await context.close();
});
