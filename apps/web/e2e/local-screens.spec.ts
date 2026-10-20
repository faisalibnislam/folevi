// Local mode's own screens (WP10, docs/LOCAL_MODE_PLAN.md owner decisions, §3, §5.2): the first launch, where
// the library lives (each kind, simulated by the FakeShell), joining a library another device made, the
// "Changed on another device" notice with two devices sharing one library, the passphrase lock, and
// Settings > Library. Local project only, against the shell dev server:
//   E2E_LOCAL_BASE_URL=http://localhost:3003 E2E_BASE_URL=http://app.localhost:3002 E2E_NO_SERVER=1 \
//     npx playwright test e2e/local-screens.spec.ts --project local
// With LOCAL_SCREENS_DIR set, each screen is also saved there in light and dark.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { WELCOME_TITLE } from "@folevi/editor-schema";
import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";
import { expect, prepareContext, test, type FakeShellConfig } from "./fixtures/localShell";

const SHOTS = process.env.LOCAL_SCREENS_DIR;

/** Saves the page in light and dark (only with LOCAL_SCREENS_DIR). */
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(SHOTS, `${name}-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: "light" });
}

/** No serious or critical axe problems, in light and in dark. */
async function accessible(page: Page, what: string) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(100);
    const r = await new AxeBuilder({ page }).analyze();
    const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
    expect(bad, `${what} in ${scheme}`).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

let n = 0;
/** A device of its own: a context with its own FakeShell, OPFS folder, IndexedDB and device id. */
async function device(browser: Browser, testInfo: TestInfo, cfg: Partial<FakeShellConfig> = {}, viewport = { width: 1280, height: 840 }): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport });
  await prepareContext(context, testInfo, { libraryName: `lib-${Date.now()}-${n++}`, ...cfg });
  const page = await context.newPage();
  return { context, page };
}

const firstLaunch = { initialMode: "unset", configured: false } as const;

/** The FakeShell's bridge calls, by name. */
const calls = (page: Page) => page.evaluate(() => window.__foleviTestShellControl!.log.map((c) => c.call));

/** Every file of the page's library, as base64. */
async function libraryFiles(page: Page): Promise<{ path: string; data: string }[]> {
  return await page.evaluate(async () => {
    const lib = window.__foleviTestShell!.library;
    const out: { path: string; data: string }[] = [];
    for (const e of await lib.list("")) {
      const r = await lib.read(e.path);
      if (!("bytes" in r)) continue;
      let bin = "";
      for (const b of r.bytes) bin += String.fromCharCode(b);
      out.push({ path: e.path, data: btoa(bin) });
    }
    return out;
  });
}

/** Writes files into the page's library the way another device's sync would. */
async function receive(page: Page, files: { path: string; data: string | null }[]) {
  await page.evaluate(async (list) => {
    const control = window.__foleviTestShellControl!;
    for (const f of list) {
      if (f.data === null) await control.externalRemove(f.path);
      else await control.externalWrite(f.path, Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0)));
    }
  }, files);
}

/**
 * Two devices sharing one library folder, as Dropbox would share it: every file one writes reaches the
 * other. `pause()` holds what each writes (so both can edit at once); `resume()` delivers it.
 */
async function share(a: { context: BrowserContext; page: Page }, b: { context: BrowserContext; page: Page }) {
  let paused = false;
  const held = new Map<Page, Map<string, string | null>>([
    [a.page, new Map()],
    [b.page, new Map()],
  ]);
  const wire = async (from: { context: BrowserContext; page: Page }, to: Page) => {
    await from.context.exposeBinding("__foleviTestShellMirror", async (_source, path: string, data: string | null) => {
      if (paused) held.get(to)!.set(path, data);
      else await receive(to, [{ path, data }]).catch(() => undefined);
    });
  };
  await wire(a, b.page);
  await wire(b, a.page);
  return {
    pause: () => void (paused = true),
    resume: async () => {
      paused = false;
      for (const [to, files] of held) {
        const list = [...files].map(([path, data]) => ({ path, data }));
        files.clear();
        await receive(to, list);
      }
    },
  };
}

/** Rows titled `title` in the page's copy of the library (IndexedDB). */
async function rowsTitled(page: Page, title: string): Promise<number> {
  return await page.evaluate(async (wanted) => {
    let count = 0;
    for (const { name } of await indexedDB.databases()) {
      if (!name?.startsWith("folevi-local-")) continue;
      const db = await new Promise<IDBDatabase>((ok, ko) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => ok(r.result);
        r.onerror = () => ko(r.error);
      });
      if (db.objectStoreNames.contains("rows")) {
        const rows = await new Promise<unknown[]>((ok, ko) => {
          const r = db.transaction("rows").objectStore("rows").getAll();
          r.onsuccess = () => ok(r.result);
          r.onerror = () => ko(r.error);
        });
        count += rows.filter((r) => (r as { title?: unknown; revision?: unknown }).title === wanted && typeof (r as { revision?: unknown }).revision === "number" && !(r as { deletedAt?: unknown }).deletedAt).length;
      }
      db.close();
    }
    return count;
  }, title);
}

async function noteFiles(page: Page): Promise<number> {
  // (A listing can race a file being written: then it's asked again.)
  return await page.evaluate(async () => (await window.__foleviTestShell!.library.list("notes").catch(() => [])).filter((e) => e.path.endsWith(".fnote")).length);
}

/** Opens the welcome note from the list the app opens on. */
async function openWelcome(page: Page) {
  await page.getByRole("link", { name: new RegExp(WELCOME_TITLE) }).first().click();
  await expect(page.locator(".ProseMirror").first()).toBeVisible({ timeout: 20_000 });
}

test.describe("local mode screens", { tag: "@local" }, () => {
  test.beforeEach(({ backendMode }) => {
    test.skip(backendMode !== "local", "local mode only");
  });

  for (const kind of ["icloud", "dropbox", "gdrive", "folder", "device"] as const) {
    test(`first launch to a note: ${kind}`, async ({ browser }, testInfo) => {
      test.setTimeout(120_000);
      const { context, page } = await device(browser, testInfo, firstLaunch);
      await page.goto("/documents");
      const choice = page.getByTestId("mode-choice");
      await expect(choice.getByRole("heading", { name: "Where should your notes live?" })).toBeVisible({ timeout: 30_000 });
      await expect(choice.getByText("Free forever. No account.")).toBeVisible();
      if (kind === "icloud") {
        await shot(page, "01-mode-choice");
        await accessible(page, "the first-launch choice");
      }
      await choice.getByRole("button", { name: /Keep notes on my devices/ }).click();

      const setup = page.getByTestId("library-setup");
      await expect(setup.getByRole("heading", { name: "Where should your library live?" })).toBeVisible();
      if (kind === "icloud") {
        await shot(page, "02-library-setup");
        await accessible(page, "the library setup");
      }
      await setup.getByTestId(`place-${kind}`).click();
      if (kind === "dropbox" || kind === "gdrive") {
        const waiting = page.getByTestId("cloud-connecting");
        await expect(waiting).toContainText(`Finish signing in to ${kind === "dropbox" ? "Dropbox" : "Google Drive"} in your browser`);
        if (kind === "dropbox") await shot(page, "03-cloud-connecting");
      }
      await expect(setup.getByRole("heading", { name: "Your library is ready" })).toBeVisible({ timeout: 15_000 });
      if (kind === "device") {
        await setup.getByRole("switch", { name: "Encrypt with a passphrase" }).click();
        await shot(page, "04-new-library-encrypt");
        await accessible(page, "a new library's passphrase");
        await setup.getByRole("switch", { name: "Encrypt with a passphrase" }).click();
      }
      await setup.getByRole("button", { name: "Open Folevi" }).click();

      await openWelcome(page);
      const log = await calls(page);
      expect(log).toEqual(expect.arrayContaining(["library.setup", "setMode"]));
      if (kind === "dropbox" || kind === "gdrive") expect(log).toContain("cloud.connect");
      const setupCall = (await page.evaluate(() => window.__foleviTestShellControl!.log.find((c) => c.call === "library.setup")?.detail)) as { kind: string };
      expect(setupCall.kind).toBe(kind);
      // The welcome notes reach the folder: a new library.
      await expect.poll(() => noteFiles(page), { timeout: 30_000 }).toBeGreaterThan(5);
      expect(await rowsTitled(page, WELCOME_TITLE)).toBe(1);
      await context.close();
    });
  }

  test("a place that can't be used says why; cancelling a picker or a sign-in goes back", async ({ browser }, testInfo) => {
    const { context, page } = await device(browser, testInfo, { ...firstLaunch, initialMode: "local", places: { icloud: "drive_off", folder: "cancel", connectDelayMs: 60_000 } });
    await page.goto("/documents");
    const setup = page.getByTestId("library-setup");
    await expect(setup).toBeVisible({ timeout: 30_000 });
    // In local mode with nothing set up there's no going back to the choice.
    await expect(setup.getByRole("button", { name: "Back" })).toHaveCount(0);

    await setup.getByTestId("place-icloud").click();
    await expect(setup.getByRole("alert")).toContainText("iCloud Drive is turned off on this Mac. Turn it on in System Settings");
    await shot(page, "05-icloud-off");

    await setup.getByTestId("place-folder").click();
    await expect(setup.getByTestId("place-folder")).toBeEnabled();
    await expect(setup.getByRole("heading", { name: "Where should your library live?" })).toBeVisible();

    await setup.getByTestId("place-dropbox").click();
    const waiting = page.getByTestId("cloud-connecting");
    await expect(waiting).toBeVisible();
    await waiting.getByRole("button", { name: "Cancel" }).click();
    await expect(setup.getByTestId("place-dropbox")).toBeVisible();
    await expect(waiting).toHaveCount(0);
    expect(await calls(page)).toEqual(expect.arrayContaining(["cloud.connect", "cloud.cancel"]));
    expect(await calls(page)).not.toContain("setMode");
    await context.close();
  });

  test("a build without Dropbox or Google Drive doesn't offer them", async ({ browser }, testInfo) => {
    const { context, page } = await device(browser, testInfo, { ...firstLaunch, places: { cloud: [] } });
    await page.goto("/documents");
    await page.getByTestId("mode-choice").getByRole("button", { name: /Keep notes on my devices/ }).click();
    const setup = page.getByTestId("library-setup");
    await expect(setup.getByTestId("place-icloud")).toBeVisible();
    await expect(setup.getByTestId("place-dropbox")).toHaveCount(0);
    await expect(setup.getByTestId("place-gdrive")).toHaveCount(0);
    await context.close();
  });

  test("joining a library another device made adds no welcome notes", async ({ browser }, testInfo) => {
    test.setTimeout(150_000);
    const first = await device(browser, testInfo);
    await first.page.goto("/documents");
    await expect.poll(() => noteFiles(first.page), { timeout: 30_000 }).toBeGreaterThan(5);
    await first.page.waitForTimeout(6000);
    const files = await libraryFiles(first.page);
    const notes = files.filter((f) => f.path.endsWith(".fnote")).length;

    const second = await device(browser, testInfo, firstLaunch);
    await second.page.goto("/documents");
    await expect(second.page.getByTestId("mode-choice")).toBeVisible({ timeout: 30_000 });
    // The other device's library arrives in the folder (iCloud Drive syncing it).
    await receive(second.page, files);
    await second.page.getByTestId("mode-choice").getByRole("button", { name: /Keep notes on my devices/ }).click();
    await second.page.getByTestId("place-icloud").click();
    // No "Your library is ready": it's joined at once.
    await expect(second.page.getByRole("heading", { name: "Your library is ready" })).toHaveCount(0);
    await openWelcome(second.page);
    await second.page.waitForTimeout(6000);
    expect(await rowsTitled(second.page, WELCOME_TITLE)).toBe(1);
    expect(await noteFiles(second.page)).toBe(notes);
    await first.context.close();
    await second.context.close();
  });

  test("the same line changed on two devices: the notice, the other version, dismissing it", async ({ browser }, testInfo) => {
    test.setTimeout(240_000);
    const a = await device(browser, testInfo);
    const b = await device(browser, testInfo, firstLaunch);
    const link = await share(a, b);
    await a.page.goto("/documents");
    await expect.poll(() => noteFiles(a.page), { timeout: 30_000 }).toBeGreaterThan(5);
    await a.page.waitForTimeout(6000);
    await b.page.goto("/documents");
    await expect(b.page.getByTestId("mode-choice")).toBeVisible({ timeout: 30_000 });
    await receive(b.page, await libraryFiles(a.page));
    await b.page.getByTestId("mode-choice").getByRole("button", { name: /Keep notes on my devices/ }).click();
    await b.page.getByTestId("place-folder").click();

    // A new note on the first device, with one line; it reaches the second.
    await a.page.getByRole("button", { name: "New note", exact: true }).first().click();
    await a.page.getByPlaceholder(/untitled/i).first().fill("Shared plan");
    await a.page.keyboard.press("Enter");
    await a.page.keyboard.type("Meet at the station");
    await expect.poll(() => rowsTitled(b.page, "Shared plan"), { timeout: 30_000 }).toBe(1);
    const noteUrl = a.page.url();
    await b.page.goto(new URL(new URL(noteUrl).pathname, b.page.url()).href);
    const lineOn = (p: Page) => p.locator(".ProseMirror p", { hasText: "Meet at the station" }).first();
    await expect(lineOn(b.page)).toBeVisible({ timeout: 30_000 });

    // Both change the line before either sees the other's change.
    link.pause();
    for (const [p, words] of [
      [a.page, " at nine"],
      [b.page, " at ten"],
    ] as const) {
      await lineOn(p).click();
      await p.keyboard.press("End");
      await p.keyboard.type(words);
    }
    await a.page.waitForTimeout(7000);
    await link.resume();

    // The newer change shows on both; the other is in history, with a notice on the line.
    const notice = (p: Page) => p.getByTestId("changed-elsewhere").first();
    await expect.poll(async () => (await notice(a.page).isVisible()) || (await notice(b.page).isVisible()), { timeout: 45_000 }).toBe(true);
    const withNotice = (await notice(a.page).isVisible()) ? a.page : b.page;
    const other = withNotice === a.page ? b.page : a.page;
    await expect(notice(withNotice)).toContainText("Changed on another device");
    await expect(notice(other)).toBeVisible({ timeout: 30_000 });
    await shot(withNotice, "06-changed-elsewhere");
    await accessible(withNotice, "a note with a Changed on another device notice");

    await notice(withNotice).getByRole("button", { name: "See the other version" }).click();
    const history = withNotice.getByRole("dialog", { name: "Version history" });
    await expect(history.getByRole("heading", { name: "Changed on another device", level: 1 })).toBeVisible();
    await expect(history.getByRole("button", { name: /Changed on another device/ }).first()).toBeVisible();
    await shot(withNotice, "07-version-history-conflict");
    await history.getByRole("button", { name: "Back to the note" }).click();

    await notice(withNotice).getByRole("button", { name: "Dismiss" }).click();
    await expect(withNotice.getByTestId("changed-elsewhere")).toHaveCount(0);
    // Put away on the other device too: the dismissal is in the note's file.
    await expect(other.getByTestId("changed-elsewhere")).toHaveCount(0, { timeout: 30_000 });
    await a.context.close();
    await b.context.close();
  });

  test("an encrypted library asks for its passphrase, and a wrong one is refused", async ({ browser }, testInfo) => {
    test.setTimeout(120_000);
    const { context, page } = await device(browser, testInfo, firstLaunch);
    await page.goto("/documents");
    await page.getByTestId("mode-choice").getByRole("button", { name: /Keep notes on my devices/ }).click();
    await page.getByTestId("place-device").click();
    const setup = page.getByTestId("library-setup");
    await setup.getByRole("switch", { name: "Encrypt with a passphrase" }).click();
    await setup.getByRole("button", { name: "Open Folevi" }).click();
    await expect(setup.getByRole("alert")).toContainText("at least 8 characters");
    await setup.getByLabel("Passphrase", { exact: true }).fill("correct horse battery");
    await setup.getByLabel("Type it again").fill("correct horse battery");
    await setup.getByRole("button", { name: "Open Folevi" }).click();
    await expect(setup.getByRole("alert")).toContainText("Tick the box");
    await setup.getByText("I understand Folevi can't recover a lost passphrase").click();
    await setup.getByRole("button", { name: "Open Folevi" }).click();
    await openWelcome(page);
    expect(await calls(page)).toContain("library.setPassphrase");

    // The next launch on this device (the FakeShell forgets the key): the passphrase screen.
    await page.reload();
    const locked = page.getByTestId("library-locked");
    await expect(locked.getByRole("heading", { name: "Enter your library's passphrase" })).toBeVisible({ timeout: 30_000 });
    await shot(page, "08-library-locked");
    await accessible(page, "the locked library");
    await locked.getByLabel("Passphrase").fill("wrong one");
    await locked.getByRole("button", { name: "Unlock" }).click();
    await expect(locked.getByRole("alert")).toContainText("didn't open the library");
    await locked.getByLabel("Passphrase").fill("correct horse battery");
    await locked.getByRole("button", { name: "Unlock" }).click();
    await expect(locked).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByRole("link", { name: new RegExp(WELCOME_TITLE) }).first()).toBeVisible({ timeout: 20_000 });
    await context.close();
  });

  test("Settings > Library: place, sync now, devices, health, passphrase, lock, sign-out of Dropbox", async ({ browser }, testInfo) => {
    test.setTimeout(150_000);
    const { context, page } = await device(browser, testInfo, { ...firstLaunch, lockMethod: "touchID" });
    await page.goto("/documents");
    await page.getByTestId("mode-choice").getByRole("button", { name: /Keep notes on my devices/ }).click();
    await page.getByTestId("place-dropbox").click();
    await page.getByRole("button", { name: "Open Folevi" }).click();
    await openWelcome(page);
    await page.waitForTimeout(6000);

    await page.goto(new URL("/settings/library", page.url()).href);
    const section = page.getByTestId("library-section");
    await expect(section.getByTestId("library-kind")).toHaveText("Dropbox", { timeout: 30_000 });
    await expect(section.getByTestId("library-path")).toHaveText("Dropbox › Apps › Folevi");
    await expect(section.getByTestId("library-connection")).toContainText("Connected as sam@example.com");
    await expect(section.getByTestId("library-devices").getByRole("listitem")).toHaveCount(1);
    await expect(section.getByTestId("library-devices")).toContainText("This Mac");
    await expect(section.getByTestId("library-health")).toContainText("Nothing to fix.");
    await expect(section.getByTestId("library-ai-keys")).toBeVisible();
    // No prices, plans or upgrades anywhere in local mode.
    await expect(page.getByText(/\$\d|per month|upgrade|Pro AI|free trial/i)).toHaveCount(0);
    await shot(page, "09-settings-library");
    await accessible(page, "Settings > Library");
    await section.getByTestId("library-lock").scrollIntoViewIfNeeded();
    await shot(page, "09b-settings-library-lower");

    await section.getByRole("button", { name: "Sync now" }).click();
    await expect(page.getByText("Library synced")).toBeVisible();
    await expect(section.getByTestId("library-status")).toContainText("Synced");

    // The Touch ID lock.
    await section.getByRole("switch", { name: "Lock Folevi with Touch ID" }).click();
    await expect(section.getByRole("switch", { name: "Lock Folevi with Touch ID" })).toHaveAttribute("aria-checked", "true");
    await section.getByRole("combobox", { name: "Ask again when you come back" }).click();
    await page.getByRole("option", { name: "After 5 minutes" }).click();
    const lockCalls = (await page.evaluate(() => window.__foleviTestShellControl!.log.filter((c) => c.call === "lock.setSettings").map((c) => c.detail))) as unknown[];
    expect(lockCalls).toEqual([{ lock: true }, { lockAfter: 300 }]);

    // Encrypt, then change the passphrase.
    await section.getByRole("button", { name: "Encrypt with a passphrase…" }).click();
    const enc = page.getByRole("dialog", { name: "Encrypt with a passphrase" });
    await enc.getByLabel("Passphrase", { exact: true }).fill("a long passphrase");
    await enc.getByLabel("Type it again").fill("a long passphrase");
    await enc.getByText("I understand Folevi can't recover a lost passphrase").click();
    await shot(page, "10-settings-encrypt");
    await enc.getByRole("button", { name: "Encrypt", exact: true }).click();
    await expect(section.getByRole("button", { name: "Change passphrase…" })).toBeVisible();
    await section.getByRole("button", { name: "Change passphrase…" }).click();
    const change = page.getByRole("dialog", { name: "Change passphrase" });
    await change.getByLabel("Current passphrase").fill("not it");
    await change.getByLabel("New passphrase").fill("another long one");
    await change.getByLabel("Type it again").fill("another long one");
    await change.getByText("I understand Folevi can't recover a lost passphrase").click();
    await change.getByRole("button", { name: "Change passphrase" }).click();
    await expect(change.getByRole("alert")).toContainText("current passphrase isn't right");
    await change.getByLabel("Current passphrase").fill("a long passphrase");
    await change.getByRole("button", { name: "Change passphrase" }).click();
    await expect(change).toHaveCount(0);
    expect(await calls(page)).toEqual(expect.arrayContaining(["library.setPassphrase", "library.changePassphrase"]));

    // Move library opens the places, without the current one.
    await section.getByRole("button", { name: "Move library…" }).click();
    const move = page.getByRole("dialog", { name: "Move your library" });
    await expect(move.getByTestId("place-dropbox")).toHaveCount(0);
    await move.getByTestId("place-device").click();
    await expect(section.getByTestId("library-kind")).toHaveText("This Mac only");
    expect(await calls(page)).toContain("library.move");

    // Signing in to Folevi is WP12's: until then it says so.
    await section.getByTestId("library-sign-in").click();
    await expect(page.getByText(/Bringing a library into a Folevi account comes in a later update/)).toBeVisible();
    await context.close();
  });

  test("Dropbox: Reconnect and Sign out", async ({ browser }, testInfo) => {
    const { context, page } = await device(browser, testInfo, firstLaunch);
    await page.goto("/documents");
    await page.getByTestId("mode-choice").getByRole("button", { name: /Keep notes on my devices/ }).click();
    await page.getByTestId("place-gdrive").click();
    await page.getByRole("button", { name: "Open Folevi" }).click();
    await openWelcome(page);
    await page.goto(new URL("/settings/library", page.url()).href);
    const connection = page.getByTestId("library-connection");
    await expect(connection).toContainText("Connected as sam.lee@example.com", { timeout: 30_000 });
    await connection.getByRole("button", { name: "Sign out of Google Drive…" }).click();
    const confirm = page.getByRole("dialog", { name: "Sign out of Google Drive?" });
    await expect(confirm).toContainText("Your notes stay on this Mac and in Google Drive");
    await confirm.getByRole("button", { name: "Sign out" }).click();
    await expect(connection).toContainText("Not connected to Google Drive");
    await connection.getByRole("button", { name: "Connect Google Drive" }).click();
    await expect(connection).toContainText("Connected as sam.lee@example.com", { timeout: 10_000 });
    await context.close();
  });

  test("at phone width the setup screens fit", async ({ browser }, testInfo) => {
    const { context, page } = await device(browser, testInfo, firstLaunch, { width: 390, height: 844 });
    await page.goto("/documents");
    await expect(page.getByTestId("mode-choice")).toBeVisible({ timeout: 30_000 });
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(await fits()).toBe(true);
    await shot(page, "11-phone-mode-choice");
    await page.getByTestId("mode-choice").getByRole("button", { name: /Keep notes on my devices/ }).click();
    await expect(page.getByTestId("place-device")).toBeVisible();
    expect(await fits()).toBe(true);
    const box = await page.getByTestId("place-device").boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await shot(page, "12-phone-library-setup");
    await context.close();
  });

  test("notes another device hasn't sent yet show a placeholder, then open when they arrive", async ({ browser }, testInfo) => {
    test.setTimeout(150_000);
    const first = await device(browser, testInfo);
    await first.page.goto("/documents");
    await expect.poll(() => noteFiles(first.page), { timeout: 30_000 }).toBeGreaterThan(5);
    await first.page.waitForTimeout(6000);
    const files = await libraryFiles(first.page);
    const second = await device(browser, testInfo, firstLaunch);
    await second.page.goto("/documents");
    await expect(second.page.getByTestId("mode-choice")).toBeVisible({ timeout: 30_000 });
    // The library file, the index and the other device's catalog arrive first; the notes come later.
    await receive(second.page, files.filter((f) => !f.path.startsWith("notes/")));
    await second.page.getByTestId("mode-choice").getByRole("button", { name: /Keep notes on my devices/ }).click();
    await second.page.getByTestId("place-icloud").click();
    // Listed from the catalog, before any note is here.
    await second.page.getByRole("link", { name: new RegExp(WELCOME_TITLE) }).first().click({ timeout: 30_000 });
    const placeholder = second.page.getByTestId("note-placeholder");
    await expect(placeholder).toContainText("Waiting for this from your other device", { timeout: 20_000 });
    await expect(second.page.locator(".ProseMirror")).toHaveCount(0);
    await shot(second.page, "13-note-waiting");
    await accessible(second.page, "a note that hasn't arrived");
    await receive(second.page, files.filter((f) => f.path.startsWith("notes/")));
    await expect(placeholder).toHaveCount(0, { timeout: 30_000 });
    await expect(second.page.locator(".ProseMirror").first()).toBeVisible();
    await first.context.close();
    await second.context.close();
  });
  for (const platform of ["mac", "ios"] as const) {
    test(`nothing is for sale in local mode: ${platform === "mac" ? "the Mac app" : "the iOS app"}`, async ({ browser }, testInfo) => {
      test.setTimeout(120_000);
      const phone = platform === "ios";
      const { context, page } = await device(browser, testInfo, { platform }, phone ? { width: 390, height: 844 } : undefined);
      if (phone)
        // What the iOS app adds before the page's scripts (apps/ios bridge.js), as e2e/ios-app.spec.ts does.
        await context.addInitScript(() => {
          let settings = { lock: false, lockAfter: 0, method: "faceID" };
          Object.defineProperty(window, "foleviNative", {
            value: {
              platform: "ios",
              version: "1.0",
              haptic: () => undefined,
              setStatusBar: () => undefined,
              openExternal: async () => true,
              getSettings: async () => settings,
              setSettings: async (p: Record<string, unknown>) => (settings = { ...settings, ...p }),
              onCommand: () => () => undefined,
            },
          });
          const mark = () => document.documentElement?.setAttribute("data-native", "ios");
          mark();
          if (!document.documentElement) new MutationObserver((_, w) => document.documentElement && (mark(), w.disconnect())).observe(document, { childList: true });
        });
      const PURCHASE = /\$\d|upgrade|buy (more|credits)|choose (a |pro|core)|see plans|manage billing|checkout|per month|free trial|pro ai/i;
      for (const path of ["/documents", "/settings/library", "/settings/appearance", "/settings/billing", "/settings/ai"]) {
        await page.goto(path);
        await expect(page.locator("main").first()).toBeVisible({ timeout: 30_000 });
        await page.waitForTimeout(1500);
        const offers = (await page.locator("a:visible, button:visible").allTextContents()).map((t) => t.trim()).filter((t) => PURCHASE.test(t));
        expect(offers, `${platform} ${path}`).toEqual([]);
        expect(await page.locator("body").innerText(), `${platform} ${path}`).not.toMatch(/\$\d+(\.\d\d)?\b|per month|\/mo\b/);
      }
      await context.close();
    });
  }
});
