import { expect, test, type Page } from "@playwright/test";
import { APP, newPersonWithWorkspace, showFolders, waitForSaved } from "./helpers";

const mod = process.platform === "darwin" ? "Meta" : "Control";

async function newFolder(page: Page, name: string) {
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill(name);
  await page.getByRole("button", { name: "Create folder" }).click();
  await expect(page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name })).toBeVisible();
}

test("note menu: move to folder, and find & replace inside the note", async ({ browser }) => {
  const { page } = await newPersonWithWorkspace(browser, "Finder");
  await showFolders(page);
  await newFolder(page, "Guides");

  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.getByRole("textbox", { name: "Title" }).fill("Tea notes");
  await page.keyboard.press("Enter");
  await page.keyboard.type("green tea, black tea, TEA time");
  await waitForSaved(page);

  // ⌘F in the note: matches are counted and painted; Enter steps through them.
  await page.keyboard.press(`${mod}+f`);
  const bar = page.getByRole("search", { name: "Find in note" });
  await bar.getByLabel("Find", { exact: true }).fill("tea");
  await expect(bar.getByRole("status")).toHaveText("1 of 3");
  await expect(page.locator(".fb-editor .fb-find-match")).toHaveCount(3);
  await page.keyboard.press("Enter");
  await expect(bar.getByRole("status")).toHaveText("2 of 3");
  await bar.getByRole("button", { name: "Match case" }).click();
  await expect(bar.getByRole("status")).toHaveText("1 of 2");

  // Replace all is one edit (and undoable).
  await bar.getByRole("button", { name: "Show replace" }).click();
  await bar.getByLabel("Replace with").fill("coffee");
  await bar.getByRole("button", { name: "Replace all" }).click();
  await expect(page.locator(".fb-editor")).toContainText("green coffee, black coffee, TEA time");
  await page.keyboard.press("Escape");
  await expect(bar).toHaveCount(0);
  await expect(page.locator(".fb-editor .fb-find-match")).toHaveCount(0);
  await waitForSaved(page);

  // Move to folder from the page's "…" menu.
  await page.getByRole("button", { name: "Document actions" }).click();
  await page.getByRole("menuitem", { name: "Move to folder…" }).click();
  const picker = page.getByRole("dialog", { name: "Move to folder" });
  await picker.getByRole("combobox").fill("gui");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Moved to Guides" })).toBeVisible();
});

test("a new note on a folder page starts in that folder; the tab strip shows the folder", async ({ browser }) => {
  const { page } = await newPersonWithWorkspace(browser, "Filer");
  await showFolders(page);
  await newFolder(page, "Recipes");
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Recipes" }).click();
  const strip = page.getByRole("navigation", { name: "Open pages" });
  await expect(strip.locator('[aria-current="page"]')).toHaveText("Recipes");

  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.getByRole("textbox", { name: "Title" }).fill("Soup");
  await waitForSaved(page);
  await page.getByRole("button", { name: "Up to Recipes" }).click();
  await expect(page.getByRole("main").getByText("Soup")).toBeVisible();
});

test("select several notes, act on them together; drag notes onto a folder; Empty Trash", async ({ browser }) => {
  const { page } = await newPersonWithWorkspace(browser, "Selector");
  await showFolders(page);
  await newFolder(page, "Archive box");
  const nav = page.getByRole("navigation", { name: "Workspace" });
  await nav.getByRole("link", { name: "All notes" }).click();
  await page.getByRole("radio", { name: "List" }).click();

  const row = (title: string) => page.getByRole("main").getByRole("listitem").filter({ hasText: title });
  // ⌘-click toggles, Escape clears.
  await row("Reading Shelf").getByRole("link").click({ modifiers: [mod] });
  await row("Trip Sketch").getByRole("link").click({ modifiers: [mod] });
  const bar = page.getByRole("toolbar", { name: "Selected notes" });
  await expect(bar.getByRole("status")).toHaveText("2 selected");
  await page.keyboard.press("Escape");
  await expect(bar).toHaveCount(0);

  // A selection rectangle drawn over empty space selects the rows it touches.
  const first = (await row("Reading Shelf").boundingBox())!;
  const second = (await row("Trip Sketch").boundingBox())!;
  const top = Math.min(first.y, second.y);
  const bottom = Math.max(first.y + first.height, second.y + second.height);
  await page.mouse.move(first.x - 12, top - 6);
  await page.mouse.down();
  await page.mouse.move(first.x + 60, bottom - 4, { steps: 8 });
  await page.mouse.up();
  await expect(bar.getByRole("status")).toContainText("selected");

  // Move the selection to a folder with the bar.
  await row("Reading Shelf").getByRole("link").click({ modifiers: [mod] });
  await page.keyboard.press("Escape");
  await row("Reading Shelf").getByRole("link").click({ modifiers: [mod] });
  await bar.getByRole("button", { name: "Move to folder…" }).click();
  await page.getByRole("dialog", { name: "Move to folder" }).getByRole("option", { name: "Archive box" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Moved/ })).toBeVisible();

  // Drag a card onto a folder in the sidebar; Undo puts it back.
  await row("Project Atlas Brief").dragTo(nav.getByRole("link", { name: "Archive box" }));
  const toast = page.getByRole("status").filter({ hasText: "Moved to Archive box" });
  await expect(toast).toBeVisible();
  await toast.getByRole("button", { name: "Undo" }).click();

  // Trash two notes together, then empty Trash (the dialog says how many).
  await row("Field Notes").getByRole("link").click({ modifiers: [mod] });
  await row("Welcome to Folevi").getByRole("link").click({ modifiers: [mod] });
  await bar.getByRole("button", { name: "Move to Trash" }).click();
  await nav.getByRole("link", { name: "Trash" }).click();
  await page.getByRole("button", { name: "Empty Trash" }).click();
  const confirm = page.getByRole("dialog", { name: "Empty Trash?" });
  await expect(confirm).toContainText("2 notes will be permanently deleted");
  await confirm.getByRole("button", { name: "Delete permanently" }).click();
  await expect(page.getByRole("status").filter({ hasText: "will be permanently deleted" })).toBeVisible();
});

test("Home: right-click a recent note to remove it from Recent notes (Undo brings it back)", async ({ browser }) => {
  const { page } = await newPersonWithWorkspace(browser, "Tidier");
  await page.goto(`${APP}/documents`);
  const recent = page.getByRole("region", { name: "Recent notes" });
  const card = recent.getByRole("listitem").filter({ hasText: "Reading Shelf" });
  await card.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Remove from recent" }).click();
  await expect(recent.getByRole("listitem").filter({ hasText: "Reading Shelf" })).toHaveCount(0);
  await page.getByRole("status").filter({ hasText: "Removed from Recent notes" }).getByRole("button", { name: "Undo" }).click();
  await expect(recent.getByRole("listitem").filter({ hasText: "Reading Shelf" })).toHaveCount(1);
});
