// The iPhone app's menus, sheets and dialogs (docs/IOS_POLISH_PLAN.md WP3): menus drawn to the iOS menu spec
// in Folevi's fonts (17 pt rows 44 tall, hairlines in a section, 8 pt bands between, icons at the end, no
// desktop items), shrinking away when they close; sheets with a 56 pt header and 44 pt buttons that follow the
// finger 1:1 and settle or go away by where and how fast they're let go; confirmations and renames as the
// system's alert through the native bridge (a stand-in here that records the calls), and Quick add task as a
// sheet of glass chips.
import type { Browser, Page, TestInfo } from "@playwright/test";
import { expect, prepareContext, test } from "./fixtures/localShell";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FoleviiOS/1.0";

/** The app's bridge, with the native alert answered by `window.__answer` (set by the test). */
function fakeBridge() {
  const calls: { method: string; arg?: unknown }[] = [];
  const w = window as unknown as { __answer: unknown; __native: { calls: typeof calls } };
  w.__answer = null;
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
    alert: async (o: unknown) => {
      calls.push({ method: "alert", arg: o });
      return w.__answer;
    },
  };
  Object.defineProperty(window, "foleviNative", { value: bridge });
  Object.assign(window, { __native: { calls } });
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

/** A finger down at a point, moving through `path` (one step every `step` ms), then up. */
async function drag(page: Page, from: { x: number; y: number }, path: { x: number; y: number }[], step = 40, hold = 0) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
  for (const p of path) {
    await page.waitForTimeout(step);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [p] });
  }
  if (hold) await page.waitForTimeout(hold);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

/**
 * Opens the menu of Home's tile for the folder called `name` the way a long press does (its contextmenu: on
 * touch the tile's "…" is out of sight and takes no taps; iphone-folder-tap.spec.ts covers the hold itself),
 * then chooses `item`.
 */
async function tileMenuChoose(page: Page, name: string, item: string) {
  const tile = page.getByRole("list", { name: "Folders" }).getByRole("link", { name: new RegExp(`^${name}, `) }).first();
  await tile.scrollIntoViewIfNeeded();
  const b = (await tile.boundingBox())!;
  await tile.dispatchEvent("contextmenu", { bubbles: true, cancelable: true, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 });
  await page.getByRole("menu", { name: `Folder options for ${name}` }).getByRole("menuitem", { name: item }).click();
}

let n = 0;
/** An iPhone in the app, on a library of its own (the built-in interface in local mode). */
async function iphone(browser: Browser, testInfo: TestInfo) {
  const context = await browser.newContext({ viewport: { width: 402, height: 874 }, userAgent: IPHONE_UA, hasTouch: true, isMobile: true });
  await prepareContext(context, testInfo, { libraryName: `iphone-sheets-${Date.now()}-${n++}`, platform: "ios" });
  await context.addInitScript(fakeBridge);
  const page = await context.newPage();
  await page.goto("/documents");
  await expect(page.locator("html")).toHaveAttribute("data-iphone", "", { timeout: 60_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible({ timeout: 60_000 });
  return { context, page };
}

const calls = (page: Page) => page.evaluate(() => (window as unknown as { __native: { calls: { method: string; arg?: unknown }[] } }).__native.calls);

test("iPhone: menus, sheets, native alerts and Quick add @local", async ({ browser, browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "Touch input is driven through Chromium's DevTools protocol.");
  test.setTimeout(300_000);
  const { context, page } = await iphone(browser, testInfo);

  // A menu, as iOS draws one in Folevi's fonts.
  await page.getByRole("button", { name: "Create" }).click();
  const create = page.getByRole("menu", { name: "Create" });
  await expect(create).toBeVisible();
  // (Once it has grown to its size.)
  await page.waitForTimeout(700);
  const look = await create.evaluate((m) => {
    const items = [...m.querySelectorAll<HTMLElement>(".ui-menu-item")];
    const first = items[0]!;
    const icon = first.querySelector<HTMLElement>('[data-menu-part="icon"]');
    const label = first.querySelector<HTMLElement>('[data-menu-part="label"]')!;
    const cs = getComputedStyle(first);
    return {
      radius: getComputedStyle(m).borderTopLeftRadius,
      padding: getComputedStyle(m).paddingTop,
      fontSize: cs.fontSize,
      height: first.offsetHeight,
      font: cs.fontFamily,
      iconAfterLabel: icon ? icon.getBoundingClientRect().left > label.getBoundingClientRect().right : null,
      minWidth: (m as HTMLElement).offsetWidth,
      bands: [...m.querySelectorAll<HTMLElement>('[role="separator"]')].map((s) => s.offsetHeight),
      hairline: items[1] ? getComputedStyle(items[1]).boxShadow : "",
    };
  });
  expect(look.radius).toBe("18px");
  expect(look.padding).toBe("0px");
  expect(look.fontSize).toBe("17px");
  expect(look.height).toBeGreaterThanOrEqual(44);
  expect(look.font).toMatch(/^"?Instrument Sans/);
  expect(look.iconAfterLabel).toBe(true);
  // (250 unless the caller asks for its own, as the tab bar does with 248.)
  expect(look.minWidth).toBeGreaterThanOrEqual(240);
  for (const b of look.bands) expect(b).toBe(8);

  // A folder (New folder, in its glass card). The menu fades as a picture of itself, still drawn as the app's
  // menu (17 pt rows, not the desktop's) while it goes.
  const ghostLook = page.evaluate(
    () =>
      new Promise<string | null>((done) => {
        const watch = new MutationObserver(() => {
          const item = document.querySelector<HTMLElement>("[data-menu-ghost] .ui-menu-item");
          if (!item) return;
          watch.disconnect();
          done(getComputedStyle(item).fontSize);
        });
        watch.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => (watch.disconnect(), done(null)), 3000);
      }),
  );
  await create.getByRole("menuitem", { name: "New folder" }).click();
  expect(await ghostLook).toBe("17px");
  const card = page.getByRole("dialog", { name: "New folder" });
  await card.getByPlaceholder("Folder name").fill("Field notes");
  await card.getByRole("button", { name: "Create" }).click();
  await expect(card).toHaveCount(0);
  // The menu went away as a fading picture of itself, gone by now.
  await expect(page.locator('[popover][aria-hidden="true"]')).toHaveCount(0);

  // Its tile's "…" menu on Home: Rename… asks with the system's alert and its text field.
  await page.goto(`/documents`);
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible({ timeout: 60_000 });
  const folders = page.getByRole("list", { name: "Folders" });
  await expect(folders.getByText("Field notes", { exact: true })).toBeVisible();
  await page.evaluate(() => ((window as unknown as { __answer: unknown }).__answer = { id: "confirm", text: "  Field journal " }));
  await tileMenuChoose(page, "Field notes", "Rename…");
  await expect(folders.getByText("Field journal", { exact: true })).toBeVisible();
  const rename = (await calls(page)).find((c) => c.method === "alert") as { arg: { title: string; field?: { value: string } } };
  expect(rename.arg.title).toBe("Rename folder");
  expect(rename.arg.field?.value).toBe("Field notes");
  // No Folevi dialog came up for it.
  await expect(page.getByRole("dialog", { name: "Rename folder" })).toHaveCount(0);

  // Delete folder…: the alert, destructive, and a warning felt when it's done.
  await page.evaluate(() => ((window as unknown as { __answer: unknown }).__answer = { id: "confirm" }));
  await tileMenuChoose(page, "Field journal", "Delete folder…");
  await expect(page.getByText("Folder deleted")).toBeVisible();
  const asked = (await calls(page)).filter((c) => c.method === "alert").at(-1) as { arg: { title: string; actions: { id: string; title: string; style?: string }[] } };
  expect(asked.arg.title).toBe("Delete “Field journal”?");
  expect(asked.arg.actions.find((a) => a.id === "confirm")).toMatchObject({ title: "Delete folder", style: "destructive" });
  expect((await calls(page)).some((c) => c.method === "haptic" && c.arg === "warning")).toBe(true);

  // A sheet: the account sheet's 56 pt header, its Close a 44 pt target with a 32 pt circle 12 pt in.
  await page.goto(`/documents`);
  await page.locator("button[aria-label$='account and places']").first().click();
  const sheet = page.getByRole("dialog", { name: "Account" });
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(900);
  const panel = sheet.locator('[data-iphone-sheet="sheet"]');
  const header = await panel.evaluate((p) => {
    const h = p.querySelector("header")!.getBoundingClientRect();
    const close = p.querySelector<HTMLElement>('button[aria-label="Close"]')!;
    const c = close.getBoundingClientRect();
    const circle = getComputedStyle(close, "::before");
    const pr = p.getBoundingClientRect();
    return { header: h.height, w: c.width, h: c.height, circle: circle.width, right: pr.right - (c.right - 6), top: c.top + 6 - pr.top };
  });
  expect(header).toMatchObject({ header: 56, w: 44, h: 44, circle: "32px" });
  expect(Math.round(header.right)).toBe(12);
  expect(Math.round(header.top)).toBe(12);

  // Dragged down a little and let go slowly: it follows the finger, then settles back.
  const box = (await panel.boundingBox())!;
  const grab = { x: box.x + box.width / 2, y: box.y + 28 };
  await drag(page, grab, [1, 2, 3, 4, 5, 6].map((i) => ({ x: grab.x, y: grab.y + i * 10 })), 40, 160);
  await page.waitForTimeout(1200);
  await expect(sheet).toBeVisible();
  expect(Math.abs((await panel.boundingBox())!.y - box.y)).toBeLessThan(2);

  // While the finger holds it 120 points down, the sheet is 120 points down (1:1).
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [grab] });
  for (let i = 1; i <= 6; i++) {
    await page.waitForTimeout(30);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: grab.x, y: grab.y + i * 20 }] });
  }
  await page.waitForTimeout(60);
  // (The first 6 points decide it's a drag.)
  expect(Math.abs((await panel.boundingBox())!.y - box.y - 120)).toBeLessThan(8);
  // A fast flick on down: it goes.
  for (let i = 7; i <= 10; i++) {
    await page.waitForTimeout(10);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: grab.x, y: grab.y + i * 45 }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
  await expect(sheet).toHaveCount(0, { timeout: 3000 });

  // Quick add task: a field, a round add button, and glass chips; Return adds it.
  await page.goto(`/tasks/today`);
  await page.getByRole("button", { name: "Quick task" }).click();
  const quick = page.getByRole("dialog", { name: "Quick add task" });
  await expect(quick).toBeVisible();
  await expect(quick.getByRole("group", { name: "Task details" }).getByRole("button", { name: "Due date" })).toBeVisible();
  await expect(quick.getByRole("button", { name: /^Priority/ })).toBeVisible();
  await expect(quick.getByRole("button", { name: /^Adds to Inbox/ })).toBeVisible();
  const add = quick.getByRole("button", { name: "Add task" });
  expect(await add.evaluate((b) => [b.getBoundingClientRect().width, b.getAttribute("aria-disabled")])).toEqual([44, "true"]);
  // Priority from its menu (a choice, felt as one).
  await quick.getByRole("button", { name: /^Priority/ }).click();
  await page.getByRole("menu", { name: /^Priority/ }).getByRole("menuitemradio", { name: "High" }).click();
  await expect(quick.getByRole("button", { name: "Priority: High" })).toBeVisible();
  expect((await calls(page)).some((c) => c.method === "haptic" && c.arg === "selection")).toBe(true);
  // Due date without the app's picker (an older build): the page's own month in a glass card, filling it,
  // with days a finger can hit.
  await quick.getByRole("group", { name: "Task details" }).getByRole("button", { name: "Due date" }).click();
  const picker = page.getByRole("dialog", { name: "Due date" });
  await expect(picker).toBeVisible();
  await page.waitForTimeout(500); // (the card's spring in)
  const fit = await picker.evaluate((d) => {
    const card = d.querySelector<HTMLElement>("[data-iphone-sheet]")!.getBoundingClientRect();
    const grid = d.querySelector<HTMLElement>('[role="grid"]')!.getBoundingClientRect();
    const day = d.querySelector<HTMLElement>('[role="gridcell"]')!.getBoundingClientRect();
    return { spare: card.width - grid.width, day: day.height };
  });
  expect(fit.spare).toBeLessThanOrEqual(48);
  expect(fit.day).toBeGreaterThanOrEqual(44);
  await picker.getByRole("button", { name: "Next month" }).click();
  await picker.getByRole("gridcell").nth(17).click();
  await expect(picker).toHaveCount(0);
  await expect(quick.getByRole("group", { name: "Task details" }).getByRole("button", { name: /^Due .*, change$/ })).toBeVisible();
  await quick.getByPlaceholder("What needs doing?").fill("Water the ferns");
  await quick.getByPlaceholder("What needs doing?").press("Enter");
  await expect(page.getByText(/^Task added to Inbox/)).toBeVisible();
  await expect(quick).toHaveCount(0);
  await context.close();
});

test("iPhone: a held card's finger slides onto its menu and lets go on an item to choose it, as in iOS @local", async ({ browser }, testInfo) => {
  test.setTimeout(200_000);
  const { context, page } = await iphone(browser, testInfo);
  const card = page.locator("main a[href^='/d/']").first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  const b = (await card.boundingBox())!;
  const at = { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
  // Held still (the menu opens), then the finger slides down onto "Star" and lets go there.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [at] });
  await page.waitForTimeout(700);
  const menu = page.getByRole("menu").first();
  await expect(menu).toBeVisible();
  const star = menu.getByRole("menuitem", { name: "Star" });
  const sb = (await star.boundingBox())!;
  const to = { x: Math.round(sb.x + sb.width / 2), y: Math.round(sb.y + sb.height / 2) };
  for (let i = 1; i <= 6; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: at.x + ((to.x - at.x) * i) / 6, y: at.y + ((to.y - at.y) * i) / 6 }] });
    await page.waitForTimeout(40);
  }
  // Picked out under the finger, and felt.
  await expect(star).toHaveAttribute("data-highlighted", "true");
  expect((await calls(page)).some((c) => c.method === "haptic" && c.arg === "selection")).toBe(true);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
  await expect(page.getByRole("menu")).toHaveCount(0);
  // Chosen: the note is starred (its menu now offers Unstar).
  await page.waitForTimeout(600);
  const nb = (await card.boundingBox())!;
  await card.dispatchEvent("contextmenu", { bubbles: true, cancelable: true, clientX: nb.x + nb.width / 2, clientY: nb.y + nb.height / 2 });
  await expect(page.getByRole("menu").first().getByRole("menuitem", { name: "Unstar" })).toBeVisible();
  await context.close();
});

test("iPhone: Empty Trash asks with the system's alert, once it knows how many notes go @local", async ({ browser }, testInfo) => {
  test.setTimeout(200_000);
  const { context, page } = await iphone(browser, testInfo);
  // A note to the Trash, from its card's menu.
  await page.goto("/notes");
  const card = page.locator("main a[href^='/d/']").first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  const box = (await card.boundingBox())!;
  const href = (await card.getAttribute("href"))!;
  await card.dispatchEvent("contextmenu", { bubbles: true, cancelable: true, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 });
  await page.getByRole("menu").getByRole("menuitem", { name: "Move to Trash" }).click();
  // (Gone from the list once the library has it: a page loaded before then wouldn't know yet.)
  await expect(page.locator(`main a[href='${href}']`)).toHaveCount(0);
  await page.waitForTimeout(1000);
  await page.goto("/trash");
  await expect(page.locator("main a[href^='/d/']")).toHaveCount(1, { timeout: 30_000 });
  // Its "…": Empty Trash, asked as the alert (no web dialog), with the count in its message.
  await page.evaluate(() => ((window as unknown as { __answer: unknown }).__answer = { id: "confirm" }));
  await page.getByRole("button", { name: "Trash options" }).click();
  await page.getByRole("menu").getByRole("menuitem", { name: "Empty Trash" }).click();
  await expect(page.getByText("1 document will be permanently deleted.")).toBeVisible();
  const asked = (await calls(page)).filter((c) => c.method === "alert").at(-1) as { arg: { title: string; message?: string; actions: { id: string; title: string; style?: string }[] } };
  expect(asked.arg.title).toBe("Empty Trash?");
  expect(asked.arg.message).toMatch(/^1 note will be permanently deleted/);
  expect(asked.arg.actions.find((a) => a.id === "confirm")).toMatchObject({ title: "Delete permanently", style: "destructive" });
  await expect(page.getByRole("dialog", { name: "Empty Trash?" })).toHaveCount(0);
  await context.close();
});

test("the app's menus leave out the desktop's items @local", async ({ browser }, testInfo) => {
  test.setTimeout(200_000);
  const { context, page } = await iphone(browser, testInfo);
  // The page's own menu (a press anywhere without one of its own): no Back, Forward or Reload.
  await page.locator("h1").first().dispatchEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 100, clientY: 140 });
  const menu = page.getByRole("menu", { name: "Folevi" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "New note" })).toBeVisible();
  for (const name of ["Back", "Forward", "Reload"]) await expect(menu.getByRole("menuitem", { name, exact: true })).toHaveCount(0);
  // And no separator left dangling at its end.
  expect(await menu.evaluate((m) => m.lastElementChild?.getAttribute("role"))).not.toBe("separator");
  await context.close();
});

// Pictures of every piece, light and dark, when WP3_SHOTS names a folder (docs/IOS_POLISH_PLAN.md: before and after).
test("pictures: menus, sheets and dialogs @local", async ({ browser }, testInfo) => {
  const dir = process.env.WP3_SHOTS;
  test.skip(!dir, "Set WP3_SHOTS to a folder to take the pictures.");
  test.setTimeout(300_000);
  const { context, page } = await iphone(browser, testInfo);
  const shot = async (name: string) => {
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${dir}/${name}-${scheme}.png` });
    }
    await page.emulateMedia({ colorScheme: "light" });
  };
  const escape = async () => {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
  };
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForTimeout(700);
  await shot("create-menu");
  await escape();
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.waitForTimeout(700);
  await shot("more-menu");
  await escape();
  // A held note card: its menu beside it.
  const card = page.locator("main a[href^='/d/']").first();
  const box = (await card.boundingBox())!;
  await card.dispatchEvent("contextmenu", { bubbles: true, cancelable: true, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 });
  await page.waitForTimeout(700);
  await shot("note-card-menu");
  await escape();
  await page.locator("button[aria-label$='account and places']").first().click();
  await page.waitForTimeout(1000);
  await shot("account-sheet");
  await escape();
  await page.getByRole("button", { name: "Create" }).click();
  await page.getByRole("menu", { name: "Create" }).getByRole("menuitem", { name: "New folder" }).click();
  await page.waitForTimeout(800);
  await shot("new-folder-card");
  await escape();
  await page.goto("/tasks/today");
  await page.getByRole("button", { name: "Quick task" }).click();
  await page.waitForTimeout(900);
  await page.getByPlaceholder("What needs doing?").fill("Call Sam tomorrow 3pm");
  await shot("quick-add");
  await page.getByRole("button", { name: /^Priority/ }).click();
  await page.waitForTimeout(700);
  await shot("quick-add-priority");
  await context.close();

  // The iPad (its own layout): the same iOS menus under a finger.
  const ipad = await browser.newContext({ viewport: { width: 1032, height: 1376 }, userAgent: IPHONE_UA.replace("iPhone; CPU iPhone OS", "iPad; CPU OS"), hasTouch: true, isMobile: true });
  await prepareContext(ipad, testInfo, { libraryName: `ipad-sheets-${Date.now()}`, platform: "ios" });
  await ipad.addInitScript(fakeBridge);
  const pad = await ipad.newPage();
  await pad.goto("/documents");
  await pad.waitForTimeout(6000);
  const trigger = pad.locator('button[aria-haspopup="menu"]').filter({ visible: true }).first();
  await trigger.click();
  await pad.waitForTimeout(800);
  for (const scheme of ["light", "dark"] as const) {
    await pad.emulateMedia({ colorScheme: scheme });
    await pad.waitForTimeout(500);
    await pad.screenshot({ path: `${dir}/ipad-menu-${scheme}.png` });
  }
  await ipad.close();
});
