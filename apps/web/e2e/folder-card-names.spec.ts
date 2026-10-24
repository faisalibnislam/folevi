// Folder card names (components/views/FolderCardArt.tsx): they wrap only between words, up to two lines, and
// end in "…" past that. A single word wider than the card stays on one line and ends in "…" ("Brainstorm…"),
// never split as "Brainstormin" / "g". Checked on the iPhone app's Home row, the iPad app and the desktop /
// Mac width Folders page, light and dark. FOLEVI_SHOTS=<dir> saves a picture of each.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { APP, newPerson, showFolders } from "./helpers";

const SHOTS = process.env.FOLEVI_SHOTS;
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FoleviiOS/1.0";
const IPAD_UA = "Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FoleviiOS/1.0";
const NAMES = ["Brainstorming", "Space Cherries LLC", "Supercalifragilisticexpialidocious", "Quarterly planning and roadmap review for the whole team", "Ideas"];

/** What the iOS app gives the page before its first script (as iphone-app.spec.ts does). */
function fakeBridge() {
  const bridge = {
    platform: "ios",
    version: "1.0",
    haptic: () => undefined,
    setStatusBar: () => undefined,
    openExternal: async () => true,
    getSettings: async () => ({ lock: false, lockAfter: 0, method: "faceID" }),
    setSettings: async () => ({ lock: false, lockAfter: 0, method: "faceID" }),
    onCommand: () => () => undefined,
  };
  Object.defineProperty(window, "foleviNative", { value: bridge });
  const mark = () => document.documentElement?.setAttribute("data-native", "ios");
  mark();
  const hideBadge = () => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal { display: none !important; }";
    document.head.appendChild(style);
  };
  if (document.head) hideBadge();
  else document.addEventListener("DOMContentLoaded", hideBadge, { once: true });
  if (!document.documentElement) new MutationObserver((_, watch) => document.documentElement && (mark(), watch.disconnect())).observe(document, { childList: true });
}

type NameCheck = { name: string; overflowWrap: string; wordBreak: string; textOverflow: string; overflow: string; lines: number; inside: boolean; splitWords: string[] };

/** Measures every folder card name on the page: how it wraps, how many lines show, and whether any word spans two lines. */
function measure(page: Page): Promise<NameCheck[]> {
  return page.locator('[data-fc="name"]').evaluateAll((els) =>
    els.map((el) => {
      const cs = getComputedStyle(el);
      const card = el.closest("[data-drop-folder]")!.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      const text = el.firstChild as Text;
      const splitWords: string[] = [];
      for (const m of (text.data ?? "").matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(text, m.index!);
        range.setEnd(text, m.index! + m[0].length);
        const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
        if (tops.size > 1) splitWords.push(m[0]);
      }
      return {
        name: text.data,
        overflowWrap: cs.overflowWrap,
        wordBreak: cs.wordBreak,
        textOverflow: cs.textOverflow,
        overflow: cs.overflow,
        lines: Math.round(el.clientHeight / parseFloat(cs.lineHeight)),
        inside: box.left >= card.left - 0.5 && box.right <= card.right + 0.5 && box.top >= card.top - 0.5 && box.bottom <= card.bottom + 0.5,
        splitWords,
      };
    }),
  );
}

/** Every folder card name on the page is tidy; `names` (the ones made here that this page shows) are all there. */
async function expectTidyNames(page: Page, names: string[]) {
  const cards = page.locator('[data-fc="name"]');
  await expect(cards.first()).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  // A long list draws only the cards near the view: step through it top to bottom, measuring what's drawn at each
  // step (the account also starts with a couple of folders of its own).
  const scroller = async (top: number | null) =>
    cards.first().evaluate((el, to) => {
      let cur: HTMLElement | null = el.parentElement;
      while (cur && !(/(auto|scroll)/.test(getComputedStyle(cur).overflowY) && cur.scrollHeight > cur.clientHeight)) cur = cur.parentElement;
      const view = cur ?? document.scrollingElement!;
      if (to !== null) view.scrollTop = to;
      return { top: view.scrollTop, height: view.clientHeight, full: view.scrollHeight };
    }, top);
  const seen = new Map<string, NameCheck>();
  for (let at = 0, i = 0; i < 30; i++) {
    const view = await scroller(at);
    await page.waitForTimeout(250);
    for (const c of await measure(page)) seen.set(c.name, c);
    if (names.every((n) => seen.has(n)) || view.top + view.height >= view.full - 1) break;
    at = view.top + view.height / 2;
  }
  await scroller(0);
  expect([...seen.keys()]).toEqual(expect.arrayContaining(names));
  for (const c of seen.values()) {
    expect(c, c.name).toMatchObject({ overflowWrap: "normal", wordBreak: "normal", textOverflow: "ellipsis", overflow: "hidden", inside: true, splitWords: [] });
    expect(c.lines, c.name).toBeLessThanOrEqual(2);
  }
  // Single-word names keep one line (ending in "…" when too wide); the long sentence uses two.
  for (const n of names.filter((n) => !n.includes(" "))) expect(seen.get(n)?.lines, n).toBe(1);
  if (names.includes(NAMES[3]!)) expect(seen.get(NAMES[3]!)?.lines).toBe(2);
}

async function shoot(browser: Browser, state: Awaited<ReturnType<import("@playwright/test").BrowserContext["storageState"]>>, kind: "iphone" | "ipad" | "desktop", scheme: "light" | "dark") {
  const opts =
    kind === "iphone" ? { viewport: { width: 402, height: 874 }, userAgent: IPHONE_UA, hasTouch: true } :
    kind === "ipad" ? { viewport: { width: 1180, height: 820 }, userAgent: IPAD_UA, hasTouch: true } :
    { viewport: { width: 1440, height: 900 } };
  const context = await browser.newContext({ storageState: state, colorScheme: scheme, ...opts });
  if (kind !== "desktop") await context.addInitScript(fakeBridge);
  const page = await context.newPage();
  if (kind === "iphone") {
    // Home's Folders row: the first few top-level folders (the account's own two, then the first three made here).
    await page.goto(`${APP}/documents`);
    await expect(page.locator("html")).toHaveAttribute("data-iphone", "", { timeout: 30_000 });
    await expectTidyNames(page, NAMES.slice(0, 3));
    if (SHOTS) {
      const row = page.getByRole("list", { name: "Folders" });
      await row.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SHOTS}/folder-names-iphone-home-${scheme}.png` });
      await row.evaluate((el) => el.scrollBy({ left: 300 }));
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SHOTS}/folder-names-iphone-home-${scheme}-scrolled.png` });
    }
  }
  // The Folders page: every folder.
  await page.goto(`${APP}/folders`);
  await expectTidyNames(page, NAMES);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/folder-names-${kind}-folders-${scheme}.png`, fullPage: kind === "iphone" });
  await context.close();
}

test("folder card names wrap between words, at most two lines, and end in … instead of splitting a word", async ({ browser }) => {
  test.setTimeout(240_000);
  const { context, page } = await newPerson(browser, "Long Names");
  await showFolders(page);
  for (const name of NAMES) {
    await page.getByRole("button", { name: "New folder" }).first().click();
    await page.getByLabel("Folder name").fill(name);
    await page.getByRole("button", { name: "Create folder" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  // All of them saved on the server before this window closes (the page shows a new folder before it is): a
  // second window sees them.
  const state = await context.storageState();
  const check = await browser.newContext({ storageState: state });
  const other = await check.newPage();
  await expect(async () => {
    await other.goto(`${APP}/folders`);
    for (const name of NAMES) await expect(other.getByRole("link", { name: new RegExp(`^${name}, `) })).toHaveCount(1, { timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
  await check.close();
  await context.close();
  for (const kind of ["iphone", "ipad", "desktop"] as const) for (const scheme of ["light", "dark"] as const) await shoot(browser, state, kind, scheme);
});
