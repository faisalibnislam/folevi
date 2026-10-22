// Folevi for Mac with several places (docs/MULTI_ACCOUNT_PLAN.md §2.2, §3, §5.2, §9): the real Electron app with
// the interface built in, a library in a folder, then two accounts signed in from the switcher (the website's
// /connect page approved in a browser here, the folevi:// link handed back as macOS would), switching without
// signing in, a runner window per place that isn't open, and signing out of one account.
//
// Needs the built app (`cd apps/desktop && pnpm build`) and a shell export pointing at the dev server:
//   NEXT_PUBLIC_APP_URL=http://app.localhost:3002 NEXT_PUBLIC_MARKETING_URL=http://localhost:3002 \
//     node scripts/build-shell.mjs --dest <dir>
//   E2E_SHELL_DIR=<dir> E2E_BASE_URL=http://app.localhost:3002 E2E_NO_SERVER=1 npx playwright test e2e/places-shell.spec.ts --project account
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, expect, test, type BrowserContext, type ElectronApplication, type Page } from "@playwright/test";
import { APP, newPerson, showFolders } from "./helpers";

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, "../../desktop");
const electronBinary = join(desktopDir, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
const shellDir = process.env.E2E_SHELL_DIR ?? "";
const ready = existsSync(join(desktopDir, "dist/main.js")) && existsSync(electronBinary) && existsSync(join(shellDir, "index.html"));

const isMain = (w: Page) => w.url().startsWith("app://folevi/") && !/\/(quick-add|place-sync)/.test(decodeURIComponent(w.url()));

async function mainWindow(app: ElectronApplication): Promise<Page> {
  await expect.poll(() => app.windows().filter(isMain).length, { timeout: 30_000 }).toBeGreaterThan(0);
  return app.windows().find(isMain)!;
}

const runnerPlaces = (app: ElectronApplication) =>
  app
    .windows()
    .map((w) => decodeURIComponent(w.url()))
    .filter((u) => u.includes("/place-sync?place="))
    .map((u) => u.split("place=")[1]!)
    .sort();

/** Approves the app's sign-in on the website as the person signed in on `browser`, and hands the link back. */
async function approve(app: ElectronApplication, browser: BrowserContext, before: number) {
  await expect.poll(async () => (await app.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened.length)), { timeout: 30_000 }).toBeGreaterThan(before);
  const url = await app.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened.at(-1)!);
  const state = new URL(url).searchParams.get("state")!;
  const page = await browser.newPage();
  await page.goto(url.replace(/^https?:\/\/[^/]+/, APP));
  await expect(page.getByRole("heading", { name: /^Sign in to / })).toBeVisible({ timeout: 30_000 });
  const authorized = page.waitForResponse((r) => r.url().includes("/api/auth/native/authorize"));
  await page.getByRole("button", { name: "Continue" }).click();
  const { code } = (await (await authorized).json()) as { code: string };
  await page.close();
  await app.evaluate(({ app }, link) => app.emit("open-url", { preventDefault() {} }, link), `folevi://auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`);
}

async function openSwitcher(page: Page) {
  await showFolders(page);
  const nav = page.getByRole("navigation", { name: "Folio" });
  await nav.getByRole("button", { name: /: (settings and help|Personal, workspaces and account)$/ }).click();
  return page.getByRole("menu");
}

test("the Mac app: a library and two accounts, switching with no sign-in, runners for the others, signing out of one", async ({ browser, browserName }) => {
  test.skip(!ready || browserName !== "chromium" || process.platform !== "darwin", "Needs the built Mac app and E2E_SHELL_DIR (a shell export for the dev server) on a Mac.");
  test.setTimeout(420_000);
  const ana = await newPerson(browser, "Ana Desk");
  const ben = await newPerson(browser, "Ben Desk");
  const userData = mkdtempSync(join(tmpdir(), "folevi-places-"));
  const folder = mkdtempSync(join(tmpdir(), "folevi-places-library-"));
  const app = await _electron.launch({
    executablePath: electronBinary,
    args: [desktopDir],
    env: { ...process.env, FOLEVI_URL: APP, FOLEVI_USER_DATA: userData, FOLEVI_SHELL: "1", FOLEVI_SHELL_DIR: shellDir },
  });
  try {
    // The browser is this test, and the library's folder is a temporary one.
    await app.evaluate(({ shell, dialog }, dir) => {
      (globalThis as { __opened?: string[] }).__opened = [];
      shell.openExternal = async (url: string) => {
        (globalThis as unknown as { __opened: string[] }).__opened.push(url);
      };
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as never;
    }, folder);

    // ---- the library
    let page = await mainWindow(app);
    await page.getByRole("button", { name: /Keep notes on my devices/ }).click();
    await page.getByTestId("place-folder").click();
    await page.getByRole("button", { name: "Open Folevi" }).click();
    page = await mainWindow(app);
    await expect(page.getByRole("navigation", { name: "Folio" })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "New note", exact: true }).click();
    await page.getByRole("textbox", { name: "Title" }).fill("Kept on this Mac");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Only in the library.");
    await page.waitForTimeout(2500);

    // ---- Ana, signed in from the library: one screen asks to move or keep them separate.
    let menu = await openSwitcher(page);
    await menu.getByRole("menuitem", { name: "Sign in to another account" }).click();
    await approve(app, ana.context, 0);
    page = await mainWindow(app);
    await expect(page.getByRole("button", { name: "Keep them separate on this Mac" })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Keep them separate on this Mac" }).click();
    await expect(page.getByRole("navigation", { name: "Folio" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Kept on this Mac")).toHaveCount(0);
    // The library keeps going behind Ana.
    await expect.poll(() => runnerPlaces(app), { timeout: 30_000 }).toEqual(["library"]);

    // ---- Ben, from Ana's switcher
    menu = await openSwitcher(page);
    await expect(menu.getByRole("menuitem", { name: "On this Mac" })).toBeVisible();
    await menu.getByRole("menuitem", { name: "Sign in to another account" }).click();
    await approve(app, ben.context, 1);
    await expect.poll(async () => (await mainWindow(app)).evaluate(() => (window as { foleviShell?: { places?: { current: string | null } } }).foleviShell?.places?.current ?? ""), { timeout: 60_000 }).toMatch(/^acct:/);
    page = await mainWindow(app);
    await expect(page.getByRole("navigation", { name: "Folio" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("navigation", { name: "Folio" }).getByText("Ben Desk")).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => runnerPlaces(app).length, { timeout: 30_000 }).toBe(2);

    // ---- switching needs no sign-in: to the library, and to Ana
    menu = await openSwitcher(page);
    await menu.getByRole("menuitem", { name: "On this Mac" }).click();
    page = await mainWindow(app);
    await expect(page.getByText("Kept on this Mac").first()).toBeVisible({ timeout: 60_000 });
    menu = await openSwitcher(page);
    await expect(menu.getByRole("menuitem", { name: "Ana Desk" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Ben Desk" })).toBeVisible();
    await menu.getByRole("menuitem", { name: "Ana Desk" }).click();
    page = await mainWindow(app);
    await expect(page.getByRole("navigation", { name: "Folio" }).getByText("Ana Desk")).toBeVisible({ timeout: 60_000 });
    const opened = await app.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened.length);
    expect(opened).toBe(2);

    // Each account has its own session on this Mac, and no token is in any file the page can read.
    const secrets = readdirSync(join(userData, "secrets")).sort();
    expect(secrets.filter((f) => f.startsWith("auth.session.")).length).toBe(2);
    expect(secrets).not.toContain("auth.session.bin");

    // ---- signing out of Ben (from Ben): Ana and the library stay
    menu = await openSwitcher(page);
    await menu.getByRole("menuitem", { name: "Ben Desk" }).click();
    page = await mainWindow(app);
    await expect(page.getByRole("navigation", { name: "Folio" }).getByText("Ben Desk")).toBeVisible({ timeout: 60_000 });
    menu = await openSwitcher(page);
    await menu.getByRole("menuitem", { name: "Sign out of Ben Desk" }).click();
    await expect.poll(() => readdirSync(join(userData, "secrets")).filter((f) => f.startsWith("auth.session.")).length, { timeout: 30_000 }).toBe(1);
    page = await mainWindow(app);
    await expect(page.getByRole("navigation", { name: "Folio" })).toBeVisible({ timeout: 60_000 });
    const places = JSON.parse(readFileSync(join(userData, "places.json"), "utf8")) as { accounts: { email: string }[]; library: boolean };
    expect(places.accounts.map((a) => a.email)).toEqual([ana.email]);
    expect(places.library).toBe(true);
    await expect.poll(() => runnerPlaces(app), { timeout: 30_000 }).toEqual(["library"]);
    // The library's folder still holds its note.
    expect(readdirSync(join(folder, "notes")).length).toBeGreaterThan(0);
  } finally {
    await app.close().catch(() => undefined);
    await ana.context.close();
    await ben.context.close();
    rmSync(userData, { recursive: true, force: true });
    rmSync(folder, { recursive: true, force: true });
  }
});
