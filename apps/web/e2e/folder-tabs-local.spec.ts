// Folders open like Finder in the tab strip (the owner, 6 November 2026; lib/app/tabs.tsx): a folder shows in a folder
// tab that navigates instead of adding a tab, Home is never replaced, a ⌘-click still opens one behind, and the top
// bar's Back steps through the tab's own history. Local project only:
//   E2E_LOCAL_BASE_URL=http://localhost:3003 E2E_BASE_URL=http://app.localhost:3002 E2E_NO_SERVER=1 \
//     npx playwright test e2e/folder-tabs-local.spec.ts --project local --workers=1
import { expect, test } from "./fixtures/localShell";
import { folderLink, newFolder } from "./folderDragHelpers";

test.describe("folder tabs", { tag: "@local" }, () => {
  test("a folder navigates its tab; from Home the same tab is reused; ⌘-click adds one; Back stays in the tab", async ({ page, backendMode }) => {
    test.skip(backendMode !== "local", "local mode only");
    test.setTimeout(120_000);
    const strip = page.getByRole("navigation", { name: "Open pages" });
    const tabs = strip.getByRole("link");
    await page.goto("/documents");
    await expect(folderLink(page, "Home")).toBeVisible({ timeout: 60_000 });
    for (const name of ["Brainstorming", "Cherries", "Plums"]) await newFolder(page, name);
    const before = await tabs.count();

    await folderLink(page, "Brainstorming").click();
    await expect(page).toHaveURL(/\/folders\/.+/);
    await expect(tabs).toHaveCount(before + 1);
    await folderLink(page, "Cherries").click();
    await expect(strip.getByRole("link", { name: "Cherries" })).toBeVisible();
    await expect(tabs).toHaveCount(before + 1);

    // Back goes to Brainstorming in the same tab.
    await page.getByRole("group", { name: "History" }).getByRole("button", { name: "Back" }).click();
    await expect(strip.getByRole("link", { name: "Brainstorming" })).toBeVisible();
    await expect(tabs).toHaveCount(before + 1);

    // From Home, the folder tab is reused; Home stays.
    await strip.getByRole("link", { name: "Home" }).click();
    await expect(page).toHaveURL(/\/documents/);
    await folderLink(page, "Plums").click();
    await expect(strip.getByRole("link", { name: "Plums" })).toBeVisible();
    await expect(tabs).toHaveCount(before + 1);

    // ⌘-click opens a folder tab behind; a plain click on that folder then switches to it.
    await folderLink(page, "Cherries").click({ modifiers: ["ControlOrMeta"] });
    await expect(tabs).toHaveCount(before + 2);
    await expect(strip.getByRole("link", { name: "Plums" })).toHaveAttribute("aria-current", "page");
    await folderLink(page, "Cherries").click();
    await expect(strip.getByRole("link", { name: "Cherries" })).toHaveAttribute("aria-current", "page");
    await expect(strip.getByRole("link", { name: "Plums" })).toBeVisible();
    await expect(tabs).toHaveCount(before + 2);
  });
});
