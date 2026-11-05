// The note page's "…" menu, grouped (components/doc/noteMenu.tsx, the owner, 6 November 2026): the everyday items,
// five submenus, then Archive and Move to Trash; submenus open to the side by pointing, → or a click, and go back
// with ← or Escape. On the web and as Folevi for Mac draws it (`data-desktop="mac"`). Local mode, a FakeShell:
//   E2E_LOCAL_BASE_URL=http://localhost:3003 E2E_BASE_URL=http://app.localhost:3002 E2E_NO_SERVER=1 \
//     npx playwright test e2e/note-menu.spec.ts --project local
// NOTE_MENU_SHOTS=<folder> also saves pictures of the menu and a submenu, light and dark.
import type { Page } from "@playwright/test";
import { expect, prepareContext, test } from "./fixtures/localShell";

const shots = process.env.NOTE_MENU_SHOTS;

async function openNote(page: Page) {
  await page.goto("/documents");
  const card = page.locator("main a[href^='/d/']").first();
  await expect(card).toBeVisible({ timeout: 60_000 });
  await card.click();
  await expect(page.getByRole("textbox", { name: "Document body" })).toBeVisible({ timeout: 30_000 });
}

const rows = (page: Page, menu: string) =>
  page.getByRole("menu", { name: menu, exact: true }).evaluate((m) =>
    [...m.children].map((c) => (c.getAttribute("role") === "separator" ? "-" : (c.querySelector('[data-menu-part="label"]')?.textContent ?? "") + (c.getAttribute("aria-haspopup") ? " >" : ""))),
  );

test.describe("the note's … menu", { tag: "@local" }, () => {
  test.beforeEach(({ backendMode }) => {
    test.skip(backendMode !== "local", "local mode only");
  });

  for (const mac of [false, true]) {
    test(`grouped into submenus${mac ? ", as the Mac draws it" : ""} @local`, async ({ browser }, testInfo) => {
      test.setTimeout(120_000);
      const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
      await prepareContext(context, testInfo, { libraryName: `note-menu-${mac}-${Date.now()}`, platform: "mac" });
      if (mac) await context.addInitScript(() => document.documentElement.setAttribute("data-desktop", "mac"));
      const page = await context.newPage();
      await openNote(page);

      const open = async () => {
        await page.getByRole("group", { name: "Page" }).getByRole("button", { name: "Document actions" }).click();
        await expect(page.getByRole("menu", { name: "Document actions" })).toBeVisible();
      };
      await open();
      const top = await rows(page, "Document actions");
      // The everyday items first, then the submenus that have two items or more here, then Archive and Move to Trash.
      const everyday = ["Bookmark", "Comments", "Info", "Find and replace…"].filter((l) => top.includes(l));
      expect(top.slice(0, everyday.length + 1)).toEqual([...everyday, "-"]);
      expect(top).toContain("Move and copy >");
      expect(top).toContain("Share and export >");
      expect(top.slice(-3)).toEqual(["-", "Archive", "Move to Trash"]);
      expect(top).not.toContain("Duplicate");
      expect(top).not.toContain("Export…");

      // No empty check column before the icons: the first icon sits as close to the menu's edge as the row's padding.
      const gap = await page.getByRole("menu", { name: "Document actions" }).evaluate((m) => {
        const icon = m.querySelector('[data-menu-part="icon"]')!.getBoundingClientRect();
        return icon.left - m.getBoundingClientRect().left;
      });
      expect(gap).toBeLessThanOrEqual(18);

      const theme = async (dark: boolean) => {
        await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
        await page.evaluate((d) => document.documentElement.setAttribute("data-theme", d ? "dark" : "light"), dark);
      };
      const shoot = async (name: string) => {
        if (!shots) return;
        for (const dark of [false, true]) {
          await theme(dark);
          await page.waitForTimeout(150);
          await page.screenshot({ path: `${shots}/${mac ? "mac" : "web"}-${name}-${dark ? "dark" : "light"}.png` });
        }
        await theme(false);
      };
      await shoot("menu");

      // Pointing at a submenu's row opens it beside the menu.
      const moveCopy = page.getByRole("menuitem", { name: "Move and copy" });
      await moveCopy.hover();
      const sub = page.getByRole("menu", { name: "Move and copy" });
      await expect(sub).toBeVisible();
      expect(await rows(page, "Move and copy")).toEqual(expect.arrayContaining(["Move…", "Duplicate"]));
      const [parentBox, subBox] = [await page.getByRole("menu", { name: "Document actions" }).boundingBox(), await sub.boundingBox()];
      expect(Math.abs(subBox!.x - (parentBox!.x + parentBox!.width)) < 12 || Math.abs(subBox!.x + subBox!.width - parentBox!.x) < 12).toBe(true);
      await moveCopy.hover();
      await shoot("submenu");

      // Pointing at another row closes it again.
      await page.getByRole("menuitem", { name: "Info" }).hover();
      await expect(sub).toBeHidden();

      // The keyboard: → opens it with the first item focused, ← goes back to its row, Escape closes the menu.
      await page.getByRole("menuitem", { name: "Share and export" }).focus();
      await page.keyboard.press("ArrowRight");
      const share = page.getByRole("menu", { name: "Share and export" });
      await expect(share).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Export…" })).toBeFocused();
      await page.keyboard.press("ArrowLeft");
      await expect(share).toBeHidden();
      await expect(page.getByRole("menuitem", { name: "Share and export" })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu", { name: "Document actions" })).toBeHidden();

      // Picking an item in a submenu runs it and closes everything (Export… opens its dialog).
      await open();
      await page.getByRole("menuitem", { name: "Share and export" }).click();
      await page.getByRole("menuitem", { name: "Export…" }).click();
      await expect(page.getByRole("menu")).toHaveCount(0);
      await expect(page.getByRole("dialog")).toBeVisible();
      await context.close();
    });
  }
});
