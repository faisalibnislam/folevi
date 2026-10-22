// End-to-end encryption in the Mac app (docs/E2EE_DESIGN.md §6.2, §6.11, §11.5): the app's own device keys
// (apps/desktop/src/e2ee.ts) unlock after a restart with no prompt, the passkey isn't offered (and says why),
// Settings > Desktop app has the Touch ID switch, and removing the Mac from encryption on the web makes it
// ask to unlock again.
//
// Runs the app from source (`cd apps/desktop && pnpm build`), or a packaged build with FOLEVI_MAC_APP=<path to
// Folevi.app> (e.g. one from `pnpm release:dry-run`), against this site (FOLEVI_URL, FOLEVI_SHELL=0) with a
// user data folder of its own, so the installed app is left alone. Needs the "e2ee" flag on the dev deployment.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { APP, newPerson } from "./helpers";
import { PASSPHRASE, turnOnEncryption } from "./e2ee-helpers";

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../desktop");
const electronBinary = join(desktopDir, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
const packaged = process.env.FOLEVI_MAC_APP ? join(process.env.FOLEVI_MAC_APP, "Contents/MacOS/Folevi") : null;
const runnable = packaged ? existsSync(packaged) : existsSync(join(desktopDir, "dist/main.js")) && existsSync(electronBinary);

const isQuickAdd = (w: Page) => decodeURIComponent(w.url()).includes("/quick-add");

async function launch(userData: string): Promise<ElectronApplication> {
  return _electron.launch({
    executablePath: packaged ?? electronBinary,
    args: packaged ? [] : [desktopDir],
    env: { ...process.env, FOLEVI_URL: APP, FOLEVI_USER_DATA: userData, FOLEVI_SHELL: "0" },
  });
}

async function mainWindow(app: ElectronApplication): Promise<Page> {
  await expect.poll(() => app.windows().filter((w) => !isQuickAdd(w)).length, { timeout: 30_000 }).toBeGreaterThan(0);
  return app.windows().find((w) => !isQuickAdd(w))!;
}

type Cookie = Awaited<ReturnType<import("@playwright/test").BrowserContext["cookies"]>>[number];
async function signInApp(app: ElectronApplication, cookies: Cookie[]) {
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
}

test("the Mac app: unlocks with its own device key after a restart, no passkey, the Touch ID switch, removed from the web", async ({ browser, browserName }) => {
  test.skip(!runnable || browserName !== "chromium" || process.platform !== "darwin", "Needs the Mac app (built from apps/desktop, or FOLEVI_MAC_APP) on a Mac.");
  test.setTimeout(300_000);
  const person = await newPerson(browser, "Mac Keys");
  await turnOnEncryption(person.page);
  const cookies = await person.context.cookies();

  const userData = mkdtempSync(join(tmpdir(), "folevi-desktop-e2ee-"));
  let app = await launch(userData);
  try {
    await signInApp(app, cookies);
    let page = await mainWindow(app);
    await page.goto(`${APP}/documents`);
    const card = page.getByRole("region", { name: "Unlock your encrypted notes" });
    await expect(card).toBeVisible({ timeout: 30_000 });
    // No passkey in the Mac app, and it says what to do instead (§6.11).
    await expect(card.getByRole("button", { name: "Use a passkey" })).toHaveCount(0);
    await expect(card.getByText("To use your passkey, open Folevi in your browser and approve this Mac from there.")).toBeVisible();
    expect(await page.evaluate(() => typeof (window as unknown as { foleviDesktop?: { e2ee?: { open?: unknown } } }).foleviDesktop?.e2ee?.open)).toBe("function");

    await card.getByRole("button", { name: "Enter passphrase" }).click();
    await card.getByLabel("Encryption passphrase").fill(PASSPHRASE);
    await card.getByRole("button", { name: "Unlock", exact: true }).click();
    await page.getByRole("radiogroup", { name: "Your notes are unlocked" }).getByRole("radio", { name: /^Trust this browser/ }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("navigation", { name: "Folio" })).toBeVisible({ timeout: 30_000 });

    // The Mac's keys are the app's: sealed in userData/e2ee (the private halves never in the clear).
    const meta = JSON.parse(readFileSync(join(userData, "e2ee", "device.json"), "utf8")) as { deviceId: string };
    expect(meta.deviceId).toMatch(/^mac-[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(existsSync(join(userData, "e2ee", "device.bin"))).toBe(true);
    expect(readFileSync(join(userData, "e2ee", "device.bin")).toString("latin1")).not.toContain('"x"');

    // Settings > Desktop app: the Touch ID switch (off; on a Mac without Touch ID it's disabled and says why).
    await page.goto(`${APP}/settings/desktop`);
    const sw = page.getByRole("switch", { name: "Ask for Touch ID to unlock encrypted notes" });
    await expect(sw).toBeVisible({ timeout: 20_000 });
    await expect(sw).not.toBeChecked();
    const canTouchId = await app.evaluate(({ systemPreferences }) => systemPreferences.canPromptTouchID());
    if (canTouchId) {
      await expect(sw).toBeEnabled();
      await expect(page.getByText("This Mac asks for Touch ID before it opens your encrypted notes, each time Folevi opens.")).toBeVisible();
    } else {
      await expect(sw).toBeDisabled();
      await expect(page.getByText("This Mac has no Touch ID, or it isn't set up in System Settings.")).toBeVisible();
    }

    // Quit and open again: unlocked with the device key, no prompt.
    await app.close();
    app = await launch(userData);
    page = await mainWindow(app);
    await page.goto(`${APP}/documents`);
    await expect(page.getByRole("navigation", { name: "Folio" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("region", { name: "Unlock your encrypted notes" })).toHaveCount(0);

    // Removed from encryption on the web (Settings > Devices in the browser that set it up): the Mac asks again.
    const web = person.page;
    await web.goto(`${APP}/settings/devices`);
    const row = web.getByRole("listitem").filter({ hasText: /Folevi for Mac/ }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.getByRole("button", { name: /^Options for Folevi for Mac/ }).click();
    await web.getByRole("menuitem", { name: "Remove from encryption" }).click();
    const dialog = web.getByRole("dialog", { name: /^Remove Folevi for Mac/ });
    // A device seen just now: "Also change your encryption key" starts off.
    await expect(dialog.getByRole("switch", { name: /Also change your encryption key/ })).not.toBeChecked();
    await dialog.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await app.close();
    app = await launch(userData);
    page = await mainWindow(app);
    await page.goto(`${APP}/documents`);
    // Removing it signs that session out, or (still signed in) it asks to unlock: either way the notes stay shut.
    await expect(page.getByRole("region", { name: "Unlock your encrypted notes" }).or(page.getByRole("heading", { name: /Sign in/i }))).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("navigation", { name: "Folio" }).filter({ visible: true })).toHaveCount(0);
  } finally {
    await app.close().catch(() => undefined);
    await person.context.close();
    rmSync(userData, { recursive: true, force: true });
  }
});
