// Moving notes between two accounts in one browser, and a Takeout round trip (docs/MULTI_ACCOUNT_PLAN.md §7, §8),
// against the dev deployment: a note moved from its own menu into the other account (the original goes to Trash
// here), then a takeout file downloaded from one account and imported into the other.
//
//   E2E_BASE_URL=http://app.localhost:3002 E2E_NO_SERVER=1 npx playwright test e2e/places-move.spec.ts --project account
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { APP, completeOnboarding, confirmEmail, PASSWORD, showFolders, switcher, uniqueEmail, waitForSaved } from "./helpers";

async function openSwitcher(page: Page) {
  await showFolders(page);
  await switcher(page).click();
  return page.getByRole("menu");
}

async function newAccountHere(page: Page, who: { email: string; name: string }, adding: boolean) {
  if (adding) {
    const menu = await openSwitcher(page);
    await menu.getByRole("menuitem", { name: "Sign in to another account" }).click();
    await page.waitForURL(/\/signin\?add=1/);
    await page.getByRole("link", { name: "Create an account" }).click();
    await page.waitForURL(/\/signup\?add=1/);
  } else {
    await page.goto(`${APP}/signup`);
  }
  await page.getByLabel("Your name").fill(who.name);
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible({ timeout: 20_000 });
  await confirmEmail(page, who.email);
  await completeOnboarding(page);
}

async function makeNote(page: Page, title: string, body: string) {
  await page.goto(`${APP}/documents`);
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.keyboard.press("Enter");
  await page.keyboard.type(body);
  await waitForSaved(page);
}

test("move a note to the other account from its menu, then a takeout from one account into the other", async ({ browser }) => {
  test.setTimeout(300_000);
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const ana = { email: uniqueEmail("move-ana"), name: "Ana Mover" };
  const ben = { email: uniqueEmail("move-ben"), name: "Ben Mover" };
  await newAccountHere(page, ana, false);
  await newAccountHere(page, ben, true);

  // Ben moves a note into Ana's Personal from the note's own menu.
  await makeNote(page, "Ferry times", "The 7:40 from the harbour.");
  await page.getByRole("button", { name: "Document actions" }).click();
  await page.getByRole("menuitem", { name: "Move to another place…" }).click();
  const dialog = page.getByRole("dialog", { name: "Move or copy notes" });
  await expect(dialog.getByRole("combobox", { name: "To" })).toHaveText(new RegExp(`${ana.name}: Personal`));
  await expect(dialog.getByRole("combobox", { name: "What" })).toHaveText(/Folders and notes I pick/);
  await expect(dialog.getByRole("checkbox", { name: "Ferry times" })).toHaveAttribute("aria-checked", "true", { timeout: 20_000 });
  await dialog.getByRole("combobox", { name: "Copy or move" }).click();
  await page.getByRole("option", { name: "Move: they go to Trash here" }).click();
  await dialog.getByRole("button", { name: "Move notes" }).click();
  await expect(dialog.getByTestId("place-move-done")).toContainText("1 note moved to", { timeout: 60_000 });
  // The original is in Ben's Trash.
  await page.goto(`${APP}/trash`);
  await expect(page.getByText("Ferry times").first()).toBeVisible({ timeout: 20_000 });

  // Open Ana: the note is there, with its words.
  await page.goto(`${APP}/documents`);
  let menu = await openSwitcher(page);
  await menu.getByRole("menuitem", { name: ana.name }).click();
  await page.waitForURL(/\/documents/);
  await page.getByText("Ferry times").first().click({ timeout: 30_000 });
  await expect(page.getByText("The 7:40 from the harbour.")).toBeVisible({ timeout: 20_000 });

  // Ana downloads a takeout file.
  await makeNote(page, "Ana's packing list", "Boots, map, flask.");
  await page.goto(`${APP}/settings/data`);
  const downloading = page.waitForEvent("download", { timeout: 120_000 });
  await page.getByRole("button", { name: "Download a takeout file" }).click();
  const file = await (await downloading).path();
  await expect(page.getByRole("status").filter({ hasText: "It isn't encrypted" })).toBeVisible({ timeout: 60_000 });

  // Ben imports it: everything comes in a folder named after it.
  menu = await openSwitcher(page);
  await menu.getByRole("menuitem", { name: ben.name }).click();
  await page.waitForURL(/\/documents/);
  await page.goto(`${APP}/settings/data`);
  await page.locator('input[type="file"][accept^=".zip"]').setInputFiles({ name: "takeout.zip", mimeType: "application/zip", buffer: readFileSync(file) });
  await expect(page.getByRole("status").filter({ hasText: /came in, in the folder “Takeout from/ })).toBeVisible({ timeout: 120_000 });
  await page.goto(`${APP}/documents`);
  await showFolders(page);
  await expect(page.getByRole("navigation", { name: "Folio" }).getByText(`Takeout from ${ana.email}`, { exact: false })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("navigation", { name: "Folio" }).getByText(`Takeout from ${ana.email}`, { exact: false }).click();
  await expect(page.getByText("Ana's packing list").first()).toBeVisible({ timeout: 20_000 });
  await context.close();
});
