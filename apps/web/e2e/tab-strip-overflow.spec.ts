import { expect, test, type Page } from "@playwright/test";
import { newPerson } from "./helpers";

// The tab strip with more tabs than fit (TabStrip.tsx): the open tab is always in the strip, selected and fully
// visible (clear of the soft edges), whenever it changes: a new note, a click, ⌃Tab in the Mac app, Back and
// Forward, closing tabs. Tabs shrink to their minimum width before the strip scrolls. At a desktop size and an
// iPad size, light and dark.

const strip = (page: Page) => page.getByRole("navigation", { name: "Open pages" });

/** Where the open tab sits in the strip: its box against the strip's visible box, its width and its name. */
async function current(page: Page) {
  return page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>('nav[aria-label="Open pages"]');
    if (!nav) return null;
    const link = nav.querySelector<HTMLElement>('[aria-current="page"]');
    if (!link) return null;
    const tab = link.closest<HTMLElement>("[data-tab]") ?? link;
    const box = nav.getBoundingClientRect();
    const r = tab.getBoundingClientRect();
    const name = link.getAttribute("aria-label") ?? link.textContent?.trim() ?? "";
    const title = link.querySelector<HTMLElement>(".truncate");
    const truncated = title ? title.scrollWidth > title.clientWidth + 0.5 : false;
    return { name, inside: r.left >= box.left - 0.5 && r.right <= box.right + 0.5, clearOfEdges: r.left >= box.left + 20 || nav.scrollLeft < 1, clearOfEnd: r.right <= box.right - 20 || nav.scrollLeft + nav.clientWidth >= nav.scrollWidth - 1, width: r.width, truncated, current: link.getAttribute("aria-current") };
  });
}

/** Waits for the strip to settle (a smooth scroll) with the open tab named `name` fully in view. */
async function expectInView(page: Page, name: string | RegExp, what: string) {
  await expect
    .poll(async () => {
      const c = await current(page);
      if (!c) return "no open tab";
      const named = typeof name === "string" ? c.name === name : name.test(c.name);
      if (!named) return `open tab is ${c.name}`;
      if (!c.inside) return "cut off";
      if (!c.clearOfEdges || !c.clearOfEnd) return "under the edge fade";
      return "ok";
    }, { message: what, timeout: 10_000 })
    .toBe("ok");
}

/** Scrolls the strip all the way with its arrows (each press glides, so wait for one to settle). */
async function scrollStrip(page: Page, dir: "left" | "right") {
  const arrow = page.getByRole("button", { name: `Scroll tabs ${dir}` });
  for (let i = 0; i < 12 && (await arrow.isEnabled()); i++) {
    await arrow.click({ timeout: 2_000 }).catch(() => undefined);
    await page.waitForTimeout(450);
  }
  await expect(arrow).toBeDisabled();
}

async function newNote(page: Page, title: string) {
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  const field = page.getByRole("textbox", { name: "Title" });
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("");
  // The new note's tab is there at once, selected and in view, before it has a name.
  await expectInView(page, "Untitled", `new note before ${title}`);
  await field.pressSequentially(title, { delay: 10 });
  // ...and takes the name as it's typed.
  await expectInView(page, title, `new note ${title}`);
}

test("the open tab is always fully in the strip: new notes, clicks, ⌃Tab, Back and Forward, closing; desktop and iPad, light and dark", async ({ browser }) => {
  test.setTimeout(420_000);
  const { context, page } = await newPerson(browser, "Strip Person");
  await page.setViewportSize({ width: 1440, height: 900 });

  // 15 notes: more than fit (and more than the strip keeps, 12).
  for (let i = 1; i <= 15; i++) await newNote(page, `Note ${String(i).padStart(2, "0")}`);
  const links = strip(page).getByRole("link");
  await expect.poll(() => links.count()).toBe(13);
  // Tabs shrank to their minimum width before the strip began to scroll.
  const widths = await strip(page).locator("[data-tab]").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  expect(Math.min(...widths)).toBeGreaterThanOrEqual(171.5);
  expect(Math.max(...widths)).toBeLessThan(173);
  await expect(page.getByRole("button", { name: "Scroll tabs left" })).toBeEnabled();

  // The 16th: at the strip's cap, its tab replaces the oldest, and it's still the one shown, its whole title
  // readable though the others are at their narrowest.
  await newNote(page, "Company Structure");
  expect((await current(page))!.truncated).toBe(false);

  const sizes = [
    { label: "desktop", width: 1440, height: 900 },
    { label: "iPad landscape", width: 1180, height: 820 },
    { label: "iPad portrait", width: 1024, height: 1366 },
  ];
  for (const size of sizes) {
    for (const scheme of ["light", "dark"] as const) {
      const at = `${size.label}, ${scheme}`;
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.emulateMedia({ colorScheme: scheme });
      // A new size keeps the open tab in view.
      await expectInView(page, /.+/, `after resizing (${at})`);

      // Clicks: the first note tab (scrolled to with the arrows), then the last one.
      await scrollStrip(page, "left");
      const first = strip(page).locator("[data-tab]").first().getByRole("link");
      const firstName = (await first.getAttribute("aria-label"))!;
      await first.click();
      await expectInView(page, firstName, `click the first tab (${at})`);
      await scrollStrip(page, "right");
      const last = strip(page).locator("[data-tab]").last().getByRole("link");
      const lastName = (await last.getAttribute("aria-label"))!;
      // A tab half under the edge, clicked: it comes fully into view.
      await last.click();
      await expectInView(page, lastName, `click the last tab (${at})`);

      // Back and Forward.
      await page.goBack();
      await expectInView(page, firstName, `Back (${at})`);
      await page.goForward();
      await expectInView(page, lastName, `Forward (${at})`);

      // A link from somewhere else (the command palette): the found note's tab.
      await page.getByRole("button", { name: /Search or jump to/ }).first().click();
      await page.keyboard.type(firstName);
      // (The note itself, not "Ask Foli AI" about it.)
      await page.getByRole("option").filter({ hasText: firstName }).filter({ hasNotText: /Foli AI|Ask/ }).first().click();
      await expectInView(page, firstName, `opened from search (${at})`);

      // The open tab keeps its title readable (never squeezed below the minimum).
      expect((await current(page))!.width).toBeGreaterThanOrEqual(size.label === "desktop" ? 171.5 : 149.5);
    }
  }

  // Reduce Motion: the strip jumps to the tab rather than gliding.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await scrollStrip(page, "right");
  const lastLink = strip(page).locator("[data-tab]").last().getByRole("link");
  await lastLink.click();
  await expectInView(page, (await lastLink.getAttribute("aria-label"))!, "reduce motion");
  await page.emulateMedia({ reducedMotion: "no-preference" });

  // Closing tabs keeps the open one in view: close the open tab (its right-hand neighbour shows) a few times
  // from the middle of the strip.
  const mid = strip(page).locator("[data-tab]").nth(5).getByRole("link");
  await mid.click();
  for (let i = 0; i < 4; i++) {
    const name = (await current(page))!.name;
    await strip(page).getByRole("button", { name: `Close ${name}`, exact: true }).click();
    await expect.poll(async () => (await current(page))?.name).not.toBe(name);
    await expectInView(page, /.+/, `after closing ${name}`);
  }
  // Close the last tab while it's open: its left-hand neighbour shows, in view.
  const end = strip(page).locator("[data-tab]").last().getByRole("link");
  await end.click();
  const endName = (await current(page))!.name;
  await strip(page).getByRole("button", { name: `Close ${endName}`, exact: true }).click();
  await expect.poll(async () => (await current(page))?.name).not.toBe(endName);
  await expectInView(page, /.+/, "after closing the last tab");
  await context.close();
});

test("⌃Tab and ⌃⇧Tab in the Mac app walk the whole strip with the open tab in view at every step", async ({ browser }) => {
  test.setTimeout(300_000);
  const { context, page } = await newPerson(browser, "Mac Strip Person");
  await page.setViewportSize({ width: 1280, height: 800 });
  for (let i = 1; i <= 14; i++) await newNote(page, `Mac ${String(i).padStart(2, "0")}`);
  // The Mac app's mark (as Folevi for Mac sets it before the first paint): its tab shortcuts are on.
  await context.addInitScript(() => {
    const mark = () => document.documentElement?.setAttribute("data-desktop", "mac");
    mark();
    document.addEventListener("DOMContentLoaded", mark);
  });
  await page.reload();
  await expectInView(page, "Mac 14", "after reload");
  const total = await strip(page).getByRole("link").count();
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    // Forward around the whole strip (Home, then every tab), and back again.
    for (let i = 0; i < total; i++) {
      const before = page.url();
      await page.keyboard.press("Control+Tab");
      await expect.poll(() => page.url()).not.toBe(before);
      await expectInView(page, /.+/, `⌃Tab step ${i + 1} (${scheme})`);
    }
    for (let i = 0; i < 4; i++) {
      const before = page.url();
      await page.keyboard.press("Control+Shift+Tab");
      await expect.poll(() => page.url()).not.toBe(before);
      await expectInView(page, /.+/, `⌃⇧Tab step ${i + 1} (${scheme})`);
    }
  }
  await context.close();
});

test("the iPad app's strip (a finger scrolls it, no arrows) keeps the open tab in view too", async ({ browser }) => {
  test.setTimeout(300_000);
  const { context, page } = await newPerson(browser, "iPad Strip Person");
  await page.setViewportSize({ width: 1440, height: 900 });
  for (let i = 1; i <= 13; i++) await newNote(page, `Pad ${String(i).padStart(2, "0")}`);
  // The same person in the iPad app (its marks, as the app sets them before the first paint), landscape.
  const state = await context.storageState();
  await context.close();
  const ipad = await browser.newContext({
    storageState: state,
    viewport: { width: 1180, height: 820 },
    userAgent: "Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FoleviiOS/1.0",
    hasTouch: true,
    isMobile: true,
  });
  await ipad.addInitScript(() => {
    const mark = () => document.documentElement?.setAttribute("data-native", "ios");
    mark();
    document.addEventListener("DOMContentLoaded", mark);
  });
  const pad = await ipad.newPage();
  await pad.goto(new URL("/documents", page.url()).toString());
  await expect(pad.locator("[data-ipad-tabs]")).toBeVisible({ timeout: 30_000 });
  await expect(pad.getByRole("button", { name: "Scroll tabs left" })).toHaveCount(0);
  for (const scheme of ["light", "dark"] as const) {
    await pad.emulateMedia({ colorScheme: scheme });
    // A finger swipes the strip to its start, then taps the first tab.
    await strip(pad).evaluate((el) => el.scrollTo({ left: 0 }));
    const first = strip(pad).locator("[data-tab]").first().getByRole("link");
    const firstName = (await first.getAttribute("aria-label"))!;
    await first.tap();
    await expectInView(pad, firstName, `tap the first tab (iPad, ${scheme})`);
    // Swiped to the end, the last one.
    await strip(pad).evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
    const last = strip(pad).locator("[data-tab]").last().getByRole("link");
    const lastName = (await last.getAttribute("aria-label"))!;
    await last.tap();
    await expectInView(pad, lastName, `tap the last tab (iPad, ${scheme})`);
    // Swiped away from the open tab, Back brings the strip to the tab that shows.
    await strip(pad).evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
    await pad.goBack();
    await expectInView(pad, firstName, `Back (iPad, ${scheme})`);
    // A new note from the round + button: its tab shows at once, in view.
    await pad.getByRole("button", { name: "New note", exact: true }).tap();
    await pad.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
    await expectInView(pad, "Untitled", `new note (iPad, ${scheme})`);
    await pad.getByRole("textbox", { name: "Title" }).pressSequentially(`From the iPad ${scheme}`, { delay: 10 });
    await expectInView(pad, `From the iPad ${scheme}`, `new note named (iPad, ${scheme})`);
  }
  await ipad.close();
});
