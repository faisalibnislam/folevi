// Finder-style multi-select of folders and notes (lib/app/multiSelect.ts) on a local library: ⌘-click and ⇧-click
// select (a plain click still opens), ⌘A and Escape, the floating bar and the right-click menu offering only what
// every selected item can take, Move with several folders, Open in new tabs, and a mixed selection dragged onto a
// folder. Local project only, against a shell dev server:
//   E2E_LOCAL_BASE_URL=http://localhost:3003 E2E_BASE_URL=http://app.localhost:3002 E2E_NO_SERVER=1 \
//     npx playwright test e2e/multi-select-local.spec.ts --project local --workers=1
// With MULTISELECT_SHOTS set, the screens are also saved there in light and dark.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures/localShell";
import { drag, folderLink, more, nav, newFolder, toast } from "./folderDragHelpers";

const SHOTS = process.env.MULTISELECT_SHOTS;
const mod = process.platform === "darwin" ? "Meta" : "Control";

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(SHOTS, `${name}-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: "light" });
}

const main = (page: Page) => page.getByRole("main");
/** A folder card (or row) on the page, by the folder's name. */
const card = (page: Page, name: string): Locator => main(page).locator("[data-card-id]").filter({ has: page.locator(`a[href^="/folders/"][aria-label^="${name},"], a[href^="/folders/"]:text-is("${name}")`) }).first();
const bar = (page: Page) => page.getByRole("toolbar", { name: /^Selected (notes|folders|items)$/ });
const barButtons = async (page: Page) => (await bar(page).getByRole("button").allInnerTexts()).map((t) => t.trim()).filter(Boolean);

test.describe("multi-select", { tag: "@local" }, () => {
  test("select folders and notes like Finder, act on them together", async ({ page, backendMode }) => {
    test.skip(backendMode !== "local", "local mode only");
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/documents");
    await expect(folderLink(page, "Home")).toBeVisible({ timeout: 60_000 });
    for (const name of ["Alder", "Birch", "Cedar"]) await newFolder(page, name);

    // The Folders page: ⌘-click selects instead of opening; a plain click on empty space clears.
    await page.goto("/folders");
    await expect(card(page, "Alder")).toBeVisible();
    await card(page, "Alder").locator("a").first().click({ modifiers: [mod] });
    await card(page, "Birch").locator("a").first().click({ modifiers: [mod] });
    await expect(page).toHaveURL(/\/folders$/);
    await expect(bar(page)).toHaveAttribute("aria-label", "Selected folders");
    await expect(bar(page).getByRole("status")).toHaveText("2 selected");
    expect(await barButtons(page)).toEqual(expect.arrayContaining(["Open in new tabs", "Move to folder…", "Change color…", "Delete folders…"]));
    expect(await barButtons(page)).not.toContain("Archive");
    await shot(page, "web-folders-selected");

    // Right-click on a selected folder: the selection's menu.
    await card(page, "Birch").locator("a").first().click({ button: "right" });
    const menu = page.getByRole("menu", { name: "2 folders selected" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Change color…" })).toBeVisible();
    await shot(page, "web-folders-context-menu");
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);

    // Escape clears; ⌘A selects every folder shown; ⇧-click selects a run.
    await page.keyboard.press("Escape");
    await expect(bar(page)).toHaveCount(0);
    const total = await main(page).locator("[data-card-id]").count();
    await page.keyboard.press(`${mod}+a`);
    await expect(bar(page).getByRole("status")).toHaveText(`${total} selected`);
    await page.keyboard.press("Escape");
    await card(page, "Alder").locator("a").first().click({ modifiers: [mod] });
    await card(page, "Cedar").locator("a").first().click({ modifiers: ["Shift"] });
    await expect(bar(page).getByRole("status")).toHaveText("3 selected");

    // A rectangle drawn from empty space (right of Cedar) up over Alder selects what it touches.
    await page.keyboard.press("Escape");
    const cedar = (await card(page, "Cedar").boundingBox())!;
    const alder = (await card(page, "Alder").boundingBox())!;
    await page.mouse.move(cedar.x + cedar.width + 40, cedar.y + cedar.height / 2);
    await page.mouse.down();
    await page.mouse.move(alder.x + 30, alder.y + alder.height - 30, { steps: 12 });
    await shot(page, "web-folders-rubber-band");
    await page.mouse.up();
    await expect(card(page, "Alder").locator("a").first()).toHaveAttribute("aria-label", /, selected$/);
    await expect(card(page, "Cedar").locator("a").first()).not.toHaveAttribute("aria-label", /, selected$/);

    // Move Alder and Birch into Cedar with the Move dialog (Cedar itself can't take itself, so only two go).
    await page.keyboard.press("Escape");
    await card(page, "Alder").locator("a").first().click({ modifiers: [mod] });
    await card(page, "Birch").locator("a").first().click({ modifiers: [mod] });
    await bar(page).getByRole("button", { name: "Move to folder…" }).click();
    const dialog = page.getByRole("dialog", { name: "Move to folder" });
    await expect(dialog.getByText("Choose where 2 folders should live.")).toBeVisible();
    await dialog.getByRole("option", { name: /^Cedar/ }).click();
    await expect(toast(page, "Moved 2 folders to Cedar")).toBeVisible();
    await expect(nav(page).getByRole("group", { name: "In Cedar" }).getByRole("link", { name: "Alder" })).toBeVisible();

    // A note into Cedar too (from All notes, ⌘-click then Move).
    await folderLink(page, "All notes").click();
    await page.getByRole("radio", { name: "List" }).click();
    const first = main(page).locator("[data-card-id]").first();
    const title = (await first.getByRole("link").first().innerText()).split("\n")[0]!.trim();
    await first.getByRole("link").first().click({ modifiers: [mod] });
    await expect(bar(page)).toHaveAttribute("aria-label", "Selected notes");
    expect(await barButtons(page)).toEqual(expect.arrayContaining(["Open in new tabs", "Move to folder…", "Bookmark", "Add tag…", "Archive", "Move to Trash"]));
    await shot(page, "web-notes-selected");
    await bar(page).getByRole("button", { name: "Move to folder…" }).click();
    await page.getByRole("dialog", { name: "Move to folder" }).getByRole("option", { name: /^Cedar/ }).click();
    await expect(toast(page, "Moved to Cedar")).toBeVisible();

    // Cedar's page: its folders and its note are one list. A folder and a note together offer only what both take.
    if (await more(page).count()) await more(page).click();
    await folderLink(page, "Cedar").click();
    await expect(card(page, "Alder")).toBeVisible();
    await card(page, "Alder").locator("a").first().click({ modifiers: [mod] });
    const note = main(page).locator("[data-card-id]").filter({ hasText: title }).first();
    await note.getByRole("link").first().click({ modifiers: [mod] });
    await expect(bar(page)).toHaveAttribute("aria-label", "Selected items");
    expect(await barButtons(page)).toEqual(["Select all", "Open in new tabs", "Move to folder…"]);
    await shot(page, "web-folder-page-mixed");

    // Open in new tabs: both join the strip behind this page, which stays.
    await bar(page).getByRole("button", { name: "Open in new tabs" }).click();
    await expect(toast(page, "Opened 2 new tabs")).toBeVisible();
    const strip = page.getByRole("navigation", { name: "Open pages" });
    await expect(strip.getByText("Alder", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/folders\//);

    // Dragging the selected note takes the folder along, onto Birch's card.
    const d = await drag(page, note, card(page, "Birch"), 0.5, 250);
    await d.drop();
    await expect(toast(page, `Moved 1 folder and 1 note to Birch`)).toBeVisible();
    await expect(nav(page).getByRole("group", { name: "In Birch" }).getByRole("link", { name: "Alder" })).toBeVisible();

    // A plain click still opens a folder.
    await card(page, "Birch").locator("a").first().click();
    await expect(page.getByRole("heading", { name: "Birch" }).first()).toBeVisible();
    await expect(main(page).getByText(title).first()).toBeVisible();
  });
});
