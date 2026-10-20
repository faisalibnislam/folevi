// Folevi for Mac with the interface built in (FOLEVI_SHELL=1), every window at once (docs/LOCAL_MODE_PLAN.md
// §2.3 "Multi-window Mac", WP13):
// - local mode: the windows share one library through the window that hosts it (lib/local/host.ts). Quick Add
//   (⌥Space), ⇧⌘N and the menus work with the main window put away, and with no other window at all the Quick
//   Add window hosts the library itself; what they add reaches the library folder on disk.
// - account mode with no network: Quick Add keeps the task on this device and queues it, instead of waiting.
// - the app itself: Resources/web and its build info, the window buttons, and reading text in images.
// With no network at all from the first request (FOLEVI_OFFLINE=1, main.ts: a packaged app can't load a fixture).
//
// By default it runs the development app (`cd apps/desktop && pnpm build`) on an export (FOLEVI_SHELL_DIR, else
// apps/desktop/web or apps/web/out-shell). With E2E_DESKTOP_APP=/path/to/Folevi.app it runs that packaged app
// instead (what `pnpm release:dry-run` builds), which must carry the production build of the interface.
// The account-mode test also needs the dev server (its first phase is today's app on the website).
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { APP, newPerson, waitForSaved } from "./helpers";

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, "../../desktop");
const electronBinary = join(desktopDir, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
const packaged = process.env.E2E_DESKTOP_APP ? resolve(process.env.E2E_DESKTOP_APP) : null;
const shellDir = [process.env.FOLEVI_SHELL_DIR, join(desktopDir, "web"), resolve(here, "../out-shell")].find((d) => d && existsSync(join(d, "index.html")));
const runnable = packaged ? existsSync(join(packaged, "Contents/MacOS/Folevi")) : existsSync(join(desktopDir, "dist/main.js")) && existsSync(electronBinary) && Boolean(shellDir);

function launch(userData: string, env: Record<string, string> = {}): Promise<ElectronApplication> {
  return _electron.launch({
    executablePath: packaged ? join(packaged, "Contents/MacOS/Folevi") : electronBinary,
    args: packaged ? [] : [desktopDir],
    env: { ...process.env, FOLEVI_USER_DATA: userData, FOLEVI_SHELL: "1", FOLEVI_OFFLINE: "1", FOLEVI_URL: APP, ...(packaged ? {} : { FOLEVI_SHELL_DIR: shellDir! }), ...env },
  });
}

const isQuickAdd = (w: Page) => decodeURIComponent(w.url()).includes("/quick-add");
const isApp = (w: Page) => w.url().startsWith("app://folevi/") && !w.url().includes("_folevi-handoff");

/** The app's windows that aren't Quick Add, newest last. */
async function mainWindows(app: ElectronApplication, count = 1): Promise<Page[]> {
  await expect.poll(() => app.windows().filter((w) => isApp(w) && !isQuickAdd(w)).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(count);
  return app.windows().filter((w) => isApp(w) && !isQuickAdd(w));
}

async function quickAddWindow(app: ElectronApplication): Promise<Page> {
  await expect.poll(() => app.windows().some(isQuickAdd), { timeout: 30_000 }).toBe(true);
  return app.windows().find(isQuickAdd)!;
}

async function clickMenu(app: ElectronApplication, menu: string, item: string) {
  await app.evaluate(({ Menu }, [m, i]) => {
    const entry = Menu.getApplicationMenu()?.items.find((x: { label: string }) => x.label === m)?.submenu?.items.find((x: { label: string }) => x.label === i);
    if (!entry) throw new Error(`No menu item ${m} > ${i}`);
    entry.click();
  }, [menu, item] as const);
}

const visibleWindows = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w: { isVisible(): boolean }) => w.isVisible()).length);

/** Opens Quick Add from the menu, adds `title`, and waits for the window to go away. */
async function quickAdd(app: ElectronApplication, title: string) {
  const before = await visibleWindows(app);
  await clickMenu(app, "File", "Quick Add Task…");
  const quick = await quickAddWindow(app);
  await expect(quick.getByRole("heading", { name: "Quick add task" })).toBeVisible({ timeout: 30_000 });
  const field = quick.getByPlaceholder("What needs doing?");
  await expect(field).toHaveValue("");
  await field.fill(title);
  await quick.keyboard.press("Enter");
  await expect.poll(() => visibleWindows(app), { timeout: 20_000 }).toBe(before);
}

/** Every file under `dir` whose text contains `needle`. */
function filesContaining(dir: string, needle: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (statSync(p).size < 5_000_000 && readFileSync(p).includes(needle)) out.push(p);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

test.describe("Folevi for Mac, every window", () => {
  // A packaged copy that was launched is known to Launch Services: it mustn't stay a candidate for folevi:// links.
  test.afterAll(() => {
    if (packaged) spawnSync("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister", ["-u", packaged], { stdio: "ignore" });
  });
  test.skip(({ browserName }) => !runnable || browserName !== "chromium" || process.platform !== "darwin", "Needs the built Mac app and an export (or E2E_DESKTOP_APP) on a Mac.");

  test("local mode: Quick Add, ⇧⌘N and the menus share one library, with the main window away or gone", async () => {
    test.setTimeout(240_000);
    const userData = mkdtempSync(join(tmpdir(), "folevi-windows-"));
    const library = mkdtempSync(join(tmpdir(), "folevi-windows-library-"));
    writeFileSync(join(userData, "settings.json"), JSON.stringify({ mode: "local", bundledShell: true }));
    const app = await launch(userData);
    try {
      let [main] = await mainWindows(app);
      await expect.poll(() => main!.evaluate(() => (window as { foleviShell?: { initialMode: string } }).foleviShell?.initialMode).catch(() => null), { timeout: 30_000 }).toBe("local");
      // "Choose a folder", answered with a temporary one, then every window opens on it.
      await app.evaluate(({ dialog }, dir) => {
        (dialog as unknown as { showOpenDialog: () => Promise<unknown> }).showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
      }, library);
      const info = await main!.evaluate(() => (window as unknown as { foleviShell: { library: { setup(o: { kind: string }): Promise<{ kind: string } | null> } } }).foleviShell.library.setup({ kind: "folder" }));
      expect(info?.kind).toBe("folder");
      await app.evaluate(({ BrowserWindow }) => {
        for (const w of BrowserWindow.getAllWindows()) w.webContents.reload();
      });
      [main] = await mainWindows(app);
      await expect(main!.getByRole("navigation", { name: "Folio" })).toBeVisible({ timeout: 60_000 });
      // A hidden window may be the one hosting: the app keeps local-mode windows at full speed.
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w: { webContents: { getBackgroundThrottling(): boolean } }) => w.webContents.getBackgroundThrottling()))).not.toContain(true);

      // 1. The main window put away (closing it hides it): Quick Add still adds to the library.
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w: { webContents: { getURL(): string }; getSize(): number[] }) => !w.webContents.getURL().includes("quick-add") && w.getSize()[0]! > 600)?.close());
      await expect.poll(() => visibleWindows(app)).toBe(0);
      await quickAdd(app, "Call the printer");

      // 2. No window but Quick Add: it takes the library over and keeps adding.
      await app.evaluate(({ BrowserWindow }) => {
        for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.getURL().includes("quick-add")) w.destroy();
      });
      await expect.poll(() => app.windows().filter((w) => !isQuickAdd(w)).length).toBe(0);
      await quickAdd(app, "Water the plants");

      // 3. The menu opens a main window again (a window that follows the Quick Add one): both tasks are there.
      await clickMenu(app, "Go", "Tasks");
      [main] = await mainWindows(app);
      await main!.evaluate(() => history.pushState(null, "", "/tasks/inbox"));
      await main!.evaluate(() => window.dispatchEvent(new PopStateEvent("popstate")));
      await expect(main!.getByText("Call the printer")).toBeVisible({ timeout: 30_000 });
      await expect(main!.getByText("Water the plants")).toBeVisible();

      // 4. ⇧⌘N: a second window writes to the same library, and the first one sees it.
      await clickMenu(app, "File", "New Window");
      const second = (await mainWindows(app, 2)).find((w) => w !== main)!;
      await expect(second.getByRole("navigation", { name: "Folio" })).toBeVisible({ timeout: 30_000 });
      await second.getByRole("button", { name: "New note", exact: true }).click();
      await second.waitForURL(/\/d\/[0-9A-Z]{26}/);
      await second.getByRole("textbox", { name: "Title" }).fill("Written in a second window");
      await second.keyboard.press("Enter");
      await second.keyboard.type("Both windows, one library.");
      await waitForSaved(second);
      await main!.evaluate(() => {
        history.pushState(null, "", "/documents");
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
      await expect(main!.getByText("Written in a second window").first()).toBeVisible({ timeout: 30_000 });
      // The second window closes for good; File > New Note still works in the first.
      await second.close();
      await clickMenu(app, "File", "New Note");
      await main!.waitForURL(/\/d\/[0-9A-Z]{26}/, { timeout: 20_000 });
      await main!.getByRole("textbox", { name: "Title" }).fill("From the menu");
      await waitForSaved(main!);

      // 5. All of it is in the library folder on disk (the hosting window writes it, hidden or not).
      for (const text of ["Call the printer", "Water the plants", "Both windows, one library.", "From the menu"]) {
        await expect.poll(() => filesContaining(library, text).length, { timeout: 30_000, message: text }).toBeGreaterThan(0);
      }

      // 6. Nothing reached the network (the guard cancels Folevi's and Convex's hosts in local mode).
      expect(await main!.evaluate(() => performance.getEntriesByType("resource").filter((r) => /^(https?|wss?):/.test(r.name)).map((r) => r.name))).toEqual([]);
    } finally {
      await app.close();
      rmSync(userData, { recursive: true, force: true });
      rmSync(library, { recursive: true, force: true });
    }
  });

  test("account mode with no network: a seeded session opens from this device, and Quick Add queues the task", async ({ browser }) => {
    test.setTimeout(240_000);
    const { context } = await newPerson(browser, "Windows Person");
    const cookies = await context.cookies();
    await context.close();
    const userData = mkdtempSync(join(tmpdir(), "folevi-windows-account-"));

    // Today's app on the website (development build), online: this device gets the account's copy.
    const before = await _electron.launch({ executablePath: electronBinary, args: [desktopDir], env: { ...process.env, FOLEVI_URL: APP, FOLEVI_USER_DATA: userData, FOLEVI_SHELL: "0" } });
    try {
      await before.evaluate(async ({ session }, list) => {
        const ses = session.fromPartition("persist:folevi");
        for (const c of list) {
          await ses.cookies.set({ url: `http://${c.domain.replace(/^\./, "")}${c.path}`, name: c.name, value: c.value, path: c.path, httpOnly: c.httpOnly, secure: c.secure, expirationDate: c.expires > 0 ? c.expires : undefined, sameSite: c.sameSite === "Strict" ? "strict" : c.sameSite === "None" ? "no_restriction" : "lax" });
        }
      }, cookies);
      await expect.poll(() => before.windows().filter((w) => !isQuickAdd(w)).length, { timeout: 30_000 }).toBeGreaterThan(0);
      const page = before.windows().find((w) => !isQuickAdd(w))!;
      await page.goto(`${APP}/documents`);
      await expect(page.getByRole("navigation", { name: "Folio" })).toBeVisible({ timeout: 30_000 });
      await page.waitForFunction(() => Boolean(localStorage.getItem("folevi:last-account")));
      // A note with a line queued offline, so there's work to hand over.
      await page.getByRole("button", { name: "New note", exact: true }).click();
      await page.waitForURL(/\/d\/[0-9A-Z]{26}/);
      await page.getByRole("textbox", { name: "Title" }).fill("Before the switch");
      await waitForSaved(page);
      await page.context().setOffline(true);
      await page.keyboard.press("Enter");
      await page.keyboard.type("Queued on the website's origin.");
      await page.waitForTimeout(1500);
    } finally {
      await before.close();
    }

    // The bundled app, no network from cold, signed in (a session the app keeps, as after signing in).
    writeFileSync(join(userData, "settings.json"), JSON.stringify({ mode: "account", bundledShell: true }));
    const app = await launch(userData);
    try {
      // (Not in a packaged copy: its safeStorage key is the installed app's "Folevi Safe Storage" Keychain item,
      // which macOS asks the person about for a copy elsewhere. Without the file nothing is decrypted, and with
      // no network the app opens from this device's copy all the same.)
      if (!packaged) {
        await app.evaluate(({ app: a, safeStorage }) => {
          const fs = (process as unknown as { mainModule: NodeJS.Module }).mainModule.require("node:fs") as typeof import("node:fs");
          const dir = `${a.getPath("userData")}/secrets`;
          fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
          fs.writeFileSync(`${dir}/auth.session.bin`, safeStorage.encryptString("e2e-seeded-session-token"), { mode: 0o600 });
        });
      }
      // No network at all, from every session (the page's, and the one the sign-in bridge uses).
      expect(
        await app.evaluate(async ({ session }) => {
          const tries = ["persist:folevi", "folevi-auth"].map((p) => session.fromPartition(p).fetch("https://example.com/").then(() => "reached", (e: Error) => e.message));
          return await Promise.all(tries);
        }),
      ).toEqual([expect.stringMatching(/BLOCKED_BY_CLIENT/), expect.stringMatching(/BLOCKED_BY_CLIENT/)]);
      let [main] = await mainWindows(app);
      await main!.reload();
      [main] = await mainWindows(app);
      await expect(main!.getByRole("navigation", { name: "Folio" })).toBeVisible({ timeout: 60_000 });
      const handoff = JSON.parse(readFileSync(join(userData, "handoff.json"), "utf8"));
      expect(handoff).toMatchObject({ state: "done", dbVersion: 3 });
      expect(handoff.appVersion).toMatch(/^\d+\.\d+\.\d+$/);

      await quickAdd(app, "Offline errand");
      // Kept by the Quick Add window's own sync engine (each window has one, as each tab does on the website):
      // the main window gets it from the server once online, or from this device after a restart (below).
    } finally {
      await app.close();
    }

    // Quit while still offline, and open again: the task is on the Inbox page, in the queue to be sent
    // (pending, or tried and waiting to be sent again).
    const again = await launch(userData);
    try {
      const [main] = await mainWindows(again);
      await expect(main!.getByRole("navigation", { name: "Folio" })).toBeVisible({ timeout: 60_000 });
      await main!.evaluate(() => {
        history.pushState(null, "", "/inbox");
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
      await main!.waitForURL(/\/d\/inbox-[0-9a-f]+/, { timeout: 20_000 });
      await expect(main!.getByRole("textbox", { name: "Document body" })).toContainText("Offline errand", { timeout: 20_000 });
      const queued = async () =>
        await main!.evaluate(async () => {
          const name = `folevi-${localStorage.getItem("folevi:last-account")}`;
          const db = await new Promise<IDBDatabase>((res, rej) => {
            const r = indexedDB.open(name);
            r.onsuccess = () => res(r.result);
            r.onerror = () => rej(r.error);
          });
          const state = await new Promise<{ pending?: { kind: string; block?: { type: string; text: { text: string }[] } }[]; inflight?: { kind: string; block?: { type: string; text: { text: string }[] } }[] } | undefined>((res) => {
            const r = db.transaction("syncState").objectStore("syncState").get("account");
            r.onsuccess = () => res(r.result);
          });
          db.close();
          return [...(state?.pending ?? []), ...(state?.inflight ?? [])].filter((op) => op.kind === "block.upsert" && op.block?.type === "todo").map((op) => op.block!.text.map((t) => t.text).join(""));
        });
      await expect.poll(queued, { timeout: 20_000 }).toContain("Offline errand");
    } finally {
      await again.close();
      rmSync(userData, { recursive: true, force: true });
    }
  });

  test("the app: its built-in interface, the window buttons and reading text in images", async () => {
    test.setTimeout(120_000);
    const userData = mkdtempSync(join(tmpdir(), "folevi-windows-app-"));
    writeFileSync(join(userData, "settings.json"), JSON.stringify({ mode: "local", bundledShell: true }));
    const app = await launch(userData);
    try {
      const [main] = await mainWindows(app);
      const where = await app.evaluate(({ app: a }) => ({ packaged: a.isPackaged, resources: (process as unknown as { resourcesPath: string }).resourcesPath, version: a.getVersion() }));
      const build = await main!.evaluate(() => fetch("/shell/build.json").then((r) => r.json()));
      expect(build).toMatchObject({ v: 1, dbVersion: 3 });
      if (packaged) {
        // extraResources: the export is Contents/Resources/web, and it's the production build for this version.
        expect(where.packaged).toBe(true);
        expect(where.resources).toBe(join(packaged, "Contents/Resources"));
        expect(existsSync(join(where.resources, "web/index.html"))).toBe(true);
        expect(existsSync(join(where.resources, "folevi-text"))).toBe(true);
        expect(existsSync(join(where.resources, "folevi-files"))).toBe(true);
        expect(build).toMatchObject({ target: "production", convexUrl: "https://fastidious-clownfish-123.convex.cloud", siteUrl: "https://app.folevi.com", appVersion: where.version });
        expect(JSON.parse(readFileSync(join(where.resources, "web/shell/build.json"), "utf8"))).toEqual(build);
      }

      // The window buttons sit in the room the page keeps for them (the first-run screens have none: a page
      // that has the product's top bar is needed, so this looks once the library is set up).
      const library = mkdtempSync(join(tmpdir(), "folevi-windows-app-library-"));
      try {
        await app.evaluate(({ dialog }, dir) => {
          (dialog as unknown as { showOpenDialog: () => Promise<unknown> }).showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
        }, library);
        await expect.poll(() => main!.evaluate(() => typeof (window as { foleviShell?: unknown }).foleviShell).catch(() => "none"), { timeout: 30_000 }).toBe("object");
        await main!.evaluate(() => (window as unknown as { foleviShell: { library: { setup(o: { kind: string }): Promise<unknown> } } }).foleviShell.library.setup({ kind: "folder" }));
        await main!.reload();
        await expect(main!.getByRole("navigation", { name: "Folio" })).toBeVisible({ timeout: 60_000 });
        const space = main!.locator(".ui-traffic-space").filter({ visible: true }).first();
        await expect(space).toBeVisible();
        const box = (await space.boundingBox())!;
        await expect
          .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w: { getSize(): number[]; isVisible(): boolean }) => w.isVisible() && w.getSize()[0]! > 600)?.getWindowButtonPosition()))
          .toEqual({ x: Math.round(box.x + 2), y: Math.round(box.y + box.height / 2 - 7) });

        // Search in images: the words in a picture, read on this Mac (folevi-text, Vision).
        const read = await main!.evaluate(async () => {
          const canvas = document.createElement("canvas");
          canvas.width = 900;
          canvas.height = 220;
          const g = canvas.getContext("2d")!;
          g.fillStyle = "#fff";
          g.fillRect(0, 0, canvas.width, canvas.height);
          g.fillStyle = "#000";
          g.font = "bold 72px Helvetica, Arial, sans-serif";
          g.fillText("Folevi reads this", 40, 140);
          const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/png"));
          const bytes = new Uint8Array(await blob.arrayBuffer());
          return await (window as unknown as { foleviDesktop: { recognizeText(b: Uint8Array): Promise<{ text: string } | null> } }).foleviDesktop.recognizeText(bytes);
        });
        expect(read?.text ?? "").toMatch(/Folevi reads this/i);
      } finally {
        rmSync(library, { recursive: true, force: true });
      }
    } finally {
      await app.close();
      rmSync(userData, { recursive: true, force: true });
    }
  });
});
