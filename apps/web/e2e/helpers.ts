import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { TOTP } from "otpauth";

export const APP = process.env.E2E_BASE_URL ?? "http://app.localhost:3000";
export const PASSWORD = "quiet folio test password";
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export function uniqueEmail(prefix = "e2e"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
}

/** Current 6-digit code for an authenticator secret (what an authenticator app would show). */
export function totpCode(secret: string): string {
  return new TOTP({ secret: secret.replace(/\s/g, ""), digits: 6, period: 30 }).generate();
}

export interface Account {
  email: string;
  name: string;
  password: string;
  totpSecret: string;
  backupCodes: string[];
}

/** Latest identity email of a kind for an address, from the development mailbox (non-production only). */
export async function mailboxLink(request: APIRequestContext, email: string, key: "auth_verify_email" | "auth_password_reset"): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const res = await request.get(`${APP}/api/dev/mailbox?to=${encodeURIComponent(email)}`);
    const { messages } = (await res.json()) as { messages: { key: string; actionUrl: string }[] };
    const hit = messages.find((m) => m.key === key);
    if (hit) return hit.actionUrl;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no ${key} email for ${email}`);
}

/** Fills and submits the sign-up form; ends on "Check your inbox". */
export async function signUp(page: Page, opts: { email: string; name: string; password?: string }) {
  await page.goto(`${APP}/signup`);
  await page.getByLabel("Your name").fill(opts.name);
  await page.getByLabel("Email").fill(opts.email);
  await page.getByLabel("Password", { exact: true }).fill(opts.password ?? PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible({ timeout: 20_000 });
}

/** Opens the emailed confirmation link; the person is signed in and lands in the app. */
export async function confirmEmail(page: Page, email: string) {
  const link = await mailboxLink(page.context().request, email, "auth_verify_email");
  await page.goto(link);
  await page.waitForURL((url) => url.host.startsWith("app.") && !/^\/(signin|signup|verify-email|two-factor|api)/.test(url.pathname), { timeout: 20_000 });
}

/**
 * Turns on (optional) two-step verification: password → scan → code → backup codes, then continues.
 * Opens the setup page itself unless `opts.onPage` says it's already showing.
 */
export async function enrollTwoFactor(page: Page, opts: { password?: string; onPage?: boolean } = {}): Promise<{ totpSecret: string; backupCodes: string[] }> {
  if (!opts.onPage) await page.goto(`${APP}/two-factor/setup?returnTo=${encodeURIComponent("/documents")}`);
  await page.getByLabel("Password", { exact: true }).fill(opts.password ?? PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  const totpSecret = ((await page.getByTestId("totp-secret").textContent({ timeout: 20_000 })) ?? "").replace(/\s/g, "");
  await page.getByLabel("6-digit code").fill(totpCode(totpSecret));
  await page.getByRole("button", { name: "Turn on two-step verification" }).click();
  await expect(page.getByRole("heading", { name: "Save your backup codes" })).toBeVisible({ timeout: 20_000 });
  const backupCodes = (await page.getByRole("list", { name: "Backup codes" }).locator("li").allTextContents()).map((c) => c.trim());
  await page.getByRole("checkbox", { name: /I saved these codes/ }).check();
  await page.getByRole("button", { name: "Continue to Folevi" }).click();
  return { totpSecret, backupCodes };
}

/** A brand-new, verified account with two-step verification turned on, signed in on `context`. */
export async function createAccount(context: BrowserContext, opts: { name?: string; email?: string } = {}): Promise<{ page: Page; account: Account }> {
  const page = await context.newPage();
  const email = opts.email ?? uniqueEmail();
  const name = opts.name ?? "Test Person";
  await signUp(page, { email, name });
  await confirmEmail(page, email);
  const { totpSecret, backupCodes } = await enrollTwoFactor(page);
  await page.waitForURL(/\/documents/, { timeout: 20_000 });
  return { page, account: { email, name, password: PASSWORD, totpSecret, backupCodes } };
}

/** Signs an existing account in on `context` (password + authenticator code). */
export async function signIn(context: BrowserContext, account: Pick<Account, "email" | "password" | "totpSecret">, opts: { trustDevice?: boolean; returnTo?: string } = {}): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${APP}/signin${opts.returnTo ? `?returnTo=${encodeURIComponent(opts.returnTo)}` : ""}`);
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/two-factor(\?|$)/, { timeout: 20_000 });
  // Avoid reusing a code in the same 30-second window as a previous verification for this account.
  await page.getByLabel("6-digit code").fill(totpCode(account.totpSecret));
  if (opts.trustDevice) await page.getByRole("checkbox", { name: /Trust this device/ }).check();
  await page.getByRole("button", { name: "Verify" }).click();
  await page.waitForURL((url) => !/\/(signin|two-factor)/.test(url.pathname), { timeout: 20_000 });
  return page;
}

/** Walks the three-step onboarding and opens the Welcome document. */
export async function completeOnboarding(page: Page) {
  await page.getByRole("button", { name: "Continue" }).click({ timeout: 30_000 });
  await page.getByRole("radio", { name: "Light" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Open “Welcome to Folevi”" }).click();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Welcome to Folevi");
}

/**
 * Signs up a brand-new person (verified email + 2FA), completes onboarding; lands on the Welcome document
 * in their Personal (no workspaces yet — Personal is not a workspace).
 */
export async function newPerson(browser: Browser, name = "Test Person"): Promise<{ context: BrowserContext; page: Page; email: string; account: Account }> {
  const context = await browser.newContext();
  const { page, account } = await createAccount(context, { name });
  await completeOnboarding(page);
  return { context, page, email: account.email, account };
}

/** The switcher at the bottom of the sidebar (Personal, your workspaces, and account items). */
export function switcher(page: Page): Locator {
  return page.getByRole("navigation", { name: "Folio" }).getByRole("button", { name: /— Personal, workspaces and account$/ });
}

/** Opens the switcher and picks Personal, or the workspace called `name`. */
export async function switchTo(page: Page, name: "Personal" | (string & {})) {
  await showFolders(page);
  await switcher(page).click();
  await page.getByRole("menuitemradio", { name, exact: true }).click();
  await expect(switcher(page)).toHaveAccessibleName(`${name} — Personal, workspaces and account`);
}

/** Creates a team workspace from the switcher and switches to it. */
export async function createWorkspace(page: Page, name: string) {
  await showFolders(page);
  await switcher(page).click();
  await page.getByRole("menuitem", { name: "New workspace…" }).click();
  await page.getByRole("dialog", { name: "New workspace" }).getByLabel("Workspace name").fill(name);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(switcher(page)).toHaveAccessibleName(`${name} — Personal, workspaces and account`);
}

/** Grants a platform role on the local (non-production) deployment via the Convex CLI. */
export function grantPlatformRole(email: string, role: "super_admin" | "support_admin" | "ops_admin" = "super_admin") {
  execFileSync("npx", ["convex", "run", "testSupport:grantPlatformRole", JSON.stringify({ email, role })], {
    cwd: REPO_ROOT,
    stdio: "ignore",
    timeout: 60_000,
    env: { ...process.env, CONVEX_AGENT_MODE: process.env.CONVEX_AGENT_MODE ?? "anonymous" },
  });
}

/** Ends an account's Pro trial on the local deployment (so Free's limits apply). */
export function endTrial(email: string) {
  execFileSync("npx", ["convex", "run", "testSupport:endTrial", JSON.stringify({ email })], {
    cwd: REPO_ROOT,
    stdio: "ignore",
    timeout: 60_000,
    env: { ...process.env, CONVEX_AGENT_MODE: process.env.CONVEX_AGENT_MODE ?? "anonymous" },
  });
}

export async function waitForSaved(page: Page) {
  await expect(page.getByTestId("sync-status")).toHaveAttribute("data-status", "saved", { timeout: 20_000 });
}

/**
 * Pages show their own sidebar (contents, tasks, attachments, find). Tests that drive the app navigation
 * from a page switch the left sidebar to the folders view, as a person would from the sidebar menu.
 */
export async function showFolders(page: Page) {
  // The Folders / Document choice only exists on notes; elsewhere the sidebar already shows folders.
  if (!/\/d\/[0-9A-Z]{26}/.test(page.url())) return;
  await page.getByRole("button", { name: "Sidebar", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Show folders" }).click();
  await expect(page.getByRole("navigation", { name: "Folio" })).toBeVisible();
}

/** Seeds demo folders, tags and notes for an account on the local (non-production) deployment. */
export function seedDemo(email: string, counts: { notes: number; folders: number; tags: number }) {
  execFileSync("npx", ["convex", "run", "testSupport:seedDemoContent", JSON.stringify({ email, ...counts })], {
    cwd: REPO_ROOT,
    stdio: "ignore",
    timeout: 60_000,
    env: { ...process.env, CONVEX_AGENT_MODE: process.env.CONVEX_AGENT_MODE ?? "anonymous" },
  });
}

/** Opens a page tool (Insert, Format, Style, Info) from the dock at the bottom of the note; returns its panel. */
export async function openTool(page: Page, name: "Insert" | "Format" | "Style" | "Info") {
  const button = page.getByRole("toolbar", { name: "Page tools" }).getByRole("button", { name, exact: true });
  if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
  const panel = page.getByRole("region", { name, exact: true });
  await expect(panel).toBeVisible();
  return panel;
}

/** Chooses an option in one of Folevi's dropdowns (the custom Select: a combobox with a listbox). */
export async function pick(combobox: Locator, option: string) {
  await combobox.click();
  await expect(combobox).toHaveAttribute("aria-expanded", "true");
  const list = combobox.page().locator(`[id="${await combobox.getAttribute("aria-controls")}"]`);
  await list.getByRole("option", { name: option, exact: true }).click();
  await expect(combobox).toHaveAttribute("aria-expanded", "false");
}

/**
 * Waits until nothing on the page is animating (CSS animations and colour transitions included), so an
 * accessibility scan measures final colours, not a frame mid-fade. Slow CI machines need more than a
 * fixed pause.
 */
export async function settle(page: Page, timeout = 10_000) {
  await page
    .waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity), undefined, { timeout })
    .catch(() => undefined);
}
