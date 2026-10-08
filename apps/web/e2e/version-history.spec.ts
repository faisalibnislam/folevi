import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { newPerson, waitForSaved } from "./helpers";

async function openHistory(page: Page) {
  await page.getByRole("button", { name: "Document actions" }).click();
  await page.getByRole("menuitem", { name: "Version history…" }).click();
  const history = page.getByRole("dialog", { name: "Version history" });
  await expect(history).toBeVisible();
  return history;
}

test("version history: name a version, see what changed and who changed it, restore it and undo; show editors", async ({ browser }) => {
  test.setTimeout(150_000);
  const { context, page } = await newPerson(browser, "History Keeper");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  const titleField = page.getByRole("textbox", { name: "Title" });
  await expect(titleField).toBeFocused();
  await titleField.fill("Field notes");
  await page.keyboard.press("Enter");
  await page.keyboard.type("The quick brown fox jumps over the lazy dog.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("A line that will go.");
  await waitForSaved(page);

  // Name the page as it is now.
  let history = await openHistory(page);
  await history.getByRole("button", { name: "Options for Current version" }).click();
  await page.getByRole("menuitem", { name: "Name current version" }).click();
  await history.getByRole("textbox", { name: "Version name" }).fill("First draft");
  await page.keyboard.press("Enter");
  await expect(history.getByRole("button", { name: /^First draft/ })).toBeVisible();
  await history.getByRole("button", { name: "Named", exact: true }).click();
  await expect(history.locator("button[aria-current], button[id^=version-]")).toHaveCount(1);
  await history.getByRole("button", { name: "All", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(history).toHaveCount(0);

  // Change a word and remove a line.
  const body = page.getByRole("textbox", { name: "Document body" });
  // (A triple click selects the line on every platform; Shift+Home doesn't.)
  await body.getByText("A line that will go.").click({ clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await expect(body).not.toContainText("A line that will go.");
  await body.getByText(/quick brown/).dblclick({ position: { x: 40, y: 8 } });
  await page.keyboard.type("slow");
  await expect(body).toContainText("The slow brown fox");
  await waitForSaved(page);

  // The current version shows what changed since "First draft", in the editor's colour.
  history = await openHistory(page);
  const preview = history.locator(".fb-editor");
  await expect(preview.locator("ins.fb-diff-added")).toHaveText("slow");
  await expect(preview.locator("del.fb-diff-removed")).toHaveText("quick");
  await expect(preview.locator('[data-change="removed"]')).toHaveText("A line that will go.");
  await expect(history.getByLabel("Changes in this version by")).toContainText("History Keeper");
  // No serious accessibility problems in the history view.
  const scan = await new AxeBuilder({ page }).include('dialog[aria-label="Version history"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(scan.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
  // Changes can be hidden.
  await history.getByRole("switch", { name: "Show changes" }).click();
  await expect(preview.locator("[data-change]")).toHaveCount(0);
  await history.getByRole("switch", { name: "Show changes" }).click();

  // Restore "First draft", then undo it from the message.
  await history.getByRole("button", { name: /^First draft/ }).click();
  await expect(history.getByRole("heading", { name: "First draft" })).toBeVisible();
  await history.getByRole("button", { name: "Restore this version" }).click();
  await page.getByRole("dialog", { name: "Restore this version?" }).getByRole("button", { name: "Restore", exact: true }).click();
  await expect(history).toHaveCount(0);
  await expect(body).toContainText("The quick brown fox");
  await expect(body).toContainText("A line that will go.");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(body).toContainText("The slow brown fox");
  await expect(body).not.toContainText("A line that will go.");

  // Show editors: each line marked with who last edited it.
  await page.getByRole("button", { name: "Document actions" }).click();
  await page.getByRole("menuitem", { name: "Show editors" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Each line shows who last edited it." })).toContainText("History Keeper");
  await expect(body.locator(".fb-authored").first()).toHaveAttribute("data-author", /History Keeper/);
  await page.getByRole("button", { name: "Hide editors" }).click();
  await expect(body.locator(".fb-authored")).toHaveCount(0);
  await context.close();
});
