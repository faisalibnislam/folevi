// What the folder drag specs share (e2e/folder-drag.spec.ts, e2e/folder-drag-local.spec.ts): the sidebar's rows, a
// mouse drag to a spot on a row, and a finger's hold-then-move.
import { expect, type Locator, type Page } from "@playwright/test";

export const nav = (page: Page) => page.getByRole("navigation", { name: "Folio" });
export const folderLink = (page: Page, name: string) => nav(page).getByRole("link", { name, exact: true });
export const drafts = (page: Page) => nav(page).getByRole("link", { name: /^Drafts( \d+)?$/ });
export const row = (page: Page, name: string) => nav(page).locator("[data-drop-tree]").filter({ has: page.getByRole("link", { name, exact: true }) }).first();
export const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });

// A new account starts with a couple of sample folders; the tests look at their own.
const SAMPLE = new Set(["Projects", "Personal"]);
export const more = (page: Page) => nav(page).getByRole("button", { name: /^\+\d+ more folders$/ });

/** The top-level folders in the sidebar (the tests' own), in order. */
export async function roots(page: Page): Promise<string[]> {
  const names = await nav(page).evaluate((n) =>
    [...n.querySelectorAll<HTMLElement>("[data-drop-tree]")].filter((r) => !r.closest('[role="group"][aria-label^="In "]')).map((r) => r.querySelector("a")!.textContent!.trim()),
  );
  return names.filter((n) => !SAMPLE.has(n));
}

export async function newFolder(page: Page, name: string, showAll = true) {
  await nav(page).getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill(name);
  await page.getByRole("button", { name: "Create folder" }).click();
  await expect(page.getByLabel("Folder name")).toHaveCount(0);
  if (!showAll) return;
  if (await more(page).count()) await more(page).click();
  await expect(folderLink(page, name)).toBeVisible();
}

/** A mouse drag from the middle of `from` to a point on `to` (`at`: 0 top edge, 0.5 middle, 1 bottom edge), resting there `rest` ms. */
export async function drag(page: Page, from: Locator, to: Locator, at = 0.5, rest = 150) {
  const a = (await from.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 6, a.y + a.height / 2 + 6, { steps: 3 });
  const b = (await to.boundingBox())!;
  const point = { x: b.x + Math.min(b.width / 2, 80), y: b.y + b.height * at };
  await page.mouse.move(point.x, point.y, { steps: 12 });
  await page.waitForTimeout(rest);
  // (Chromium only answers a drag that has moved since its last dragover.)
  await page.mouse.move(point.x + 1, point.y, { steps: 2 });
  return {
    drop: () => page.mouse.up(),
    cancel: async () => {
      await page.keyboard.press("Escape");
      await page.mouse.up();
    },
  };
}


/** A finger (Chromium's touch input): down, held `hold` ms, moved along `path`, resting `rest` ms at the end, up. */
export async function finger(page: Page, from: { x: number; y: number }, path: { x: number; y: number }[], hold = 650, rest = 200) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
  await page.waitForTimeout(hold);
  for (const p of path) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [p] });
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(rest);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

export const centre = async (l: Locator, at = 0.5) => {
  await l.scrollIntoViewIfNeeded();
  const b = (await l.boundingBox())!;
  return { x: b.x + Math.min(b.width / 2, 80), y: b.y + b.height * at };
};
export const line = (a: { x: number; y: number }, b: { x: number; y: number }, n = 14) => Array.from({ length: n }, (_, i) => ({ x: a.x + ((b.x - a.x) * (i + 1)) / n, y: a.y + ((b.y - a.y) * (i + 1)) / n }));

