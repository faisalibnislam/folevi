// Folevi for Mac with the interface built in (apps/desktop, FOLEVI_SHELL=1; docs/LOCAL_MODE_PLAN.md WP2):
// someone who used the Mac app on the website writes offline, quits, and the next launch is the bundled build
// with no network at all. The one-time handoff carries the unsent edits from the website's origin to
// app://folevi, the app opens from cold in account mode on this device's copy, the note typed offline is
// there, and Quick Add and the window buttons still work.
// Needs the built Mac app (`cd apps/desktop && pnpm build`) and the shell export (`pnpm --filter @folevi/web
// build:shell`, which also copies it to apps/desktop/web), on a Mac, plus the dev server for phase one.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { APP, newPerson, waitForSaved } from "./helpers";

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, "../../desktop");
const electronBinary = join(desktopDir, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
const offlineFixture = join(here, "fixtures/electronOffline.cjs");
// What ships (copied by build-shell), or the export itself.
const shellDir = [join(desktopDir, "web"), resolve(here, "../out-shell")].find((d) => existsSync(join(d, "index.html")));
const built = existsSync(join(desktopDir, "dist/main.js")) && existsSync(electronBinary) && Boolean(shellDir);

const isQuickAdd = (w: Page) => decodeURIComponent(w.url()).includes("/quick-add");

async function mainWindow(app: ElectronApplication): Promise<Page> {
  await expect.poll(() => app.windows().filter((w) => !isQuickAdd(w) && !w.url().includes("_folevi-handoff")).length, { timeout: 30_000 }).toBeGreaterThan(0);
  return app.windows().find((w) => !isQuickAdd(w) && !w.url().includes("_folevi-handoff"))!;
}

async function clickMenu(app: ElectronApplication, menu: string, item: string) {
  await app.evaluate(({ Menu }, [m, i]) => {
    const entry = Menu.getApplicationMenu()?.items.find((x: { label: string }) => x.label === m)?.submenu?.items.find((x: { label: string }) => x.label === i);
    if (!entry) throw new Error(`No menu item ${m} > ${i}`);
    entry.click();
  }, [menu, item] as const);
}

test("the bundled Mac app: the handoff from the website's origin, a cold offline start in account mode, Quick Add and the window buttons", async ({ browser, browserName }) => {
  test.skip(!built || browserName !== "chromium" || process.platform !== "darwin", "Needs the built Mac app and the shell export (apps/desktop/web or apps/web/out-shell) on a Mac.");
  test.setTimeout(240_000);
  const { context } = await newPerson(browser, "Bundled Person");
  const cookies = await context.cookies();
  await context.close();
  const userData = mkdtempSync(join(tmpdir(), "folevi-bundled-"));
  const title = "Moved with the app";

  // ---------------------------------------------------------------- 1. today's app, on the website's origin
  const before = await _electron.launch({
    executablePath: electronBinary,
    args: [desktopDir],
    env: { ...process.env, FOLEVI_URL: APP, FOLEVI_USER_DATA: userData, FOLEVI_SHELL: "0" },
  });
  try {
    await before.evaluate(async ({ session }, list) => {
      const ses = session.fromPartition("persist:folevi");
      for (const c of list) {
        await ses.cookies.set({
          url: `http://${c.domain.replace(/^\./, "")}${c.path}`,
          name: c.name,
          value: c.value,
          path: c.path,
          httpOnly: c.httpOnly,
          secure: c.secure,
          expirationDate: c.expires > 0 ? c.expires : undefined,
          sameSite: c.sameSite === "Strict" ? "strict" : c.sameSite === "None" ? "no_restriction" : "lax",
        });
      }
    }, cookies);
    const page = await mainWindow(before);
    await page.goto(`${APP}/documents`);
    await expect(page.getByRole("navigation", { name: "Folio" })).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => typeof (window as { foleviShell?: unknown }).foleviShell)).toBe("undefined");
    await page.waitForFunction(() => Boolean(localStorage.getItem("folevi:last-account")));
    await page.getByRole("button", { name: "New note", exact: true }).click();
    await page.waitForURL(/\/d\/[0-9A-Z]{26}/);
    await page.getByRole("textbox", { name: "Title" }).fill(title);
    await page.keyboard.press("Enter");
    await page.keyboard.type("Written online.");
    await waitForSaved(page);
    // Offline: the next line waits in this origin's queue when the app quits.
    await page.context().setOffline(true);
    await page.keyboard.press("Enter");
    await page.keyboard.type("Typed offline before the switch.");
    await expect(page.getByTestId("sync-status")).toHaveAttribute("data-status", "offline", { timeout: 15_000 });
    await page.waitForTimeout(1500);
  } finally {
    await before.close();
  }

  // ---------------------------------------------------------------- 2. the bundled build, no network from cold
  const app = await _electron.launch({
    executablePath: electronBinary,
    args: ["-r", offlineFixture, desktopDir],
    env: { ...process.env, FOLEVI_URL: APP, FOLEVI_USER_DATA: userData, FOLEVI_SHELL: "1", FOLEVI_SHELL_DIR: shellDir! },
  });
  try {
    const page = await mainWindow(app);
    await expect.poll(() => page.url(), { timeout: 30_000 }).toMatch(/^app:\/\/folevi\//);

    // The handoff ran once, before the window opened, and copied the account with its waiting edit.
    const handoff = JSON.parse(readFileSync(join(userData, "handoff.json"), "utf8"));
    expect(handoff.state).toBe("done");
    expect(handoff.from).toBe(new URL(APP).origin);
    expect(handoff.report.copied).toHaveLength(1);
    expect(handoff.report.copied[0].pending.sync).toBeGreaterThan(0);
    // An existing account carries on in account mode (no first-launch choice).
    expect(JSON.parse(readFileSync(join(userData, "settings.json"), "utf8")).mode).toBe("account");

    // Opened from this device's copy, offline: the folio, and the note with the line typed offline.
    await expect(page.getByRole("navigation", { name: "Folio" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("You're offline", { exact: true })).toHaveCount(0);
    // (The tab it was open in comes back with the rest of the website origin's state.)
    await page.getByText(title, { exact: true }).first().click();
    await expect(page.getByRole("textbox", { name: "Document body" })).toContainText("Typed offline before the switch.", { timeout: 20_000 });
    // The queue is in the new origin's database, for the sync engine to send once signed in.
    const pending = await page.evaluate(async () => {
      const name = `folevi-${localStorage.getItem("folevi:last-account")}`;
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      const state = await new Promise<{ pending?: unknown[]; inflight?: unknown[] } | undefined>((res) => {
        const r = db.transaction("syncState").objectStore("syncState").get("account");
        r.onsuccess = () => res(r.result);
      });
      db.close();
      return (state?.pending?.length ?? 0) + (state?.inflight?.length ?? 0);
    });
    expect(pending).toBeGreaterThan(0);

    // The bridges: the Mac app's own, and foleviShell, with its mode set before the page's scripts.
    await expect(page.locator("html")).toHaveAttribute("data-desktop", "mac");
    const bridge = await page.evaluate(async () => {
      const w = window as unknown as { foleviShell: { platform: string; initialMode: string; shellVersion: string; library: { info(): Promise<unknown>; fileUrl(s: string, m: string): string } }; foleviDesktop?: { onCommand?: unknown } };
      const info = await w.foleviShell.library.info().then(
        () => "answered",
        (e: Error) => e.message,
      );
      return { platform: w.foleviShell.platform, mode: w.foleviShell.initialMode, version: w.foleviShell.shellVersion, info, fileUrl: w.foleviShell.library.fileUrl("a".repeat(64), "image/png"), desktop: typeof w.foleviDesktop?.onCommand };
    });
    expect(bridge).toMatchObject({ platform: "mac", mode: "account", desktop: "function", fileUrl: `app://folevi/_files/${"a".repeat(64)}?type=image%2Fpng` });
    expect(bridge.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(bridge.info).toMatch(/isn't in this build of Folevi for Mac yet/);

    // The window buttons sit in the room the page keeps for them.
    const space = page.locator(".ui-traffic-space").filter({ visible: true }).first();
    await expect(space).toBeVisible();
    const box = (await space.boundingBox())!;
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w: { getSize(): number[]; isVisible(): boolean }) => w.isVisible() && w.getSize()[0]! > 600)?.getWindowButtonPosition()))
      .toEqual({ x: Math.round(box.x + 2), y: Math.round(box.y + box.height / 2 - 7) });

    // Quick Add: the small window on the new origin, offline too.
    await clickMenu(app, "File", "Quick Add Task…");
    await expect.poll(() => app.windows().some(isQuickAdd)).toBe(true);
    const quick = app.windows().find(isQuickAdd)!;
    expect(quick.url()).toMatch(/^app:\/\/folevi\/quick-add/);
    await expect(quick.getByRole("heading", { name: "Quick add task" })).toBeVisible({ timeout: 30_000 });
    // The form reports its height (the window fits it) and Escape puts the window away, both through the
    // Mac bridge on the new origin. (Adding the task itself is a server call, so it waits for the network,
    // as on the website.)
    const quickSize = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w: { getURL(): string }) => w.getURL().includes("/quick-add"))!.getContentSize());
    await expect.poll(async () => (await quickSize())[1]).not.toBe(320);
    await quick.getByPlaceholder("What needs doing?").fill("Call the printer");
    await quick.keyboard.press("Escape");
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w: { isVisible(): boolean }) => w.isVisible()).length)).toBe(1);

    // A link to one of the website's product pages stays in the app; sign-in goes to the browser.
    const opened = await app.evaluate(async ({ shell }) => {
      const calls: string[] = [];
      (shell as { openExternal: (u: string) => Promise<void> }).openExternal = async (u: string) => void calls.push(u);
      (globalThis as { __opened?: string[] }).__opened = calls;
      return true;
    });
    expect(opened).toBe(true);
    await page.evaluate((url) => (location.href = url), `${APP}/signin`);
    await expect.poll(() => app.evaluate(() => (globalThis as { __opened?: string[] }).__opened ?? [])).toEqual([`${APP}/signin`]);
    expect(page.url()).toMatch(/^app:\/\/folevi\//);
    await page.evaluate((url) => (location.href = url), `${APP}/tasks/today`);
    await expect.poll(() => page.url()).toBe("app://folevi/tasks/today");

    // Local mode: the policy and the session refuse Folevi's and Convex's hosts.
    await page.evaluate(() => (window as unknown as { foleviShell: { setMode(m: string): Promise<void> } }).foleviShell.setMode("local"));
    await expect.poll(() => page.evaluate(() => (window as unknown as { foleviShell?: { initialMode: string } }).foleviShell?.initialMode).catch(() => null), { timeout: 20_000 }).toBe("local");
    const csp = await page.evaluate(() => fetch(location.href).then((r) => r.headers.get("content-security-policy")));
    expect(csp).toContain("connect-src 'self';");
    const blocked = await app.evaluate(async ({ session }, url) => {
      try {
        await session.fromPartition("persist:folevi").fetch(url);
        return "reached";
      } catch (e) {
        return String(e);
      }
    }, "https://wp2-guard-check.folevi.com/api/auth/get-session");
    expect(blocked).toMatch(/ERR_BLOCKED_BY_CLIENT|blocked/i);
  } finally {
    await app.close();
    rmSync(userData, { recursive: true, force: true });
  }
});
