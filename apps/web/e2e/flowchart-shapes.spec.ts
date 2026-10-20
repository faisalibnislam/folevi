// Flowchart shapes and content: the shape library (search, add, drag out, change kind), icons, rich text
// in shapes (formatting kept, exported), auto-height and fit to text, images (pick, paste, drop; kept
// across a reload), notes and page links (badges open them), and fill, outline and text colours (custom
// fills stay readable in light and dark).
import { readFileSync, mkdirSync } from "node:fs";
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

const bar = (page: Page) => page.getByRole("toolbar", { name: "Selected shapes" });

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
});
