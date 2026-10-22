// Several accounts in one browser (docs/MULTI_ACCOUNT_PLAN.md §2.1, §3, §9), against the dev deployment: a second
// account signed in from the switcher, switching between them in one tab while another tab stays where it is,
// and signing out of one while the other stays signed in.
//
//   E2E_BASE_URL=http://app.localhost:3002 E2E_NO_SERVER=1 npx playwright test e2e/places-web.spec.ts --project account
import { expect, test, type Page } from "@playwright/test";
import { APP, completeOnboarding, confirmEmail, openShare, pick, PASSWORD, showFolders, switcher, uniqueEmail, waitForSaved } from "./helpers";

async function openSwitcher(page: Page) {
  await showFolders(page);
  await switcher(page).click();
  return page.getByRole("menu");
}

/** Makes a note with this title in the open place. */
async function makeNote(page: Page, title: string) {
  await page.goto(`${APP}/documents`);
  await page.getByRole("button", { name: "New note", exact: true }).click();
  const field = page.getByRole("textbox", { name: "Title" });
  await field.fill(title);
  await field.press("Enter");
  await waitForSaved(page);
}

async function placesInBrowser(page: Page): Promise<string[]> {
  return await page.evaluate(async () => {
    const r = await fetch("/api/places", { cache: "no-store" });
    const body = (await r.json()) as { accounts: { email: string }[] };
    return body.accounts.map((a) => a.email).sort();
  });
}

test("two accounts in one browser: add one, switch in one tab while another stays, sign out of one", async ({ browser }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext();
  const page = await context.newPage();
  const ana = { email: uniqueEmail("places-ana"), name: "Ana Places" };
  const ben = { email: uniqueEmail("places-ben"), name: "Ben Places" };

  // Ana signs up and opens Folevi.
  await page.goto(`${APP}/signup`);
  await page.getByLabel("Your name").fill(ana.name);
  await page.getByLabel("Email").fill(ana.email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible({ timeout: 20_000 });
  await confirmEmail(page, ana.email);
  await completeOnboarding(page);
  await makeNote(page, "Ana's own note");

  // "Sign in to another account" keeps Ana signed in and opens the sign-in page for one more.
  let menu = await openSwitcher(page);
  await expect(menu.getByRole("menuitem", { name: `Sign out of ${ana.name}` })).toBeVisible();
  await menu.getByRole("menuitem", { name: "Sign in to another account" }).click();
  await page.waitForURL(/\/signin\?add=1/);
  await expect(page.getByRole("heading", { name: "Add an account" })).toBeVisible();
  await page.getByRole("link", { name: "Create an account" }).click();
  await page.waitForURL(/\/signup\?add=1/);
  await page.getByLabel("Your name").fill(ben.name);
  await page.getByLabel("Email").fill(ben.email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible({ timeout: 20_000 });
  // Confirming signs Ben in, in this tab (it adopts whoever signs in next).
  await confirmEmail(page, ben.email);
  await completeOnboarding(page);
  await makeNote(page, "Ben's own note");
  expect(await placesInBrowser(page)).toEqual([ana.email, ben.email].sort());

  // Ben's switcher lists Ana as another place; Ana's note isn't in Ben's notes.
  await page.goto(`${APP}/documents`);
  await expect(page.getByText("Ben's own note").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Ana's own note")).toHaveCount(0);
  menu = await openSwitcher(page);
  await expect(menu.getByRole("menuitemradio", { name: "Personal", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(menu.getByRole("menuitem", { name: ana.name })).toBeVisible();

  // A second tab opens the place this browser used last (Ben).
  const second = await context.newPage();
  await second.goto(`${APP}/documents`);
  await expect(second.getByText("Ben's own note").first()).toBeVisible({ timeout: 30_000 });

  // The first tab switches to Ana, with no sign-in.
  await menu.getByRole("menuitem", { name: ana.name }).click();
  await page.waitForURL(/\/documents/);
  await expect(page.getByText("Ana's own note").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Ben's own note")).toHaveCount(0);

  // The second tab is still Ben's, after a reload too: switching in one tab never moves another.
  await second.reload();
  await expect(second.getByText("Ben's own note").first()).toBeVisible({ timeout: 30_000 });
  await expect(second.getByText("Ana's own note")).toHaveCount(0);
  await makeNote(second, "Ben again from tab two");
  await page.reload();
  await expect(page.getByText("Ana's own note").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Ben again from tab two")).toHaveCount(0);

  // Ben signs out in the second tab: that tab opens Ana, and Ana stays signed in everywhere.
  menu = await openSwitcher(second);
  await menu.getByRole("menuitem", { name: `Sign out of ${ben.name}` }).click();
  await second.waitForURL(/\/documents/);
  await expect(second.getByText("Ana's own note").first()).toBeVisible({ timeout: 30_000 });
  expect(await placesInBrowser(second)).toEqual([ana.email]);
  await page.reload();
  await expect(page.getByText("Ana's own note").first()).toBeVisible({ timeout: 30_000 });
  menu = await openSwitcher(page);
  await expect(menu.getByRole("menuitem", { name: ben.name })).toHaveCount(0);
  // Ben's copy on this device is gone.
  const left = await page.evaluate(async () => ((await indexedDB.databases?.()) ?? []).map((d) => d.name ?? ""));
  expect(left.filter((n) => n.startsWith("folevi-") && !n.startsWith("folevi-e2ee") && !n.startsWith("folevi-local")).length).toBe(1);
  await context.close();
});

/** Signs a new person up in this tab (with "Sign in to another account" first when `adding`). */
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

test("another account's notifications arrive in the open one, labelled, and Open switches to it", async ({ browser }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext();
  const page = await context.newPage();
  const ana = { email: uniqueEmail("bg-ana"), name: "Ana Background" };
  const ben = { email: uniqueEmail("bg-ben"), name: "Ben Background" };
  await newAccountHere(page, ben, false);
  await newAccountHere(page, ana, true);
  await makeNote(page, "Shared from Ana");

  // Ana's tab keeps Ben's account in sync behind it: one hidden runner.
  await expect(page.locator("iframe[data-place-sync]")).toHaveCount(1, { timeout: 20_000 });

  // Ana shares the note with Ben: Ben's notification shows here, in Ana's tab, saying it's Ben's.
  await openShare(page);
  const share = page.getByRole("dialog", { name: /Share/ });
  await share.getByLabel("Email address").fill(ben.email);
  await pick(share.getByLabel("Role"), "Can edit");
  await share.getByRole("button", { name: "Share", exact: true }).click();
  await expect(share.getByText(ben.name)).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press("Escape");
  const toast = page.getByRole("status").filter({ hasText: `In ${ben.name}:` });
  await expect(toast).toBeVisible({ timeout: 45_000 });
  // The switcher's row for Ben has the dot.
  const menu = await openSwitcher(page);
  await expect(menu.getByRole("menuitem", { name: ben.name })).toHaveAttribute("aria-description", /1 unread/);
  await page.keyboard.press("Escape");

  // Open switches this tab to Ben, on the note.
  await toast.getByRole("button", { name: "Open" }).click();
  await page.waitForURL(/\/d\//);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Shared from Ana", { timeout: 30_000 });
  await expect(switcher(page)).toBeVisible();
  const after = await openSwitcher(page);
  await expect(after.getByRole("menuitem", { name: ana.name })).toBeVisible();
  await context.close();
});
