// The sidebar's More section in local mode (a library on this device: lib/local/functions/sidebarLayout.ts keeps
// the layout in the library). Local project only:
//   E2E_LOCAL_BASE_URL=http://localhost:3003 E2E_BASE_URL=http://app.localhost:3002 E2E_NO_SERVER=1 \
//     npx playwright test e2e/sidebar-more-local.spec.ts --project local --workers=1
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/localShell";

const sidebar = (page: Page) => page.getByRole("navigation", { name: "Folio" });
const moreToggle = (page: Page) => sidebar(page).getByRole("button", { name: "More", exact: true });
const moreGroup = (page: Page) => sidebar(page).getByRole("group", { name: "More" });
const topItems = (page: Page) =>
  page.locator("[data-sidebar-items]").evaluate((list) => [...list.querySelectorAll("a")].filter((a) => !a.closest("[role=group]")).map((a) => a.querySelector(".truncate")?.textContent?.trim() ?? ""));

test.describe("the sidebar's More section", { tag: "@local" }, () => {
  test("More, Move to More, Customize sidebar, kept in the library", async ({ page, backendMode }, testInfo) => {
    test.skip(backendMode !== "local", "local mode only");
    test.setTimeout(120_000);
    await page.goto("/documents");
    await expect(sidebar(page).getByRole("link", { name: "Home", exact: true })).toBeVisible({ timeout: 60_000 });

    // Templates starts under a closed More.
    await expect(moreToggle(page)).toHaveAttribute("aria-expanded", "false");
    await expect(sidebar(page).getByRole("link", { name: "Templates", exact: true })).toHaveCount(0);
    await moreToggle(page).click();
    await expect(moreGroup(page).getByRole("link", { name: "Templates", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("more-open.png") });

    // Right-click: Calendar to More. By keyboard: Shift+F10 on a focused row opens the same menu.
    await sidebar(page).getByRole("link", { name: "Calendar", exact: true }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Move to More" }).click();
    await expect(moreGroup(page).getByRole("link", { name: "Calendar", exact: true })).toBeVisible();
    await moreGroup(page).getByRole("link", { name: "Calendar", exact: true }).focus();
    await page.keyboard.press("Shift+F10");
    await page.getByRole("menuitem", { name: "Move to sidebar" }).click();
    await expect(moreGroup(page).getByRole("link", { name: "Calendar", exact: true })).toHaveCount(0);

    // Customize sidebar, from the end of More: Tasks under More, Templates on the sidebar and moved up by keyboard.
    await moreGroup(page).getByRole("button", { name: "Customize" }).click();
    const dialog = page.getByRole("dialog", { name: "Customize sidebar" });
    await expect(dialog.getByRole("checkbox", { name: /Home/ })).toBeDisabled();
    await dialog.getByRole("checkbox", { name: /Tasks/ }).click();
    await dialog.getByRole("checkbox", { name: /Templates/ }).click();
    const rows = () => dialog.locator("[data-sidebar-item]").evaluateAll((els) => els.map((e) => e.getAttribute("data-sidebar-item")));
    const before = await rows();
    await dialog.getByRole("button", { name: "Move Templates up" }).focus();
    await page.keyboard.press("Enter");
    const after = await rows();
    expect(after.indexOf("templates")).toBe(before.indexOf("templates") - 1);
    expect(after[after.indexOf("templates") + 1]).toBe(before[before.indexOf("templates") - 1]);
    await page.screenshot({ path: testInfo.outputPath("customize.png") });
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect.poll(() => topItems(page)).not.toContain("Tasks");
    const top = await topItems(page);
    expect(top).toContain("Templates");
    // The sidebar shows the dialog's order: Templates right after Calendar's neighbours above it, Tasks gone.
    expect(top.indexOf("Templates")).toBeGreaterThan(top.indexOf("Calendar"));

    // On a page under More, More opens by itself.
    await moreToggle(page).click();
    await expect(moreToggle(page)).toHaveAttribute("aria-expanded", "false");
    await page.goto("/tasks/today");
    await expect(moreToggle(page)).toHaveAttribute("aria-expanded", "true");
    await expect(moreGroup(page).getByRole("link", { name: /^Tasks\b/ })).toHaveAttribute("aria-current", "page");

    // Kept in the library across a reload.
    await page.reload();
    await expect(moreGroup(page).getByRole("link", { name: /^Tasks\b/ })).toBeVisible({ timeout: 60_000 });
    await page.screenshot({ path: testInfo.outputPath("after-reload.png") });

    // Right-click on empty sidebar space opens Customize sidebar; drag Templates above All notes.
    const box = (await sidebar(page).locator("div.overflow-y-auto").first().boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 8, { button: "right" });
    await page.getByRole("menuitem", { name: "Customize sidebar…" }).click();
    const again = page.getByRole("dialog", { name: "Customize sidebar" });
    await again.locator('[data-sidebar-item="templates"]').dragTo(again.locator('[data-sidebar-item="notes"]'), { targetPosition: { x: 40, y: 2 } });
    await expect.poll(() => rows()).toEqual(expect.arrayContaining(["templates", "notes"]));
    const order = await rows();
    expect(order.indexOf("templates")).toBe(order.indexOf("notes") - 1);
    await again.getByRole("button", { name: "Done" }).click();
    await expect.poll(async () => {
      const t = await topItems(page);
      return t.indexOf("Templates") === t.indexOf("All notes") - 1;
    }).toBe(true);

  });
});
