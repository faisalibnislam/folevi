// The iPhone layout lets go of a note once it's closed (the iOS review, 2026-11-24: about 5 MB kept per note
// opened, in WebKit only). Run in WebKit, whose JavaScriptCore kept them, against the shell's dev server:
//   E2E_LOCAL_BASE_URL=http://localhost:3003 E2E_BASE_URL=http://app.localhost:3002 E2E_NO_SERVER=1 \
//     npx playwright test e2e/iphone-note-memory.spec.ts --project mac-webkit
// (Chromium let them go all along, so the local project's run proves little.) Each closed note's editor is held
// only by a WeakRef from the page; after the page allocates enough for full collections, none may be left.
// The editor is found from inside the page, never through a locator: Playwright marks what a locator touches,
// and that mark would keep it alive.
import { expect, prepareContext, test } from "./fixtures/localShell";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FoleviiOS/2.0";

type Probe = { __refs: WeakRef<Element>[]; __sentinel: WeakRef<object> };

test("the iPhone layout lets go of a closed note", { tag: ["@local", "@mac"] }, async ({ browser, browserName }, testInfo) => {
  // A local library (the local and mac-webkit projects, never the account one), and only WebKit's answer counts.
  test.skip(browserName !== "webkit", "JavaScriptCore is what kept the notes; Chromium's collector timing proves nothing here");
  test.setTimeout(300_000);
  const context = await browser.newContext({ viewport: { width: 402, height: 874 }, hasTouch: true, userAgent: IPHONE_UA });
  await prepareContext(context, testInfo, { initialMode: "local", configured: true, platform: "ios", libraryName: `note-memory-${Date.now()}` });
  await context.addInitScript(() => {
    const bridge = { platform: "ios", version: "2.0", haptic: () => undefined, hapticPrepare: () => undefined, setStatusBar: () => undefined, openExternal: async () => true, getSettings: async () => ({}), setSettings: async () => ({}), onCommand: () => () => undefined };
    Object.defineProperty(window, "foleviNative", { value: bridge, configurable: true });
    (window as unknown as Probe).__refs = [];
  });
  const page = await context.newPage();
  await page.goto("/documents");
  const card = page.locator("a[href^='/d/']").filter({ hasText: /Welcome/ }).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  for (let i = 0; i < 5; i++) {
    await card.click();
    await page.waitForFunction(() => Boolean(document.querySelector(".ProseMirror")), undefined, { timeout: 20_000 });
    await page.waitForTimeout(1200);
    await page.evaluate(() => (window as unknown as Probe).__refs.push(new WeakRef(document.querySelector(".ProseMirror")!)));
    await page.getByRole("button", { name: "Back", exact: true }).first().click();
    await expect(card).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1200);
  }
  // Six rounds of allocating and dropping a lot, so JavaScriptCore runs full collections (a young sentinel
  // alone can go in a quick young-generation one, before the old notes are looked at); the sentinel, which only a
  // WeakRef reaches, then shows a collection did run.
  await page.evaluate(() => ((window as unknown as Probe).__sentinel = new WeakRef({ big: new Array(1000).fill(1) })));
  for (let k = 0; k < 6; k++) {
    await page.evaluate(() => {
      let junk: unknown[] = [];
      for (let i = 0; i < 40; i++) junk.push(new Array(500_000).fill(i));
      junk = [];
      return junk.length;
    });
    await page.waitForTimeout(700);
  }
  expect(await page.evaluate(() => !(window as unknown as Probe).__sentinel.deref()), "a collection ran").toBe(true);
  const kept = await page.evaluate(() => (window as unknown as Probe).__refs.filter((r) => r.deref()).length);
  expect(kept, "closed notes' editors still reachable").toBe(0);
  await context.close();
});
