// The iPhone app's Foli AI sheet, frame by frame (CPU slowed 4x): it slides up from the bottom on its first
// frame (never drawn at the top first), the composer rides up on the keyboard in one move and stays right on the
// keyboard's top (also when the app's web view shrinks for the keyboard a moment later, as Capacitor does), the
// answer's text shows while it streams, the title never runs under the header's buttons, it stays at its large
// detent when the keyboard goes, a drag takes it down to medium, and it slides away when closed. The model is the
// FakeShell's scripted one (local mode, nothing sent anywhere), streaming a long answer in pieces over ~2 s.
// Strips of frames go to $FOLEVI_SHOTS when it's set.
//   E2E_LOCAL_BASE_URL=http://localhost:3003 E2E_BASE_URL=http://app.localhost:3002 E2E_NO_SERVER=1 \
//     npx playwright test e2e/iphone-ai-sheet.spec.ts --project local --workers=1
import type { Browser, Page, TestInfo } from "@playwright/test";
import { expect, prepareContext, test } from "./fixtures/localShell";
import { cameInFromBelow, installFrameProbe, record, saveFrames, saveStrip, turnsBack, type Recording } from "./sheetFrames";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FoleviiOS/1.0";
const SHOTS = process.env.FOLEVI_SHOTS;
const ANSWER = [
  "This week you are working on three things. First, the ClimbOS product notes: fifty issues written up as requirements, with the customer acquisition framework beside them [1].",
  "Second, the Airly Studio website: layout ideas for the hero, the chat bubbles and the pricing table, with a note to try a darker header and to test the page on a small phone before it goes out.",
  "Third, getting the apps ready for the App Store. The build is archived, the screenshots are half done, and the privacy answers still need a last read. The release notes are drafted in your Inbox.",
  "Of these, the App Store work has a date on it: Friday. The website has none yet, so it may be the one to move to next week if the week fills up.",
  "Two of your tasks are overdue: answering the support request about invoices, and sending the signed agreement back. Both are small, so they could go first tomorrow morning.",
  "Last, the signing and the profiles still to finish.",
].join("\n\n");

/** The app's bridge, with the keyboard's news sent by `window.__native.keyboard(height)`. */
function fakeBridge() {
  const keyboard: ((f: { height: number; duration: number; curve: string; visible: boolean }) => void)[] = [];
  const bridge = {
    platform: "ios",
    version: "1.0",
    haptic: () => undefined,
    hapticPrepare: () => undefined,
    setStatusBar: () => undefined,
    openExternal: async () => true,
    getSettings: async () => ({ lock: false, lockAfter: 0, method: "faceID" }),
    setSettings: async () => ({ lock: false, lockAfter: 0, method: "faceID" }),
    onCommand: () => () => undefined,
    keyboard: () => undefined,
    onKeyboard: (cb: (f: { height: number; duration: number; curve: string; visible: boolean }) => void) => {
      keyboard.push(cb);
      return () => keyboard.splice(keyboard.indexOf(cb), 1);
    },
  };
  Object.defineProperty(window, "foleviNative", { value: bridge });
  Object.assign(window, {
    __native: {
      keyboard: (height: number) => {
        window.dispatchEvent(new Event(height ? "keyboardWillShow" : "keyboardWillHide"));
        for (const cb of keyboard) cb({ height, duration: 250, curve: "keyboard", visible: height > 0 });
      },
    },
  });
  const mark = () => document.documentElement?.setAttribute("data-native", "ios");
  mark();
  if (!document.documentElement) new MutationObserver((_, watch) => document.documentElement && (mark(), watch.disconnect())).observe(document, { childList: true });
  const hideBadge = () => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal { display: none !important; }";
    document.head.appendChild(style);
  };
  if (document.head) hideBadge();
  else document.addEventListener("DOMContentLoaded", hideBadge, { once: true });
}

let n = 0;
async function iphone(browser: Browser, testInfo: TestInfo, viewport = { width: 440, height: 956 }) {
  const context = await browser.newContext({ viewport, userAgent: IPHONE_UA, hasTouch: true, isMobile: true });
  await prepareContext(context, testInfo, { libraryName: `iphone-ai-sheet-${Date.now()}-${n++}`, platform: "ios", ai: { onDevice: true, answer: ANSWER, pieceMs: 28 } });
  await context.addInitScript(fakeBridge);
  await context.addInitScript(installFrameProbe);
  const page = await context.newPage();
  await page.goto("/documents");
  await expect(page.locator("html")).toHaveAttribute("data-iphone", "", { timeout: 60_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible({ timeout: 60_000 });
  return { context, page };
}

/** The keyboard as the app has it: its news first, then (as Capacitor does) the web view shrinks once it's up. */
async function keyboard(page: Page, up: boolean, full: { width: number; height: number }) {
  const kb = keyboardOn(full);
  await page.evaluate((h) => (window as unknown as { __native: { keyboard: (h: number) => void } }).__native.keyboard(h), up ? kb : 0);
  await page.waitForTimeout(up ? 450 : 10);
  await page.setViewportSize(up ? { width: full.width, height: full.height - kb } : full);
}
/** The keyboard's height on that screen (an iPhone 16 Pro Max's, an iPhone SE's). */
const keyboardOn = (full: { height: number }) => (full.height > 800 ? 336 : 260);

const PROBE = { panel: '[data-iphone-sheet="sheet"]', dock: "[data-iphone-sheet] [data-sheet-dock]", title: "[data-iphone-sheet] header h2", answer: "[data-iphone-sheet] .fb-ai-answer" };

async function keepAs(browser: Browser, rec: Recording, name: string) {
  if (!SHOTS) return;
  await saveStrip(browser, rec, `${SHOTS}/${name}.png`);
  saveFrames(rec, `${SHOTS}/${name}.json`);
}

for (const full of [
  { width: 440, height: 956, name: "pro-max" },
  { width: 375, height: 667, name: "se" },
]) test(`iPhone (${full.width}x${full.height}): the Foli AI sheet slides in, rides the keyboard, streams its answer and slides away @local`, async ({ browser, browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "Frames and touch go through Chromium's DevTools protocol.");
  test.setTimeout(240_000);
  const KEYBOARD = keyboardOn(full);
  const keep = (browser: Browser, rec: Recording, name: string) => keepAs(browser, rec, `${full.name}-${name}`);
  const { context, page } = await iphone(browser, testInfo, { width: full.width, height: full.height });
  const sheet = page.locator('[data-iphone-sheet="sheet"]');

  // Open: the frame is there at once, and it comes up from the bottom of the screen.
  let rec = await record(page, PROBE);
  const tapped = Date.now();
  await page.getByRole("group", { name: "Create" }).getByRole("button", { name: "Foli AI" }).tap();
  await expect(sheet).toBeVisible();
  const shownAfter = Date.now() - tapped;
  await page.waitForTimeout(1200);
  let r = await rec.stop();
  await keep(browser, r, "ai-1-open");
  expect(cameInFromBelow(r.frames, "panel", full.height)).toEqual([]);
  // (A generous bound: the 4x slowed CPU and the test's own round trips are in it.)
  expect(shownAfter).toBeLessThan(1500);
  await expect(sheet.getByRole("heading", { name: "New chat" })).toBeVisible();

  // Focus the composer: one move up with the keyboard, the composer ending right on the keyboard's top, and
  // staying there when the web view shrinks.
  const box = sheet.getByRole("textbox");
  rec = await record(page, PROBE);
  await box.tap();
  await keyboard(page, true, { width: full.width, height: full.height });
  await page.waitForTimeout(600);
  r = await rec.stop();
  await keep(browser, r, "ai-2-keyboard");
  const last = r.frames[r.frames.length - 1]!;
  expect(Math.abs(last.boxes.dock!.bottom - (full.height - KEYBOARD))).toBeLessThanOrEqual(2);
  // The composer is never covered by the keyboard once it has landed (250 ms), and nothing jumps.
  for (const f of r.frames.filter((f) => f.t > 400)) expect(f.boxes.dock!.bottom).toBeLessThanOrEqual(full.height - KEYBOARD + 2);
  expect(turnsBack(r.frames, "dock", "bottom")).toEqual([]);
  expect(turnsBack(r.frames, "panel", "top")).toEqual([]);
  // Once it has landed nothing moves (the web view shrinking 450 ms in included).
  const landed = r.frames.filter((f) => f.t > 450).map((f) => [f.boxes.panel!.top, f.boxes.dock!.bottom].join());
  expect(new Set(landed).size).toBe(1);
  const largeTop = last.boxes.panel!.top;
  expect(largeTop).toBeLessThan(80);

  // Send a question: the keyboard goes, the sheet stays large, the answer's text shows as it streams.
  rec = await record(page, PROBE, 1);
  await box.fill("What am I working on this week?");
  await sheet.getByRole("button", { name: "Ask", exact: true }).tap();
  await keyboard(page, false, { width: full.width, height: full.height });
  await expect(sheet.getByText("This week you are working on three things", { exact: false })).toBeVisible({ timeout: 30_000 });
  await expect(sheet.getByText("the signing and the profiles still to finish", { exact: false })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(400);
  r = await rec.stop();
  await keep(browser, r, "ai-3-answer");
  const streamed = r.frames.filter((f) => (f.answer ?? 0) > 0);
  // Text was on screen while it was still coming (more than a handful of frames with partial text).
  const lengths = new Set(streamed.map((f) => f.answer));
  expect(lengths.size).toBeGreaterThan(4);
  // It only grows: it never blinks out and types itself again when the stream hands over to the saved answer.
  for (let i = 1; i < streamed.length; i++) expect(streamed[i]!.answer!).toBeGreaterThanOrEqual(streamed[i - 1]!.answer! - 6);
  // And the newest words stay in view above the composer as they come (the thread follows the stream).
  for (const f of streamed.slice(0, -1)) if (f.boxes.answer && f.boxes.dock) expect(f.boxes.answer.bottom).toBeLessThanOrEqual(f.boxes.dock.top + 40);
  expect(Math.max(...r.frames.map((f) => f.overlap ?? 0))).toBe(0);
  const after = r.frames[r.frames.length - 1]!;
  expect(Math.abs(after.boxes.panel!.top - largeTop)).toBeLessThanOrEqual(2);
  expect(after.boxes.dock!.bottom).toBeGreaterThan(full.height - 60);
  // The title is the question, cut short, clear of the buttons.
  await expect(sheet.locator("header h2")).not.toHaveText("New chat");

  // A drag on the header takes it down to medium.
  const header = await sheet.locator("header").boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const x = header!.x + header!.width / 2;
  let y = header!.y + 20;
  rec = await record(page, PROBE, 1);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 0; i < 6; i++) {
    y += 40;
    await page.waitForTimeout(30);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
  await page.waitForTimeout(900);
  r = await rec.stop();
  await keep(browser, r, "ai-4-drag");
  const medium = r.frames[r.frames.length - 1]!.boxes.panel!;
  expect(medium.top).toBeGreaterThan(full.height * 0.35);
  // (Following the finger, then settling on the spring: a spring may pass its rest by a few points.)
  expect(turnsBack(r.frames, "panel", "top", 16)).toEqual([]);

  // Close: down and away, every frame lower than the one before.
  rec = await record(page, PROBE);
  await sheet.getByRole("button", { name: "Close" }).tap();
  await expect(sheet).toHaveCount(0);
  await page.waitForTimeout(200);
  r = await rec.stop();
  await keep(browser, r, "ai-5-close");
  const tops = r.frames.filter((f) => f.boxes.panel).map((f) => f.boxes.panel!.top);
  for (let i = 1; i < tops.length; i++) expect(tops[i]!).toBeGreaterThanOrEqual(tops[i - 1]! - 2);
  await context.close();
});

const IPAD_UA = "Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FoleviiOS/1.0";

for (const size of [
  { width: 1180, height: 820, keyboard: 398, name: "landscape" },
  { width: 820, height: 1180, keyboard: 314, name: "portrait" },
]) test(`iPad (${size.name}): the floating Foli AI chat appears in place and its composer rides the keyboard @local`, async ({ browser, browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "Frames go through Chromium's DevTools protocol.");
  test.setTimeout(180_000);
  const full = { width: size.width, height: size.height };
  const context = await browser.newContext({ viewport: full, userAgent: IPAD_UA, hasTouch: true });
  await prepareContext(context, testInfo, { libraryName: `ipad-ai-${Date.now()}-${n++}`, platform: "ios", ai: { onDevice: true, answer: ANSWER, pieceMs: 28 } });
  await context.addInitScript(fakeBridge);
  await context.addInitScript(installFrameProbe);
  const page = await context.newPage();
  await page.goto("/documents");
  await expect(page.locator("html")).toHaveAttribute("data-ipad", "", { timeout: 60_000 });
  const probe = { panel: ".ai-chat .ui-fab-panel", dock: ".ai-chat [data-sheet-dock]" };
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    let rec = await record(page, probe);
    await page.getByRole("button", { name: "Foli AI", exact: true }).first().tap();
    await expect(page.locator(".ai-chat .ui-fab-panel")).toBeVisible();
    await page.waitForTimeout(600);
    let r = await rec.stop();
    await keepAs(browser, r, `ipad-${size.name}-${scheme}-open`);
    // In place from its first frame (it rises a few points as it fades in, no more).
    const tops = r.frames.filter((f) => f.boxes.panel).map((f) => f.boxes.panel!.top);
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(14);

    // The software keyboard: the composer goes up with it, lands on it, and stays when the web view shrinks.
    rec = await record(page, probe);
    await page.locator(".ai-chat textarea").tap();
    await page.evaluate((h) => (window as unknown as { __native: { keyboard: (h: number) => void } }).__native.keyboard(h), size.keyboard);
    await page.waitForTimeout(450);
    const before = await page.locator(".ai-chat [data-sheet-dock]").boundingBox();
    await page.setViewportSize({ width: full.width, height: full.height - size.keyboard });
    await page.waitForTimeout(500);
    r = await rec.stop();
    await keepAs(browser, r, `ipad-${size.name}-${scheme}-keyboard`);
    const after = await page.locator(".ai-chat [data-sheet-dock]").boundingBox();
    expect(before!.y + before!.height).toBeLessThanOrEqual(full.height - size.keyboard);
    expect(Math.abs(after!.y + after!.height - (before!.y + before!.height))).toBeLessThanOrEqual(2);
    expect(turnsBack(r.frames, "dock", "bottom")).toEqual([]);
    // The chat itself stays put (only shorter): its top never jumps.
    expect(turnsBack(r.frames, "panel", "top")).toEqual([]);
    const panelTops = r.frames.filter((f) => f.boxes.panel).map((f) => f.boxes.panel!.top);
    expect(Math.max(...panelTops) - Math.min(...panelTops)).toBeLessThanOrEqual(size.height > 1000 ? 2 : 200);
    // Away again (a hardware keyboard sends no height: nothing moves then).
    await page.evaluate(() => (window as unknown as { __native: { keyboard: (h: number) => void } }).__native.keyboard(0));
    await page.waitForTimeout(20);
    await page.setViewportSize(full);
    await page.waitForTimeout(400);
    const down = await page.locator(".ai-chat [data-sheet-dock]").boundingBox();
    expect(down!.y + down!.height).toBeGreaterThan(full.height - 80);
    await page.getByRole("button", { name: "Close chat" }).click();
    await page.waitForTimeout(300);
  }
  await context.close();
});
