// Helpers for the end-to-end encryption specs (docs/E2EE_DESIGN.md §11.4). They run against the real keys,
// router, migration and server on the dev deployment (the "e2ee" feature flag must be on there).
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { APP } from "./helpers";

/**
 * A tab in the browser that holds the account's trusted device keys. Those keys are non-extractable
 * CryptoKeys in IndexedDB, which a saved storage state can't carry, so the trusted browser is one context
 * kept open for a whole file; each "context" handed out is one of its tabs (closing it closes the tab).
 */
export async function trustedPage(context: BrowserContext, opts: { scheme?: "light" | "dark"; phone?: boolean } = {}): Promise<{ context: { close(): Promise<void> }; page: Page }> {
  const page = await context.newPage();
  await page.setViewportSize(opts.phone ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: opts.scheme ?? "light" });
  await page.addInitScript((s) => localStorage.setItem("folevi:appearance", s), opts.scheme ?? "light");
  return { context: { close: () => page.close() }, page };
}

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const PASSPHRASE = "lantern orchard velvet compass";

/** A marker string the no-plaintext scan looks for (§11.2): unique per run. */
export function marker(kind: "TITLE" | "BODY" | "FOLDER" | "TAG" | "COMMENT" | "FILE" | "VERSION"): string {
  return `ZQXJ-${kind}-${Math.random().toString(16).slice(2, 10)}`;
}

/**
 * Rows made before this are left out of a scan: everything a spec writes (its fresh account, notes, files and
 * jobs) comes after its worker started. Ten minutes of margin for a clock that differs from the deployment's.
 */
const SCAN_SINCE = Date.now() - 10 * 60_000;

/**
 * testSupport.e2eeScan on the dev deployment (refused in production): where any marker turns up. Scoped to
 * what was made since this worker started (and to `email`'s spaces when given), so it takes seconds on a
 * deployment full of other runs' data.
 */
export function e2eeScan(markers: string[], scope: { since?: number; email?: string } = {}): { clean: boolean; hits: { table: string; id: string; encoding: string }[] } {
  const args = { markers, since: scope.since ?? SCAN_SINCE, ...(scope.email ? { email: scope.email } : {}) };
  const out = execFileSync("npx", ["convex", "run", "testSupport:e2eeScan", JSON.stringify(args)], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 900_000,
    env: { ...process.env, CONVEX_AGENT_MODE: process.env.CONVEX_AGENT_MODE ?? "anonymous" },
  });
  return JSON.parse(out.slice(out.indexOf("{")));
}

/** emailNotes.receive on the dev deployment: one parsed email for an address, as the inbound mail webhook files it. */
export function receiveMail(args: Record<string, unknown>): { outcome: string } {
  const out = execFileSync("npx", ["convex", "run", "emailNotes:receive", JSON.stringify(args)], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, CONVEX_AGENT_MODE: process.env.CONVEX_AGENT_MODE ?? "anonymous" },
  });
  return JSON.parse(out.slice(out.indexOf("{")));
}

/**
 * Settings > Privacy → the wizard with a recovery key and a passphrase → Turn on encryption. Returns the
 * recovery key it showed. `workspace` opens Settings > Workspace > Privacy instead.
 */
export async function turnOnEncryption(page: Page, opts: { level?: "selected" | "full"; workspace?: boolean } = {}): Promise<{ recoveryKey: string }> {
  await page.goto(`${APP}/settings/${opts.workspace ? "workspace-privacy" : "privacy"}`);
  await page.getByRole("radio", { name: opts.level === "full" ? /^Fully encrypted/ : /^Encrypted, with the features you pick/ }).click();
  await page.getByRole("button", { name: "Turn on encryption" }).click();
  const w = page.getByRole("dialog", { name: opts.workspace ? "Encrypt this workspace" : "Turn on encryption" });
  await w.getByRole("button", { name: "Continue" }).click();
  let recoveryKey = "";
  // Making the keys takes a moment (and remounts the app); the wizard then shows the ways to unlock, or goes
  // straight to confirm for someone who already has two.
  const next = page.locator('[data-e2ee-step="methods"], [data-e2ee-step="confirm"]');
  await expect(next).toBeVisible({ timeout: 60_000 });
  if ((await next.getAttribute("data-e2ee-step")) === "methods") {
    recoveryKey = await addTwoMethods(page, w);
    await w.getByRole("button", { name: "Continue" }).click();
  }
  await w.getByRole("button", { name: "Turn on encryption" }).click();
  await expect(w.getByText("Encryption is on", { exact: true })).toBeVisible({ timeout: 30_000 });
  await w.getByRole("button", { name: "Done" }).click();
  return { recoveryKey };
}

/** In an open wizard at the ways to unlock: a recovery key (checked) and the passphrase. Returns the key. */
export async function addTwoMethods(page: Page, w: ReturnType<Page["getByRole"]>): Promise<string> {
  await expect(page.locator('[data-e2ee-step="methods"]')).toBeVisible({ timeout: 60_000 });
  await w.getByRole("button", { name: "Add Recovery key" }).click();
  const list = w.getByRole("list", { name: "Your recovery key" });
  await expect(list.getByRole("listitem")).toHaveCount(9, { timeout: 30_000 });
  const groups = (await list.getByRole("listitem").allTextContents()).map((t) => t.replace(/^Group \d+: /, "").trim());
  await w.getByLabel("Group 3").fill(groups[2]!);
  await w.getByLabel("Group 7").fill(groups[6]!);
  await w.getByRole("button", { name: "Check and continue" }).click();
  await w.getByRole("button", { name: "Add Encryption passphrase" }).click({ timeout: 30_000 });
  await w.getByLabel("Passphrase", { exact: true }).fill(PASSPHRASE);
  await w.getByLabel("Type it again").fill(PASSPHRASE);
  await w.getByRole("button", { name: "Save passphrase" }).click();
  await expect(w.getByRole("status")).toHaveText("2 of 2 needed", { timeout: 60_000 });
  return groups.join("-");
}

/** Waits until Settings > Privacy no longer shows a migration running. */
export async function migrationDone(page: Page, timeout = 180_000) {
  await page.goto(`${APP}/settings/privacy`);
  const progress = page.getByRole("region", { name: /(Encrypting|Decrypting) your notes/ });
  // The progress shows once the page has loaded the job: wait for it a moment first, or "none shown" passes
  // before the page knows (a job that already finished never shows, hence the catch).
  await progress.first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
  await expect(progress).toHaveCount(0, { timeout });
}

/** The unlock screen with a passphrase, then the trust choice. */
export async function unlockWithPassphrase(page: Page, mode: "browser" | "public" = "browser") {
  const card = page.getByRole("region", { name: "Unlock your encrypted notes" });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByRole("button", { name: "Enter passphrase" }).click();
  await card.getByLabel("Encryption passphrase").fill(PASSPHRASE);
  await card.getByRole("button", { name: "Unlock", exact: true }).click();
  const choice = page.getByRole("radiogroup", { name: "Your notes are unlocked" });
  await choice.getByRole("radio", { name: mode === "browser" ? /^Trust this browser/ : /^This is a public or shared computer/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("navigation", { name: "Folio" })).toBeVisible({ timeout: 30_000 });
}

/** A new note with a title and one line of text; returns its address. */
export async function newNote(page: Page, title: string, body: string): Promise<string> {
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}/);
  await expect(page.getByRole("textbox", { name: "Title" })).toBeFocused();
  await page.keyboard.type(title);
  await page.keyboard.press("Enter");
  await page.keyboard.type(body);
  await expect(page.getByTestId("sync-status")).toHaveAttribute("data-status", "saved", { timeout: 20_000 });
  return page.url().replace(/\?.*$/, "");
}

/** ⌘K search for `query`: the palette's results. */
export async function paletteResults(page: Page, query: string) {
  await expect(page.getByRole("navigation", { name: "Folio" })).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  const input = page.getByRole("combobox", { name: /Search documents/ });
  await input.fill(query);
  return page.getByRole("dialog", { name: "Search and commands" }).getByRole("option");
}
