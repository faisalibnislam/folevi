import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { newPerson, waitForSaved, openTool, settle, openShare } from "./helpers";

async function newPage(page: Page, title: string) {
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Intro");
  await waitForSaved(page);
}

async function openInsert(page: Page) {
  const panel = await openTool(page, "Insert");
  await expect(panel.getByText("Drag and drop any item to the document")).toBeVisible();
  return panel;
}

/** Puts the caret at the end of the document's last text block, so the next insert lands at the end. */
async function caretToEnd(page: Page) {
  await page.locator(".fb-editor > p.fb").last().click();
  await page.keyboard.press("End");
}

test.describe("Insert panel", () => {
  test.setTimeout(150_000);

  test("inserts lines, a page break, a picked table, a formula, a Mermaid diagram and a whiteboard that all persist and publish", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Insert Blocks Tester");
    await newPage(page, "Insert blocks");
    const panel = await openInsert(page);

    // Craft-style tiles: a picture and a label, grouped into sections (an item can sit in two sections), the
    // same groups as the slash menu.
    const tilesIn: Record<string, string[]> = {
      Suggested: ["Text", "Page", "Card", "To-do", "Table", "Image"],
      Text: ["Heading 1", "Heading 2", "Heading 3", "Quote", "Callout"],
      "Lists and tasks": ["Bulleted list", "Numbered list", "To-do", "Toggle"],
      Visuals: ["Flowchart", "Mind map", "Chart", "Sticky notes", "Wireframe", "Whiteboard", "Mermaid diagram"],
      Media: ["Image", "Image from Unsplash", "File attachment", "Audio recording", "Bookmark", "Embed"],
      "Data and more": ["Table", "Gallery", "Kanban", "Calendar", "Page", "Card", "Date", "Code block", "TeX formula", "Extra light", "Light", "Regular", "Strong", "Page break"],
    };
    const headings = panel.locator("h3");
    await expect(headings).toHaveText(Object.keys(tilesIn));
    for (const [section, labels] of Object.entries(tilesIn)) {
      const group = panel.getByRole("group", { name: section, exact: true });
      await expect(group.getByRole("heading", { name: section, exact: true })).toBeVisible();
      expect(await group.locator("button[title]").evaluateAll((els) => els.map((el) => el.getAttribute("title")))).toEqual(labels);
    }
    await expect(panel.getByRole("group", { name: "Data and more", exact: true }).getByRole("heading", { name: "Quick table", exact: true })).toBeVisible();
    // Search narrows the list.
    await panel.getByRole("textbox", { name: "Search blocks" }).fill("mermaid");
    await expect(panel.getByRole("button", { name: "Mermaid diagram" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Whiteboard" })).toHaveCount(0);
    await expect(panel.getByRole("group", { name: "Suggested", exact: true })).toHaveCount(0);
    // Across groups: "map" finds the mind map in Visuals and the map embed in Media.
    await panel.getByRole("textbox", { name: "Search blocks" }).fill("map");
    await expect(panel.getByRole("group", { name: "Visuals", exact: true }).getByRole("button", { name: "Mind map" })).toBeVisible();
    await expect(panel.getByRole("group", { name: "Media", exact: true }).getByRole("button", { name: "Embed" })).toBeVisible();
    await panel.getByRole("textbox", { name: "Search blocks" }).fill("zzzz");
    await expect(panel.getByText("No matches", { exact: true })).toBeVisible();
    await panel.getByRole("textbox", { name: "Search blocks" }).fill("");

    // Four divider styles.
    for (const style of ["extralight", "light", "regular", "strong"]) {
      await caretToEnd(page);
      await panel.getByRole("button", { name: `Divider, ${style === "extralight" ? "extra light" : style}` }).click();
      await expect(page.locator(`.fb-editor .fb-divider[data-style="${style}"]`)).toHaveCount(1);
    }

    // Page break.
    await caretToEnd(page);
    await panel.getByRole("button", { name: "Page break" }).click();
    await expect(page.locator(".fb-editor .fb-page-break")).toHaveCount(1);

    // Table picker: hover highlights rows × columns; click inserts that size.
    await caretToEnd(page);
    const cell = panel.getByRole("button", { name: /^3 × 4 table/ });
    await cell.hover();
    await expect(panel.getByText("3 × 4", { exact: true })).toBeVisible();
    await expect(panel.locator('.fb-table-cell[data-lit="true"]')).toHaveCount(12);
    await cell.click();
    const table = page.locator(".fb-editor table.fb-table").first();
    await expect(table.locator("tbody tr")).toHaveCount(3);
    await expect(table.locator("tbody tr").first().locator("th")).toHaveCount(4);
    // Keyboard: arrows move the highlight (announced), Enter inserts.
    await caretToEnd(page);
    await page.mouse.move(0, 0);
    await panel.getByRole("button", { name: /^3 × 3 table/ }).focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowLeft");
    await expect(panel.getByText("4 × 2", { exact: true })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator(".fb-editor table.fb-table")).toHaveCount(2);
    await expect(page.locator(".fb-editor table.fb-table").nth(1).locator("tbody tr")).toHaveCount(4);

    // TeX formula: opens for editing, renders with KaTeX.
    await caretToEnd(page);
    await panel.getByRole("button", { name: "TeX formula" }).click();
    const latex = page.getByRole("textbox", { name: "LaTeX formula" });
    await expect(latex).toBeFocused();
    await latex.fill("\\frac{a}{b} = c^2");
    await latex.press("Escape");
    await expect(page.locator(".fb-editor .fb-formula .katex")).toBeVisible();
    await expect(page.locator(".fb-editor .fb-formula annotation")).toHaveText("\\frac{a}{b} = c^2");

    // Mermaid: a code block with a sample diagram and a live SVG preview.
    await caretToEnd(page);
    await panel.getByRole("button", { name: "Mermaid diagram" }).click();
    const mermaid = page.locator(".fb-editor pre.fb-code-mermaid");
    await expect(mermaid).toContainText("flowchart TD");
    await expect(mermaid.locator("img.fb-mermaid-svg")).toHaveAttribute("src", /^data:image\/svg\+xml/, { timeout: 30_000 });

    // Whiteboard: draw one stroke.
    await caretToEnd(page);
    await panel.getByRole("button", { name: "Whiteboard" }).click();
    const canvas = page.locator(".fb-editor .fb-whiteboard svg.fb-whiteboard-canvas");
    await expect(canvas).toBeVisible();
    await expect(page.getByRole("toolbar", { name: "Whiteboard tools" }).getByRole("button", { name: "Pen", exact: true })).toHaveAttribute("aria-pressed", "true");
    await canvas.scrollIntoViewIfNeeded();
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + 40, box.y + 40);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + 40 + i * 20, box.y + 40 + Math.sin(i / 2) * 30);
    await page.mouse.up();
    await expect(canvas.locator("path")).toHaveCount(1);

    // Unsplash tile: opens the picker (search results, or an honest "not set up" message).
    await panel.getByRole("button", { name: "Image from Unsplash" }).click();
    const unsplash = page.getByRole("dialog", { name: "Image from Unsplash" });
    await expect(unsplash.getByText(/Unsplash isn’t set up for this Folevi server yet|Photos from/)).toBeVisible({ timeout: 20_000 });
    await unsplash.getByRole("button", { name: "Close" }).click();

    await waitForSaved(page);
    await page.waitForTimeout(600);
    await waitForSaved(page);
    await page.reload();
    for (const style of ["extralight", "light", "regular", "strong"]) await expect(page.locator(`.fb-editor .fb-divider[data-style="${style}"]`)).toHaveCount(1);
    await expect(page.locator(".fb-editor .fb-page-break")).toHaveCount(1);
    await expect(page.locator(".fb-editor table.fb-table")).toHaveCount(2);
    await expect(page.locator(".fb-editor .fb-formula .katex")).toBeVisible();
    await expect(page.locator(".fb-editor pre.fb-code-mermaid img.fb-mermaid-svg")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".fb-editor .fb-whiteboard svg.fb-whiteboard-canvas path")).toHaveCount(1);

    // The public share page shows the same blocks read-only.
    await openShare(page);
    const share = page.getByRole("dialog", { name: /Share/ });
    await share.getByRole("button", { name: "Create link" }).click();
    const link = await share.getByLabel("Public link").inputValue();
    const anon = await browser.newContext();
    const anonPage = await anon.newPage();
    await anonPage.goto(link);
    await expect(anonPage.getByRole("heading", { name: "Insert blocks" })).toBeVisible();
    await expect(anonPage.locator('.fb-divider[data-style="strong"]')).toHaveCount(1);
    await expect(anonPage.locator(".fb-page-break")).toHaveCount(1);
    await expect(anonPage.locator(".fb-readonly-formula .katex")).toBeVisible();
    await expect(anonPage.locator(".fb-readonly-mermaid img.fb-mermaid-svg")).toBeVisible({ timeout: 30_000 });
    await expect(anonPage.locator(".fb-readonly-whiteboard path")).toHaveCount(1);
    await anon.close();
    await context.close();
  });

  test("mind maps, charts, sticky notes and wireframes insert from the panel and the slash menu, open full canvas and persist", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Visual Blocks Tester");
    await newPage(page, "Visual blocks");
    const panel = await openInsert(page);
    const blocks = [
      ["Mind map", "mindmap"],
      ["Chart", "chart"],
      ["Sticky notes", "stickies"],
      ["Wireframe", "wireframe"],
    ] as const;
    for (const [label, type] of blocks) {
      await caretToEnd(page);
      await panel.getByRole("group", { name: "Visuals", exact: true }).getByRole("button", { name: label, exact: true }).click();
      const card = page.locator(`.fb-editor .fb-${type} .fb-vcard`);
      await expect(card).toBeVisible({ timeout: 20_000 });
      const tools = card.getByRole("toolbar", { name: `${label} tools` });
      await expect(tools).toContainText(label);
      // The wireframe draws its own empty state, with buttons to add a first screen.
      await expect(card.locator(type === "wireframe" ? ".wf-empty" : ".fb-vc-empty")).toBeVisible();
      // Full canvas: the toolbar's button, then Esc back; ⇧⌘F from the keyboard.
      await tools.getByRole("button", { name: "Full canvas" }).click();
      await expect(card).toHaveAttribute("data-full", "true");
      expect(await card.evaluate((el) => el.matches(":popover-open"))).toBe(true);
      await card.locator(".fb-canvas-body").press("Escape");
      await expect(card).not.toHaveAttribute("data-full", "true");
      await card.locator(".fb-canvas-body").focus();
      await page.keyboard.press("ControlOrMeta+Shift+F");
      await expect(card).toHaveAttribute("data-full", "true");
      await page.keyboard.press("Escape");
      await expect(card).not.toHaveAttribute("data-full", "true");
      // Export waits for something to draw.
      await tools.getByRole("button", { name: "Export" }).click();
      await expect(page.getByRole("menuitem", { name: "Export as PNG" })).toBeDisabled();
      await page.keyboard.press("Escape");
    }
    // The slash menu has the same groups, and finds a new block by name.
    await caretToEnd(page);
    await page.keyboard.press("Enter");
    await page.keyboard.type("/");
    const slash = page.getByRole("listbox");
    await expect(slash).toBeVisible();
    const groups = await slash.locator('li[role="presentation"]').allTextContents();
    expect(groups.slice(0, 6)).toEqual(["Suggested", "Text", "Lists and tasks", "Visuals", "Media", "Data and more"]);
    await page.keyboard.type("wirefr");
    await expect(slash.getByRole("option").first()).toHaveText(/Wireframe/);
    await page.keyboard.press("Enter");
    await expect(page.locator(".fb-editor .fb-wireframe .fb-vcard")).toHaveCount(2, { timeout: 20_000 });

    await waitForSaved(page);
    await page.waitForTimeout(600);
    await waitForSaved(page);
    await page.reload();
    for (const [, type] of blocks) await expect(page.locator(`.fb-editor .fb-${type} .fb-vcard`).first()).toBeVisible({ timeout: 20_000 });
    await context.close();
  });

  test("tiles drag into the page; gallery, kanban and card pages insert", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Insert Rows Tester");
    await newPage(page, "Insert rows");
    const panel = await openInsert(page);

    // Drag the Whiteboard tile above the first block.
    const tile = panel.getByRole("button", { name: "Whiteboard" });
    await tile.scrollIntoViewIfNeeded();
    const r = (await tile.boundingBox())!;
    const first = (await page.locator(".fb-editor > .fb").first().boundingBox())!;
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
    await page.mouse.down();
    await page.mouse.move(first.x + 20, first.y + 3, { steps: 16 });
    await expect(page.locator(".fb-drag-chip")).toHaveText(/Whiteboard/);
    await page.mouse.up();
    await expect(page.locator(".fb-editor > :first-child .fb-whiteboard")).toHaveCount(1);

    // The panel (tiles, table picker) and the whiteboard toolbar pass axe in light and dark.
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.evaluate((t) => (document.documentElement.dataset.theme = t), scheme);
      await settle(page); // let colour transitions finish
      const results = await new AxeBuilder({ page })
        .include("#document-inspector")
        .include(".fb-whiteboard")
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
    }
    await page.emulateMedia({ colorScheme: "light" });
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));

    // Gallery and Kanban create collections whose first view is a gallery / board.
    await caretToEnd(page);
    await panel.getByRole("button", { name: "Gallery" }).click();
    const gallery = page.getByRole("region", { name: "Collection Gallery" });
    await expect(gallery).toBeVisible({ timeout: 20_000 });
    await expect(gallery.getByRole("button", { name: /Gallery/ })).toHaveAttribute("aria-pressed", "true");
    await caretToEnd(page);
    await panel.getByRole("button", { name: "Kanban" }).click();
    const board = page.getByRole("region", { name: "Collection Kanban" });
    await expect(board).toBeVisible({ timeout: 20_000 });
    await expect(board.getByRole("button", { name: /Board/ })).toHaveAttribute("aria-pressed", "true");
    await waitForSaved(page);

    // Card: a nested page shown as a card (the new page opens to be titled).
    const url = page.url().replace(/\?.*$/, "");
    await caretToEnd(page);
    await panel.getByRole("group", { name: "Data and more", exact: true }).getByRole("button", { name: "Card", exact: true }).click();
    await page.waitForURL((u) => u.toString().replace(/\?.*$/, "") !== url);
    await page.getByRole("textbox", { name: "Title" }).fill("Card child");
    await waitForSaved(page);
    await page.goto(url);
    const card = page.locator(".fb-editor a.ui-card", { hasText: "Card child" });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await context.close();
  });
});
