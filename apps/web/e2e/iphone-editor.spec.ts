// The note editor in the iPhone app (docs/IOS_POLISH_PLAN.md §3 Note, Insert, Format, Style; WP2), in local
// mode with the starter library: the page gets a stand-in for the app's bridge (<html data-native="ios">) and
// an iPhone-sized window with an iPhone's user agent and touch.
//   E2E_LOCAL_BASE_URL=http://localhost:3003 E2E_BASE_URL=http://app.localhost:3002 E2E_NO_SERVER=1 \
//     npx playwright test e2e/iphone-editor.spec.ts --project local
// With IPHONE_EDITOR_SHOTS set, each screen is also saved there in light and dark.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Browser, Page, TestInfo } from "@playwright/test";
import { expect, prepareContext, test } from "./fixtures/localShell";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FoleviiOS/1.0";
const SHOTS = process.env.IPHONE_EDITOR_SHOTS;

function fakeBridge() {
  const calls: { method: string; arg?: unknown }[] = [];
  const keyboard: ((f: { height: number; duration: number; curve: string; visible: boolean }) => void)[] = [];
  const bridge = {
    platform: "ios",
    version: "1.0",
    haptic: (kind: string) => calls.push({ method: "haptic", arg: kind }),
    hapticPrepare: () => undefined,
    setStatusBar: () => undefined,
    openExternal: async () => true,
    getSettings: async () => ({ lock: false, lockAfter: 0, method: "faceID" }),
    setSettings: async () => ({ lock: false, lockAfter: 0, method: "faceID" }),
    onCommand: () => () => undefined,
    keyboard: (o: unknown) => calls.push({ method: "keyboard", arg: o }),
    onKeyboard: (cb: (f: { height: number; duration: number; curve: string; visible: boolean }) => void) => {
      keyboard.push(cb);
      return () => keyboard.splice(keyboard.indexOf(cb), 1);
    },
  };
  Object.defineProperty(window, "foleviNative", { value: bridge });
  Object.assign(window, {
    __native: {
      calls,
      // The keyboard coming up or going away, as the app reports it.
      keyboard: (height: number) => {
        window.dispatchEvent(new Event(height ? "keyboardWillShow" : "keyboardWillHide"));
        for (const cb of keyboard) cb({ height, duration: 250, curve: "keyboard", visible: height > 0 });
      },
    },
  });
  const mark = () => document.documentElement?.setAttribute("data-native", "ios");
  mark();
  if (!document.documentElement) new MutationObserver((_, watch) => document.documentElement && (mark(), watch.disconnect())).observe(document, { childList: true });
  window.addEventListener("contextmenu", (e) => (e.isTrusted ? (e.stopImmediatePropagation(), e.preventDefault()) : undefined), true);
  const hideBadge = () => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal { display: none !important; }";
    document.head.appendChild(style);
  };
  if (document.head) hideBadge();
  else document.addEventListener("DOMContentLoaded", hideBadge, { once: true });
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(SHOTS, `${name}-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: "light" });
}

let n = 0;
async function iphone(browser: Browser, testInfo: TestInfo) {
  const context = await browser.newContext({ viewport: { width: 402, height: 874 }, userAgent: IPHONE_UA, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await prepareContext(context, testInfo, { libraryName: `iphone-editor-${Date.now()}-${n++}`, platform: "ios" });
  await context.addInitScript(fakeBridge);
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
  page.on("console", (m) => (m.type() === "error" ? console.log("CONSOLE", m.text().slice(0, 300)) : undefined));
  return { context, page };
}

/** Opens the starter library's first note from Home. */
async function openNote(page: Page, title?: RegExp) {
  await page.goto("/documents");
  await expect(page.locator("html")).toHaveAttribute("data-iphone", "", { timeout: 60_000 });
  const link = title ? page.locator("main a[href^='/d/']", { hasText: title }).first() : page.locator("main a[href^='/d/']").first();
  await expect(link).toBeVisible({ timeout: 60_000 });
  await link.click();
  await expect(page.getByRole("textbox", { name: "Document body" })).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(800);
}

/** A real finger (Chromium's touch input): down at a point, an optional path, then up after `ms`. */
async function finger(page: Page, x: number, y: number, ms: number, path: { x: number; y: number }[] = []) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (const p of path) {
    await page.waitForTimeout(40);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [p] });
  }
  await page.waitForTimeout(ms);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

const keyboard = (page: Page, height: number) => page.evaluate((h) => (window as unknown as { __native: { keyboard: (h: number) => void } }).__native.keyboard(h), height);
const body = (page: Page) => page.getByRole("textbox", { name: "Document body" });

test("iPhone note: the bar on the keyboard, the top bar with Done while writing, Insert and Format from it @local", async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { context, page } = await iphone(browser, testInfo);
  await openNote(page, /Trip Sketch/);
  await shot(page, "note");
  const back = page.getByRole("button", { name: "Back" });
  await expect(back).toBeVisible();

  // Writing: the bar rides on the keyboard, 8 pt above it; the top bar stays, with Back and Done (in place of
  // Share and "…"); no grip beside the line.
  await body(page).locator("p").first().tap();
  const bar = page.getByRole("toolbar", { name: "Writing tools" });
  await expect(bar).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-iphone-writing", "");
  await expect(back).toBeVisible();
  const done = page.getByRole("button", { name: "Done", exact: true });
  await expect(done).toBeVisible();
  await expect(page.getByRole("group", { name: "Note actions" })).toBeHidden();
  await expect(page.locator("[data-block-grip]")).toBeHidden();
  await keyboard(page, 336);
  await expect.poll(async () => Math.round((await bar.boundingBox())!.y + (await bar.boundingBox())!.height), { timeout: 5_000 }).toBe(874 - 336 - 8);
  await shot(page, "note-keyboard");
  // The web view shrinks to end at the keyboard (the app's keyboard setting): the bar stays where it is.
  await page.setViewportSize({ width: 402, height: 874 - 336 });
  await expect.poll(async () => Math.round((await bar.boundingBox())!.y + (await bar.boundingBox())!.height), { timeout: 5_000 }).toBe(874 - 336 - 8);
  await page.setViewportSize({ width: 402, height: 874 });
  // Its keys: 44 pt, Insert and Format first, the keyboard key at the end.
  const keys = bar.getByRole("button");
  const names = await keys.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
  expect(names.slice(0, 2)).toEqual(["Insert", "Format"]);
  expect(names.at(-1)).toBe("Hide keyboard");
  for (const box of await keys.evaluateAll((els) => els.slice(0, 8).map((el) => el.getBoundingClientRect()).map((r) => [r.width, r.height]))) expect(box).toEqual([44, 44]);

  // To-do turns the line into a task, and back.
  const todos = await page.locator(".fb-todo").count();
  await bar.getByRole("button", { name: "To-do" }).tap();
  await expect(page.locator(".fb-todo")).toHaveCount(todos + 1);
  await expect(bar.getByRole("button", { name: "To-do" })).toHaveAttribute("aria-pressed", "true");
  await bar.getByRole("button", { name: "To-do" }).tap();
  await expect(page.locator(".fb-todo")).toHaveCount(todos);

  // Insert opens its sheet (the bar gives way); the search isn't focused, so no keyboard comes up over it.
  await bar.getByRole("button", { name: "Insert" }).tap();
  const insert = page.getByRole("dialog", { name: "Insert" });
  await expect(insert).toBeVisible();
  await expect(bar).toBeHidden();
  await expect(insert.getByText("Drag and drop any item to the document")).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).not.toBe("Search blocks");
  const tile = insert.getByRole("button", { name: "Heading 1", exact: true });
  expect((await tile.boundingBox())!.height).toBeGreaterThanOrEqual(74);
  await shot(page, "note-insert");
  // The search stays under the sheet's title while the tiles scroll.
  const search = insert.getByRole("searchbox", { name: "Search blocks" });
  // (Once the sheet has come up.)
  await page.waitForTimeout(900);
  const before = (await search.boundingBox())!.y;
  await search.evaluate((el) => {
    for (let p = el.parentElement; p; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) return void (p.scrollTop = 500);
  });
  await page.waitForTimeout(300);
  expect(Math.abs((await search.boundingBox())!.y - before)).toBeLessThan(8);
  await search.evaluate((el) => {
    for (let p = el.parentElement; p; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) return void (p.scrollTop = 0);
  });
  const headings = await page.locator(".fb-editor .fb-h1").count();
  await tile.tap();
  await expect(page.locator(".fb-editor .fb-h1")).toHaveCount(headings + 1);
  // The sheet steps aside to show what was added.
  await expect(insert).toBeHidden();

  // Format: preview tiles for text styles, capsules of 44 pt buttons, the chosen one filled.
  await body(page).locator("p").first().tap();
  await bar.getByRole("button", { name: "Format" }).tap();
  const format = page.getByRole("dialog", { name: "Format" });
  await expect(format).toBeVisible();
  const bold = format.getByRole("button", { name: "Bold" });
  expect(Math.round((await bold.boundingBox())!.height)).toBe(44);
  await shot(page, "note-format");
  const styles = format.getByRole("group", { name: "Text style" });
  const subtitle = styles.getByRole("button", { name: "Subtitle", exact: true });
  await subtitle.tap();
  await expect(subtitle).toHaveAttribute("aria-pressed", "true");
  await expect(styles.getByRole("button", { name: "Body", exact: true })).toHaveAttribute("aria-pressed", "false");
  // Chosen: filled, not outlined.
  const plain = await styles.getByRole("button", { name: "Body", exact: true }).evaluate((el) => getComputedStyle(el).backgroundColor);
  await expect.poll(() => subtitle.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(plain);
  await page.keyboard.press("Escape");
  await expect(format).toBeHidden();

  // The keyboard key puts it away: the note's bars come back.
  await body(page).locator("p").first().tap();
  await bar.getByRole("button", { name: "Hide keyboard" }).tap();
  await keyboard(page, 0);
  await expect(bar).toBeHidden();
  await expect(back).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "Note tools" })).toBeVisible();
  // Done in the top bar puts the keyboard away too, and Share and "…" come back.
  await body(page).locator("p").first().tap();
  await keyboard(page, 336);
  await expect(done).toBeVisible();
  await done.tap();
  await keyboard(page, 0);
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[aria-label="Document body"]') != null)).toBe(false);
  await expect(page.locator("html")).not.toHaveAttribute("data-iphone-writing", "");
  await expect(done).toBeHidden();
  await expect(page.getByRole("group", { name: "Note actions" })).toBeVisible();
  await context.close();
});

test("iPhone note: a table scrolls sideways with a 44 pt + after its last column and under its last row @local", async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const { context, page } = await iphone(browser, testInfo);
  await openNote(page, /Trip Sketch/);
  const table = page.getByRole("group", { name: "Table" }).first();
  await table.scrollIntoViewIfNeeded();
  const addRow = table.getByRole("button", { name: "Add a row" });
  const addColumn = table.getByRole("button", { name: "Add a column" });
  await expect(addRow).toBeVisible();
  await expect(addColumn).toBeVisible();
  expect(Math.round((await addRow.boundingBox())!.height)).toBe(44);
  expect(Math.round((await addColumn.boundingBox())!.width)).toBe(44);
  // The small text links are the desktop's.
  await expect(table.getByRole("button", { name: "Row", exact: true })).toHaveCount(0);
  await shot(page, "note-table");
  const rows = await table.locator("tbody tr").count();
  await addRow.tap();
  await expect(table.locator("tbody tr")).toHaveCount(rows + 1);
  const columns = await table.locator("tbody tr").first().locator("[data-cell-at]").count();
  await addColumn.tap();
  await addColumn.tap();
  await expect(table.locator("tbody tr").first().locator("[data-cell-at]")).toHaveCount(columns + 2);
  // Now wider than the screen: it scrolls inside itself (never the page), with a fade at the edge.
  const scroller = table.locator(".fb-hscroll");
  await expect(scroller).toHaveAttribute("data-more-end", "");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shot(page, "note-table-wide");
  await context.close();
});

test("iPhone note: a collection is a list with its views as a segmented control and the rest in its menu @local", async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const { context, page } = await iphone(browser, testInfo);
  await openNote(page, /Reading Shelf/);
  const shelf = page.getByRole("region", { name: /^Collection / });
  await expect(shelf).toBeVisible();
  // No desktop table or toolbar.
  await expect(shelf.locator("table")).toHaveCount(0);
  await expect(shelf.getByRole("button", { name: "Export" })).toHaveCount(0);
  const first = shelf.getByRole("listitem").first().getByRole("link");
  await expect(first).toBeVisible();
  expect((await first.boundingBox())!.height).toBeGreaterThanOrEqual(64);
  await shot(page, "note-collection");
  const views = shelf.getByRole("group", { name: "Views" });
  const gallery = views.getByRole("button", { name: "Gallery" });
  await gallery.tap();
  await expect(gallery).toHaveAttribute("aria-pressed", "true");
  await shot(page, "note-collection-gallery");
  await shelf.getByRole("button", { name: "Collection options" }).tap();
  await expect(page.getByRole("menuitem", { name: "Download CSV" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Gallery" })).toBeVisible();
  await shot(page, "note-collection-menu");
  await context.close();
});

test("iPhone note: holding a line opens its menu beside it, the block's own actions first, no Paste @local", async ({ browser, browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "Touch input is driven through Chromium's DevTools protocol.");
  test.setTimeout(180_000);
  const { context, page } = await iphone(browser, testInfo);
  await openNote(page, /Welcome to Folevi/);
  const line = body(page).locator("p").first();
  const r = (await line.boundingBox())!;
  await finger(page, r.x + 40, r.y + r.height / 2, 900);
  const menu = page.getByRole("menu", { name: "Note actions" });
  await expect(menu).toBeVisible();
  const items = await menu.getByRole("menuitem").evaluateAll((els) => els.map((el) => el.textContent?.trim()));
  expect(items.some((t) => t?.startsWith("Paste"))).toBe(false);
  expect(items.findIndex((t) => t?.startsWith("Turn into"))).toBe(0);
  expect(items.slice(0, 4).map((t) => t?.replace(/[⌘⇧⌥⌫↵].*$/, "").trim())).toEqual(["Turn into", "Insert below", "Duplicate", "Copy link to block"]);
  expect(items.at(-1)).toMatch(/^Delete block/);
  // The line is held (lifted, or marked where the app can't lift it) and the menu doesn't cover it.
  await expect(page.locator("[data-block-held]")).toHaveCount(1);
  await expect(body(page)).toHaveAttribute("contenteditable", "false");
  const m = (await menu.boundingBox())!;
  const held = (await page.locator("[data-block-held]").boundingBox())!;
  expect(m.y >= held.y + held.height - 1 || m.y + m.height <= held.y + 1).toBe(true);
  await shot(page, "note-block-menu");
  // Drawn as the app's other menus: 17 pt rows, 44 tall.
  const first = menu.getByRole("menuitem").first();
  expect(await first.evaluate((el) => getComputedStyle(el).fontSize)).toBe("17px");
  expect(Math.round((await first.boundingBox())!.height)).toBeGreaterThanOrEqual(44);
  // A submenu opens in place of the menu, with a row back to it. (A tap just as the held finger lifts belongs
  // to the hold: a moment later.)
  await page.waitForTimeout(500);
  await first.tap();
  const sub = page.getByRole("menu", { name: "Turn into" });
  await expect(sub).toBeVisible();
  const s = (await sub.boundingBox())!;
  expect(Math.abs(s.x - m.x)).toBeLessThan(2);
  await shot(page, "note-block-submenu");
  await sub.getByRole("menuitem", { name: "Turn into" }).tap();
  await expect(sub).toBeHidden();
  await expect(menu).toBeVisible();
  await page.touchscreen.tap(200, 120);
  await expect(menu).toBeHidden();
  await expect(page.locator("[data-block-held]")).toHaveCount(0);
  // iOS doesn't select the words under the held finger meanwhile (the page isn't editable text for it while
  // the menu is up); afterwards it is again.
  await expect(body(page)).toHaveAttribute("contenteditable", "true");
  // Writing (the caret in the note), a held finger is iOS's own: its loupe and selection, no block menu.
  await page.waitForTimeout(600);
  await line.tap();
  await expect(page.getByRole("toolbar", { name: "Writing tools" })).toBeVisible();
  await finger(page, r.x + 40, r.y + r.height / 2, 900);
  await page.waitForTimeout(300);
  await expect(menu).toHaveCount(0);
  await context.close();
});

test("iPhone note: Style's themes in a row, round swatches @local", async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const { context, page } = await iphone(browser, testInfo);
  await openNote(page, /Welcome to Folevi/);
  await page.getByRole("button", { name: "Style", exact: true }).tap();
  const style = page.getByRole("dialog", { name: "Style" });
  await expect(style).toBeVisible();
  const themes = style.getByRole("radiogroup", { name: "Note theme" });
  await expect(themes.getByRole("radio", { name: "Plain" })).toHaveAttribute("aria-checked", "true");
  const doc = style.getByRole("button", { name: "Document color" });
  expect((await doc.boundingBox())!.height).toBeGreaterThanOrEqual(52);
  await shot(page, "note-style");
  await doc.tap();
  await shot(page, "note-style-colors");
  await context.close();
});
