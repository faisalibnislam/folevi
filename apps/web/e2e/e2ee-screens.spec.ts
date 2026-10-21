import { mkdirSync } from "node:fs";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { APP, newPerson, settle, showFolders, signIn, type Account } from "./helpers";
import { stubState, type StubName } from "./e2ee-stub";

// The end-to-end encryption screens (docs/E2EE_DESIGN.md §10) on the stubs of WP6, WP7 and WP8
// (components/e2ee/__stubs__.ts). These pass before integration; the flows against the real keys and server
// are in the other e2ee-*.spec.ts files. With E2EE_SHOTS=<dir>, the last test saves a screenshot of each
// screen in light and dark, at desktop and phone width.

let storage: Awaited<ReturnType<BrowserContext["storageState"]>>;
let welcomePath = "/documents";
let account: Account;
/** A second signed-in session of the same account (Settings > Devices lists it). */
let second: BrowserContext | null = null;
async function secondSession(browser: Browser) {
  if (!second) {
    second = await browser.newContext();
    await signIn(second, account);
  }
}

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await second?.close();
});

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  const person = await newPerson(browser, "Privacy Person");
  const { context, page } = person;
  account = person.account;
  welcomePath = new URL(page.url()).pathname;
  storage = await context.storageState();
  await context.close();
});

async function open(browser: Browser, state: StubName | object, opts: { scheme?: "light" | "dark"; phone?: boolean } = {}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    storageState: storage,
    colorScheme: opts.scheme ?? "light",
    viewport: opts.phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    ...(opts.phone ? { hasTouch: true, isMobile: true } : {}),
  });
  await context.addInitScript((s) => localStorage.setItem("folevi:appearance", s), opts.scheme ?? "light");
  await stubState(context, state);
  return { context, page: await context.newPage() };
}

test("Standard: Settings > Privacy is the only new thing, and nothing else changes", async ({ browser }) => {
  const { context, page } = await open(browser, "none");
  await page.goto(`${APP}/settings/privacy`);
  await expect(page.getByRole("heading", { name: "Privacy", level: 2 })).toBeVisible({ timeout: 30_000 });
  const levels = page.getByRole("radiogroup", { name: "How private your notes are" });
  await expect(levels.getByRole("radio")).toHaveCount(3);
  await expect(levels.getByRole("radio", { name: /^Standard/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("You can also mark single folders or notes as Always fully encrypted from their menu.")).toBeVisible();
  // No switches and no ways to unlock before encryption is on.
  await expect(page.getByText("Features that need to read your notes")).toHaveCount(0);
  await expect(page.getByText("Ways to unlock")).toHaveCount(0);
  // The menus, devices and the sidebar carry nothing new.
  await page.goto(`${APP}/settings/devices`);
  await expect(page.getByText("Can unlock encrypted notes")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Sign out / }).first().or(page.getByText("This device"))).toBeVisible({ timeout: 30_000 });
  await page.goto(`${APP}/documents`);
  await expect(page.getByText(/Encrypting your notes/)).toHaveCount(0);
  await context.close();
});

test("What each choice means: the table and the things to know", async ({ browser }) => {
  const { context, page } = await open(browser, "none");
  await page.goto(`${APP}/settings/privacy`);
  await page.getByRole("button", { name: "What each choice means" }).click();
  const dialog = page.getByRole("dialog", { name: "What each choice means" });
  await expect(dialog.getByRole("table")).toBeVisible();
  await expect(dialog.getByRole("rowheader", { name: "Search on our servers" })).toBeVisible();
  await expect(dialog.getByText("What Folevi can always see")).toBeVisible();
  await expect(dialog.getByText(/Not even Folevi\./)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await context.close();
});

test("the setup wizard: two ways to unlock, the recovery key check, the passphrase, confirm, done", async ({ browser }) => {
  const { context, page } = await open(browser, "none");
  await page.goto(`${APP}/settings/privacy`);
  const levels = page.getByRole("radiogroup", { name: "How private your notes are" });
  await levels.getByRole("radio", { name: /^Encrypted, with the features you pick/ }).click();
  await page.getByRole("button", { name: "Turn on encryption" }).click();
  const wizard = page.getByRole("dialog", { name: "Turn on encryption" });
  await expect(wizard.getByText("Before you start")).toBeVisible();
  await wizard.getByRole("button", { name: "Continue" }).click();
  await expect(wizard.getByText("Pick at least two.", { exact: false })).toBeVisible();
  await expect(wizard.getByRole("status")).toHaveText("0 of 2 needed");
  await expect(wizard.getByRole("button", { name: "Continue" })).toBeDisabled();

  // Recovery key: shown once, then groups 3 and 7 typed back.
  await wizard.getByRole("button", { name: "Add Recovery key" }).click();
  const key = wizard.getByRole("list", { name: "Your recovery key" });
  await expect(key.getByRole("listitem")).toHaveCount(9);
  const groups = (await key.getByRole("listitem").allTextContents()).map((t) => t.replace(/^Group \d+: /, "").trim());
  await wizard.getByLabel("Group 3").fill("ZZZZ");
  await wizard.getByLabel("Group 7").fill(groups[6]!);
  await wizard.getByRole("button", { name: "Check and continue" }).click();
  await expect(wizard.getByRole("alert")).toHaveText("Those groups don't match. Check the key you saved and try again.");
  await wizard.getByLabel("Group 3").fill(groups[2]!);
  await wizard.getByRole("button", { name: "Check and continue" }).click();
  await expect(wizard.getByRole("status")).toHaveText("1 of 2 needed");

  // Passphrase: at least 12 characters, typed twice.
  await wizard.getByRole("button", { name: "Add Encryption passphrase" }).click();
  await wizard.getByLabel("Passphrase", { exact: true }).fill("short");
  await expect(wizard.getByText("Too short: use at least 12 characters")).toBeVisible();
  await wizard.getByLabel("Passphrase", { exact: true }).fill("lantern orchard velvet compass");
  await expect(wizard.getByText("Strong")).toBeVisible();
  await wizard.getByLabel("Type it again").fill("lantern orchard velvet compass");
  await wizard.getByRole("button", { name: "Save passphrase" }).click();
  await expect(wizard.getByRole("status")).toHaveText("2 of 2 needed");
  await wizard.getByRole("button", { name: "Continue" }).click();

  await expect(wizard.getByText("Encrypt my Personal space")).toBeVisible();
  await expect(wizard.getByText("Recovery key, Encryption passphrase")).toBeVisible();
  await wizard.getByRole("button", { name: "Turn on encryption" }).click();
  await expect(wizard.getByText("Encryption is on", { exact: true })).toBeVisible();
  await expect(wizard.getByRole("progressbar")).toBeVisible();
  await wizard.getByRole("button", { name: "Done" }).click();

  // Settings > Privacy now shows the switches, the ways to unlock and the progress.
  await expect(page.getByRole("radiogroup", { name: "How private your notes are" }).getByRole("radio", { name: /^Encrypted, with the features you pick/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("Features that need to read your notes")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ways to unlock" })).toBeVisible();
  await expect(page.getByText(/Encrypting your notes: 0 of 48/).first()).toBeVisible();
  await context.close();
});

test("the switches: Foli AI's choice and each switch, with what turning one off does", async ({ browser }) => {
  const { context, page } = await open(browser, "encrypted");
  await page.goto(`${APP}/settings/privacy`);
  const foli = page.getByRole("combobox", { name: "Foli AI" });
  await expect(foli).toHaveText(/Ask me each time/, { timeout: 30_000 });
  const search = page.getByRole("switch", { name: "Search everywhere" });
  await expect(search).toHaveAttribute("aria-checked", "false");
  await search.click();
  await expect(page.getByText("Search everywhere turned on")).toBeVisible();
  await search.click();
  await expect(page.getByText("Turned off. Folevi deleted the readable copy.")).toBeVisible();
  await expect(page.getByText("Folders and notes marked Always fully encrypted never use these features.")).toBeVisible();
  await context.close();
});

test("lowering: Standard needs a recovery method again; Fully encrypted only confirms", async ({ browser }) => {
  const { context, page } = await open(browser, "encrypted");
  await page.goto(`${APP}/settings/privacy`);
  const levels = page.getByRole("radiogroup", { name: "How private your notes are" });
  await levels.getByRole("radio", { name: /^Standard/ }).click();
  await page.getByRole("button", { name: "Change to Standard" }).click();
  const dialog = page.getByRole("dialog", { name: "Turn off encryption?" });
  await expect(dialog.getByRole("button", { name: "Turn off encryption" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Enter passphrase" }).click();
  await dialog.getByLabel("Encryption passphrase").fill("wrong passphrase");
  await dialog.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("That passphrase didn't unlock your notes. Check it and try again.");
  await dialog.getByLabel("Encryption passphrase").fill("lantern orchard velvet compass");
  await dialog.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(dialog.getByText("Confirmed")).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await levels.getByRole("radio", { name: /^Fully encrypted/ }).click();
  await page.getByRole("button", { name: "Change to Fully encrypted" }).click();
  const full = page.getByRole("dialog", { name: "Change to Fully encrypted?" });
  await expect(full.getByText("Folevi will delete the readable copies your features use.")).toBeVisible();
  await full.getByRole("button", { name: "Change" }).click();
  await expect(levels.getByRole("radio", { name: /^Fully encrypted/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("Features that need to read your notes")).toHaveCount(0);
  await context.close();
});

test("the unlock screen: wrong passphrase, then trust this browser", async ({ browser }) => {
  const { context, page } = await open(browser, "locked");
  await page.goto(`${APP}/documents`);
  await expect(page.getByRole("heading", { name: "Unlock your encrypted notes" })).toBeVisible({ timeout: 30_000 });
  for (const name of ["Approve from another device", "Use a passkey", "Enter passphrase", "Enter recovery key"]) await expect(page.getByRole("button", { name })).toBeVisible();
  await page.getByRole("button", { name: "Enter recovery key" }).click();
  await page.getByLabel("Recovery key").fill("1234");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(page.getByRole("region", { name: "Unlock your encrypted notes" }).getByRole("alert")).toHaveText(/36 letters and numbers/);
  await page.getByRole("button", { name: "Other ways to unlock" }).click();
  await page.getByRole("button", { name: "Enter passphrase" }).click();
  await page.getByLabel("Encryption passphrase").fill("wrong passphrase");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(page.getByRole("region", { name: "Unlock your encrypted notes" }).getByRole("alert")).toHaveText("That passphrase didn't unlock your notes. Check it and try again.");
  await page.getByLabel("Encryption passphrase").fill("lantern orchard velvet compass");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  const choice = page.getByRole("radiogroup", { name: "Your notes are unlocked" });
  await expect(choice.getByRole("radio", { name: /^Trust this browser/ })).toHaveAttribute("aria-checked", "true");
  await choice.getByRole("radio", { name: /^This is a public or shared computer/ }).click();
  await choice.getByRole("radio", { name: /^Trust this browser/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("navigation", { name: "Folio" })).toBeVisible({ timeout: 30_000 });
  await context.close();
});

test("approving a device: the new device's code, and the trusted device's question", async ({ browser }) => {
  const { context, page } = await open(browser, "locked");
  await page.goto(`${APP}/documents`);
  await page.getByRole("button", { name: "Approve from another device" }).click();
  const waiting = page.getByRole("dialog", { name: "Waiting for approval" });
  await expect(waiting.getByText("Open Folevi on a device you've already unlocked.", { exact: false })).toBeVisible();
  await expect(waiting.getByLabel("Code 4 8 2 0 1 9")).toBeVisible();
  // Approved: the trust choice follows.
  await expect(page.getByRole("radiogroup", { name: "Your notes are unlocked" })).toBeVisible({ timeout: 10_000 });
  await context.close();

  const trusted = await open(browser, "approval");
  await trusted.page.goto(`${APP}/documents`);
  const ask = trusted.page.getByRole("dialog", { name: "Approve a new device?" });
  await expect(ask.getByText("Chrome on Windows wants to unlock your encrypted notes.", { exact: false })).toBeVisible({ timeout: 30_000 });
  await expect(ask.getByLabel("Code 4 8 2 0 1 9")).toBeVisible();
  await ask.getByRole("button", { name: "They don't match" }).click();
  await expect(ask.getByRole("alert")).toHaveText(/Approval cancelled\. If you weren't setting up a device, someone may have your password/);
  await trusted.context.close();
});

test("Foli AI consent: the notes and their sizes, Send and Don't send", async ({ browser }) => {
  const { context, page } = await open(browser, "consent");
  await page.goto(`${APP}/documents`);
  const ask = page.getByRole("dialog", { name: "Send to Foli AI?" });
  await expect(ask.getByText("Trip notes")).toBeVisible({ timeout: 30_000 });
  await expect(ask.getByText("9,120 characters")).toBeVisible();
  await ask.getByRole("button", { name: "Don't send" }).click();
  await expect(ask).toHaveCount(0);
  await context.close();
});

test("migration progress in Settings > Privacy and the sidebar", async ({ browser }) => {
  const { context, page } = await open(browser, "migrating");
  await page.goto(`${APP}/settings/privacy`);
  const row = page.getByRole("region", { name: "Encrypting your notes: 1,240 of 1,800" });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole("button", { name: "Details" }).click();
  await expect(row.getByText(/History: 340 of 2,100 versions\./)).toBeVisible();
  await expect(row.getByRole("alert")).toContainText("1 note couldn't be encrypted.");
  await page.goto(`${APP}/documents`);
  await expect(page.getByRole("navigation", { name: "Folio" }).getByRole("link", { name: /Encrypting your notes: 1,240 of 1,800/ })).toBeVisible({ timeout: 30_000 });
  await context.close();
});

test("devices: who can unlock, and removing one from encryption", async ({ browser }) => {
  const { context, page } = await open(browser, { ...{}, lock: "unlocked", spaces: { personal: { level: "selected", state: "on", switches: { foliAi: "ask", backgroundAi: false, searchEverywhere: false, apps: false, emailToNote: false, webClipper: false, notificationPreviews: false }, lockedCount: 0, keyHolders: 1 } } });
  // A second signed-in session to remove.
  await secondSession(browser);
  await page.goto(`${APP}/settings/devices`);
  await expect(page.getByText("Can unlock encrypted notes").first()).toBeVisible({ timeout: 30_000 });
  const menu = page.getByRole("button", { name: /^Options for / }).first();
  await menu.click();
  await page.getByRole("menuitem", { name: "Remove from encryption" }).click();
  const dialog = page.getByRole("dialog", { name: /^Remove / });
  await expect(dialog.getByRole("switch", { name: "Also change your encryption key" })).toBeVisible();
  await dialog.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText(/can't unlock encrypted notes any more/)).toBeVisible();
  await context.close();
});

test("Always fully encrypted: the folder menu item, its question and the lock in the sidebar", async ({ browser }) => {
  const { context, page } = await open(browser, "encrypted");
  await page.goto(`${APP}/documents`);
  await showFolders(page);
  const nav = page.getByRole("navigation", { name: "Folio" });
  await nav.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill("Diary");
  await page.getByRole("button", { name: "Create folder" }).click();
  const row = nav.getByRole("link", { name: /^Diary/ });
  await expect(row).toBeVisible();
  await row.hover();
  await nav.getByRole("button", { name: "Folder options for Diary" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Always fully encrypted" }).click();
  const dialog = page.getByRole("dialog", { name: "Always fully encrypt Diary?" });
  await expect(dialog.getByText("Foli AI, search on our servers and apps can't use them.", { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "Encrypt" }).click();
  await expect(page.getByText("Diary is always fully encrypted")).toBeVisible();
  await expect(nav.getByRole("link", { name: "Diary Always fully encrypted" })).toBeVisible();
  await row.hover();
  await nav.getByRole("button", { name: "Folder options for Diary" }).click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Always fully encrypted" })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await context.close();
});

test("sharing a sealed note: the key is in the link, and publishing makes a readable copy", async ({ browser }) => {
  const id = welcomePath.split("/").pop()!;
  const { context, page } = await open(browser, { lock: "unlocked", spaces: { personal: { level: "selected", state: "on", switches: { foliAi: "ask", backgroundAi: false, searchEverywhere: false, apps: false, emailToNote: false, webClipper: false, notificationPreviews: false }, lockedCount: 0, keyHolders: 1 } }, sealedDocuments: [id] });
  await page.goto(`${APP}${welcomePath}`);
  await page.getByRole("group", { name: "Page" }).getByRole("button", { name: /^Share/ }).click();
  const dialog = page.getByRole("dialog", { name: /^Share/ });
  await expect(dialog.getByText("Encrypted link: the key is in the link itself.", { exact: false })).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole("button", { name: "Create link" }).click();
  await expect(dialog.getByLabel("Public link")).toHaveValue(/\/s\/[^#]+#k=/);
  await dialog.getByRole("button", { name: "Publish…" }).click();
  const warn = page.getByRole("dialog", { name: "Publish a readable copy?" });
  await expect(warn.getByText("The note itself stays encrypted.", { exact: false })).toBeVisible();
  await warn.getByRole("button", { name: "Publish readable copy" }).click();
  await expect(page.getByText("Published. Copy the link below.")).toBeVisible();
  await context.close();
});

test("screenshots of every screen, light and dark, desktop and phone", async ({ browser }) => {
  const dir = process.env.E2EE_SHOTS;
  test.skip(!dir, "set E2EE_SHOTS=<dir> to save screenshots");
  test.setTimeout(600_000);
  mkdirSync(dir!, { recursive: true });
  const id = welcomePath.split("/").pop()!;
  for (const scheme of ["light", "dark"] as const) {
    for (const phone of [false, true]) {
      const tag = `${scheme}-${phone ? "phone" : "desktop"}`;
      const shot = async (page: Page, name: string) => {
        await page.waitForTimeout(400);
        await settle(page);
        await page.screenshot({ path: `${dir}/${name}-${tag}.png` });
      };
      const at = async (state: StubName | object, path: string) => {
        const o = await open(browser, state, { scheme, phone });
        await o.page.goto(`${APP}${path}`);
        await o.page.waitForTimeout(1500);
        return o;
      };
      {
        const { context, page } = await at("none", "/settings/privacy");
        await expect(page.getByRole("radiogroup", { name: "How private your notes are" })).toBeVisible({ timeout: 30_000 });
        await shot(page, "01-privacy-standard");
        await page.getByRole("button", { name: "What each choice means" }).click();
        await shot(page, "02-what-each-choice-means");
        await page.keyboard.press("Escape");
        await page.getByRole("radio", { name: /^Encrypted, with the features you pick/ }).click();
        await shot(page, "03-privacy-choice-changed");
        await page.getByRole("button", { name: "Turn on encryption" }).click();
        const w = page.getByRole("dialog", { name: "Turn on encryption" });
        await shot(page, "04-wizard-before-you-start");
        await w.getByRole("button", { name: "Continue" }).click();
        await expect(w.getByRole("status")).toBeVisible();
        await shot(page, "05-wizard-ways-to-unlock");
        await w.getByRole("button", { name: "Add Recovery key" }).click();
        await expect(w.getByRole("list", { name: "Your recovery key" })).toBeVisible();
        await shot(page, "06-wizard-recovery-key");
        const groups = (await w.getByRole("list", { name: "Your recovery key" }).getByRole("listitem").allTextContents()).map((t) => t.replace(/^Group \d+: /, "").trim());
        await w.getByLabel("Group 3").fill(groups[2]!);
        await w.getByLabel("Group 7").fill(groups[6]!);
        await w.getByRole("button", { name: "Check and continue" }).click();
        await w.getByRole("button", { name: "Add Encryption passphrase" }).click();
        await w.getByLabel("Passphrase", { exact: true }).fill("lantern orchard velvet compass");
        await shot(page, "07-wizard-passphrase");
        await w.getByLabel("Type it again").fill("lantern orchard velvet compass");
        await w.getByRole("button", { name: "Save passphrase" }).click();
        await w.getByRole("button", { name: "Continue" }).click();
        await shot(page, "08-wizard-confirm");
        await w.getByRole("button", { name: "Turn on encryption" }).click();
        await expect(w.getByText("Encryption is on", { exact: true })).toBeVisible();
        await shot(page, "09-wizard-done");
        await context.close();
      }
      {
        const { context, page } = await at("encrypted", "/settings/privacy");
        await expect(page.getByText("Features that need to read your notes")).toBeVisible({ timeout: 30_000 });
        await shot(page, "10-privacy-encrypted");
        await page.screenshot({ path: `${dir}/10-privacy-encrypted-full-${tag}.png`, fullPage: true });
        await page.getByRole("radio", { name: /^Standard/ }).click();
        await page.getByRole("button", { name: "Change to Standard" }).click();
        await page.getByRole("dialog", { name: "Turn off encryption?" }).getByRole("button", { name: "Enter passphrase" }).click();
        await shot(page, "11-lower-to-standard");
        await context.close();
      }
      {
        const { context, page } = await at("full", "/settings/privacy");
        await expect(page.getByRole("radiogroup", { name: "How private your notes are" })).toBeVisible({ timeout: 30_000 });
        await shot(page, "12-privacy-full");
        await context.close();
      }
      {
        const { context, page } = await at("migrating", "/settings/privacy");
        const row = page.getByRole("region", { name: /Encrypting your notes/ });
        await row.getByRole("button", { name: "Details" }).click();
        await row.scrollIntoViewIfNeeded();
        await shot(page, "13-migration-progress");
        await page.goto(`${APP}/documents`);
        await page.waitForTimeout(1500);
        if (phone) await page.getByRole("button", { name: /Open sidebar|Show sidebar|Menu/ }).first().click().catch(() => undefined);
        await shot(page, "14-sidebar-migration-line");
        await context.close();
      }
      {
        const { context, page } = await at("locked", "/documents");
        await expect(page.getByRole("heading", { name: "Unlock your encrypted notes" })).toBeVisible({ timeout: 30_000 });
        await shot(page, "15-unlock");
        await page.getByRole("button", { name: "Enter passphrase" }).click();
        await page.getByLabel("Encryption passphrase").fill("wrong passphrase");
        await page.getByRole("button", { name: "Unlock", exact: true }).click();
        await expect(page.getByRole("region", { name: "Unlock your encrypted notes" }).getByRole("alert")).toBeVisible();
        await shot(page, "16-unlock-wrong-passphrase");
        await page.getByLabel("Encryption passphrase").fill("lantern orchard velvet compass");
        await page.getByRole("button", { name: "Unlock", exact: true }).click();
        await expect(page.getByRole("radiogroup", { name: "Your notes are unlocked" })).toBeVisible();
        await shot(page, "17-unlock-trust-choice");
        await context.close();
      }
      {
        const { context, page } = await at("locked", "/documents");
        await page.getByRole("button", { name: "Approve from another device" }).click();
        await expect(page.getByLabel("Code 4 8 2 0 1 9")).toBeVisible({ timeout: 10_000 });
        await shot(page, "18-approve-new-device-code");
        await context.close();
      }
      {
        const { context, page } = await at("approval", "/documents");
        const ask = page.getByRole("dialog", { name: "Approve a new device?" });
        await expect(ask.getByLabel("Code 4 8 2 0 1 9")).toBeVisible({ timeout: 30_000 });
        await shot(page, "19-approve-trusted-device");
        await ask.getByRole("button", { name: "They don't match" }).click();
        await shot(page, "20-approve-dont-match");
        await context.close();
      }
      {
        const { context, page } = await at("consent", "/documents");
        await expect(page.getByRole("dialog", { name: "Send to Foli AI?" })).toBeVisible({ timeout: 30_000 });
        await shot(page, "21-foli-ai-consent");
        await context.close();
      }
      {
        await secondSession(browser);
        const { context, page } = await at("encrypted", "/settings/devices");
        await expect(page.getByText("Can unlock encrypted notes").first()).toBeVisible({ timeout: 30_000 });
        await shot(page, "22-devices");
        const menu = page.getByRole("button", { name: /^Options for / }).first();
        if (await menu.count()) {
          await menu.click();
          await page.getByRole("menuitem", { name: "Remove from encryption" }).click();
          await shot(page, "23-devices-remove");
        }
        await context.close();
      }
      {
        const { context, page } = await at({ ...{ lock: "unlocked" }, spaces: { personal: { level: "selected", state: "on", switches: { foliAi: "ask", backgroundAi: false, searchEverywhere: false, apps: false, emailToNote: false, webClipper: false, notificationPreviews: false }, lockedCount: 1, keyHolders: 1 } }, sealedDocuments: [id], lockedDocuments: [] }, welcomePath);
        await page.getByRole("group", { name: "Page" }).getByRole("button", { name: /^Share/ }).click();
        await expect(page.getByText("Encrypted link: the key is in the link itself.", { exact: false })).toBeVisible({ timeout: 30_000 });
        await shot(page, "24-share-sealed");
        await page.getByRole("button", { name: "Publish…" }).click();
        await shot(page, "25-publish-readable-copy");
        await page.keyboard.press("Escape");
        await page.keyboard.press("Escape");
        await page.getByRole("group", { name: "Page" }).getByRole("button", { name: "Document actions" }).click();
        await page.getByRole("menuitemcheckbox", { name: "Always fully encrypted" }).click();
        await shot(page, "26-lock-note");
        await context.close();
      }
    }
  }
});
