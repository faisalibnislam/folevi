// Drag and drop in the sidebar's folders on a local library ("Keep notes on my devices", docs/LOCAL_MODE_PLAN.md):
// the same drops as with an account (e2e/folder-drag.spec.ts), kept in the library's folder, so a reload shows them.
// Local project only:
//   E2E_LOCAL_BASE_URL=http://localhost:3003 E2E_BASE_URL=http://app.localhost:3002 E2E_NO_SERVER=1 \
//     npx playwright test e2e/folder-drag-local.spec.ts --project local --workers=1
import { expect, test } from "./fixtures/localShell";
import { drag, folderLink, more, nav, newFolder, roots, row, toast } from "./folderDragHelpers";

test.describe("folders on this device", { tag: "@local" }, () => {
  test("reorder, nest, un-nest, refuse and file a note by dragging; still so after a reload", async ({ page, backendMode }) => {
    test.skip(backendMode !== "local", "local mode only");
    test.setTimeout(180_000);
    await page.goto("/documents");
    await expect(folderLink(page, "Home")).toBeVisible({ timeout: 60_000 });
    for (const name of ["Maple", "Oak", "Pine"]) await newFolder(page, name);
    const mine = async () => (await roots(page)).filter((n) => ["Maple", "Oak", "Pine"].includes(n));
    expect(await mine()).toEqual(["Maple", "Oak", "Pine"]);

    // A line above Maple: Pine goes first.
    let d = await drag(page, folderLink(page, "Pine"), row(page, "Maple"), 0.1);
    await expect(row(page, "Maple")).toHaveAttribute("data-drop-state", "before");
    await d.drop();
    await expect(toast(page, "Moved “Pine”")).toBeVisible();
    await expect.poll(mine).toEqual(["Pine", "Maple", "Oak"]);

    // Into Maple, then Maple can't go into it.
    await drag(page, folderLink(page, "Oak"), row(page, "Maple"), 0.5).then((x) => x.drop());
    await expect(toast(page, "Moved “Oak” to Maple")).toBeVisible();
    await expect(nav(page).getByRole("group", { name: "In Maple" }).getByRole("link", { name: "Oak" })).toBeVisible();
    d = await drag(page, folderLink(page, "Maple"), row(page, "Oak"), 0.5);
    await expect(row(page, "Oak")).toHaveAttribute("data-drop-state", "refused");
    await d.drop();
    await expect(nav(page).getByRole("group", { name: "In Maple" }).getByRole("link", { name: "Oak" })).toBeVisible();

    // A note onto Pine, from the All notes list.
    await folderLink(page, "All notes").click();
    await page.getByRole("radio", { name: "List" }).click();
    const first = page.getByRole("main").getByRole("listitem").first();
    const title = (await first.getByRole("link").first().innerText()).split("\n")[0]!.trim();
    await drag(page, first, row(page, "Pine"), 0.5).then((x) => x.drop());
    await expect(toast(page, "Moved to Pine")).toBeVisible();

    // After a reload, from the library: the order, the nesting and the note.
    await page.waitForTimeout(2500);
    await page.reload();
    await expect(folderLink(page, "Pine")).toBeVisible({ timeout: 60_000 });
    if (await more(page).count()) await more(page).click();
    expect(await mine()).toEqual(["Pine", "Maple"]);
    await expect(nav(page).getByRole("group", { name: "In Maple" }).getByRole("link", { name: "Oak" })).toBeVisible();
    await folderLink(page, "Pine").click();
    await expect(page.getByRole("main").getByText(title).first()).toBeVisible();

    // Undo of an un-nesting puts it back inside.
    await drag(page, folderLink(page, "Oak"), row(page, "Pine"), 0.1).then((x) => x.drop());
    await expect(toast(page, "Moved “Oak” to the top level")).toBeVisible();
    await expect.poll(mine).toEqual(["Oak", "Pine", "Maple"]);
    await toast(page, "Moved “Oak” to the top level").getByRole("button", { name: "Undo" }).click();
    await expect(nav(page).getByRole("group", { name: "In Maple" }).getByRole("link", { name: "Oak" })).toBeVisible();
  });
});
