import type { Browser, BrowserContextOptions, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { createAccount, completeOnboarding } from "./helpers";

// The note's Foli AI panel (the right sidebar, opened from the page tools): in Ask, the chat fills the
// panel's height, its composer and footnote sit at the bottom with the usual small inset (no empty band under
// them), and the messages scroll above. On the website, in the Mac app (<html data-desktop="mac">) and on iPad
// (<html data-native="ios">), light and dark. No model call: without a key the reply is the "isn't set up"
// notice, and the test only needs the question in the thread.
// Screenshots go to $FOLEVI_SHOTS when it is set.

const INSET = 24;

function macMark() {
  const mark = () => document.documentElement?.setAttribute("data-desktop", "mac");
  mark();
  document.addEventListener("DOMContentLoaded", mark);
}

function iosMark() {
  Object.defineProperty(window, "foleviNative", {
    value: { platform: "ios", version: "1.0", haptic: () => {}, setStatusBar: () => {}, openExternal: async () => true, getSettings: async () => ({ lock: false, lockAfter: 0, method: "faceID" }), setSettings: async (p: unknown) => p, onCommand: () => () => {} },
  });
  const mark = () => document.documentElement?.setAttribute("data-native", "ios");
  mark();
  if (!document.documentElement) new MutationObserver((_, watch) => document.documentElement && (mark(), watch.disconnect())).observe(document, { childList: true });
}

async function openAsk(browser: Browser, options: BrowserContextOptions, init?: () => void) {
  const context = await browser.newContext(options);
  if (init) await context.addInitScript(init);
  const { page } = await createAccount(context, { name: "Panel Person" });
  await completeOnboarding(page);
  await page.getByRole("toolbar", { name: "Page tools" }).getByRole("button", { name: "Foli AI", exact: true }).click();
  const panel = page.locator("#document-inspector");
  await panel.getByRole("group", { name: "What Foli AI should do" }).getByRole("button", { name: "Ask" }).click();
  await expect(panel.getByRole("textbox", { name: /Ask about your notes/ })).toBeVisible();
  return { context, page, panel };
}

/** Distance from the bottom of the composer's footnote to the bottom of the panel column. */
async function bottomGap(page: Page) {
  return page.evaluate(() => {
    const column = document.getElementById("document-inspector")!;
    const notes = [...column.querySelectorAll("p")].filter((p) => p.textContent?.startsWith("Foli AI can make mistakes."));
    const foot = notes[notes.length - 1]!;
    return Math.round(column.getBoundingClientRect().bottom - foot.getBoundingClientRect().bottom);
  });
}

async function shot(page: Page, name: string) {
  const dir = process.env.FOLEVI_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}

const CASES: { name: string; options: BrowserContextOptions; init?: () => void }[] = [
  { name: "web-light", options: { viewport: { width: 1440, height: 900 }, colorScheme: "light" } },
  { name: "web-dark-tall", options: { viewport: { width: 1600, height: 1100 }, colorScheme: "dark" } },
  { name: "mac-light", options: { viewport: { width: 1440, height: 900 }, colorScheme: "light" }, init: macMark },
  { name: "mac-dark", options: { viewport: { width: 1440, height: 900 }, colorScheme: "dark" }, init: macMark },
  { name: "ipad-light", options: { viewport: { width: 1180, height: 820 }, colorScheme: "light", hasTouch: true }, init: iosMark },
];

for (const c of CASES) {
  test(`Foli AI panel in Ask fills the panel to its bottom (${c.name})`, async ({ browser }) => {
    test.setTimeout(120_000);
    const { context, page, panel } = await openAsk(browser, c.options, c.init);
    // Empty: the composer is at the bottom already.
    await expect.poll(() => bottomGap(page)).toBeLessThanOrEqual(INSET);
    expect(await bottomGap(page)).toBeGreaterThanOrEqual(0);
    await shot(page, `${c.name}-empty`);
    // A conversation: the question shows, the composer stays at the bottom.
    const box = panel.getByRole("textbox", { name: /Ask about your notes/ });
    await box.fill("Tidy up the headings");
    await box.press("Enter");
    await expect(panel.getByText("Tidy up the headings").first()).toBeVisible({ timeout: 20_000 });
    await expect(panel.getByText(/isn.t set up|couldn.t|try again|ran into/i).first()).toBeVisible({ timeout: 30_000 });
    expect(await bottomGap(page)).toBeLessThanOrEqual(INSET);
    expect(await bottomGap(page)).toBeGreaterThanOrEqual(0);
    await shot(page, `${c.name}-thread`);
    await context.close();
  });
}

// A narrow window: the tools are a pop-up above the bar, as tall as it always was, with the composer in it.
test("in a narrow window the Foli AI pop-up keeps its composer inside", async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page } = await openAsk(browser, { viewport: { width: 760, height: 900 } });
  const gap = await bottomGap(page);
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThanOrEqual(INSET);
  await shot(page, "narrow-light-empty");
  await context.close();
});

// A long conversation scrolls inside the thread while the composer stays put at the bottom.
test("a long Foli AI conversation scrolls above the pinned composer", async ({ browser }) => {
  test.setTimeout(180_000);
  const { context, page, panel } = await openAsk(browser, { viewport: { width: 1440, height: 900 } }, macMark);
  const box = panel.getByRole("textbox", { name: /Ask about your notes/ });
  for (let i = 1; i <= 5; i++) {
    await box.fill(`Question number ${i}: ${"what does this note say about the plan? ".repeat(4)}`);
    await box.press("Enter");
    await expect(panel.getByText(`Question number ${i}:`).first()).toBeVisible({ timeout: 20_000 });
    await expect(box).toBeEnabled({ timeout: 30_000 });
    await expect.poll(() => page.evaluate(() => !document.querySelector("#document-inspector [aria-busy='true']"))).toBe(true);
  }
  expect(await bottomGap(page)).toBeLessThanOrEqual(INSET);
  // The panel column itself doesn't scroll: the thread does.
  const scrolls = await page.evaluate(() => {
    const region = document.querySelector<HTMLElement>("#document-inspector [role='region'], #document-inspector [role='tabpanel']")!;
    return region.scrollHeight - region.clientHeight;
  });
  expect(scrolls).toBeLessThanOrEqual(1);
  await shot(page, "mac-light-long");
  await context.close();
});
