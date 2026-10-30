import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { APP, newPerson, waitForSaved } from "./helpers";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FoleviiOS/1.0";

/** What the iOS app gives the page before its first script (as iphone-app.spec.ts does): a stand-in bridge. */
function fakeBridge() {
  const calls: string[] = [];
  Object.defineProperty(window, "foleviNative", { value: { platform: "ios", version: "1.0", haptic: (kind: string) => calls.push(kind), setStatusBar: () => undefined, openExternal: async () => true, getSettings: async () => null, setSettings: async () => null, onCommand: () => () => undefined } });
  Object.assign(window, { __haptics: calls });
  const mark = () => document.documentElement?.setAttribute("data-native", "ios");
  mark();
  if (!document.documentElement) new MutationObserver((_, watch) => document.documentElement && (mark(), watch.disconnect())).observe(document, { childList: true });
}

async function newPage(page: Page, title: string) {
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Intro");
  await waitForSaved(page);
}

async function insertWhiteboard(page: Page) {
  await page.keyboard.press("Enter");
  await page.keyboard.type("/whiteboard");
  await page.getByRole("option", { name: /Whiteboard/ }).first().click();
  const canvas = page.locator(".fb-editor .fb-whiteboard svg.fb-whiteboard-canvas");
  await expect(canvas).toBeVisible();
  await canvas.scrollIntoViewIfNeeded();
  return canvas;
}

/** A horizontal line across the canvas, `y` pixels from its top. */
async function drawLine(page: Page, canvas: Locator, y: number, from = 60, to = 300) {
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + from, box.y + y);
  await page.mouse.down();
  for (let x = from + 20; x <= to; x += 20) await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.up();
}

/** The strokes' vertical middles, in page pixels, in drawing order. */
const strokeYs = (canvas: Locator) =>
  canvas.locator("[data-wb-stroke]").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2)));

test.describe("Whiteboard", () => {
  test.setTimeout(150_000);

  test("export, a stroke's own menu, Select (double-click, move, duplicate, delete), full canvas: it persists", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Whiteboard Tester");
    await newPage(page, "Sketches");
    const canvas = await insertWhiteboard(page);
    const tools = page.getByRole("toolbar", { name: "Whiteboard tools" });
    const strokes = canvas.locator("[data-wb-stroke]");

    // Export is there from the start, unavailable until something is drawn.
    await tools.getByRole("button", { name: "Export" }).click();
    for (const item of ["Export as PNG", "Export as SVG", "Export as PDF", "Copy as image"]) await expect(page.getByRole("menuitem", { name: item })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);

    await drawLine(page, canvas, 60);
    await drawLine(page, canvas, 180);
    await expect(strokes).toHaveCount(2);
    const box = (await canvas.boundingBox())!;

    // Export: an SVG of the sheet with both strokes.
    await tools.getByRole("button", { name: "Export" }).click();
    for (const item of ["Export as PNG", "Export as PDF", "Copy as image"]) await expect(page.getByRole("menuitem", { name: item })).toBeEnabled();
    const download = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Export as SVG" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("Whiteboard.svg");
    const svg = readFileSync((await file.path())!, "utf8");
    expect(svg).toMatch(/^<svg[^>]*viewBox="0 0 1000 420"/);
    expect(svg.match(/<path /g)).toHaveLength(2);

    // Right-click on empty sheet: no menu at all (not the note's block menu either).
    await page.mouse.click(box.x + box.width - 60, box.y + box.height - 40, { button: "right" });
    await expect(page.getByRole("menu")).toHaveCount(0);

    // Right-click on the second (lower) line, a little off it: its own short menu, which recolours just that one.
    await page.mouse.click(box.x + 180, box.y + 183, { button: "right" });
    const menu = page.getByRole("menu", { name: "Stroke" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem")).toHaveText([/Duplicate/, /Delete/]);
    await expect(menu.getByRole("menuitemradio")).toHaveText(["Black", "Blue", "Red", "Green", "Orange", "Purple"]);
    await expect(menu.getByRole("menuitemradio", { name: "Black" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("menuitem", { name: /Turn into|Insert below/ })).toHaveCount(0);
    await menu.getByRole("menuitemradio", { name: "Blue" }).click();
    await expect(menu).toHaveCount(0);
    await expect(canvas.locator('[data-wb-stroke] path[stroke*="--wb-blue"]')).toHaveCount(1);
    expect((await strokeYs(canvas)).sort((a, b) => a - b)[1]! - box.y).toBeGreaterThan(150);
    const blueY = await canvas.locator('[data-wb-stroke]:has(path[stroke*="--wb-blue"])').evaluate((el) => el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2);
    expect(Math.abs(blueY - (box.y + 180))).toBeLessThan(6);
    // Nothing stays picked after the menu (the Pen is still the tool).
    await expect(canvas.locator("[data-picked]")).toHaveCount(0);

    // Right-click the upper line, Delete: only that one goes.
    await page.mouse.click(box.x + 120, box.y + 61, { button: "right" });
    await page.getByRole("menu", { name: "Stroke" }).getByRole("menuitem", { name: /Delete/ }).click();
    await expect(strokes).toHaveCount(1);
    await expect(canvas.locator('[data-wb-stroke] path[stroke*="--wb-blue"]')).toHaveCount(1);
    // Undo brings it back.
    await tools.getByRole("button", { name: "Undo" }).click();
    await expect(strokes).toHaveCount(2);

    // Select: Cmd+A picks every stroke; a double-click picks just the one under the pointer.
    await tools.getByRole("button", { name: /^Select/ }).click();
    await page.mouse.click(box.x + box.width - 60, box.y + box.height - 40);
    await page.keyboard.press("ControlOrMeta+a");
    await expect(canvas).toHaveAttribute("aria-label", /2 strokes, 2 selected/);
    await page.mouse.dblclick(box.x + 200, box.y + 61);
    await expect(canvas).toHaveAttribute("aria-label", /2 strokes, 1 selected/);
    const picked = canvas.locator("[data-wb-stroke][data-picked]");
    await expect(picked.locator("path:not(.fb-wb-halo)")).not.toHaveAttribute("stroke", /--wb-blue/);
    // The toolbar offers the picked stroke's colour, Duplicate and Delete.
    await expect(tools.getByRole("group", { name: "Colour of the selected strokes" })).toBeVisible();
    // Drag it down 100 pixels.
    await page.mouse.move(box.x + 200, box.y + 60);
    await page.mouse.down();
    for (let dy = 10; dy <= 100; dy += 10) await page.mouse.move(box.x + 200, box.y + 60 + dy);
    await page.mouse.up();
    await expect.poll(async () => (await strokeYs(canvas)).some((y) => Math.abs(y - (box.y + 160)) < 6)).toBe(true);
    // Cmd+D duplicates it (the copy is picked), Delete removes the copy.
    await page.keyboard.press("ControlOrMeta+d");
    await expect(strokes).toHaveCount(3);
    await expect(canvas).toHaveAttribute("aria-label", /3 strokes, 1 selected/);
    await page.keyboard.press("Backspace");
    await expect(strokes).toHaveCount(2);
    await page.keyboard.press("Escape");
    await expect(canvas.locator("[data-picked]")).toHaveCount(0);

    // Full canvas: the toolbar's button, the toolbar centred along the top, the sheet filling the window.
    await tools.getByRole("button", { name: "Full canvas" }).click();
    const card = page.locator(".fb-whiteboard .fb-canvas-card[data-full]");
    await expect(card).toBeVisible();
    const vp = page.viewportSize()!;
    const bar = (await tools.boundingBox())!;
    expect(Math.abs(bar.x + bar.width / 2 - vp.width / 2)).toBeLessThan(4);
    expect(bar.y).toBeLessThan(20);
    const sheet = (await canvas.boundingBox())!;
    expect(sheet.width > vp.width - 60 || sheet.height > vp.height - bar.height - 60).toBe(true);
    // The right-click menu shows over full canvas, inside it, and finds the stroke under the pointer.
    const ys = (await strokeYs(canvas)).sort((a, b) => a - b);
    await page.mouse.click(sheet.x + sheet.width * 0.18, ys[0]!, { button: "right" });
    const fullMenu = page.getByRole("menu", { name: "Stroke" });
    await expect(fullMenu).toBeVisible();
    expect(await fullMenu.evaluate((el) => Boolean(el.closest(".fb-canvas-card[data-full]")))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(fullMenu).toHaveCount(0);
    // Esc first lets go of the stroke Select picked for the menu, then leaves full canvas.
    await canvas.locator("..").focus();
    await page.keyboard.press("Escape");
    await expect(canvas.locator("[data-picked]")).toHaveCount(0);
    await expect(card).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(card).toHaveCount(0);
    // Shift+Cmd+F goes back in, Esc back out.
    await canvas.locator("..").focus();
    await page.keyboard.press("ControlOrMeta+Shift+f");
    await expect(card).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(card).toHaveCount(0);

    // The Mac app: the window's buttons get the corner of the full canvas.
    await page.evaluate(() => (document.documentElement.dataset.desktop = "mac"));
    await tools.getByRole("button", { name: "Full canvas" }).click();
    const traffic = await page.locator(".fb-whiteboard .fb-canvas-card[data-full] .fb-full-traffic").boundingBox();
    expect(traffic).toMatchObject({ x: 14, y: 10 });
    const macBar = (await tools.boundingBox())!;
    expect(macBar.x).toBeGreaterThan(70);
    await tools.getByRole("button", { name: "Exit full canvas" }).click();
    await expect(card).toHaveCount(0);
    await page.evaluate(() => delete document.documentElement.dataset.desktop);

    await waitForSaved(page);
    await page.waitForTimeout(800);
    await waitForSaved(page);
    await page.reload();
    const again = page.locator(".fb-editor .fb-whiteboard svg.fb-whiteboard-canvas");
    await expect(again.locator("[data-wb-stroke]")).toHaveCount(2);
    await expect(again.locator('[data-wb-stroke] path[stroke*="--wb-blue"]')).toHaveCount(1);
    await context.close();
  });

  test("iPhone app: a finger draws, 44 point tools, a long press on a stroke opens its menu", async ({ browser }) => {
    const { context: desk, page: deskPage } = await newPerson(browser, "Whiteboard Phone");
    await newPage(deskPage, "Phone sketch");
    const deskCanvas = await insertWhiteboard(deskPage);
    await drawLine(deskPage, deskCanvas, 60, 40, 240);
    await expect(deskCanvas.locator("[data-wb-stroke]")).toHaveCount(1);
    await waitForSaved(deskPage);
    await deskPage.waitForTimeout(800);
    await waitForSaved(deskPage);
    const url = deskPage.url().replace(/\?.*$/, "");
    const state = await desk.storageState();
    await desk.close();

    const context = await browser.newContext({ storageState: state, viewport: { width: 402, height: 874 }, userAgent: IPHONE_UA, hasTouch: true });
    await context.addInitScript(fakeBridge);
    const page = await context.newPage();
    await page.goto(url.replace(/^https?:\/\/[^/]+/, APP));
    await expect(page.locator("html")).toHaveAttribute("data-iphone", "", { timeout: 30_000 });
    const canvas = page.locator(".fb-editor .fb-whiteboard svg.fb-whiteboard-canvas");
    await expect(canvas.locator("[data-wb-stroke]")).toHaveCount(1, { timeout: 30_000 });
    await canvas.scrollIntoViewIfNeeded();
    const tools = page.getByRole("toolbar", { name: "Whiteboard tools" });
    for (const name of ["Pen", "Full canvas", "Export"]) {
      const b = (await tools.getByRole("button", { name, exact: true }).boundingBox())!;
      expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44);
    }
    const swatch = (await tools.getByRole("button", { name: "Blue" }).boundingBox())!;
    expect(Math.min(swatch.width, swatch.height)).toBeGreaterThanOrEqual(44);

    // A finger draws (touch events, as the iPhone sends them).
    const box = (await canvas.boundingBox())!;
    const cdp = await context.newCDPSession(page);
    const at = (x: number, y: number) => [{ x: box.x + x, y: box.y + y }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(40, 120) });
    for (let x = 60; x <= 240; x += 20) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(x, 120) });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(canvas.locator("[data-wb-stroke]")).toHaveCount(2);

    // With Select, holding a finger on a stroke opens its menu (with a haptic).
    // (A tap just after the drawing finger lifts can belong to it: tap again until Select is on.)
    const select = tools.getByRole("button", { name: /^Select/ });
    await expect(async () => {
      await select.tap();
      await expect(select).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    const y = (await canvas.locator("[data-wb-stroke]").first().boundingBox())!;
    const hold = [{ x: y.x + y.width / 2, y: y.y + y.height / 2 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: hold });
    await page.waitForTimeout(700);
    const menu = page.getByRole("menu", { name: "Stroke" });
    await expect(menu).toBeVisible();
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    expect(await page.evaluate(() => (window as unknown as { __haptics: string[] }).__haptics)).toContain("medium");
    await expect(menu).toBeVisible();
    const del = (await menu.getByRole("menuitem", { name: /Delete/ }).boundingBox())!;
    expect(del.height).toBeGreaterThanOrEqual(44);
    await menu.getByRole("menuitem", { name: /Delete/ }).tap();
    await expect(canvas.locator("[data-wb-stroke]")).toHaveCount(1);
    await context.close();
  });
});
