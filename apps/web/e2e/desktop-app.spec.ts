// The Mac app (apps/desktop) driving this site: the window marks the page as the Mac app, keeps room for
// the window buttons, adds Settings > Desktop app, and its menus and Quick Add window work end to end.
// Needs a built shell: `cd apps/desktop && pnpm install --ignore-workspace && pnpm build`.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { APP, newPerson } from "./helpers";

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../desktop");
const electronBinary = join(desktopDir, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
const built = existsSync(join(desktopDir, "dist/main.js")) && existsSync(electronBinary);

// (Before signing in, the Quick Add window shows the sign-in page with /quick-add as where to return.)
const isQuickAdd = (w: Page) => decodeURIComponent(w.url()).includes("/quick-add");

async function mainWindow(app: ElectronApplication): Promise<Page> {
  await expect.poll(() => app.windows().filter((w) => !isQuickAdd(w)).length, { timeout: 20_000 }).toBeGreaterThan(0);
  return app.windows().find((w) => !isQuickAdd(w))!;
}

async function clickMenu(app: ElectronApplication, menu: string, item: string) {
  await app.evaluate(({ Menu }, [m, i]) => {
    const entry = Menu.getApplicationMenu()?.items.find((x: { label: string }) => x.label === m)?.submenu?.items.find((x: { label: string }) => x.label === i);
    if (!entry) throw new Error(`No menu item ${m} > ${i}`);
    entry.click();
  }, [menu, item] as const);
}

test("the Mac app: seamless window, Settings > Desktop app, New Note from the menu, Quick Add window", async ({ browser, browserName }) => {
  test.skip(!built || browserName !== "chromium" || process.platform !== "darwin", "Needs the built Mac app (apps/desktop) on a Mac.");
  test.setTimeout(180_000);
  const { context } = await newPerson(browser, "Desk Person");
  const cookies = await context.cookies();
  await context.close();

  const userData = mkdtempSync(join(tmpdir(), "folevi-desktop-"));
  const app = await _electron.launch({
    executablePath: electronBinary,
    args: [desktopDir],
    env: { ...process.env, FOLEVI_URL: APP, FOLEVI_USER_DATA: userData },
  });
  try {
    // Signed in as the person made above (the browser's session, handed to the app's own).
    await app.evaluate(async ({ session }, list) => {
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
    const page = await mainWindow(app);
    await page.goto(`${APP}/documents`);
    await expect(page.getByRole("navigation", { name: "Folio" })).toBeVisible({ timeout: 30_000 });

    // The page knows it's in the Mac app, and keeps room for the window buttons in the top bar.
    await expect(page.locator("html")).toHaveAttribute("data-desktop", "mac");
    expect(await page.evaluate(() => typeof window.foleviDesktop?.onCommand)).toBe("function");
    const space = page.locator(".ui-traffic-space").first();
    await expect(space).toBeVisible();
    expect((await space.boundingBox())!.width).toBe(60);
    await page.screenshot({ path: test.info().outputPath("desktop-main.png") });
    // The window buttons sit in that space, and follow it when the sidebar is hidden (into the tab strip).
    const buttons = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w: { getSize(): number[] }) => w.getSize()[0]! > 600)?.getWindowButtonPosition());
    const expected = async () => {
      const box = (await page.locator(".ui-traffic-space").filter({ visible: true }).first().boundingBox())!;
      return { x: Math.round(box.x + 2), y: Math.round(box.y + box.height / 2 - 7) };
    };
    await expect.poll(buttons).toEqual(await expected());
    const withSidebar = await expected();
    await page.keyboard.press("Meta+\\");
    await expect.poll(async () => (await expected()).y).not.toBe(withSidebar.y);
    await expect.poll(buttons).toEqual(await expected());
    await page.keyboard.press("Meta+\\");
    await expect.poll(buttons).toEqual(withSidebar);

    // Settings > Desktop app: the shortcut and the Mac switches.
    await page.goto(`${APP}/settings/desktop`);
    await expect(page.getByRole("link", { name: "Desktop app" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("button", { name: /Quick Add shortcut: ⌥Space/ })).toBeVisible();
    const menuBar = page.getByRole("switch", { name: "Menu bar icon" });
    await expect(menuBar).toBeChecked();
    await menuBar.click();
    await expect(menuBar).not.toBeChecked();
    await menuBar.click();
    await expect(menuBar).toBeChecked();

    // File > New Note opens a new note.
    await clickMenu(app, "File", "New Note");
    await page.waitForURL(/\/d\/[0-9A-Z]{26}/, { timeout: 20_000 });

    // File > Quick Add Task…: the small window, then the task lands in the Inbox.
    await clickMenu(app, "File", "Quick Add Task…");
    const quick = app.windows().find(isQuickAdd)!;
    await expect(quick.getByRole("heading", { name: "Quick add task" })).toBeVisible({ timeout: 30_000 });
    await quick.screenshot({ path: test.info().outputPath("desktop-quick-add.png") });
    await quick.getByPlaceholder("What needs doing?").fill("Call the printer");
    await quick.keyboard.press("Enter");
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w: { isVisible(): boolean }) => w.isVisible()).length)).toBe(1);
    await page.goto(`${APP}/tasks/inbox`);
    await expect(page.getByText("Call the printer")).toBeVisible({ timeout: 20_000 });
  } finally {
    await app.close();
    rmSync(userData, { recursive: true, force: true });
  }
});
