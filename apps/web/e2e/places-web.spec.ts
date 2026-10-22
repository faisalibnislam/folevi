// Several accounts in one browser (docs/MULTI_ACCOUNT_PLAN.md §2.1, §3, §9), against the dev deployment: a second
// account signed in from the switcher, switching between them in one tab while another tab stays where it is,
// and signing out of one while the other stays signed in.
//
//   E2E_BASE_URL=http://app.localhost:3002 E2E_NO_SERVER=1 npx playwright test e2e/places-web.spec.ts --project account
import { expect, test, type Page } from "@playwright/test";
import { APP, completeOnboarding, confirmEmail, PASSWORD, showFolders, switcher, uniqueEmail, waitForSaved } from "./helpers";

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
