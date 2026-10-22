// Helpers for the end-to-end encryption specs (docs/E2EE_DESIGN.md §11.4).
//
// Until WP6, WP7 and WP8 land, the screens run on components/e2ee/__stubs__.ts, whose state can be forced in
// development through localStorage["folevi.e2ee.stub"]. The screen-level specs use that (`stubState`) and
// pass now. The flow specs that need the real keys, router and server skip themselves without `HAS_BACKEND`: they run
// once E2EE_BACKEND=1 is set at integration, when the stubs are deleted.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { APP } from "./helpers";

export const NEEDS_BACKEND = "needs the real E2EE backend (WP2 to WP8); run with E2EE_BACKEND=1 after integration";
/** Whether the real backend is there (set at integration); the flow specs skip themselves without it. */
export const HAS_BACKEND = Boolean(process.env.E2EE_BACKEND);

const switches = { foliAi: "ask", backgroundAi: false, searchEverywhere: false, apps: false, emailToNote: false, webClipper: false, notificationPreviews: false };
const off = { ...switches, foliAi: "off" };
const space = (level: "selected" | "full", extra: object = {}) => ({ level, state: "on", switches: level === "full" ? off : switches, lockedCount: 0, keyHolders: 1, ...extra });

/**
 * Named stub states (StubState in components/e2ee/__stubs__.ts): what WP7 and WP8 would report. The lock state
 * and the ways to unlock are WP6's, real: a browser holding the account's trusted keys unlocks, a fresh one is
 * locked.
 */
export const STUB = {
  none: {},
  encrypted: { spaces: { personal: space("selected") } },
  full: { spaces: { personal: space("full") } },
  migrating: {
    spaces: { personal: { ...space("selected"), state: "enabling" } },
    migrations: { personal: { direction: "seal", phase: "history", documents: { done: 1240, total: 1800 }, history: { done: 340, total: 2100 }, files: { done: 12, total: 80, bytesLeft: 1_200_000_000 }, paused: false, failed: [{ documentId: "01JZZZZZZZZZZZZZZZZZZZZZZZ", title: "Trip notes" }] } },
  },
  consent: {
    spaces: { personal: space("selected") },
    consent: { notes: [{ id: "n1", title: "Welcome to Folevi", chars: 2480 }, { id: "n2", title: "Trip notes", chars: 9120 }] },
  },
} as const;
export type StubName = keyof typeof STUB;

/**
 * The first page of each tab in `context` starts with this stub state (or a custom one); reloads keep what
 * the screens changed since.
 */
export async function stubState(context: BrowserContext, state: StubName | object) {
  const value = typeof state === "string" ? STUB[state] : state;
  await context.addInitScript((v) => {
    try {
      if (location.origin === "null" || sessionStorage.getItem("folevi.e2ee.stub.seeded")) return;
      localStorage.setItem("folevi.e2ee.stub", JSON.stringify(v));
      sessionStorage.setItem("folevi.e2ee.stub.seeded", "1");
    } catch {
      // A page without storage.
    }
  }, value);
}

/** The same for one page (a tab in a context that's shared, such as the trusted browser's). */
export async function stubStateOnPage(page: Page, state: StubName | object) {
  const value = typeof state === "string" ? STUB[state] : state;
  await page.addInitScript((v) => {
    try {
      if (location.origin === "null" || sessionStorage.getItem("folevi.e2ee.stub.seeded")) return;
      localStorage.setItem("folevi.e2ee.stub", JSON.stringify(v));
      sessionStorage.setItem("folevi.e2ee.stub.seeded", "1");
    } catch {
      // A page without storage.
    }
  }, value);
}

/**
 * A page in the browser that holds the account's trusted device keys. Those keys are non-extractable
 * CryptoKeys in IndexedDB, which a saved storage state can't carry, so the trusted browser is one context
 * kept open for the whole file; each "context" handed out is one of its tabs (closing it closes the tab).
 */
export async function trustedPage(context: BrowserContext, state: StubName | object, opts: { scheme?: "light" | "dark"; phone?: boolean } = {}): Promise<{ context: { close(): Promise<void> }; page: Page }> {
  const page = await context.newPage();
  await page.setViewportSize(opts.phone ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: opts.scheme ?? "light" });
  await page.addInitScript((s) => localStorage.setItem("folevi:appearance", s), opts.scheme ?? "light");
  await stubStateOnPage(page, state);
  return { context: { close: () => page.close() }, page };
}

/** Changes the stub state of a page that's already open (the stubs module puts its setter on window in development). */
export async function setStub(page: Page, patch: object) {
  await page.evaluate((p) => (window as unknown as { __foleviE2eeStub: { set(p: object): void } }).__foleviE2eeStub.set(p), patch);
}

// ─── Flow helpers for the specs that need the real backend ─────────────────────────────────────────────────

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const PASSPHRASE = "lantern orchard velvet compass";

/** A marker string the no-plaintext scan looks for (§11.2): unique per run. */
export function marker(kind: "TITLE" | "BODY" | "FOLDER" | "TAG" | "COMMENT" | "FILE" | "VERSION"): string {
  return `ZQXJ-${kind}-${Math.random().toString(16).slice(2, 10)}`;
}

/** testSupport.e2eeScan on the dev deployment (refused in production): where any marker turns up. */
export function e2eeScan(markers: string[]): { clean: boolean; hits: { table: string; id: string; encoding: string }[] } {
  const out = execFileSync("npx", ["convex", "run", "testSupport:e2eeScan", JSON.stringify({ markers })], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 300_000,
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
    await w.getByRole("button", { name: "Add Recovery key" }).click();
    const groups = (await w.getByRole("list", { name: "Your recovery key" }).getByRole("listitem").allTextContents()).map((t) => t.replace(/^Group \d+: /, "").trim());
    recoveryKey = groups.join("-");
    await w.getByLabel("Group 3").fill(groups[2]!);
    await w.getByLabel("Group 7").fill(groups[6]!);
    await w.getByRole("button", { name: "Check and continue" }).click();
    await w.getByRole("button", { name: "Add Encryption passphrase" }).click();
    await w.getByLabel("Passphrase", { exact: true }).fill(PASSPHRASE);
    await w.getByLabel("Type it again").fill(PASSPHRASE);
    await w.getByRole("button", { name: "Save passphrase" }).click();
    await expect(w.getByRole("status")).toHaveText("2 of 2 needed");
    await w.getByRole("button", { name: "Continue" }).click();
  }
  await w.getByRole("button", { name: "Turn on encryption" }).click();
  await expect(w.getByText("Encryption is on", { exact: true })).toBeVisible({ timeout: 30_000 });
  await w.getByRole("button", { name: "Done" }).click();
  return { recoveryKey };
}

/** Waits until Settings > Privacy no longer shows a migration running. */
export async function migrationDone(page: Page, timeout = 180_000) {
  await page.goto(`${APP}/settings/privacy`);
  await expect(page.getByRole("region", { name: /(Encrypting|Decrypting) your notes/ })).toHaveCount(0, { timeout });
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
  await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  const input = page.getByRole("combobox", { name: /Search documents/ });
  await input.fill(query);
  return page.getByRole("dialog", { name: "Search and commands" }).getByRole("option");
}
