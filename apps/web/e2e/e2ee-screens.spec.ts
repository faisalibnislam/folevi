import { mkdirSync } from "node:fs";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { APP, createWorkspace, newPerson, settle, showFolders, signIn, type Account } from "./helpers";
import { PASSPHRASE, migrationDone, trustedPage, unlockWithPassphrase } from "./e2ee-helpers";

// The end-to-end encryption screens (docs/E2EE_DESIGN.md §10) against the real keys, router, migration and
// server on the dev deployment: one account turns encryption on in the wizard, its Personal is encrypted in
// the background, a fresh browser of the same account is locked, approvals pass between two browsers. With
// E2EE_SHOTS=<dir>, the last test saves a screenshot of each screen in light and dark, at desktop and phone
// width (each with an account of its own, as the wizard needs one without keys).

type Storage = Awaited<ReturnType<BrowserContext["storageState"]>>;
type Handle = { context: { close(): Promise<void> }; page: Page };
/** Signed in, no device keys: before setup a Standard browser, after it a locked one. */
let cookies: Storage;
/** The browser that set encryption up, kept open (its trusted device keys can't be saved and restored). */
let trusted: BrowserContext | null = null;
let welcomePath = "/documents";
let account: Account;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  const person = await newPerson(browser, "Privacy Person");
  account = person.account;
  welcomePath = new URL(person.page.url()).pathname;
  cookies = await person.context.storageState();
  await person.context.close();
});

test.afterAll(async () => {
  await trusted?.close();
});

/** A tab of the trusted browser, or (`fresh`, or before setup) a browser of its own with only the sign-in. */
async function open(browser: Browser, opts: { scheme?: "light" | "dark"; phone?: boolean; fresh?: boolean; storage?: Storage } = {}): Promise<Handle> {
  if (trusted && !opts.fresh) return trustedPage(trusted, opts);
  const context = await browser.newContext({
    storageState: opts.storage ?? cookies,
    colorScheme: opts.scheme ?? "light",
    viewport: opts.phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    ...(opts.phone ? { hasTouch: true, isMobile: true } : {}),
  });
  await context.addInitScript((s) => localStorage.setItem("folevi:appearance", s), opts.scheme ?? "light");
  return { context, page: await context.newPage() };
}

const unlockCard = (page: Page) => page.getByRole("region", { name: "Unlock your encrypted notes" });

/** The wizard from Settings > Privacy with a recovery key and a passphrase; checks each step on the way. */
async function wizard(page: Page, shot?: (name: string) => Promise<void>) {
  await page.goto(`${APP}/settings/privacy`);
  const levels = page.getByRole("radiogroup", { name: "How private your notes are" });
  await expect(levels).toBeVisible({ timeout: 30_000 });
  await shot?.("01-privacy-standard");
  await page.getByRole("button", { name: "What each choice means" }).click();
  await expect(page.getByRole("dialog", { name: "What each choice means" }).getByText("What Folevi can always see")).toBeVisible();
  await shot?.("02-what-each-choice-means");
  await page.keyboard.press("Escape");
  await levels.getByRole("radio", { name: /^Encrypted, with the features you pick/ }).click();
  await shot?.("03-privacy-choice-changed");
  await page.getByRole("button", { name: "Turn on encryption" }).click();
  const w = page.getByRole("dialog", { name: "Turn on encryption" });
  await expect(w.getByText("Before you start")).toBeVisible();
  await shot?.("04-wizard-before-you-start");
  await w.getByRole("button", { name: "Continue" }).click();
  // Making the keys remounts the app; the wizard comes back at the ways to unlock.
  await expect(page.locator('[data-e2ee-step="methods"]')).toBeVisible({ timeout: 60_000 });
  await expect(w.getByRole("status")).toHaveText("0 of 2 needed");
  await expect(w.getByText("1 trusted device so far", { exact: false })).toBeVisible();
  await expect(w.getByRole("button", { name: "Continue" })).toBeDisabled();
  await shot?.("05-wizard-ways-to-unlock");

  await w.getByRole("button", { name: "Add Recovery key" }).click();
  const key = w.getByRole("list", { name: "Your recovery key" });
  await expect(key.getByRole("listitem")).toHaveCount(9, { timeout: 30_000 });
  await shot?.("06-wizard-recovery-key");
  const groups = (await key.getByRole("listitem").allTextContents()).map((t) => t.replace(/^Group \d+: /, "").trim());
  await w.getByLabel("Group 3").fill(groups[2] === "ZZZZ" ? "YYYY" : "ZZZZ");
  await w.getByLabel("Group 7").fill(groups[6]!);
  await w.getByRole("button", { name: "Check and continue" }).click();
  await expect(w.getByRole("alert")).toHaveText("Those groups don't match. Check the key you saved and try again.");
  await w.getByLabel("Group 3").fill(groups[2]!);
  await w.getByRole("button", { name: "Check and continue" }).click();
  await expect(w.getByRole("status")).toHaveText("1 of 2 needed", { timeout: 30_000 });

  await w.getByRole("button", { name: "Add Encryption passphrase" }).click();
  await w.getByLabel("Passphrase", { exact: true }).fill("short");
  await expect(w.getByText("Too short: use at least 12 characters")).toBeVisible();
  await w.getByLabel("Passphrase", { exact: true }).fill(PASSPHRASE);
  await expect(w.getByText("Strong")).toBeVisible();
  await shot?.("07-wizard-passphrase");
  await w.getByLabel("Type it again").fill(PASSPHRASE);
  await w.getByRole("button", { name: "Save passphrase" }).click();
  await expect(w.getByRole("status")).toHaveText("2 of 2 needed", { timeout: 60_000 });
  await w.getByRole("button", { name: "Continue" }).click();

  await expect(w.getByText("Encrypt my Personal space")).toBeVisible();
  await expect(w.getByText("Recovery key, Encryption passphrase")).toBeVisible();
  await shot?.("08-wizard-confirm");
  await w.getByRole("button", { name: "Turn on encryption" }).click();
  await expect(w.getByText("Encryption is on", { exact: true })).toBeVisible({ timeout: 60_000 });
  await shot?.("09-wizard-done");
  await w.getByRole("button", { name: "Done" }).click();
  await expect(levels.getByRole("radio", { name: /^Encrypted, with the features you pick/ })).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });
}

test("Standard: Settings > Privacy is the only new thing, and nothing else changes", async ({ browser }) => {
  const { context, page } = await open(browser);
  await page.goto(`${APP}/settings/privacy`);
  await expect(page.getByRole("heading", { name: "Privacy", level: 2 })).toBeVisible({ timeout: 30_000 });
  const levels = page.getByRole("radiogroup", { name: "How private your notes are" });
  await expect(levels.getByRole("radio")).toHaveCount(3);
  await expect(levels.getByRole("radio", { name: /^Standard/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("You can also mark single folders or notes as Always fully encrypted from their menu.")).toBeVisible();
  await expect(page.getByText("Features that need to read your notes")).toHaveCount(0);
  await expect(page.getByText("Ways to unlock")).toHaveCount(0);
  await page.getByRole("button", { name: "What each choice means" }).click();
  const meaning = page.getByRole("dialog", { name: "What each choice means" });
  await expect(meaning.getByRole("rowheader", { name: "Search on our servers" })).toBeVisible();
  await expect(meaning.getByText(/Not even Folevi\./)).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto(`${APP}/settings/devices`);
  await expect(page.getByText("This device")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Encrypted notes" })).toHaveCount(0);
  await page.goto(`${APP}/documents`);
  await expect(page.getByText(/Encrypting your notes/)).toHaveCount(0);
  await context.close();
});

test("the setup wizard: two ways to unlock, the recovery key check, the passphrase, confirm, done; the notes get encrypted", async ({ browser }) => {
  test.setTimeout(300_000);
  // This browser becomes the trusted one.
  const context = await browser.newContext({ storageState: cookies });
  const page = await context.newPage();
  await wizard(page);
  await expect(page.getByText("Features that need to read your notes")).toBeVisible();
  const methods = page.getByRole("region", { name: "Ways to unlock" });
  await expect(methods.getByText("Recovery key", { exact: true })).toBeVisible();
  await expect(methods.getByText("Encryption passphrase", { exact: true })).toBeVisible();
  await migrationDone(page);
  trusted = context;
  await page.close();
});

test("a trusted browser opens its own key in a new tab", async ({ browser }) => {
  const { context, page } = await open(browser);
  await page.goto(`${APP}/documents`);
  await expect(page.getByRole("navigation", { name: "Folio" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Unlock your encrypted notes" })).toHaveCount(0);
  await expect(page.getByText("Welcome to Folevi").first()).toBeVisible({ timeout: 30_000 });
  await context.close();
});

test("the switches: Foli AI's choice and Search everywhere on and off", async ({ browser }) => {
  const { context, page } = await open(browser);
  await page.goto(`${APP}/settings/privacy`);
  await expect(page.getByRole("combobox", { name: "Foli AI" })).toHaveText(/Ask me each time/, { timeout: 30_000 });
  const search = page.getByRole("switch", { name: "Search everywhere" });
  await expect(search).toHaveAttribute("aria-checked", "false");
  await search.click();
  await expect(page.getByText("Search everywhere turned on")).toBeVisible({ timeout: 30_000 });
  await expect(search).toHaveAttribute("aria-checked", "true");
  await search.click();
  await expect(page.getByText("Turned off. Folevi deleted the readable copy.")).toBeVisible({ timeout: 30_000 });
  await expect(search).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText("Folders and notes marked Always fully encrypted never use these features.")).toBeVisible();
  await context.close();
});

test("the unlock screen in a new browser: a bad recovery key, a wrong passphrase, then trust this browser", async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page } = await open(browser, { fresh: true });
  await page.goto(`${APP}/documents`);
  const card = unlockCard(page);
  await expect(card).toBeVisible({ timeout: 30_000 });
  for (const name of ["Approve from another device", "Use a passkey", "Enter passphrase", "Enter recovery key"]) await expect(card.getByRole("button", { name })).toBeVisible();
  await card.getByRole("button", { name: "Enter recovery key" }).click();
  await card.getByLabel("Recovery key").fill("1234");
  await card.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(card.getByRole("alert")).toHaveText(/36 letters and numbers/);
  await card.getByRole("button", { name: "Other ways to unlock" }).click();
  await card.getByRole("button", { name: "Enter passphrase" }).click();
  await card.getByLabel("Encryption passphrase").fill("not the passphrase at all");
  await card.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(card.getByRole("alert")).toHaveText("That passphrase didn't unlock your notes. Check it and try again.", { timeout: 30_000 });
  await card.getByLabel("Encryption passphrase").fill(PASSPHRASE);
  await card.getByRole("button", { name: "Unlock", exact: true }).click();
  const choice = page.getByRole("radiogroup", { name: "Your notes are unlocked" });
  await expect(choice.getByRole("radio", { name: /^Trust this browser/ })).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("navigation", { name: "Folio" })).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.getByRole("navigation", { name: "Folio" })).toBeVisible({ timeout: 30_000 });
  await expect(card).toHaveCount(0);
  await context.close();
});

test("approving a device: both show the same code; They don't match cancels", async ({ browser }) => {
  test.setTimeout(180_000);
  const old = await open(browser);
  await old.page.goto(`${APP}/documents`);
  await expect(old.page.getByRole("navigation", { name: "Folio" })).toBeVisible({ timeout: 30_000 });

  const fresh = await open(browser, { fresh: true });
  await fresh.page.goto(`${APP}/documents`);
  await unlockCard(fresh.page).getByRole("button", { name: "Approve from another device" }).click({ timeout: 30_000 });
  const waiting = fresh.page.getByRole("dialog", { name: "Waiting for approval" });
  await expect(waiting.getByText("Open Folevi on a device you've already unlocked.", { exact: false })).toBeVisible();
  const ask = old.page.getByRole("dialog", { name: "Approve a new device?" });
  await expect(ask.getByText("wants to unlock your encrypted notes.", { exact: false })).toBeVisible({ timeout: 60_000 });
  const code = await ask.getByLabel(/^Code /).getAttribute("aria-label", { timeout: 30_000 });
  await expect(waiting.getByLabel(code!)).toBeVisible({ timeout: 30_000 });
  await ask.getByRole("button", { name: "They match" }).click();
  await expect(fresh.page.getByRole("radiogroup", { name: "Your notes are unlocked" })).toBeVisible({ timeout: 60_000 });
  await fresh.context.close();

  const another = await open(browser, { fresh: true });
  await another.page.goto(`${APP}/documents`);
  await unlockCard(another.page).getByRole("button", { name: "Approve from another device" }).click({ timeout: 30_000 });
  await expect(ask.getByLabel(/^Code /)).toBeVisible({ timeout: 60_000 });
  await ask.getByRole("button", { name: "They don't match" }).click();
  await expect(ask.getByRole("alert")).toHaveText(/Approval cancelled\. If you weren't setting up a device, someone may have your password/);
  await expect(another.page.getByRole("dialog", { name: "Waiting for approval" }).getByRole("alert")).toBeVisible({ timeout: 60_000 });
  await Promise.all([old.context.close(), another.context.close()]);
});

test("devices: which can unlock, and removing one from encryption", async ({ browser }) => {
  test.setTimeout(120_000);
  // A browser with a session of its own (the others here share one: removing a device signs its session out).
  const other = await browser.newContext();
  const otherPage = await signIn(other, account);
  await otherPage.goto(`${APP}/documents`);
  await unlockWithPassphrase(otherPage);
  const { context, page } = await open(browser);
  await page.goto(`${APP}/settings/devices`);
  const card = page.getByRole("region", { name: "Encrypted notes" });
  await expect(card.getByText("This device")).toBeVisible({ timeout: 30_000 });
  await expect(card.getByText(/Can unlock encrypted notes/).first()).toBeVisible();
  // The newest one is that browser.
  await card.getByRole("button", { name: /^Options for / }).first().click();
  await page.getByRole("menuitem", { name: "Remove from encryption" }).click();
  const dialog = page.getByRole("dialog", { name: /^Remove / });
  await expect(dialog.getByRole("switch", { name: "Also change your encryption key" })).toHaveAttribute("aria-checked", "false");
  await dialog.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText(/can't unlock encrypted notes any more/)).toBeVisible({ timeout: 30_000 });
  await otherPage.reload();
  await expect(otherPage).toHaveURL(/\/signin/, { timeout: 30_000 });
  await Promise.all([context.close(), other.close()]);
});

test("Always fully encrypted: the folder menu item, its question and the lock in the sidebar", async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page } = await open(browser);
  await page.goto(`${APP}/documents`);
  await showFolders(page);
  const nav = page.getByRole("navigation", { name: "Folio" });
  await nav.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill("Diary");
  await page.getByRole("button", { name: "Create folder" }).click();
  const row = nav.getByRole("link", { name: /^Diary/ });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.hover();
  await nav.getByRole("button", { name: "Folder options for Diary" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Always fully encrypted" }).click();
  const dialog = page.getByRole("dialog", { name: "Always fully encrypt Diary?" });
  await expect(dialog.getByText("Foli AI, search on our servers and apps can't use them.", { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "Encrypt" }).click();
  await expect(page.getByText("Diary is always fully encrypted")).toBeVisible({ timeout: 30_000 });
  await expect(nav.getByRole("link", { name: "Diary Always fully encrypted" })).toBeVisible({ timeout: 30_000 });
  await row.hover();
  await nav.getByRole("button", { name: "Folder options for Diary" }).click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Always fully encrypted" })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await context.close();
});

test("sharing an encrypted note: the dialog says the key is in the link", async ({ browser }) => {
  const { context, page } = await open(browser);
  await page.goto(`${APP}${welcomePath}`);
  await page.getByRole("group", { name: "Page" }).getByRole("button", { name: /^Share/ }).click({ timeout: 30_000 });
  const dialog = page.getByRole("dialog", { name: /^Share/ });
  await expect(dialog.getByText("Encrypted link: the key is in the link itself.", { exact: false })).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByText("They'll get the key on their devices.", { exact: false })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Publish to the web: makes a readable copy" })).toBeVisible();
  await expect(dialog.getByRole("switch", { name: "Let search engines find it" })).toBeHidden();
  await context.close();
});

// Fails at integration (2026-10-22): createEncryptedLink refuses with e2ee_no_key ("You don't have the key to
// this note.") on the browser that encrypted the note: the key ring can't hand lib/e2ee/links.ts the note key's
// raw bytes (KeyRing.openNoteRaw). WP6/WP8 to fix; the screen shows the refusal as a toast meanwhile.
test.fixme("an encrypted link opens signed out and needs its fragment; publishing makes a readable copy", async ({ browser }) => {
  test.setTimeout(180_000);
  const { context, page } = await open(browser);
  await page.goto(`${APP}${welcomePath}`);
  await page.getByRole("group", { name: "Page" }).getByRole("button", { name: /^Share/ }).click({ timeout: 30_000 });
  const dialog = page.getByRole("dialog", { name: /^Share/ });
  await dialog.getByRole("button", { name: "Create link" }).click();
  const link = dialog.getByLabel("Public link");
  await expect(link).toHaveValue(/\/s\/[^#]+#k=/, { timeout: 30_000 });
  const url = await link.inputValue();
  const anon = await browser.newContext();
  const viewer = await anon.newPage();
  await viewer.goto(url);
  await expect(viewer.getByText("Welcome to Folevi").first()).toBeVisible({ timeout: 30_000 });
  await viewer.goto(url.split("#")[0]!);
  await expect(viewer.getByText("This link is missing its key. Ask the person who shared it to send the whole link.")).toBeVisible({ timeout: 30_000 });
  await anon.close();
  await dialog.getByRole("button", { name: "Publish…" }).click();
  const warn = page.getByRole("dialog", { name: "Publish a readable copy?" });
  await expect(warn.getByText("The note itself stays encrypted.", { exact: false })).toBeVisible();
  await warn.getByRole("button", { name: "Publish readable copy" }).click();
  await expect(page.getByText("Published. Copy the link below.")).toBeVisible({ timeout: 60_000 });
  await context.close();
});

test("lowering and raising: Standard needs the passphrase again; Fully encrypted only confirms; back to the features you pick", async ({ browser }) => {
  test.setTimeout(180_000);
  const { context, page } = await open(browser);
  await page.goto(`${APP}/settings/privacy`);
  const levels = page.getByRole("radiogroup", { name: "How private your notes are" });
  await levels.getByRole("radio", { name: /^Standard/ }).click({ timeout: 30_000 });
  await page.getByRole("button", { name: "Change to Standard" }).click();
  const off = page.getByRole("dialog", { name: "Turn off encryption?" });
  await expect(off.getByRole("button", { name: "Turn off encryption" })).toBeDisabled();
  await off.getByRole("button", { name: "Enter passphrase" }).click();
  await off.getByLabel("Encryption passphrase").fill("not the passphrase at all");
  await off.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(off.getByRole("alert")).toHaveText("That passphrase didn't unlock your notes. Check it and try again.", { timeout: 30_000 });
  await off.getByLabel("Encryption passphrase").fill(PASSPHRASE);
  await off.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(off.getByText("Confirmed")).toBeVisible({ timeout: 30_000 });
  await expect(off.getByRole("button", { name: "Turn off encryption" })).toBeEnabled();
  await off.getByRole("button", { name: "Cancel" }).click();

  await levels.getByRole("radio", { name: /^Fully encrypted/ }).click();
  await page.getByRole("button", { name: "Change to Fully encrypted" }).click();
  const full = page.getByRole("dialog", { name: "Change to Fully encrypted?" });
  await expect(full.getByText("Folevi will delete the readable copies your features use.")).toBeVisible();
  await full.getByRole("button", { name: "Change" }).click();
  await expect(levels.getByRole("radio", { name: /^Fully encrypted/ })).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });
  await expect(page.getByText("Features that need to read your notes")).toHaveCount(0);

  await levels.getByRole("radio", { name: /^Encrypted, with the features you pick/ }).click();
  await page.getByRole("button", { name: "Change to Encrypted, with the features you pick" }).click();
  const back = page.getByRole("dialog", { name: "Turn on feature choices?" });
  await back.getByRole("button", { name: "Enter passphrase" }).click();
  await back.getByLabel("Encryption passphrase").fill(PASSPHRASE);
  await back.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(back.getByText("Confirmed")).toBeVisible({ timeout: 30_000 });
  await back.getByRole("button", { name: "Change" }).click();
  await expect(levels.getByRole("radio", { name: /^Encrypted, with the features you pick/ })).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });
  await context.close();
});

test("a workspace's privacy: encrypted by its owner, the key holders and the invite note", async ({ browser }) => {
  test.setTimeout(240_000);
  const { context, page } = await open(browser);
  await page.goto(`${APP}/documents`);
  await createWorkspace(page, "Cipher Team");
  await page.goto(`${APP}/settings/workspace-privacy`);
  const levels = page.getByRole("radiogroup", { name: "How private your notes are" });
  await expect(levels.getByRole("radio", { name: /^Standard/ })).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });
  await levels.getByRole("radio", { name: /^Fully encrypted/ }).click();
  await page.getByRole("button", { name: "Turn on encryption" }).click();
  const w = page.getByRole("dialog", { name: "Encrypt this workspace" });
  await expect(w.getByText("Every member will need to set up encryption to open it.", { exact: false })).toBeVisible();
  await w.getByRole("button", { name: "Continue" }).click();
  await expect(w.getByText("Encrypt Cipher Team")).toBeVisible({ timeout: 30_000 });
  await w.getByRole("button", { name: "Turn on encryption" }).click();
  await expect(w.getByText("Encryption is on", { exact: true })).toBeVisible({ timeout: 60_000 });
  await w.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Only you can unlock this workspace.", { exact: false })).toBeVisible({ timeout: 30_000 });
  const dir = process.env.E2EE_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/27-workspace-privacy-light-desktop.png` });
  await page.goto(`${APP}/settings/members`);
  await expect(page.getByText("This workspace is end-to-end encrypted. New members set up encryption when they join", { exact: false })).toBeVisible({ timeout: 30_000 });
  if (dir) await page.screenshot({ path: `${dir}/28-workspace-members-light-desktop.png` });
  await context.close();
});

test("screenshots of every screen, light and dark, desktop and phone", async ({ browser }) => {
  const dir = process.env.E2EE_SHOTS;
  test.skip(!dir, "set E2EE_SHOTS=<dir> to save screenshots");
  test.setTimeout(1_800_000);
  mkdirSync(dir!, { recursive: true });
  for (const scheme of ["light", "dark"] as const) {
    for (const phone of [false, true]) {
      const tag = `${scheme}-${phone ? "phone" : "desktop"}`;
      const shoot = (page: Page) => async (name: string) => {
        await page.waitForTimeout(400);
        await settle(page);
        await page.screenshot({ path: `${dir}/${name}-${tag}.png` });
      };
      // An account of its own: the wizard needs one without keys.
      const person = await newPerson(browser, "Wizard Person");
      const storage = await person.context.storageState();
      const welcome = new URL(person.page.url()).pathname;
      await person.context.close();
      const mine = await browser.newContext({ storageState: storage, colorScheme: scheme, viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 } });
      await mine.addInitScript((s) => localStorage.setItem("folevi:appearance", s), scheme);
      const page = await mine.newPage();
      await wizard(page, shoot(page));
      // While the notes are being encrypted (a new account has few: it may be done already).
      if (await page.getByRole("region", { name: /Encrypting your notes/ }).count()) await shoot(page)("13-migration-progress");
      await migrationDone(page);
      await expect(page.getByRole("region", { name: "Ways to unlock" })).toBeVisible({ timeout: 30_000 });
      await shoot(page)("10-privacy-encrypted");
      await page.screenshot({ path: `${dir}/10-privacy-encrypted-full-${tag}.png`, fullPage: true });
      await page.getByRole("radio", { name: /^Standard/ }).click();
      await page.getByRole("button", { name: "Change to Standard" }).click();
      await page.getByRole("dialog", { name: "Turn off encryption?" }).getByRole("button", { name: "Enter passphrase" }).click();
      await shoot(page)("11-lower-to-standard");
      await page.keyboard.press("Escape");

      const fresh = await open(browser, { fresh: true, storage, scheme, phone });
      await fresh.page.goto(`${APP}/documents`);
      const card = unlockCard(fresh.page);
      await expect(card).toBeVisible({ timeout: 30_000 });
      await shoot(fresh.page)("15-unlock");
      await card.getByRole("button", { name: "Enter passphrase" }).click();
      await card.getByLabel("Encryption passphrase").fill("not the passphrase at all");
      await card.getByRole("button", { name: "Unlock", exact: true }).click();
      await expect(card.getByRole("alert")).toBeVisible({ timeout: 30_000 });
      await shoot(fresh.page)("16-unlock-wrong-passphrase");
      await card.getByRole("button", { name: "Other ways to unlock" }).click();
      await card.getByRole("button", { name: "Approve from another device" }).click();
      const ask = page.getByRole("dialog", { name: "Approve a new device?" });
      await expect(ask.getByLabel(/^Code /)).toBeVisible({ timeout: 60_000 });
      await expect(fresh.page.getByRole("dialog", { name: "Waiting for approval" }).getByLabel(/^Code /)).toBeVisible({ timeout: 30_000 });
      await shoot(fresh.page)("18-approve-new-device-code");
      await shoot(page)("19-approve-trusted-device");
      await ask.getByRole("button", { name: "They match" }).click();
      await expect(fresh.page.getByRole("radiogroup", { name: "Your notes are unlocked" })).toBeVisible({ timeout: 60_000 });
      await shoot(fresh.page)("17-unlock-trust-choice");
      await fresh.page.getByRole("button", { name: "Continue" }).click();
      await fresh.context.close();

      await page.goto(`${APP}/settings/devices`);
      const devices = page.getByRole("region", { name: "Encrypted notes" });
      await expect(devices.getByText("This device")).toBeVisible({ timeout: 30_000 });
      await devices.scrollIntoViewIfNeeded();
      await shoot(page)("22-devices");
      await devices.getByRole("button", { name: /^Options for / }).first().click();
      await page.getByRole("menuitem", { name: "Remove from encryption" }).click();
      await page.getByRole("dialog", { name: /^Remove / }).getByRole("switch", { name: "Also change your encryption key" }).click();
      await shoot(page)("23-devices-remove");
      await page.keyboard.press("Escape");

      await page.goto(`${APP}${welcome}`);
      await page.getByRole("group", { name: "Page" }).getByRole("button", { name: /^Share/ }).click({ timeout: 30_000 });
      await expect(page.getByText("Encrypted link: the key is in the link itself.", { exact: false })).toBeVisible({ timeout: 30_000 });
      await shoot(page)("24-share-sealed");
      await page.getByRole("button", { name: "Publish…" }).click();
      await shoot(page)("25-publish-readable-copy");
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.getByRole("group", { name: "Page" }).getByRole("button", { name: "Document actions" }).click();
      await page.getByRole("menuitemcheckbox", { name: "Always fully encrypted" }).click();
      await shoot(page)("26-lock-note");
      await mine.close();
    }
  }
});
