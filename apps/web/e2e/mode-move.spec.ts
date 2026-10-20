// Moving between "Keep notes on my devices" and a Folevi account, both ways (docs/LOCAL_MODE_PLAN.md §6,
// WP12), end to end against the dev deployment: the apps' built-in interface served by `next dev` with
// FOLEVI_BUILD=shell (port 3003), the FakeShell's library in the page (OPFS), and the Mac app's own sign-in
// bridge (apps/desktop/src/authBridge.ts) running here in Node, approving on the website as a real person.
//
//   E2E_BASE_URL=http://app.localhost:3002 E2E_NO_SERVER=1 npx playwright test e2e/mode-move.spec.ts --project account
// (E2E_SHELL_BASE_URL overrides http://localhost:3003.)
import { expect, request as playwrightRequest, test, type BrowserContext, type Page } from "@playwright/test";
import { createAuthBridge, type AuthBridge, type BridgeResponse } from "../../desktop/src/authBridge";
import { installFakeShell, type FakeShellConfig } from "./fixtures/localShell";
import { APP, newPerson } from "./helpers";

const SHELL = (process.env.E2E_SHELL_BASE_URL ?? "http://localhost:3003").replace(/\/$/, "");

test.skip(!process.env.E2E_BASE_URL, "needs the dev servers: E2E_BASE_URL=http://app.localhost:3002 and the shell on 3003");

test.beforeAll(async () => {
  const up = await fetch(`${SHELL}/`).then(
    (r) => r.ok,
    () => false,
  );
  test.skip(!up, `the shell dev server isn't running at ${SHELL} (pnpm --filter @folevi/web dev:shell)`);
});

/** The Mac app's sign-in bridge, here in Node, approving each sign-in as `approver` (signed in on the website). */
function nodeBridge(approver: () => Page) {
  const store = new Map<string, string>();
  const bridge: AuthBridge = createAuthBridge({
    serviceUrl: new URL(APP),
    fetch: (url, init) => fetch(url, init),
    openExternal: (url) => approve(url),
    store: { get: (n) => store.get(n) ?? null, set: (n, v) => void store.set(n, v), delete: (n) => void store.delete(n) },
    deviceName: () => "E2E Mac",
  });
  async function approve(url: string) {
    const page = approver();
    const state = new URL(url).searchParams.get("state")!;
    await page.goto(url);
    await expect(page.getByRole("heading", { name: "Sign in to Folevi app" })).toBeVisible({ timeout: 30_000 });
    const authorized = page.waitForResponse((r) => r.url().includes("/api/auth/native/authorize"));
    await page.getByRole("button", { name: "Continue" }).click();
    const { code } = (await (await authorized).json()) as { code: string };
    bridge.handleCallback(`folevi://auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`);
  }
  return { bridge, store };
}

/** The FakeShell (library, mode, everything else) with its `auth` answered by the Node bridge. */
async function prepare(context: BrowserContext, b: ReturnType<typeof nodeBridge>, cfg: FakeShellConfig) {
  await context.exposeFunction("__e2eAuthSignIn", () => b.bridge.signIn());
  await context.exposeFunction("__e2eAuthSignOut", () => b.bridge.signOut());
  await context.exposeFunction("__e2eAuthConvexToken", () => b.bridge.convexToken());
  await context.exposeFunction("__e2eAuthFetch", (path: string, init: unknown): Promise<BridgeResponse> => b.bridge.fetch(path, init));
  await context.addInitScript(installFakeShell, cfg);
  await context.addInitScript(() => {
    const w = window as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
    const shell = window.__foleviTestShell as unknown as { auth: unknown } | undefined;
    if (!shell) return;
    shell.auth = {
      signIn: () => w.__e2eAuthSignIn!(),
      signOut: () => w.__e2eAuthSignOut!(),
      fetch: (path: unknown, init: unknown) => w.__e2eAuthFetch!(path, init),
      convexToken: () => w.__e2eAuthConvexToken!(),
    };
  });
}

/** A note row in this device's copy of the library (IndexedDB), by title. */
async function libraryNote(page: Page, title: string): Promise<{ id: string; title: string } | null> {
  return await page.evaluate(async (wanted) => {
    const names = (await indexedDB.databases()).map((d) => d.name ?? "").filter((n) => n.startsWith("folevi-local-"));
    for (const name of names) {
      const db = await new Promise<IDBDatabase>((ok, ko) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => ok(r.result);
        r.onerror = () => ko(r.error);
      });
      if (!db.objectStoreNames.contains("rows")) {
        db.close();
        continue;
      }
      const rows = await new Promise<unknown[]>((ok, ko) => {
        const r = db.transaction("rows").objectStore("rows").getAll();
        r.onsuccess = () => ok(r.result);
        r.onerror = () => ko(r.error);
      });
      db.close();
      const hit = rows.find((r) => (r as { title?: unknown; revision?: unknown }).title === wanted && typeof (r as { revision?: unknown }).revision === "number");
      if (hit) return hit as { id: string; title: string };
    }
    return null;
  }, title);
}

async function libraryFile(page: Page, path: string): Promise<string | null> {
  return await page.evaluate(async (p) => {
    const r = await window.__foleviTestShell!.library.read(p).catch(() => null);
    return r && "bytes" in r ? new TextDecoder().decode(r.bytes) : null;
  }, path);
}

test("a library moves into an account: the same notes under their own ids, and the folder says where they went", async ({ browser }) => {
  test.setTimeout(420_000);
  const person = await newPerson(browser, "Library Mover");
  const b = nodeBridge(() => person.page);
  const context = await browser.newContext();
  await prepare(context, b, { initialMode: "local", libraryName: `move-up-${Date.now()}`, platform: "mac" });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // A library on this Mac, with its welcome notes.
  await page.goto(`${SHELL}/`);
  await expect.poll(() => libraryNote(page, "Welcome to Folevi"), { timeout: 90_000 }).not.toBeNull();
  const welcome = (await libraryNote(page, "Welcome to Folevi"))!;
  const shelf = (await libraryNote(page, "Reading Shelf"))!;
  expect(shelf).not.toBeNull();

  // Settings > Import & export: sign in (in "the browser"), and the app comes back signed in, ready to move.
  await page.goto(`${SHELL}/settings/data`);
  await page.getByTestId("move-to-account").getByRole("button", { name: "Sign in and move…" }).click({ timeout: 90_000 });
  const summary = page.getByTestId("migration-summary");
  await expect(summary).toBeVisible({ timeout: 180_000 });
  await expect(summary).toContainText(/notes?, \d+ folders?/);
  // Facts, never a price.
  await expect(page.getByText(/\$|price|upgrade/i)).toHaveCount(0);
  await page.getByRole("button", { name: "Move my notes" }).click();
  await expect(page.getByRole("heading", { name: "Your notes are in Folevi" })).toBeVisible({ timeout: 300_000 });
  await expect(page.getByTestId("migration-problems")).toHaveCount(0);

  // The library's folder is as it was, plus where it went.
  const manifest = JSON.parse((await libraryFile(page, "folevi-library.json"))!) as { migratedTo?: string };
  expect(manifest.migratedTo).toBeTruthy();

  // Signed in, the app opens; the library's notes are in the account under their own ids.
  await page.getByRole("button", { name: "Open Folevi" }).click();
  await expect(page.getByRole("navigation", { name: "Folio" })).toBeVisible({ timeout: 90_000 });
  await person.page.goto(`${APP}/d/${welcome.id}`);
  await expect(person.page.getByRole("textbox", { name: "Title" })).toHaveValue("Welcome to Folevi", { timeout: 60_000 });
  await person.page.goto(`${APP}/d/${shelf.id}`);
  await expect(person.page.getByRole("textbox", { name: "Title" })).toHaveValue("Reading Shelf", { timeout: 60_000 });
  // The collection came with its books.
  await expect(person.page.getByRole("link", { name: "Open Salt and Signal" }).first()).toBeVisible({ timeout: 30_000 });

  // Later, the local copy can go.
  await page.goto(`${SHELL}/settings/data`);
  await expect(page.getByTestId("remove-local-copy")).toBeVisible({ timeout: 60_000 });

  expect(errors.filter((e) => !/ResizeObserver/.test(e))).toEqual([]);
  await context.close();
  await person.context.close();
});

test("an account comes down into a library on this Mac, then this Mac signs out and the account goes on", async ({ browser }) => {
  test.setTimeout(420_000);
  const person = await newPerson(browser, "Account Keeper");
  const welcome = new URL(person.page.url()).pathname;
  expect(welcome).toMatch(/^\/d\/[0-9A-Z]{26}$/);
  const welcomeId = welcome.slice(3);
  const b = nodeBridge(() => person.page);
  const context = await browser.newContext();
  await prepare(context, b, { initialMode: "account", libraryName: `move-down-${Date.now()}`, platform: "mac" });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // Signed in through the browser.
  await page.goto(`${SHELL}/settings/data`);
  await page.getByTestId("shell-sign-in").getByRole("button", { name: "Sign in to Folevi" }).click({ timeout: 90_000 });
  await page.getByTestId("move-to-this-mac").click({ timeout: 180_000 });
  const dialog = page.getByRole("dialog", { name: "Keep your notes on this Mac" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Bring my notes here" }).click();
  await expect(page.getByRole("heading", { name: "Your notes are on this Mac" })).toBeVisible({ timeout: 300_000 });
  await expect(page.getByText("Your Folevi account isn’t deleted")).toBeVisible();
  const token = b.store.get("auth.session")!;
  expect(token).toBeTruthy();

  // What only the server keeps is written down in the library.
  const record = JSON.parse((await libraryFile(page, "exported/server-only.json"))!) as { format: string };
  expect(record.format).toBe("folevi-server-only");

  // Sign out: the session is revoked, and the app opens the library in local mode.
  await page.getByRole("button", { name: "Sign out and open my library" }).click();
  await expect.poll(() => b.bridge.signedIn(), { timeout: 60_000 }).toBe(false);
  await expect.poll(() => libraryNote(page, "Welcome to Folevi"), { timeout: 90_000 }).toMatchObject({ id: welcomeId });
  const direct = await playwrightRequest.newContext();
  expect((await direct.get(`${APP}/api/auth/convex/token`, { headers: { authorization: `Bearer ${token}` } })).status()).toBe(401);
  await direct.dispose();
  // The account's own note opens from the library, under the same id.
  await page.goto(`${SHELL}${welcome}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Welcome to Folevi", { timeout: 90_000 });
  // The app opens in local mode from now on.
  expect(await page.evaluate(() => window.__foleviTestShell!.initialMode)).toBe("local");
  // And the account is still there on the website.
  await person.page.goto(`${APP}${welcome}`);
  await expect(person.page.getByRole("textbox", { name: "Title" })).toHaveValue("Welcome to Folevi", { timeout: 60_000 });

  expect(errors.filter((e) => !/ResizeObserver/.test(e))).toEqual([]);
  await context.close();
  await person.context.close();
});
