// The owner's polish of 2026-11-26, in local mode against the shell dev server, in Chromium (the Windows look) and
// WebKit (the Mac look):
//   E2E_LOCAL_BASE_URL=http://localhost:3003 E2E_NO_SERVER=1 \
//     npx playwright test e2e/window-polish-local.spec.ts --project local --project mac-webkit --workers=2
// - Home stays in the tab strip, before the scrolling tabs, however far they scroll (TabStrip.tsx).
// - A picker's list fits its dialog on a short window: the list is what scrolls, its last row never cut off
//   (Dialog `fit`, MoveToFolderDialog.tsx).
// - Version history's top bar keeps clear of the window's buttons: the Mac's at its start, Windows' at its end.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/localShell";

async function newNote(page: Page, title: string) {
  await expect(async () => {
    await page.getByRole("button", { name: "New note", exact: true }).first().click();
    await page.waitForURL((u) => /\/d\/[0-9A-Z]{26}/.test(u.pathname) && !page.url().includes(title), { timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
  await page.getByRole("textbox", { name: "Title" }).fill(title);
}

test.describe("Window polish", { tag: ["@local", "@mac"] }, () => {
  test.beforeEach(({ backendMode }) => {
    test.skip(backendMode !== "local", "local mode only");
  });

  test("Home stays put, pickers fit short windows, version history clears the window buttons", async ({ page, browserName }) => {
    test.setTimeout(240_000);
    const look = browserName === "webkit" ? "mac" : "windows";
    await page.addInitScript((l) => {
      const mark = () => document.documentElement?.setAttribute("data-desktop", l);
      mark();
      document.addEventListener("DOMContentLoaded", mark);
      if (l === "windows") document.addEventListener("DOMContentLoaded", () => document.documentElement.style.setProperty("--win-caption-inset", "136px"));
    }, look);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/documents");
    await expect(page.getByRole("heading", { name: "Recent notes" })).toBeVisible({ timeout: 60_000 });
    for (let i = 1; i <= 12; i++) await newNote(page, `Polish ${String(i).padStart(2, "0")}`);

    // Home: the tabs scrolled to their end, Home is still on screen, on top, and takes you home.
    await page.evaluate(() => {
      const nav = document.querySelector<HTMLElement>('nav[aria-label="Open pages"]')!;
      nav.scrollLeft = nav.scrollWidth;
    });
    await page.waitForTimeout(400);
    const home = page.locator("[data-tab-home]");
    const homeOnTop = await home.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return r.left >= 0 && !!hit && el.contains(hit);
    });
    expect(homeOnTop, "Home visible with the tabs scrolled to the end").toBe(true);

    // Version history (from the note's menu; an account's notes have it, local mode's don't).
    await page.getByRole("button", { name: "Document actions" }).first().click();
    const historyItem = page.getByRole("menuitem", { name: /Version history/ });
    await page.waitForTimeout(300);
    if (await historyItem.count()) {
      await historyItem.click();
      const history = page.getByRole("dialog", { name: "Version history" });
      await expect(history).toBeVisible();
      const bar = await history.evaluate((d, l) => {
        const header = d.querySelector("header")!;
        const controls = [...header.querySelectorAll<HTMLElement>("button, label, h1")].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
        const space = header.querySelector<HTMLElement>(".ui-traffic-space")?.getBoundingClientRect();
        return l === "mac"
          ? { spaceWidth: space?.width ?? 0, clear: controls.every((r) => r.left >= (space?.right ?? 0) - 0.5) }
          : { spaceWidth: 0, clear: controls.every((r) => r.right <= innerWidth - 136) };
      }, look);
      if (look === "mac") expect(bar.spaceWidth, "the Mac's window buttons have their room").toBe(60);
      expect(bar.clear, `nothing under the ${look} window buttons`).toBe(true);
      await page.keyboard.press("Escape");
      await expect(history).toHaveCount(0);
    } else {
      test.info().annotations.push({ type: "skipped-step", description: "Version history: not in local mode" });
      await page.keyboard.press("Escape");
    }

    // Move to folder on a short window: one scroll area, the list's last row fully reachable.
    await page.locator("[data-tab-home]").click();
    await expect(page.getByRole("heading", { name: "Recent notes" })).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 330 });
    const card = page.getByRole("region", { name: "Recent notes" }).getByRole("listitem").first();
    await card.hover();
    await card.getByRole("button", { name: /^More actions for/ }).click();
    await page.getByRole("menuitem", { name: "Move to folder…" }).click();
    const dialog = page.getByRole("dialog", { name: "Move to folder" });
    const list = dialog.getByRole("listbox", { name: "Folders" });
    await expect(list.getByRole("option").first()).toBeVisible();
    const fit = await list.evaluate((ul) => {
      const body = ul.parentElement!;
      ul.scrollTop = ul.scrollHeight;
      const last = ul.lastElementChild!.getBoundingClientRect();
      const b = body.getBoundingClientRect();
      const l = ul.getBoundingClientRect();
      return { listScrolls: ul.scrollHeight > ul.clientHeight + 1, bodyScrolls: body.scrollHeight > body.clientHeight + 1, listInBody: l.bottom <= b.bottom + 0.5, lastShown: last.bottom <= l.bottom + 0.5 && last.top >= l.top - 0.5 };
    });
    // (Short enough that the list has to scroll: the case that cut its last row off.)
    expect(fit).toEqual({ listScrolls: true, bodyScrolls: false, listInBody: true, lastShown: true });
    if (process.env.POLISH_SHOTS) await dialog.screenshot({ path: `${process.env.POLISH_SHOTS}/move-${look}.png` });
  });
});
