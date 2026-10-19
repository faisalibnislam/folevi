// Copying and cutting blocks (components/editor/blockClipboard.ts): the block menu's Copy and Cut, several
// selected blocks at once, pasting into another note recreates them exactly with new ids, and pasted images
// get a file of the new note (files.shareForPaste).
import { expect, test, type Page } from "@playwright/test";
import { newPerson, waitForSaved } from "./helpers";

type Clip = Record<string, string>;

/** Records what the next copy or cut puts on the clipboard (read during the event, after the editor wrote it). */
async function recordClipboard(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __clip?: Record<string, string> | null };
    w.__clip = null;
    const take = (e: ClipboardEvent) => {
      const d = e.clipboardData;
      if (d) w.__clip = Object.fromEntries([...d.types].map((t) => [t, d.getData(t)]));
    };
    window.addEventListener("copy", take, { once: true });
    window.addEventListener("cut", take, { once: true });
  });
}
const recorded = async (page: Page): Promise<Clip> => {
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { __clip?: unknown }).__clip))).toBe(true);
  return (await page.evaluate(() => (window as unknown as { __clip: Clip }).__clip))!;
};

/** Pastes what was recorded into the note open in `page`, at the end. */
async function paste(page: Page, clip: Clip) {
  await page.evaluate((c) => {
    const ed = (document.querySelector(".fb-editor") as unknown as { editor: { commands: { focus: (at: string) => void }; view: { dom: HTMLElement } } }).editor;
    ed.commands.focus("end");
    const data = new DataTransfer();
    for (const [k, v] of Object.entries(c)) data.setData(k, v);
    ed.view.dom.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, clip);
}

async function newNote(page: Page, title: string) {
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.keyboard.press("Enter");
  await page.getByRole("textbox", { name: "Document body" }).click();
  return page.url().replace(/\?.*$/, "");
}

/** The note's blocks as type and file id, from its editor. */
const blocksOf = (page: Page) =>
  page.evaluate(() => {
    const ed = (document.querySelector(".fb-editor") as unknown as { editor: { state: { doc: { forEach: (f: (n: { type: { name: string }; attrs: Record<string, unknown> }) => void) => void } } } }).editor;
    const out: { type: string; id: string; fileId: string | null }[] = [];
    ed.state.doc.forEach((n) => out.push({ type: n.type.name, id: String(n.attrs.id), fileId: (n.attrs.fileId as string | null) ?? null }));
    return out;
  });

async function openBlockMenu(page: Page, block: ReturnType<Page["locator"]>) {
  await block.hover({ position: { x: 20, y: 12 } });
  await page.getByRole("button", { name: /^Drag to move/ }).click();
  return page.getByRole("menu", { name: /Block options|Options for/ });
}

test.describe("copying blocks", () => {
  test("Copy and Cut in the block menu, several blocks at once, pasted into another note exactly", async ({ browser }) => {
    test.setTimeout(150_000);
    const { context, page } = await newPerson(browser, "Block Copier");
    const from = await newNote(page, "Source");
    await page.keyboard.type("Intro line");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/table");
    await page.keyboard.press("Enter");
    await page.getByRole("textbox", { name: "Row 1, column 1" }).click();
    await page.keyboard.type("Name");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Score");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Ana");
    await page.keyboard.press("Tab");
    await page.keyboard.type("=2*21");
    await page.keyboard.press("Escape");
    // An image (stored as this note's file), after the table.
    await page.evaluate(async () => {
      const ed = (document.querySelector(".fb-editor") as unknown as { editor: { commands: { focus: (at: string) => void }; view: { dom: HTMLElement } } }).editor;
      ed.commands.focus("end");
      const c = document.createElement("canvas");
      c.width = 60;
      c.height = 40;
      const x = c.getContext("2d")!;
      x.fillStyle = "#2a6";
      x.fillRect(0, 0, 60, 40);
      const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/png"));
      const data = new DataTransfer();
      data.items.add(new File([blob], "Green.png", { type: "image/png" }));
      ed.view.dom.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await expect.poll(async () => (await blocksOf(page)).find((b) => b.type === "image")?.fileId ?? null, { timeout: 30_000 }).not.toBeNull();
    await waitForSaved(page);
    const source = await blocksOf(page);
    const sourceImage = source.find((b) => b.type === "image")!;

    // The table alone, from its block menu: the Folevi type, HTML with a real table, and text.
    await recordClipboard(page);
    const menu = await openBlockMenu(page, page.locator(".fb-editor .fb-table-block").first());
    await menu.getByRole("menuitem", { name: /^Copy(?! link)/ }).click();
    const tableClip = await recorded(page);
    expect(Object.keys(tableClip)).toEqual(expect.arrayContaining(["application/x-folevi-blocks", "text/html", "text/plain"]));
    expect(JSON.parse(tableClip["application/x-folevi-blocks"]!).blocks.map((b: { type: string }) => b.type)).toEqual(["table"]);
    // Other apps read the formula's result.
    expect(tableClip["text/plain"]).toContain("| Ana | 42 |");
    expect(tableClip["text/html"]).toMatch(/<table[\s\S]*42/);

    // Every block, selected with Escape and Shift+↓: copied together, the image's file shown to other apps.
    await page.locator(".fb-editor p").filter({ hasText: "Intro line" }).click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Shift+ArrowDown");
    await expect(page.locator(".fb-editor > .fb-selected")).toHaveCount(3);
    await recordClipboard(page);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+c" : "Control+c");
    const allClip = await recorded(page);
    expect(JSON.parse(allClip["application/x-folevi-blocks"]!).blocks.map((b: { type: string }) => b.type)).toEqual(["paragraph", "table", "image"]);
    expect(allClip["text/html"]).toContain("<img");

    // Into another note: the same blocks, new ids, and the image gets a file of its own there.
    await newNote(page, "Target");
    await paste(page, allClip);
    await expect(page.locator(".fb-editor .fb-table-block")).toHaveCount(1);
    await expect(page.getByRole("textbox", { name: "Row 2, column 2" })).toHaveText("42");
    await expect(page.locator(".fb-editor p").filter({ hasText: "Intro line" })).toHaveCount(1);
    await expect.poll(async () => (await blocksOf(page)).find((b) => b.type === "image")?.fileId ?? null).not.toBe(sourceImage.fileId);
    const pasted = await blocksOf(page);
    expect(pasted.find((b) => b.type === "image")?.fileId).toBeTruthy();
    for (const b of pasted) expect(source.some((s) => s.id === b.id)).toBe(false);
    // It shows (the new note's file opens for its readers).
    await expect.poll(() => page.locator(".fb-editor img").first().evaluate((img) => (img as HTMLImageElement).naturalWidth), { timeout: 20_000 }).toBeGreaterThan(0);
    await waitForSaved(page);

    // Cut from the source: the table goes there.
    await page.goto(from);
    await expect(page.locator(".fb-editor .fb-table-block")).toHaveCount(1);
    await recordClipboard(page);
    const again = await openBlockMenu(page, page.locator(".fb-editor .fb-table-block").first());
    await again.getByRole("menuitem", { name: /^Cut/ }).click();
    await recorded(page);
    await expect(page.locator(".fb-editor .fb-table-block")).toHaveCount(0);
    await context.close();
  });
});
