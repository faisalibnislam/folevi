import { expect, test, type Page } from "@playwright/test";
import { strToU8, unzipSync, zipSync } from "fflate";
import { newPerson, waitForSaved } from "./helpers";

// 1×1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

async function newPage(page: Page, title: string) {
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  const t = page.getByRole("textbox", { name: "Title" });
  await expect(t).toBeFocused();
  await t.fill(title);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Document body" })).toBeFocused();
  return page.url().replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "");
}

test.describe("documents", () => {
  test("an inserted image uploads right away (no reload needed) and survives a reload", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Upload Tester");
    await newPage(page, "Photos");
    await page.keyboard.type("/image");
    const chooser = page.waitForEvent("filechooser");
    await page.keyboard.press("Enter");
    await (await chooser).setFiles({ name: "dot.png", mimeType: "image/png", buffer: PNG });
    const img = page.locator(".fb-editor img");
    // The server URL replaces the local preview once the upload is done.
    await expect(img).toHaveAttribute("src", /\/files\//, { timeout: 20_000 });
    await waitForSaved(page);
    await page.reload();
    await expect(page.locator(".fb-editor img")).toHaveAttribute("src", /\/files\//);
    await context.close();
  });

  test("comments: @mention suggestions, editing a comment, and resolve", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Mira Comment");
    await newPage(page, "Discussed");
    await page.keyboard.type("Something to discuss");
    await waitForSaved(page);
    await page.getByRole("tab", { name: /^Comments/ }).click();
    const box = page.getByRole("textbox", { name: /Comment on this document/ });
    await box.click();
    await page.keyboard.type("Ping @Mir");
    const suggestion = page.getByRole("option", { name: /Mira Comment/ });
    await expect(suggestion).toBeVisible();
    await expect(box).toHaveAttribute("aria-activedescendant", (await suggestion.getAttribute("id"))!);
    await page.keyboard.press("Enter");
    await expect(box).toHaveValue("Ping @Mira Comment ");
    await page.keyboard.type("please");
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    // A comment on the whole note opens right in the Comments panel.
    await page.getByRole("button", { name: /On the whole note/ }).click();
    const thread = page.getByRole("region", { name: "Thread" });
    await expect(thread.locator("span", { hasText: "@Mira Comment" })).toBeVisible();
    await thread.getByRole("listitem").filter({ hasText: "Ping" }).hover();
    await thread.getByRole("button", { name: /Options for Mira Comment/ }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    const edit = page.getByRole("textbox", { name: "Edit comment" });
    await edit.fill("Ping @Mira Comment again");
    await thread.getByRole("button", { name: "Save", exact: true }).click();
    await expect(thread).toContainText("again");
    await expect(thread).toContainText("edited");
    await thread.getByRole("button", { name: "Resolve thread" }).click();
    await expect(page.getByText("No open comments.")).toBeVisible();
    await page.getByRole("button", { name: /^Resolved/ }).click();
    await expect(page.getByRole("button", { name: /On the whole note/ })).toContainText("Resolved by Mira Comment");
    await context.close();
  });

  test("comments on a block: ⌘⌥M opens a thread under it, and the comment line reopens it", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Block Commenter");
    await newPage(page, "Launch review");
    await page.keyboard.type("Ship the beta on Friday");
    await waitForSaved(page);
    const mod = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.press(`${mod}+Alt+KeyM`);
    const card = page.getByRole("dialog", { name: "Comments" });
    const box = card.getByRole("textbox", { name: "Comment on this block" });
    await expect(box).toBeFocused();
    await page.keyboard.type("Is Friday realistic?");
    await page.keyboard.press("Enter");
    await expect(card.getByText("Is Friday realistic?")).toBeVisible();
    // The thread now takes replies; Escape closes it.
    await expect(card.getByRole("textbox", { name: "Reply" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(card).toBeHidden();
    const line = page.getByRole("button", { name: /^1 comment, latest/ });
    await expect(line).toBeVisible();
    await line.click();
    await expect(card.getByText("Is Friday realistic?")).toBeVisible();
    // Resolving collapses the thread and removes the line under the block.
    await card.getByRole("button", { name: "Resolve thread" }).click();
    await expect(card.getByText(/^Resolved/)).toBeVisible();
    await card.getByRole("button", { name: "Close comments" }).click();
    await expect(line).toBeHidden();
    await context.close();
  });

  test("move a page under another page; exports use current titles of linked pages", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Mover");
    const parentPath = await newPage(page, "Harbor parent");
    await page.keyboard.type("Parent body");
    await waitForSaved(page);
    await newPage(page, "Loose child");
    await page.keyboard.type("Child body");
    await waitForSaved(page);
    await page.getByRole("button", { name: "Document actions" }).click();
    await page.getByRole("menuitem", { name: "Move to page…" }).click();
    const dialog = page.getByRole("dialog", { name: "Move page" });
    await dialog.getByRole("textbox", { name: "Search pages" }).fill("Harbor parent");
    await dialog.getByRole("button", { name: /Harbor parent/ }).click();
    await expect(page.getByText("Moved into “Harbor parent”")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: /Harbor parent/ })).toBeVisible();
    // The parent now shows a card for its new child.
    await page.goto(parentPath);
    await expect(page.locator(".fb-editor").getByText("Loose child")).toBeVisible({ timeout: 15_000 });

    // Link a page, rename it, and the Markdown export shows the new title (not the cached one).
    await page.locator(".fb-editor p").first().click();
    await page.keyboard.press("End");
    await page.keyboard.type(" see [[Tide");
    await page.getByRole("option", { name: /Create page “Tide”/ }).click();
    await waitForSaved(page);
    // Alt-click opens the linked page in a new tab; a plain click opens it here.
    const popup = context.waitForEvent("page");
    await page.locator(".fb-editor a[data-page-link]").click({ modifiers: ["Alt"] });
    const tab = await popup;
    await tab.waitForURL(/\/d\/[0-9A-Z]{26}$/);
    await tab.close();
    expect(page.url()).toContain(parentPath);
    await page.locator(".fb-editor a[data-page-link]").click();
    await page.waitForURL(/\/d\/[0-9A-Z]{26}$/);
    await page.getByRole("textbox", { name: "Title" }).fill("Tide tables");
    await waitForSaved(page);
    await page.goto(parentPath);
    await expect(page.locator(".fb-editor a[data-page-link]")).toBeVisible();
    await page.getByRole("button", { name: "Document actions" }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Export as Markdown" }).click();
    const md = Buffer.concat(await (await (await download).createReadStream()).toArray()).toString("utf8");
    expect(md).toMatch(/\[Tide tables\]\(https?:\/\/[^)]+\/d\/[0-9A-Z]{26}\)/);
    expect(md).toMatch(/\[Loose child\]\(https?:\/\/[^)]+\/d\/[0-9A-Z]{26}\)/);
    await context.close();
  });

  test("import a ZIP: relative images are uploaded, dropped front matter is reported, display math becomes a formula", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Zip Importer");
    await page.goto("/settings/data");
    const zip = zipSync({
      "notes/trip.md": strToU8(["---", "title: Island trip", "tags: travel", "---", "", "Intro", "", "![Dot](img/dot.png)", "", "$$", "e = mc^2", "$$", ""].join("\n")),
      "notes/img/dot.png": new Uint8Array(PNG),
    });
    await page.locator('input[type="file"]').first().setInputFiles({ name: "bundle.zip", mimeType: "application/zip", buffer: Buffer.from(zip) });
    const result = page.getByRole("list", { name: "Import results" });
    await expect(result.getByRole("link", { name: /trip\.md/ })).toBeVisible({ timeout: 30_000 });
    await expect(result).toContainText("1 image uploaded");
    await expect(result).toContainText("Front matter field not imported: tags");
    await expect(result).not.toContainText("Math");
    await result.getByRole("link", { name: /trip\.md/ }).click();
    await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Island trip");
    await expect(page.locator(".fb-editor img")).toHaveAttribute("src", /\/files\//);
    // $$…$$ is imported as a formula block and rendered with KaTeX.
    await expect(page.locator(".fb-editor .fb-formula .katex")).toBeVisible();
    await expect(page.locator(".fb-editor .fb-formula annotation")).toHaveText("e = mc^2");
    await context.close();
  });

  test("Personal export streams a ZIP with Markdown in sidebar folders and a manifest", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Exporter");
    await page.goto("/settings/data");
    const download = page.waitForEvent("download", { timeout: 60_000 });
    await page.getByRole("button", { name: "Export Personal (.zip)" }).click();
    const file = await download;
    const bytes = Buffer.concat(await (await file.createReadStream()).toArray());
    const files = unzipSync(new Uint8Array(bytes));
    const manifest = JSON.parse(Buffer.from(files["manifest.json"]!).toString("utf8")) as { documents: { markdown: string; title: string }[]; skippedAssets: unknown[] };
    expect(manifest.skippedAssets).toEqual([]);
    const welcome = manifest.documents.find((d) => d.title === "Welcome to Folevi")!;
    expect(files[welcome.markdown]).toBeTruthy();
    expect(Buffer.from(files[welcome.markdown]!).toString("utf8")).toContain("# Welcome to Folevi");
    await context.close();
  });

  test("page tools live in a bottom dock: each opens a floating panel; Escape returns focus; no side panel", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Dock Tester");
    await newPage(page, "Dock");
    const dock = page.getByRole("toolbar", { name: "Page tools" });
    for (const name of ["Insert", "Format", "Style"]) await expect(dock.getByRole("button", { name, exact: true })).toBeVisible();
    const noteWidth = (await page.locator("#doc-scroll").boundingBox())!.width;
    // Style opens as a floating card (here from the keyboard); the note keeps its full width.
    await dock.getByRole("button", { name: "Style", exact: true }).focus();
    await page.keyboard.press("Enter");
    const panel = page.locator("#document-inspector");
    await expect(panel.getByRole("heading", { name: "Style" })).toBeVisible();
    await expect(dock.getByRole("button", { name: "Style", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect((await page.locator("#doc-scroll").boundingBox())!.width).toBe(noteWidth);
    // Focus moves in; Escape closes it and returns focus to the dock button that opened it.
    await expect(panel.locator(":focus")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(dock.getByRole("button", { name: "Style", exact: true })).toBeFocused();
    // Pressing another tool switches the panel; pressing it again closes it.
    await dock.getByRole("button", { name: "Format", exact: true }).click();
    await expect(panel.getByRole("heading", { name: "Format" })).toBeVisible();
    await dock.getByRole("button", { name: "Format", exact: true }).click();
    await expect(panel).toBeHidden();
    // Info (like Share) is in the page's "…" menu, and opens in the same floating panel.
    const icons = page.getByRole("group", { name: "Page" });
    await icons.getByRole("button", { name: "Document actions" }).click();
    await page.getByRole("menuitem", { name: "Info" }).click();
    await expect(panel.getByRole("heading", { name: "Info" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    // Page actions sit in the dock; the save state sits in the page's sidebar.
    const noteBox = (await page.locator("#doc-scroll").boundingBox())!;
    const iconsBox = (await icons.boundingBox())!;
    expect(iconsBox.y).toBeGreaterThanOrEqual(noteBox.y);
    expect(iconsBox.x + iconsBox.width).toBeLessThanOrEqual(noteBox.x + noteBox.width);
    await expect(page.getByTestId("sync-status")).toHaveCount(1);
    await expect(icons.getByTestId("sync-status")).toHaveCount(0);
    // Phone width: the dock stays, icons only.
    await page.setViewportSize({ width: 390, height: 800 });
    await expect(dock.getByRole("button", { name: "Format", exact: true })).toBeVisible();
    await context.close();
  });
});
