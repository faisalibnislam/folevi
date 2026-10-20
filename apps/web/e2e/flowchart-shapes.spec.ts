// Flowchart shapes and content: the shape library (search, add, drag out, change kind), icons, rich text
// in shapes (formatting kept, exported), auto-height and fit to text, images (pick, paste, drop; kept
// across a reload), notes and page links (badges open them), and fill, outline and text colours (custom
// fills stay readable in light and dark).
import { readFileSync, mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { newPerson, waitForSaved } from "./helpers";

const SHOTS = process.env.FLOWCHART_SHOTS;
async function shot(page: Page, name: string, target?: Locator) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await (target ?? page).screenshot({ path: `${SHOTS}/${name}.png` });
}

/** A 1 × 1 PNG. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function newPage(page: Page, title: string) {
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Intro");
  await waitForSaved(page);
}

async function newFlowchart(page: Page, title: string) {
  await newPage(page, title);
  await page.keyboard.press("Enter");
  await page.keyboard.type("/flowchart");
  await page.getByRole("option", { name: /Flowchart/ }).first().click();
  const canvas = page.getByRole("application", { name: /Flowchart/ });
  await expect(canvas).toBeVisible();
  return canvas;
}

/** Adds a process box with `text` from the toolbar. */
async function addProcess(page: Page, canvas: Locator, text: string) {
  await page.getByRole("toolbar", { name: "Flowchart tools" }).getByRole("button", { name: "Add process" }).click();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  const node = canvas.getByRole("button", { name: new RegExp(`^Process: ${text}`) });
  await expect(node).toBeVisible();
  return node;
}

/** The caret to the end of the text being written (⌘↓ on a Mac, Ctrl+End elsewhere). */
const toEnd = (page: Page) => page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");

const bar = (page: Page) => page.getByRole("toolbar", { name: "Selected shapes" });

/** No serious accessibility problems in the flowchart (its panels and bars included). */
async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).include(".fb-flowchart").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
}

/** Saved, then the page reloaded. */
async function reload(page: Page) {
  await waitForSaved(page);
  await page.waitForTimeout(800);
  await waitForSaved(page);
  await page.reload();
  const canvas = page.getByRole("application", { name: /Flowchart/ });
  await expect(canvas).toBeVisible();
  return canvas;
}

/** Fires a paste carrying `files` (and optional text) on `target`, as the browser does. */
async function pasteFiles(target: Locator, files: { name: string; type: string; base64: string }[], text?: string) {
  await target.evaluate(
    (el, { files, text }) => {
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(new File([Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0))], f.name, { type: f.type }));
      if (text) dt.setData("text/plain", text);
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    },
    { files, text },
  );
}

test.describe("Flowchart shapes and content", () => {
  test.setTimeout(180_000);

  test("the shape library: search and add, drag a shape out, change a shape's kind, icons, colours", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Shape Library Tester");
    const canvas = await newFlowchart(page, "Shape library");
    const tools = page.getByRole("toolbar", { name: "Flowchart tools" });

    // The library opens from the toolbar: every shape, in three sections.
    await tools.getByRole("button", { name: "All shapes" }).click();
    const lib = canvas.getByRole("dialog", { name: "Shapes" });
    await expect(lib).toBeVisible();
    await expect(lib.getByRole("heading", { name: "Flowchart" })).toBeVisible();
    await expect(lib.getByRole("heading", { name: "Basic" })).toBeVisible();
    await expect(lib.getByRole("heading", { name: "Arrows and callouts" })).toBeVisible();
    await expect(lib.locator("[data-tile]")).toHaveCount(53);
    await shot(page, "library-open", canvas);
    await expectAccessible(page);

    // Search narrows it; a click adds the shape in the middle of the view.
    await lib.getByRole("searchbox", { name: "Search shapes" }).fill("database");
    await expect(lib.getByRole("button", { name: "Add database" })).toBeVisible();
    await expect(lib.getByRole("button", { name: "Add process" })).toHaveCount(0);
    await lib.getByRole("button", { name: "Add database" }).click();
    await expect(canvas.locator('[data-fc-node][data-shape="database"]')).toHaveCount(1);
    await lib.getByRole("searchbox", { name: "Search shapes" }).fill("zzz");
    await expect(lib.getByText(/No shape matches/)).toBeVisible();
    await lib.getByRole("searchbox", { name: "Search shapes" }).fill("");

    // Dragging a tile out onto the canvas drops the shape there.
    const tile = lib.getByRole("button", { name: "Add multiple documents" });
    const t = (await tile.boundingBox())!;
    const c = (await canvas.boundingBox())!;
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
    await page.mouse.down();
    await page.mouse.move(c.x + c.width - 160, c.y + c.height - 120, { steps: 12 });
    await page.mouse.up();
    const docs = canvas.locator('[data-fc-node][data-shape="documents"]');
    await expect(docs).toHaveCount(1);
    const d = (await docs.boundingBox())!;
    expect(Math.abs(d.x + d.width / 2 - (c.x + c.width - 160))).toBeLessThan(30);
    await page.keyboard.press("Escape");
    await expect(lib).toHaveCount(0);

    // A selected shape's bar opens the library to change its kind.
    const db = canvas.locator('[data-fc-node][data-shape="database"]');
    await page.mouse.click(c.x + 30, c.y + c.height / 2);
    await db.click();
    await bar(page).getByRole("button", { name: "Change shape" }).click();
    const change = canvas.getByRole("dialog", { name: "Change shape" });
    await expect(change.getByRole("button", { name: "Database", exact: true })).toHaveAttribute("aria-pressed", "true");
    await change.getByRole("searchbox", { name: "Search shapes" }).fill("hexa");
    await change.getByRole("button", { name: "Hexagon" }).click();
    await expect(canvas.locator('[data-fc-node][data-shape="hexagon"]')).toHaveCount(1);
    await expect(canvas.locator('[data-fc-node][data-shape="database"]')).toHaveCount(0);
    await change.getByRole("button", { name: "Close change shape" }).click();

    // ⌘Z undoes the change of kind as one step.
    await canvas.focus();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(canvas.locator('[data-fc-node][data-shape="database"]')).toHaveCount(1);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    const hex = canvas.locator('[data-fc-node][data-shape="hexagon"]');
    await expect(hex).toHaveCount(1);

    // Icons: search the set and put one in the shape, above its text.
    await hex.click();
    await bar(page).getByRole("button", { name: "Icon" }).click();
    const icons = canvas.getByRole("dialog", { name: "Icon" });
    await icons.getByRole("searchbox", { name: "Search icons" }).fill("person");
    await icons.getByRole("button", { name: "Person" }).click();
    await expect(hex.locator(".fc-icon")).toHaveCount(1);
    await icons.getByRole("radio", { name: "Above text" }).click();
    await expect(icons.getByRole("radio", { name: "Above text" })).toHaveAttribute("aria-checked", "true");
    await shot(page, "icon-picker", canvas);
    await icons.getByRole("button", { name: "Close icon" }).click();

    // Colours: a custom dark fill gets a light label and icon, in light and in dark mode.
    await hex.click();
    await bar(page).getByRole("button", { name: "Colours" }).click();
    const colours = canvas.getByRole("dialog", { name: "Colours" });
    await colours.getByRole("textbox", { name: "Custom fill colour" }).fill("#1e3a8a");
    await colours.getByRole("button", { name: "Apply" }).click();
    const outline = hex.locator("path.fc-shape").last();
    await expect(outline).toHaveCSS("fill", "rgb(30, 58, 138)");
    await expect(hex.locator(".fc-icon")).toHaveCSS("stroke", "rgb(244, 244, 246)");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
    await expect(outline).toHaveCSS("fill", "rgb(30, 58, 138)");
    await expect(hex.locator(".fc-icon")).toHaveCSS("stroke", "rgb(244, 244, 246)");
    await shot(page, "colours-dark", canvas);
    await expectAccessible(page);
    await page.emulateMedia({ colorScheme: "light" });
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    // A theme tint clears the custom fill; the outline can go; the text takes a text colour.
    await colours.getByRole("button", { name: "Green fill" }).click();
    await expect(hex).toHaveAttribute("data-color", "green");
    await expect(outline).not.toHaveCSS("fill", "rgb(30, 58, 138)");
    await colours.getByRole("radio", { name: "Outline" }).click();
    await colours.getByRole("radio", { name: "Dashed outline" }).click();
    await expect(outline).toHaveCSS("stroke-dasharray", /\d/);
    await colours.getByRole("radio", { name: "Fill" }).click();
    await colours.getByRole("button", { name: "Close colours" }).click();

    // Everything is kept.
    const after = await reload(page);
    const hex2 = after.locator('[data-fc-node][data-shape="hexagon"]');
    await expect(hex2).toHaveAttribute("data-color", "green");
    await expect(hex2.locator(".fc-icon")).toHaveCount(1);
    await expect(after.locator('[data-fc-node][data-shape="documents"]')).toHaveCount(1);
    await context.close();
  });

  test("rich text in shapes: formatting, lists, links, alignment and plain pasting; kept, undone as one step, exported", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Rich Label Tester");
    const canvas = await newFlowchart(page, "Rich labels");
    const tools = page.getByRole("toolbar", { name: "Flowchart tools" });

    // Writing starts at once in a new shape; ⌘B, "- " lists and ⇧Enter new lines.
    await tools.getByRole("button", { name: "Add process" }).click();
    const label = canvas.getByRole("textbox", { name: "Text for this shape" });
    await expect(label).toBeFocused();
    await page.keyboard.type("Plan ");
    await page.keyboard.press("ControlOrMeta+b");
    await page.keyboard.type("bold");
    await page.keyboard.press("ControlOrMeta+b");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("- first");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("second");
    const fmt = canvas.getByRole("toolbar", { name: "Text formatting" });
    await expect(fmt.getByRole("button", { name: "Bulleted list" })).toHaveAttribute("aria-pressed", "true");
    await expect(label.locator("strong")).toHaveText("bold");
    await shot(page, "rich-text-editing", canvas);
    await page.keyboard.press("Enter");
    const shape = canvas.locator("[data-fc-node]").first();
    await expect(shape.locator("tspan tspan", { hasText: /^\s*bold$/ })).toHaveCSS("font-weight", "650");
    await expect(shape.locator(".fc-marker")).toHaveCount(2);

    // The bar's buttons: italic over everything, then left alignment.
    await shape.dblclick();
    await expect(label).toBeFocused();
    await fmt.getByRole("button", { name: "Italic" }).click();
    await fmt.getByRole("button", { name: "Align left" }).click();
    await page.keyboard.press("Enter");
    await expect(shape.locator("tspan tspan", { hasText: /^Plan$/ })).toHaveCSS("font-style", "italic");
    await expect(shape.locator("text.fc-label")).toHaveAttribute("text-anchor", "start");

    // A link on the selected word (⌘K), and pasted formatting arriving as plain text.
    await shape.dblclick();
    await toEnd(page);
    await page.keyboard.type(" docs");
    for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowLeft");
    await page.keyboard.press("ControlOrMeta+k");
    await fmt.getByRole("textbox", { name: "Link address" }).fill("folevi.com/help");
    await page.keyboard.press("Enter");
    await expect(label.locator("a")).toHaveText("docs");
    await toEnd(page);
    await label.evaluate((el) => {
      const dt = new DataTransfer();
      dt.setData("text/html", "<b>Pasted</b>");
      dt.setData("text/plain", " Pasted");
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await expect(label).toContainText("docs Pasted");
    await expect(label.locator("strong", { hasText: "Pasted" })).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(shape.locator(".fc-link")).toHaveText("docs");
    await expect(shape.locator("tspan tspan", { hasText: /Pasted/ }).last()).not.toHaveCSS("font-weight", "650");

    // The whole edit is one undo step.
    await page.keyboard.press("ControlOrMeta+z");
    await expect(shape.locator(".fc-link")).toHaveCount(0);
    await expect(shape.locator("tspan tspan", { hasText: /^Plan$/ })).toHaveCSS("font-style", "italic");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(shape.locator(".fc-link")).toHaveText("docs");

    // Kept across a reload.
    const after = await reload(page);
    const kept = after.locator("[data-fc-node]").first();
    await expect(kept.locator("tspan tspan", { hasText: /^\s*bold$/ })).toHaveCSS("font-weight", "650");
    await expect(kept.locator(".fc-marker")).toHaveCount(2);
    await expect(kept.locator(".fc-link")).toHaveText("docs");

    // Grow with text: the shape follows its text.
    await kept.click({ button: "right" });
    await page.getByRole("menuitemradio", { name: /Grow with text/ }).click();
    const h1 = (await kept.boundingBox())!.height;
    await kept.dblclick();
    await toEnd(page);
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("one more line");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await kept.boundingBox())!.height).toBeGreaterThan(h1);

    // Exported: the SVG carries the formatting.
    await page.getByRole("toolbar", { name: "Flowchart tools" }).getByRole("button", { name: "Export" }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Export as SVG" }).click();
    const svg = readFileSync((await (await download).path())!, "utf8");
    expect(svg).toMatch(/font-weight="600"[^>]*>\s*bold</);
    expect(svg).toContain("•");
    expect(svg).toMatch(/<a href="https:\/\/folevi\.com\/help">/);
    await context.close();
  });

  test("images, notes and page links: pick, paste and drop images (kept after a reload); badges open notes and pages", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Image Tester");
    // A page to link to (opened, so it's among the recent pages).
    await newPage(page, "Launch checklist");
    const target = new URL(page.url()).pathname;
    // Opened again once it's saved, so it's among the recent pages.
    await page.waitForTimeout(800);
    await waitForSaved(page);
    await page.goto(target);
    await expect(page.getByRole("textbox", { name: "Title" })).toHaveText("Launch checklist");
    const canvas = await newFlowchart(page, "Images and notes");
    const png = { name: "photo.png", type: "image/png", base64: PNG.toString("base64") };

    // An image picked for a shape: uploaded into the note, shown inside the shape.
    const photo = await addProcess(page, canvas, "Photo");
    await photo.click();
    const chooser = page.waitForEvent("filechooser");
    await bar(page).getByRole("button", { name: "Add image" }).click();
    await (await chooser).setFiles({ name: "photo.png", mimeType: "image/png", buffer: PNG });
    await expect(photo.locator("image.fc-image")).toHaveCount(1, { timeout: 20_000 });

    // Pasted on the canvas with nothing selected: a new shape showing it.
    await page.mouse.click((await canvas.boundingBox())!.x + 30, (await canvas.boundingBox())!.y + 200);
    await canvas.focus();
    await pasteFiles(canvas, [png]);
    await expect(canvas.locator("[data-fc-node] image.fc-image")).toHaveCount(2, { timeout: 20_000 });

    // Dropped onto a shape: it goes into that shape.
    const area = (await canvas.boundingBox())!;
    await page.mouse.dblclick(area.x + area.width - 140, area.y + area.height - 90);
    await page.keyboard.type("Drop here");
    await page.keyboard.press("Enter");
    const drop = canvas.getByRole("button", { name: /^Process: Drop here/ });
    const box = (await drop.boundingBox())!;
    await canvas.locator("svg.fc-svg").evaluate(
      (el, { x, y, base64 }) => {
        const dt = new DataTransfer();
        dt.items.add(new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], "drop.png", { type: "image/png" }));
        el.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }));
        el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }));
      },
      { x: box.x + box.width / 2, y: box.y + box.height / 2, base64: png.base64 },
    );
    await expect(drop.locator("image.fc-image")).toHaveCount(1, { timeout: 20_000 });
    await shot(page, "images", canvas);

    // A note: written from the bar, shown as a badge that opens it.
    await page.mouse.click(area.x + 30, area.y + area.height / 2);
    await photo.click();
    await bar(page).getByRole("button", { name: "Add note" }).click();
    const notePanel = canvas.getByRole("dialog", { name: "Note" });
    await notePanel.getByRole("textbox", { name: "Note" }).fill("Ask the design team for the final photo.");
    await notePanel.getByRole("button", { name: "Done" }).click();
    const noteBadge = photo.locator('[data-fc-badge="note"]');
    await expect(noteBadge).toHaveCount(1);
    await expect(photo).toHaveAccessibleName(/with a note/);

    // A link to a Folevi page, picked from the recent pages.
    await photo.click();
    await bar(page).getByRole("button", { name: "Link to a page" }).click();
    const links = canvas.getByRole("dialog", { name: "Link to a page" });
    // Recent pages first (search finds the rest once the page is indexed).
    await expect(links.getByRole("heading", { name: "Recent" })).toBeVisible();
    await links.getByRole("button", { name: "Launch checklist" }).click();
    await expect(photo.locator('[data-fc-badge="link"]')).toHaveCount(1);
    await expect(photo).toHaveAccessibleName(/links to Launch checklist/);
    await shot(page, "badges", canvas);

    // Everything is kept; the badges open the note and the page.
    const after = await reload(page);
    const kept = after.getByRole("button", { name: /^Process: Photo/ });
    await expect(kept.locator("image.fc-image")).toHaveAttribute("href", /\/files\//, { timeout: 20_000 });
    await expect(after.locator("[data-fc-node] image.fc-image")).toHaveCount(3);
    await kept.locator('[data-fc-badge="note"]').click();
    await expect(after.getByRole("dialog", { name: "Note" })).toContainText("Ask the design team for the final photo.");
    await shot(page, "note-open", after);
    await after.getByRole("dialog", { name: "Note" }).getByRole("button", { name: "Close note" }).click();

    // Removing the image from the bar; ⌘Z brings it back.
    await kept.click();
    await bar(page).getByRole("button", { name: "Image" }).click();
    await page.getByRole("menuitem", { name: "Remove image" }).click();
    await expect(kept.locator("image.fc-image")).toHaveCount(0);
    await after.focus();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(kept.locator("image.fc-image")).toHaveCount(1);

    await kept.locator('[data-fc-badge="link"]').click();
    await page.waitForURL((u) => u.pathname === target);
    await context.close();
  });

  test("a flowchart copied into another note: the images in its shapes get files of that note", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Shape Image Copier");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const canvas = await newFlowchart(page, "Copy from");
    const photo = await addProcess(page, canvas, "Photo");
    await photo.click();
    const chooser = page.waitForEvent("filechooser");
    await bar(page).getByRole("button", { name: "Add image" }).click();
    await (await chooser).setFiles({ name: "photo.png", mimeType: "image/png", buffer: PNG });
    await expect(photo.locator("image.fc-image")).toHaveCount(1, { timeout: 20_000 });
    await waitForSaved(page);

    /** The file ids the note's flowchart shapes show, from its editor. */
    const shapeFiles = () =>
      page.evaluate(() => {
        const ed = (document.querySelector(".fb-editor") as unknown as { editor: { state: { doc: { forEach: (f: (n: { type: { name: string }; attrs: Record<string, unknown> }) => void) => void } } } }).editor;
        const out: string[] = [];
        ed.state.doc.forEach((n) => {
          if (n.type.name !== "flowchart") return;
          const fc = JSON.parse(String(n.attrs.data || "{}")) as { nodes?: { image?: { fileId: string } }[] };
          for (const x of fc.nodes ?? []) if (x.image) out.push(x.image.fileId);
        });
        return out;
      });
    const [original] = await shapeFiles();
    expect(original).toBeTruthy();

    // Esc steps out of the canvas to the note with the block selected; ⌘C copies the block.
    await page.evaluate(() => {
      const w = window as unknown as { __clip?: Record<string, string> | null };
      w.__clip = null;
      window.addEventListener("copy", (e) => { const d = e.clipboardData; if (d) w.__clip = Object.fromEntries([...d.types].map((t) => [t, d.getData(t)])); }, { once: true });
    });
    await canvas.focus();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.keyboard.press("ControlOrMeta+c");
    await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { __clip?: unknown }).__clip))).toBe(true);
    const clip = (await page.evaluate(() => (window as unknown as { __clip: Record<string, string> }).__clip))!;
    // The picture on the clipboard (for other apps) shows the shape's image, not a placeholder.
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const items = await navigator.clipboard.read().catch(() => []);
            const item = items.find((i) => i.types.includes("image/png"));
            if (!item) return -1;
            const bmp = await createImageBitmap(await item.getType("image/png"));
            const c = document.createElement("canvas");
            c.width = bmp.width;
            c.height = bmp.height;
            const g = c.getContext("2d")!;
            g.drawImage(bmp, 0, 0);
            const px = g.getImageData(0, 0, c.width, c.height).data;
            let red = 0;
            for (let i = 0; i < px.length; i += 4) if (px[i]! > 200 && px[i + 1]! < 170 && px[i + 2]! < 170) red++;
            return red;
          }),
        { timeout: 20_000 },
      )
      .toBeGreaterThan(50);

    // Pasted into another note: the shape shows a file of that note (a different id), and still draws.
    const fromPath = new URL(page.url()).pathname;
    await page.getByRole("button", { name: "New note", exact: true }).click();
    await page.waitForURL((u) => /^\/d\/[0-9A-Z]{26}$/.test(u.pathname) && u.pathname !== fromPath);
    await page.getByRole("textbox", { name: "Title" }).fill("Paste into");
    await page.keyboard.press("Enter");
    await page.evaluate((c) => {
      const ed = (document.querySelector(".fb-editor") as unknown as { editor: { commands: { focus: (at: string) => void }; view: { dom: HTMLElement } } }).editor;
      ed.commands.focus("end");
      const data = new DataTransfer();
      for (const [k, v] of Object.entries(c)) data.setData(k, v);
      ed.view.dom.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }, clip);
    await expect.poll(async () => (await shapeFiles()).length, { timeout: 20_000 }).toBe(1);
    await expect.poll(async () => (await shapeFiles())[0], { timeout: 20_000 }).not.toBe(original);
    const pasted = await reload(page);
    await expect(pasted.locator("image.fc-image")).toHaveAttribute("href", /\/files\//, { timeout: 20_000 });
    await context.close();
  });
});
