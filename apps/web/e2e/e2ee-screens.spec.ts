import { mkdirSync } from "node:fs";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { APP, createWorkspace, newPerson, settle, showFolders, signIn, type Account } from "./helpers";
import { PASSPHRASE, setStub, stubState, stubStateOnPage, trustedPage, unlockWithPassphrase, type StubName } from "./e2ee-stub";

// The end-to-end encryption screens (docs/E2EE_DESIGN.md §10). The keys are WP6's, real, against the dev
// backend: the wizard makes the account's keys, a recovery key and a passphrase; a browser holding them
// unlocks, a fresh one is locked; approvals pass between two browsers. What WP7 and WP8 would report (the
// space's level and switches, migration progress, consent requests, sealed notes) still comes from
// components/e2ee/__stubs__.ts. With E2EE_SHOTS=<dir>, the last test saves a screenshot of each screen in
// light and dark, at desktop and phone width.

type Storage = Awaited<ReturnType<BrowserContext["storageState"]>>;
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

async function open(browser: Browser, state: StubName | object, opts: { scheme?: "light" | "dark"; phone?: boolean; keys?: "trusted" | "fresh"; storage?: Storage } = {}): Promise<{ context: { close(): Promise<void> }; page: Page }> {
  if (trusted && opts.keys !== "fresh" && !opts.storage) return trustedPage(trusted, state, opts);
  const context = await browser.newContext({
    storageState: opts.storage ?? cookies,
    colorScheme: opts.scheme ?? "light",
    viewport: opts.phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    ...(opts.phone ? { hasTouch: true, isMobile: true } : {}),
  });
  await context.addInitScript((s) => localStorage.setItem("folevi:appearance", s), opts.scheme ?? "light");
  await stubState(context, state);
  return { context, page: await context.newPage() };
}

test.afterAll(async () => {
  await trusted?.close();
});

/** The unlock card of a locked browser. */
const unlockCard = (page: Page) => page.getByRole("region", { name: "Unlock your encrypted notes" });

test("Standard: Settings > Privacy is the only new thing, and nothing else changes", async ({ browser }) => {
  const { context, page } = await open(browser, "none");
  await page.goto(`${APP}/settings/privacy`);
  await expect(page.getByRole("heading", { name: "Privacy", level: 2 })).toBeVisible({ timeout: 30_000 });
  const levels = page.getByRole("radiogroup", { name: "How private your notes are" });
  await expect(levels.getByRole("radio")).toHaveCount(3);
  await expect(levels.getByRole("radio", { name: /^Standard/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("You can also mark single folders or notes as Always fully encrypted from their menu.")).toBeVisible();
  await expect(page.getByText("Features that need to read your notes")).toHaveCount(0);
  await expect(page.getByText("Ways to unlock")).toHaveCount(0);
  await page.goto(`${APP}/settings/devices`);
  await expect(page.getByText("This device")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Encrypted notes" })).toHaveCount(0);
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
  test.setTimeout(120_000);
  // This browser becomes the trusted one: its stub state is set per tab, so later tabs can have their own.
  const context = await browser.newContext({ storageState: cookies });
  const page = await context.newPage();
  await stubStateOnPage(page, "none");
  await page.goto(`${APP}/settings/privacy`);
  const levels = page.getByRole("radiogroup", { name: "How private your notes are" });
  await levels.getByRole("radio", { name: /^Encrypted, with the features you pick/ }).click();
  await page.getByRole("button", { name: "Turn on encryption" }).click();
  const wizard = page.getByRole("dialog", { name: "Turn on encryption" });
  await expect(wizard.getByText("Before you start")).toBeVisible();
  await wizard.getByRole("button", { name: "Continue" }).click();
  await expect(wizard.getByText("Pick at least two.", { exact: false })).toBeVisible({ timeout: 30_000 });
  await expect(wizard.getByRole("status")).toHaveText("0 of 2 needed");
  await expect(wizard.getByText("1 trusted device so far", { exact: false })).toBeVisible();
  await expect(wizard.getByRole("button", { name: "Continue" })).toBeDisabled();

  // Recovery key: shown once, then groups 3 and 7 typed back.
  await wizard.getByRole("button", { name: "Add Recovery key" }).click();
  const key = wizard.getByRole("list", { name: "Your recovery key" });
  await expect(key.getByRole("listitem")).toHaveCount(9, { timeout: 30_000 });
  const groups = (await key.getByRole("listitem").allTextContents()).map((t) => t.replace(/^Group \d+: /, "").trim());
  await wizard.getByLabel("Group 3").fill(groups[2] === "ZZZZ" ? "YYYY" : "ZZZZ");
  await wizard.getByLabel("Group 7").fill(groups[6]!);
  await wizard.getByRole("button", { name: "Check and continue" }).click();
  await expect(wizard.getByRole("alert")).toHaveText("Those groups don't match. Check the key you saved and try again.");
  await wizard.getByLabel("Group 3").fill(groups[2]!);
  await wizard.getByRole("button", { name: "Check and continue" }).click();
  await expect(wizard.getByRole("status")).toHaveText("1 of 2 needed", { timeout: 30_000 });

  // Passphrase: at least 12 characters, not a common one, typed twice.
  await wizard.getByRole("button", { name: "Add Encryption passphrase" }).click();
  await wizard.getByLabel("Passphrase", { exact: true }).fill("short");
  await expect(wizard.getByText("Too short: use at least 12 characters")).toBeVisible();
  await wizard.getByLabel("Passphrase", { exact: true }).fill(PASSPHRASE);
  await expect(wizard.getByText("Strong")).toBeVisible();
  await wizard.getByLabel("Type it again").fill(PASSPHRASE);
  await wizard.getByRole("button", { name: "Save passphrase" }).click();
  await expect(wizard.getByRole("status")).toHaveText("2 of 2 needed", { timeout: 60_000 });
  await wizard.getByRole("button", { name: "Continue" }).click();

  await expect(wizard.getByText("Encrypt my Personal space")).toBeVisible();
  await expect(wizard.getByText("Recovery key, Encryption passphrase")).toBeVisible();
  await wizard.getByRole("button", { name: "Turn on encryption" }).click();
  await expect(wizard.getByText("Encryption is on", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(wizard.getByRole("progressbar")).toBeVisible();
  await wizard.getByRole("button", { name: "Done" }).click();

  // Settings > Privacy now shows the switches, the real ways to unlock and the progress.
  await expect(levels.getByRole("radio", { name: /^Encrypted, with the features you pick/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("Features that need to read your notes")).toBeVisible();
  const methods = page.getByRole("region", { name: "Ways to unlock" });
  await expect(methods.getByText("Recovery key", { exact: true })).toBeVisible();
  await expect(methods.getByText("Encryption passphrase", { exact: true })).toBeVisible();
  await expect(page.getByText(/Encrypting your notes: 0 of 48/).first()).toBeVisible();
  // This browser stays open as the trusted one for the tests below.
  trusted = context as BrowserContext;
  await page.close();
});

test("a trusted browser unlocks by itself after a reload", async ({ browser }) => {
  const { context, page } = await open(browser, "encrypted");
  await page.goto(`${APP}/documents`);
  await expect(page.getByRole("navigation", { name: "Folio" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Unlock your encrypted notes" })).toHaveCount(0);
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

test("lowering: Standard needs the passphrase again; Fully encrypted only confirms", async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page } = await open(browser, "encrypted");
  await page.goto(`${APP}/settings/privacy`);
  const levels = page.getByRole("radiogroup", { name: "How private your notes are" });
  await levels.getByRole("radio", { name: /^Standard/ }).click();
  await page.getByRole("button", { name: "Change to Standard" }).click();
  const dialog = page.getByRole("dialog", { name: "Turn off encryption?" });
  await expect(dialog.getByRole("button", { name: "Turn off encryption" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Enter passphrase" }).click();
  await dialog.getByLabel("Encryption passphrase").fill("not the passphrase at all");
  await dialog.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("That passphrase didn't unlock your notes. Check it and try again.", { timeout: 30_000 });
  await dialog.getByLabel("Encryption passphrase").fill(PASSPHRASE);
  await dialog.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(dialog.getByText("Confirmed")).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByRole("button", { name: "Turn off encryption" })).toBeEnabled();
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

test("the unlock screen in a new browser: a bad recovery key, a wrong passphrase, then trust this browser", async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page } = await open(browser, "encrypted", { keys: "fresh" });
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
  const old = await open(browser, "encrypted");
  await old.page.goto(`${APP}/documents`);
  await expect(old.page.getByRole("navigation", { name: "Folio" })).toBeVisible({ timeout: 30_000 });

  const fresh = await open(browser, "encrypted", { keys: "fresh" });
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

  const another = await open(browser, "encrypted", { keys: "fresh" });
  await another.page.goto(`${APP}/documents`);
  await unlockCard(another.page).getByRole("button", { name: "Approve from another device" }).click({ timeout: 30_000 });
  await expect(ask.getByLabel(/^Code /)).toBeVisible({ timeout: 60_000 });
  await ask.getByRole("button", { name: "They don't match" }).click();
  await expect(ask.getByRole("alert")).toHaveText(/Approval cancelled\. If you weren't setting up a device, someone may have your password/);
  await expect(another.page.getByRole("dialog", { name: "Waiting for approval" }).getByRole("alert")).toBeVisible({ timeout: 60_000 });
  await Promise.all([old.context.close(), another.context.close()]);
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

test("devices: which can unlock, and removing one from encryption", async ({ browser }) => {
  test.setTimeout(120_000);
  // A browser with a session of its own (the others here share one: removing a device signs its session out).
  const other = await browser.newContext();
  const otherPage = await signIn(other, account);
  await stubStateOnPage(otherPage, "encrypted");
  await otherPage.goto(`${APP}/documents`);
  await unlockWithPassphrase(otherPage);
  const { context, page } = await open(browser, "encrypted");
  await page.goto(`${APP}/settings/devices`);
  const card = page.getByRole("region", { name: "Encrypted notes" });
  await expect(card.getByText("This device")).toBeVisible({ timeout: 30_000 });
  await expect(card.getByText(/Can unlock encrypted notes/).first()).toBeVisible();
  // The newest one is that browser.
  await card.getByRole("button", { name: /^Options for / }).first().click();
  await page.getByRole("menuitem", { name: "Remove from encryption" }).click();
  const dialog = page.getByRole("dialog", { name: /^Remove / });
  const rotate = dialog.getByRole("switch", { name: "Also change your encryption key" });
  await expect(rotate).toHaveAttribute("aria-checked", "false");
  await dialog.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText(/can't unlock encrypted notes any more/)).toBeVisible({ timeout: 30_000 });
  await otherPage.reload();
  await expect(otherPage).toHaveURL(/\/signin/, { timeout: 30_000 });
  await Promise.all([context.close(), other.close()]);
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
  const { context, page } = await open(browser, { spaces: { personal: { level: "selected", state: "on", switches: { foliAi: "ask", backgroundAi: false, searchEverywhere: false, apps: false, emailToNote: false, webClipper: false, notificationPreviews: false }, lockedCount: 0, keyHolders: 1 } }, sealedDocuments: [id] });
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

test("a workspace's privacy: the key holders, rotation and the invite note", async ({ browser }) => {
  test.setTimeout(180_000);
  const { context, page } = await open(browser, "encrypted");
  await page.goto(`${APP}/documents`);
  await createWorkspace(page, "Cipher Team");
  const ws = (await page.evaluate(() => localStorage.getItem("folevi:context")))!.replace(/^workspace:/, "");
  await page.goto(`${APP}/settings/workspace-privacy`);
  await expect(page.getByRole("radiogroup", { name: "How private your notes are" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("radio", { name: /^Standard/ })).toHaveAttribute("aria-checked", "true");
  const off = { foliAi: "off", backgroundAi: false, searchEverywhere: false, apps: false, emailToNote: false, webClipper: false, notificationPreviews: false };
  await setStub(page, {
    spaces: {
      personal: { level: "selected", state: "on", switches: { ...off, foliAi: "ask" }, lockedCount: 0, keyHolders: 1 },
      [ws]: { level: "full", state: "on", switches: off, lockedCount: 0, keyHolders: 1 },
    },
    rotation: { done: 120, total: 900 },
  });
  await expect(page.getByText("Only you can unlock this workspace.", { exact: false })).toBeVisible();
  const dir = process.env.E2EE_SHOTS;
  for (const scheme of dir ? (["light", "dark"] as const) : []) {
    await page.evaluate((s) => localStorage.setItem("folevi:appearance", s), scheme);
    await page.emulateMedia({ colorScheme: scheme });
    await page.reload();
    await expect(page.getByText("Only you can unlock this workspace.", { exact: false })).toBeVisible({ timeout: 30_000 });
    await settle(page);
    await page.screenshot({ path: `${dir}/27-workspace-privacy-${scheme}-desktop.png` });
  }
  await page.goto(`${APP}/settings/members`);
  await expect(page.getByText("Changing the workspace key… 120 of 900 notes")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("This workspace is end-to-end encrypted. New members set up encryption when they join", { exact: false })).toBeVisible();
  if (dir) {
    await settle(page);
    await page.screenshot({ path: `${dir}/28-workspace-members-dark-desktop.png` });
  }
  await context.close();
});

test("screenshots of every screen, light and dark, desktop and phone", async ({ browser }) => {
  const dir = process.env.E2EE_SHOTS;
  test.skip(!dir, "set E2EE_SHOTS=<dir> to save screenshots");
  test.setTimeout(1_200_000);
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
      const at = async (state: StubName | object, path: string, keys: "trusted" | "fresh" = "trusted", storage?: Storage) => {
        const o = await open(browser, state, { scheme, phone, keys, storage });
        await o.page.goto(`${APP}${path}`);
        await o.page.waitForTimeout(1500);
        return o;
      };
      {
        // The wizard needs an account without keys: a new person each time.
        const person = await newPerson(browser, "Wizard Person");
        const storage = await person.context.storageState();
        await person.context.close();
        const { context, page } = await at("none", "/settings/privacy", "fresh", storage);
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
        await expect(w.getByRole("status")).toBeVisible({ timeout: 30_000 });
        await shot(page, "05-wizard-ways-to-unlock");
        await w.getByRole("button", { name: "Add Recovery key" }).click();
        await expect(w.getByRole("list", { name: "Your recovery key" })).toBeVisible({ timeout: 30_000 });
        await shot(page, "06-wizard-recovery-key");
        const groups = (await w.getByRole("list", { name: "Your recovery key" }).getByRole("listitem").allTextContents()).map((t) => t.replace(/^Group \d+: /, "").trim());
        await w.getByLabel("Group 3").fill(groups[2]!);
        await w.getByLabel("Group 7").fill(groups[6]!);
        await w.getByRole("button", { name: "Check and continue" }).click();
        await w.getByRole("button", { name: "Add Encryption passphrase" }).click({ timeout: 30_000 });
        await w.getByLabel("Passphrase", { exact: true }).fill(PASSPHRASE);
        await shot(page, "07-wizard-passphrase");
        await w.getByLabel("Type it again").fill(PASSPHRASE);
        await w.getByRole("button", { name: "Save passphrase" }).click();
        await expect(w.getByRole("status")).toHaveText("2 of 2 needed", { timeout: 60_000 });
        await w.getByRole("button", { name: "Continue" }).click();
        await shot(page, "08-wizard-confirm");
        await w.getByRole("button", { name: "Turn on encryption" }).click();
        await expect(w.getByText("Encryption is on", { exact: true })).toBeVisible({ timeout: 30_000 });
        await shot(page, "09-wizard-done");
        await context.close();
      }
      {
        const { context, page } = await at("encrypted", "/settings/privacy");
        await expect(page.getByText("Features that need to read your notes")).toBeVisible({ timeout: 30_000 });
        await expect(page.getByRole("region", { name: "Ways to unlock" })).toBeVisible({ timeout: 30_000 });
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
        await row.getByRole("button", { name: "Details" }).click({ timeout: 30_000 });
        await row.scrollIntoViewIfNeeded();
        await shot(page, "13-migration-progress");
        await page.goto(`${APP}/documents`);
        await page.waitForTimeout(1500);
        await shot(page, "14-sidebar-migration-line");
        await context.close();
      }
      {
        const { context, page } = await at("encrypted", "/documents", "fresh");
        const card = unlockCard(page);
        await expect(card).toBeVisible({ timeout: 30_000 });
        await shot(page, "15-unlock");
        await card.getByRole("button", { name: "Enter passphrase" }).click();
        await card.getByLabel("Encryption passphrase").fill("not the passphrase at all");
        await card.getByRole("button", { name: "Unlock", exact: true }).click();
        await expect(card.getByRole("alert")).toBeVisible({ timeout: 30_000 });
        await shot(page, "16-unlock-wrong-passphrase");
        await card.getByLabel("Encryption passphrase").fill(PASSPHRASE);
        await card.getByRole("button", { name: "Unlock", exact: true }).click();
        await expect(page.getByRole("radiogroup", { name: "Your notes are unlocked" })).toBeVisible({ timeout: 30_000 });
        await shot(page, "17-unlock-trust-choice");
        // Leave it as a public computer, so the browser list stays short.
        await page.getByRole("radio", { name: /^This is a public or shared computer/ }).click();
        await page.getByRole("button", { name: "Continue" }).click();
        await context.close();
      }
      {
        const old = await at("encrypted", "/documents");
        const fresh = await at("encrypted", "/documents", "fresh");
        await unlockCard(fresh.page).getByRole("button", { name: "Approve from another device" }).click({ timeout: 30_000 });
        const ask = old.page.getByRole("dialog", { name: "Approve a new device?" });
        await expect(ask.getByLabel(/^Code /)).toBeVisible({ timeout: 60_000 });
        await expect(fresh.page.getByRole("dialog", { name: "Waiting for approval" }).getByLabel(/^Code /)).toBeVisible({ timeout: 30_000 });
        await shot(fresh.page, "18-approve-new-device-code");
        await shot(old.page, "19-approve-trusted-device");
        await ask.getByRole("button", { name: "They don't match" }).click();
        await shot(old.page, "20-approve-dont-match");
        await Promise.all([old.context.close(), fresh.context.close()]);
      }
      {
        const { context, page } = await at("consent", "/documents");
        await expect(page.getByRole("dialog", { name: "Send to Foli AI?" })).toBeVisible({ timeout: 30_000 });
        await shot(page, "21-foli-ai-consent");
        await context.close();
      }
      {
        const { context, page } = await at("encrypted", "/settings/devices");
        const card = page.getByRole("region", { name: "Encrypted notes" });
        await expect(card.getByText("This device")).toBeVisible({ timeout: 30_000 });
        await card.scrollIntoViewIfNeeded();
        await shot(page, "22-devices");
        const menu = card.getByRole("button", { name: /^Options for / }).first();
        if (await menu.count()) {
          await menu.click();
          await page.getByRole("menuitem", { name: "Remove from encryption" }).click();
          await page.getByRole("dialog", { name: /^Remove / }).getByRole("switch", { name: "Also change your encryption key" }).click();
          await shot(page, "23-devices-remove");
        }
        await context.close();
      }
      {
        const { context, page } = await at({ spaces: { personal: { level: "selected", state: "on", switches: { foliAi: "ask", backgroundAi: false, searchEverywhere: false, apps: false, emailToNote: false, webClipper: false, notificationPreviews: false }, lockedCount: 1, keyHolders: 1 } }, sealedDocuments: [id] }, welcomePath);
        await page.getByRole("group", { name: "Page" }).getByRole("button", { name: /^Share/ }).click({ timeout: 30_000 });
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
