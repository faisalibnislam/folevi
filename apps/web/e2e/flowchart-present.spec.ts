// Flowchart v2: Present (step through a branching flow in full canvas), Follow a path (paths from a shape,
// and between two shapes), and the read-only views and exports drawing everything v2 holds: frames,
// swimlanes, formatted text, icons, images (a file of the note), dashed connectors with labels, in light
// and dark (interactions/walkthrough.tsx, FlowchartStatic.tsx, canvas/imageFiles.ts).
import { readFileSync, mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { newPerson, openShare, waitForSaved } from "./helpers";

// Screenshots for review when FC_SHOTS names a folder.
const SHOTS = process.env.FC_SHOTS;
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  // Let the view finish gliding.
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

const node = (id: string, shape: string, x: number, y: number, text: string, extra: Record<string, unknown> = {}) => ({ id, shape, x, y, w: 160, h: 64, text, color: "neutral", ...extra });
const edge = (id: string, from: string, to: string, label = "", extra: Record<string, unknown> = {}) => ({ id, from, to, route: "elbow", bends: [], start: "none", end: "arrow", style: "solid", width: 1.5, labels: label ? [{ text: label, at: 0.5 }] : [], ...extra });

/** Start → In stock? → Yes: Ship → Done; No: Order more → back to In stock?. */
const BRANCHING = {
  v: 2,
  nodes: [node("start", "terminator", 200, 0, "Start"), node("check", "decision", 200, 130, "In stock?", { h: 96 }), node("ship", "process", 200, 300, "Ship"), node("more", "process", 460, 146, "Order more"), node("done", "terminator", 200, 430, "Done")],
  edges: [edge("e1", "start", "check"), edge("e2", "check", "ship", "Yes"), edge("e3", "check", "more", "No"), edge("e4", "more", "check"), edge("e5", "ship", "done")],
  frames: [],
  pools: [],
};

async function newNote(page: Page, title: string) {
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Intro");
  await waitForSaved(page);
}

/** Inserts a flowchart block with this data at the end of the note. */
async function insertFlowchart(page: Page, data: unknown) {
  await page.evaluate((json) => {
    const ed = (document.querySelector(".fb-editor") as unknown as { editor: { state: { doc: { content: { size: number } } }; commands: { insertContentAt: (at: number, c: unknown) => void } } }).editor;
    ed.commands.insertContentAt(ed.state.doc.content.size, { type: "flowchart", attrs: { data: json, height: 520 } });
  }, JSON.stringify(data));
}

/** The flowchart's stored data, from the editor. */
const storedData = (page: Page) =>
  page.evaluate(() => {
    const ed = (document.querySelector(".fb-editor") as unknown as { editor: { state: { doc: { descendants: (f: (n: { type: { name: string }; attrs: Record<string, unknown> }) => void) => void } } } }).editor;
    let data = "";
    ed.state.doc.descendants((n) => {
      if (n.type.name === "flowchart") data = String(n.attrs.data);
    });
    return data;
  });

/** The file of the note's image block ("" until its upload has one). */
const imageFileId = (page: Page) =>
  page.evaluate(() => {
    const ed = (document.querySelector(".fb-editor") as unknown as { editor: { state: { doc: { descendants: (f: (n: { type: { name: string }; attrs: Record<string, unknown> }) => void) => void } } } }).editor;
    let id = "";
    ed.state.doc.descendants((n) => {
      if (n.type.name === "image" && n.attrs.fileId) id = String(n.attrs.fileId);
    });
    return id;
  });

const opacity = (page: Page, selector: string) => page.locator(selector).first().evaluate((el) => Number(getComputedStyle(el).opacity));

test.describe("Flowchart: present and follow a path", () => {
  test.setTimeout(180_000);

  test("present a branching flow step by step, then follow paths from a shape and between two", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Presenter");
    await newNote(page, "Stock flow");
    await insertFlowchart(page, BRANCHING);
    const canvas = page.getByRole("application", { name: /Flowchart, 5 shapes/ });
    await expect(canvas).toBeVisible();
    await waitForSaved(page);
    const before = await storedData(page);
    const tools = page.getByRole("toolbar", { name: "Flowchart tools" });

    // Present: full canvas, from the start terminator.
    await tools.getByRole("button", { name: "Present" }).click();
    const card = page.locator(".fb-flowchart .fc-card");
    await expect(card).toHaveAttribute("data-full", "true");
    const bar = page.getByRole("toolbar", { name: "Presenting the flowchart" });
    await expect(bar).toContainText("Step 1");
    await expect(bar).toContainText("Start");
    await expect(tools).toBeHidden();
    // The current shape is lit, the next one half lit, the rest dimmed.
    await expect.poll(() => opacity(page, '[data-fc-node="start"]')).toBe(1);
    await expect.poll(() => opacity(page, '[data-fc-node="done"]')).toBeLessThan(0.3);
    await expect(canvas.locator(".fc-walk-ring")).toHaveCount(1);

    // → goes on; at the decision, the incoming connector is lit and the two ways are numbered.
    await page.keyboard.press("ArrowRight");
    await expect(bar).toContainText("Step 2");
    await expect(bar).toContainText("In stock?");
    await expect.poll(() => opacity(page, '.fc-edge[data-fc-edge="e1"]')).toBe(1);
    await expect.poll(() => page.locator('.fc-edge[data-fc-edge="e1"]').evaluate((el) => getComputedStyle(el).getPropertyValue("--fc-ec").trim())).not.toBe("");
    const ways = bar.getByRole("group", { name: "Choose where to go" });
    await expect(ways.getByRole("button")).toHaveCount(2);
    await expect(ways.getByRole("button", { name: "1: Yes, to Ship" })).toBeVisible();
    await expect(ways.getByRole("button", { name: "2: No, to Order more" })).toBeVisible();
    await expect(canvas.locator("[data-fc-walk-step]")).toHaveCount(2);
    // → alone doesn't choose for you.
    await page.keyboard.press("ArrowRight");
    await expect(bar).toContainText("Step 2");
    await shot(page, "present-decision");

    // 2 takes the No branch; → comes back round to the decision; a click on the numbered 1 takes Yes.
    await page.keyboard.press("2");
    await expect(bar).toContainText("Order more");
    await page.keyboard.press("ArrowRight");
    await expect(bar).toContainText("Step 4");
    await expect(bar).toContainText("In stock?");
    await canvas.locator('[data-fc-walk-step="e2"] .fc-walk-chip-dot').click();
    await expect(bar).toContainText("Ship");
    // A click on the next shape goes there too; the end says so.
    await canvas.locator('[data-fc-node="done"]').click();
    await expect(bar).toContainText("End of the flow");
    await shot(page, "present-end");
    // ← goes back; Home starts again; Esc ends and leaves full canvas.
    await page.keyboard.press("ArrowLeft");
    await expect(bar).toContainText("Ship");
    await page.keyboard.press("Home");
    await expect(bar).toContainText("Step 1");
    await page.keyboard.press("Escape");
    await expect(bar).toBeHidden();
    await expect(card).not.toHaveAttribute("data-full", "true");
    await expect(tools).toBeVisible();
    await expect.poll(() => opacity(page, '[data-fc-node="done"]')).toBe(1);

    // Present from a shape (its right-click menu).
    await canvas.locator('[data-fc-node="ship"]').click({ button: "right" });
    await page.getByRole("menuitem", { name: "Present from here" }).click();
    await expect(bar).toContainText("Ship");
    await page.keyboard.press("Escape");

    // Highlight paths from here: every path from Start, all lit together, then one at a time with its steps.
    await canvas.locator('[data-fc-node="start"]').click({ button: "right" });
    await page.getByRole("menuitem", { name: "Highlight paths from here" }).click();
    const paths = page.getByRole("toolbar", { name: "Paths" });
    await expect(paths).toContainText("2 paths");
    await expect.poll(() => opacity(page, '[data-fc-node="more"]')).toBe(1);
    await page.keyboard.press("ArrowRight");
    await expect(paths).toContainText("Path 1 of 2");
    const steps = paths.getByRole("list", { name: "Steps" });
    await expect(steps.getByRole("button")).toHaveText(["Start", "In stock?", "YesShip", "Done"]);
    // The other branch is dimmed on this path.
    await expect.poll(() => opacity(page, '[data-fc-node="more"]')).toBeLessThan(0.3);
    await shot(page, "paths-from-start");
    await page.keyboard.press("Escape");
    await expect(paths).toBeHidden();

    // Follow a path between two shapes: pick the start, then the end; then present that path.
    await tools.getByRole("button", { name: "Follow a path" }).click();
    const pick = page.getByRole("toolbar", { name: "Follow a path" });
    await expect(pick).toContainText("Click the shape a path starts from.");
    await canvas.locator('[data-fc-node="more"]').click();
    await expect(pick).toContainText("From “Order more”");
    await canvas.locator('[data-fc-node="done"]').click();
    await expect(paths).toContainText("Path 1 of 1");
    await expect(steps.getByRole("button")).toHaveText(["Order more", "In stock?", "YesShip", "Done"]);
    await paths.getByRole("button", { name: /Present/ }).click();
    const walking = page.getByRole("toolbar", { name: "Presenting a path" });
    await expect(walking).toContainText("Order more");
    for (const name of ["In stock?", "Ship", "Done"]) {
      await page.keyboard.press("ArrowRight");
      await expect(walking).toContainText(name);
    }
    await expect(walking).toContainText("End of the flow");
    await page.keyboard.press("Escape");
    await expect(walking).toBeHidden();

    // Walking never changed the chart.
    await waitForSaved(page);
    expect(await storedData(page)).toBe(before);
    await context.close();
  });

  test("the share page and the exports draw v2 content: frames, lanes, formatted text, icons, images, styled connectors", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Exporter");
    await newNote(page, "Rich chart");
    // An image of this note (pasted), whose file a shape then shows.
    await page.evaluate(async () => {
      const ed = (document.querySelector(".fb-editor") as unknown as { editor: { commands: { focus: (at: string) => void }; view: { dom: HTMLElement } } }).editor;
      ed.commands.focus("end");
      const c = document.createElement("canvas");
      c.width = 80;
      c.height = 60;
      const x = c.getContext("2d")!;
      x.fillStyle = "#2a6";
      x.fillRect(0, 0, 80, 60);
      const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/png"));
      const data = new DataTransfer();
      data.items.add(new File([blob], "Green.png", { type: "image/png" }));
      ed.view.dom.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await expect.poll(() => imageFileId(page), { timeout: 30_000 }).not.toBe("");
    // Uploaded (it shows) and saved, so the block holds its server file, ready to be read.
    await expect.poll(() => page.locator(".fb-editor img").first().evaluate((img) => (img as HTMLImageElement).naturalWidth), { timeout: 30_000 }).toBeGreaterThan(0);
    await waitForSaved(page);
    const fileId = await imageFileId(page);
    expect(fileId).toBeTruthy();

    const rich = {
      v: 2,
      nodes: [
        node("a", "terminator", 40, 70, "Ship today", { rich: [{ text: [{ type: "text", text: "Ship " }, { type: "text", text: "today", marks: [{ type: "bold" }] }] }], parent: "f1" }),
        node("b", "process", 40, 210, "Photo", { w: 180, h: 150, image: { fileId }, parent: "f1" }),
        node("c", "process", 330, 70, "Ask the team", { icon: { name: "users", place: "left" }, color: "blue" }),
      ],
      edges: [edge("x1", "a", "b", "Yes", { style: "dashed", start: "circle" }), edge("x2", "a", "c", "Later", { style: "dotted", color: "green" })],
      frames: [{ id: "f1", x: 0, y: 0, w: 260, h: 400, title: "Warehouse", color: "yellow" }],
      pools: [{ id: "p1", x: 0, y: 460, orient: "rows", title: "Teams", length: 600, lanes: [{ id: "l1", title: "Sales", size: 140, color: "neutral" }, { id: "l2", title: "Support", size: 140, color: "pink" }] }],
    };
    await insertFlowchart(page, rich);
    await expect(page.getByRole("application", { name: /Flowchart, 3 shapes/ })).toBeVisible();
    await waitForSaved(page);
    await page.waitForTimeout(800);
    await waitForSaved(page);

    // Export as SVG: the image is inside the file (a data URL), with the frame, lane and label text.
    const tools = page.getByRole("toolbar", { name: "Flowchart tools" });
    await tools.getByRole("button", { name: "Export" }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Export as SVG" }).click();
    const svg = readFileSync((await (await download).path())!, "utf8");
    expect(svg).toMatch(/<image href="data:image\/png;base64,/);
    for (const text of ["Warehouse", "Teams", "Sales", "Support", "Yes", "Later", "Ask the team"]) expect(svg).toContain(text);
    expect(svg).toMatch(/font-weight="600">\s?today/);
    expect(svg).toContain("stroke-dasharray");
    // PNG too.
    await tools.getByRole("button", { name: "Export" }).click();
    const png = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Export as PNG" }).click();
    expect(readFileSync((await (await png).path())!).subarray(1, 4).toString()).toBe("PNG");

    // The note's HTML export packs the shape's image and draws a light and a dark picture.
    await page.getByRole("button", { name: "Document actions" }).click();
    const htmlDownload = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Export…" }).click();
    const exporting = page.getByRole("dialog", { name: /^Export “/ });
    await exporting.getByRole("radio", { name: /Web page/ }).click();
    await exporting.getByRole("button", { name: "Export Web page" }).click();
    const zipPath = (await (await htmlDownload).path())!;
    const { unzipSync, strFromU8 } = await import("fflate");
    const files = unzipSync(new Uint8Array(readFileSync(zipPath)));
    const htmlName = Object.keys(files).find((n) => n.endsWith(".html"))!;
    const html = strFromU8(files[htmlName]!);
    expect(Object.keys(files).some((n) => n.startsWith(`assets/${fileId}`))).toBe(true);
    expect(html).toContain('<svg class="fc-light"');
    expect(html).toContain('<svg class="fc-dark"');
    expect(html).toMatch(new RegExp(`<image href="assets/${fileId}`));

    // The public page: the same picture, with the image loading from a signed address, light and dark.
    await openShare(page);
    const share = page.getByRole("dialog", { name: /Share/ });
    await share.getByRole("button", { name: "Create link" }).click();
    const link = await share.getByLabel("Public link").inputValue();
    const anon = await browser.newContext();
    const reader = await anon.newPage();
    await reader.goto(link);
    const picture = reader.getByRole("img", { name: /Flowchart with 3 shapes: Ship today, Photo, Ask the team/ });
    await expect(picture).toBeVisible();
    const light = picture.locator(".fc-static-light");
    await expect(light.locator("text").filter({ hasText: "Warehouse" })).toHaveCount(1);
    await expect(light.locator("text").filter({ hasText: "Support" })).toHaveCount(1);
    await expect(light.locator('tspan[font-weight="600"]').filter({ hasText: "today" })).toHaveCount(1);
    const href = await light.locator("image").getAttribute("href");
    expect(href).toMatch(new RegExp(`/files/${fileId}\\?exp=\\d+&sig=`));
    const res = await reader.request.get(href!);
    expect(res.ok()).toBe(true);
    expect(res.headers()["content-type"]).toContain("image/png");
    await expect(picture.locator(".fc-static-dark")).toBeHidden();
    await picture.scrollIntoViewIfNeeded();
    await shot(reader, "share-light");
    // Dark (the page's theme is set when it loads, from the system's).
    await reader.emulateMedia({ colorScheme: "dark" });
    await reader.evaluate(() => (document.documentElement.dataset.theme = "dark"));
    await expect(picture.locator(".fc-static-dark")).toBeVisible();
    await expect(light).toBeHidden();
    await shot(reader, "share-dark");
    // Zoom and pan as with the other pictures.
    await picture.hover();
    await reader.getByRole("toolbar", { name: "Zoom" }).getByRole("button", { name: "Zoom in" }).click();
    await expect(picture).toHaveAttribute("data-zoomed", "true");
    await reader.getByRole("toolbar", { name: "Zoom" }).getByRole("button", { name: "Fit the whole flowchart" }).click();
    await expect(picture).not.toHaveAttribute("data-zoomed", "true");
    // Presenting the shared note: the slide shows the same v2 picture.
    await reader.getByRole("button", { name: /Present/ }).first().click();
    const slides = reader.getByRole("dialog", { name: /Presenting/ });
    await expect(slides).toBeVisible();
    for (let i = 0; i < 6 && !(await slides.locator(".fc-static-svg").count()); i++) await reader.keyboard.press("ArrowRight");
    await expect(slides.locator(".fc-static-dark text").filter({ hasText: "Warehouse" })).toHaveCount(1);
    await expect(slides.locator(".fc-static-dark image")).toHaveAttribute("href", /\/files\//);
    await shot(reader, "present-slide-dark");
    await anon.close();
    await context.close();
  });
});
