import { expect, test, type Page } from "@playwright/test";
import { newPerson, openTool, waitForSaved } from "./helpers";

// Search in files (docs/ARCHITECTURE.md, "Search in files"): the words in a PDF are read on the device with
// pdf.js when it's added to a note and found by ⌘K search, which says where ("In PDF, page 2") and opens the
// note at the file. Images and whiteboard handwriting are read by the device's own recogniser (the iPhone, iPad
// and Mac apps); a browser has none, so here a test stand-in answers for it (window.__foleviTestRecognizer,
// development builds only). The Mac app's own recogniser (Vision, foleviDesktop.recognizeText) is checked in
// mac-app.spec.ts and apps/mac's CapabilitiesTests.

/** A small PDF with one line of text on each page (offsets in the cross-reference table worked out). */
function makePdf(pages: string[]): Buffer {
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 3 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  const font = 3 + pages.length * 2;
  pages.forEach((text, i) => {
    const pageId = pageIds[i]!;
    const stream = `BT /F1 18 Tf 72 720 Td (${text.replace(/[()\\]/g, "")}) Tj ET`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  objects[font] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function newNote(page: Page, title: string) {
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.keyboard.press("Enter");
  const body = page.getByRole("textbox", { name: "Document body" });
  await expect(body).toBeFocused();
  return body;
}

/** Pastes a file into the note's body (as dropping or pasting a file does). */
async function pasteFile(page: Page, file: { name: string; type: string; base64: string }) {
  await page.getByRole("textbox", { name: "Document body" }).evaluate((el, f) => {
    const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], f.name, { type: f.type }));
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, file);
}

/** Opens ⌘K and types `query`; returns the palette. */
async function search(page: Page, query: string) {
  await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  const input = page.getByRole("combobox", { name: /Search documents/ });
  await expect(input).toBeFocused();
  await input.fill(query);
  return page.getByRole("dialog", { name: "Search and commands" });
}

/** Searches until a result shows up (the file is read in the background after it's uploaded). */
async function searchUntil(page: Page, query: string, title: string) {
  const palette = await search(page, query);
  const result = palette.getByRole("option").filter({ hasText: title });
  await expect(async () => {
    if (!(await result.count())) {
      await page.getByRole("combobox", { name: /Search documents/ }).fill("");
      await page.getByRole("combobox", { name: /Search documents/ }).fill(query);
    }
    await expect(result).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 45_000 });
  return { palette, result };
}

test.describe("search in files", () => {
  test("a PDF's words are found in ⌘K search, which says the page and opens the note at the file", async ({ browser }) => {
    test.setTimeout(120_000);
    const { page } = await newPerson(browser, "Pdf Searcher");
    await newNote(page, "Boat manual");
    await page.keyboard.type("Everything about the boat.");
    await page.keyboard.press("Enter");
    const pdf = makePdf(["Contents and safety", "The bilge pump quokkaflux sits under the stairs"]);
    await pasteFile(page, { name: "manual.pdf", type: "application/pdf", base64: pdf.toString("base64") });
    await expect(page.locator(".fb-editor").getByText("manual.pdf")).toBeVisible({ timeout: 15_000 });
    await waitForSaved(page);

    const { result } = await searchUntil(page, "quokkaflux", "Boat manual");
    await expect(result).toContainText("In PDF, page 2");
    await expect(result.locator("mark", { hasText: /quokkaflux/i })).toBeVisible();
    await result.click();
    await expect(page).toHaveURL(/\/d\/[0-9A-Z]{26}#block-[0-9A-Za-z]+$/);
    // The note's own words don't include the PDF's: the text is kept beside the file.
    await expect(page.getByRole("textbox", { name: "Document body" })).not.toContainText("quokkaflux");
  });

  test("an image's words, from the device's recogniser, are found and say they're in an image; so is handwriting", async ({ browser }) => {
    test.setTimeout(150_000);
    const { context, page } = await newPerson(browser, "Image Searcher");
    // The stand-in for Vision: answers for images and for drawings.
    await context.addInitScript(() => {
      (window as unknown as { __foleviTestRecognizer: (i: { kind: string }) => string }).__foleviTestRecognizer = (i) => (i.kind === "handwriting" ? "remember the zinnoberkatze" : "PLATFORM 9 glimmerwick");
    });
    await page.reload();
    await newNote(page, "Station photo");
    await pasteFile(page, { name: "sign.png", type: "image/png", base64: PNG });
    await expect(page.locator(".fb-editor .fb-atom").first()).toBeVisible({ timeout: 15_000 });
    await waitForSaved(page);

    const { result, palette } = await searchUntil(page, "glimmerwick", "Station photo");
    await expect(result).toContainText("In image");
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();

    // Handwriting: a whiteboard, drawn on, is read once it's left alone a moment.
    const panel = await openTool(page, "Insert");
    await page.getByRole("textbox", { name: "Document body" }).click();
    await page.keyboard.press("ControlOrMeta+End");
    await panel.getByRole("button", { name: "Whiteboard" }).click();
    const canvas = page.locator(".fb-editor .fb-whiteboard svg.fb-whiteboard-canvas");
    await expect(canvas).toBeVisible();
    await canvas.scrollIntoViewIfNeeded();
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + 40, box.y + 40);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + 40 + i * 20, box.y + 40 + Math.sin(i / 2) * 30);
    await page.mouse.up();
    await expect(canvas.locator("path")).toHaveCount(1);
    await waitForSaved(page);
    const handwriting = await searchUntil(page, "zinnoberkatze", "Station photo");
    await expect(handwriting.result).toContainText("In handwriting");
  });

  test("in the iPhone and iPad app, the image goes to Vision through FoleviNative.recognizeText", async ({ browser }) => {
    test.setTimeout(120_000);
    const { context, page } = await newPerson(browser, "Ipad Searcher");
    // A stand-in for bridge.js and the app: the calls a page makes, and Vision's answer.
    await context.addInitScript(() => {
      const calls: { data: string; type: string; handwriting?: boolean }[] = [];
      const bridge = {
        platform: "ios",
        version: "1.1",
        haptic: () => undefined,
        setStatusBar: () => undefined,
        openExternal: async () => true,
        getSettings: async () => ({ lock: false, lockAfter: 0, method: "faceID" }),
        setSettings: async () => ({ lock: false, lockAfter: 0, method: "faceID" }),
        onCommand: () => () => undefined,
        recognizeText: async (image: { data: string; type: string; handwriting?: boolean }) => {
          calls.push(image);
          return { text: "Receipt total 42 flumpetine" };
        },
      };
      Object.defineProperty(window, "foleviNative", { value: bridge });
      Object.assign(window, { __vision: calls });
      const mark = () => document.documentElement?.setAttribute("data-native", "ios");
      mark();
      if (!document.documentElement) new MutationObserver((_, watch) => document.documentElement && (mark(), watch.disconnect())).observe(document, { childList: true });
    });
    await page.reload();
    await newNote(page, "Lunch receipt");
    await pasteFile(page, { name: "receipt.png", type: "image/png", base64: PNG });
    await expect(page.locator(".fb-editor .fb-atom").first()).toBeVisible({ timeout: 15_000 });
    await waitForSaved(page);
    const { result } = await searchUntil(page, "flumpetine", "Lunch receipt");
    await expect(result).toContainText("In image");
    // The image's own bytes, read once, as an image (not handwriting).
    const sent = await page.evaluate(() => (window as unknown as { __vision: { data: string; type: string; handwriting?: boolean }[] }).__vision);
    expect(sent).toEqual([{ data: PNG, type: "image/png", handwriting: false }]);
  });
});
