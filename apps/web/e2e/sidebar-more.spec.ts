import { expect, test, type Page } from "@playwright/test";
import { newPerson, signIn } from "./helpers";

// The sidebar's More section and Customize sidebar (the owner, 2026-11-27; lib/app/sidebarLayout.ts): Shared with
// Me, Changes and Templates start under More, which starts closed and remembers being opened; it opens by itself for
// the page you're on. A right-click moves an item in or out of More; Customize sidebar has a checkbox per item and
// reorders them, by drag or by Move up and Move down. Home and Drafts always stay. The layout is saved with the
// account, so another sign-in shows it too.

const sidebar = (page: Page) => page.getByRole("navigation", { name: "Folio" });
const moreToggle = (page: Page) => sidebar(page).getByRole("button", { name: "More", exact: true });
const moreGroup = (page: Page) => sidebar(page).getByRole("group", { name: "More" });
/** A sidebar row by its label (its accessible name also carries its count: "Drafts 1"). */
const row = (name: string) => ({ name: new RegExp(`^${name}( \\d+)?$`) });

/** The names of the app's own items above More, in order (not the rows inside a group: More, bookmarked notes). */
async function topItems(page: Page): Promise<string[]> {
  return page.locator("[data-sidebar-items]").evaluate((list) =>
    [...list.querySelectorAll("a")].filter((a) => !a.closest("[role=group]")).map((a) => a.querySelector(".truncate")?.textContent?.trim() ?? ""),
  );
}

test.describe("the sidebar's More section", () => {
  test("starts with Shared with Me, Changes and Templates under a closed More; opens and remembers it", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "More Person");
    await page.goto("/documents");
    await expect(moreToggle(page)).toHaveAttribute("aria-expanded", "false");
    for (const name of ["Home", "Drafts", "All notes", "Tasks", "Calendar"]) await expect(sidebar(page).getByRole("link", row(name))).toBeVisible();
    await expect(sidebar(page).getByRole("link", row("Templates"))).toHaveCount(0);

    await moreToggle(page).click();
    await expect(moreToggle(page)).toHaveAttribute("aria-expanded", "true");
    for (const name of ["Shared with Me", "Changes", "Templates"]) await expect(moreGroup(page).getByRole("link", row(name))).toBeVisible();
    await expect(moreGroup(page).getByRole("button", { name: "Customize" })).toBeVisible();
    // Remembered after a reload.
    await page.reload();
    await expect(moreToggle(page)).toHaveAttribute("aria-expanded", "true");
    await moreToggle(page).click();
    await page.reload();
    await expect(moreToggle(page)).toHaveAttribute("aria-expanded", "false");

    // On a page under More, More opens by itself with that item marked.
    await page.goto("/templates");
    await expect(moreToggle(page)).toHaveAttribute("aria-expanded", "true");
    await expect(moreGroup(page).getByRole("link", row("Templates"))).toHaveAttribute("aria-current", "page");
    await context.close();
  });

  test("right-click moves an item to More and back; Home and Drafts can't move", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Move Person");
    await page.goto("/documents");
    await sidebar(page).getByRole("link", row("Calendar")).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Move to More" }).click();
    await moreToggle(page).click();
    await expect(moreGroup(page).getByRole("link", row("Calendar"))).toBeVisible();

    await moreGroup(page).getByRole("link", row("Templates")).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Move to sidebar" }).click();
    await expect(moreGroup(page).getByRole("link", row("Templates"))).toHaveCount(0);
    await expect(sidebar(page).getByRole("link", row("Templates"))).toBeVisible();

    await sidebar(page).getByRole("link", row("Home")).click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "Move to More" })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Always on the sidebar" })).toBeDisabled();
    await page.keyboard.press("Escape");
    await context.close();
  });

  test("Customize sidebar: checkboxes, Move up, drag, Reset; saved with the account", async ({ browser }) => {
    const { context, page, account } = await newPerson(browser, "Customize Person");
    await page.goto("/documents");

    // Opened from empty sidebar space.
    const nav = sidebar(page);
    const box = (await nav.locator("div.overflow-y-auto").first().boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 8, { button: "right" });
    await page.getByRole("menuitem", { name: "Customize sidebar…" }).click();
    const dialog = page.getByRole("dialog", { name: "Customize sidebar" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("checkbox", { name: /Home/ })).toBeDisabled();
    await expect(dialog.getByRole("checkbox", { name: /Drafts/ })).toBeDisabled();
    await expect(dialog.getByRole("checkbox", { name: /Templates/ })).not.toBeChecked();

    // Tasks under More; Calendar to the top; Templates dragged onto the sidebar above All notes.
    await dialog.getByRole("checkbox", { name: /Tasks/ }).click();
    await expect(dialog.getByRole("checkbox", { name: /Tasks/ })).not.toBeChecked();
    for (let i = 0; i < 12; i++) {
      const up = dialog.getByRole("button", { name: "Move Calendar up" });
      if (await up.isDisabled()) break;
      await up.click();
    }
    await dialog.getByRole("checkbox", { name: /Templates/ }).click();
    await dialog.locator('[data-sidebar-item="templates"]').dragTo(dialog.locator('[data-sidebar-item="notes"]'), { targetPosition: { x: 40, y: 2 } });
    await dialog.getByRole("button", { name: "Done" }).click();

    const expectLayout = async (p: Page) => {
      await expect.poll(() => topItems(p)).toEqual(expect.arrayContaining(["Calendar", "Home", "Templates", "All notes"]));
      const top = await topItems(p);
      expect(top[0]).toBe("Calendar");
      expect(top.indexOf("Templates")).toBe(top.indexOf("All notes") - 1);
      expect(top).not.toContain("Tasks");
    };
    await expectLayout(page);

    // Another sign-in to the same account shows the same layout.
    const other = await browser.newContext();
    const there = await signIn(other, account);
    await there.goto("/documents");
    await expectLayout(there);
    await other.close();

    // Reset to default.
    await moreToggle(page).click();
    await moreGroup(page).getByRole("button", { name: "Customize" }).click();
    await dialog.getByRole("button", { name: "Reset to default" }).click();
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect.poll(() => topItems(page)).toEqual(expect.arrayContaining(["Home", "Tasks", "Calendar"]));
    expect((await topItems(page))[0]).toBe("Home");
    await context.close();
  });
});
