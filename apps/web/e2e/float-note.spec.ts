// "Float this note" (lib/app/float.ts): the menu items in a note tab's and a listed note's right-click menu, where
// they show (Chrome's Picture-in-Picture, the desktop apps' foleviDesktop.floatNote) and where they don't (WebKit:
// Safari and an older desktop app), and the floating note's own page (/float/<id>): its slim bar, the note's title
// and text, editing that reaches the main window, and links that stay out of it. Local mode, against the shell dev
// server, in Chromium (project "local") and in WebKit (project "mac-webkit"):
//   E2E_LOCAL_BASE_URL=http://localhost:3003 E2E_NO_SERVER=1 \
//     npx playwright test e2e/float-note.spec.ts --project local --project mac-webkit --workers=1
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/localShell";

declare global {
  interface Window {
    __floatCalls?: { method: string; value: unknown }[];
  }
}

/** A desktop app's bridge that floats notes (its calls kept in window.__floatCalls). */
function desktopWithFloat() {
  const calls: { method: string; value: unknown }[] = [];
  window.__floatCalls = calls;
  const record = (method: string) => (value?: unknown) => void calls.push({ method, value });
  Object.defineProperty(window, "foleviDesktop", {
    configurable: true,
    value: {
      platform: "windows",
      setBadge() {},
      notify() {},
      setRecent() {},
      setStatus() {},
      getSettings: async () => null,
      setSettings: async () => null,
      placeWindowButtons() {},
      pauseShortcut() {},
      closeQuickAdd() {},
      sizeQuickAdd() {},
      openInMain: record("openInMain"),
      closeWindow: record("closeWindow"),
      onCommand: () => () => undefined,
      floatNote: record("floatNote"),
      floatOnTop: async (on?: boolean) => (record("floatOnTop")(on), on ?? true),
    },
  });
}

async function newNote(page: Page, title: string, body: string): Promise<string> {
  await page.goto("/documents");
  await expect(page.getByRole("heading", { name: "Recent notes" })).toBeVisible({ timeout: 60_000 });
  // (A click before the page is ready to take it does nothing: click again until a note opens.)
  await expect(async () => {
    await page.getByRole("button", { name: "New note", exact: true }).first().click();
    await page.waitForURL(/\/d\/[0-9A-Z]{26}/, { timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
  const t = page.getByRole("textbox", { name: "Title" });
  await expect(t).toBeFocused();
  await t.fill(title);
  await page.keyboard.press("Enter");
  await page.keyboard.type(body);
  return /\/d\/([0-9A-Z]{26})/.exec(page.url())![1]!;
}

const calls = (page: Page, method: string) => page.evaluate((m) => (window.__floatCalls ?? []).filter((c) => c.method === m).map((c) => c.value), method);

test.describe("Float this note", { tag: ["@local", "@mac"] }, () => {
  test.beforeEach(({ backendMode }) => {
    test.skip(backendMode !== "local", "local mode only");
  });

  test("the menu items: shown where a note can float, and floating it asks the desktop app", async ({ page, browserName }) => {
    test.setTimeout(120_000);
    const id = await newNote(page, "Floating plans", "First line.");
    const hasPip = await page.evaluate(() => "documentPictureInPicture" in window);
    // The tab's right-click menu.
    await page.getByRole("link", { name: "Floating plans" }).first().click({ button: "right" });
    const tabMenu = page.getByRole("menu", { name: "Tab options" });
    await expect(tabMenu).toBeVisible();
    await expect(tabMenu.getByRole("menuitem", { name: "Float this note" })).toHaveCount(hasPip ? 1 : 0);
    await page.keyboard.press("Escape");
    if (browserName === "webkit") expect(hasPip, "Safari's engine has no Document Picture-in-Picture").toBe(false);

    // In a desktop app that floats notes (any engine): Home's right-click menu has it, and it asks the app.
    await page.addInitScript(desktopWithFloat);
    await page.goto("/documents");
    const card = page.locator(`[data-card-id="${id}"], a[href="/d/${id}"]`).first();
    await card.click({ button: "right", timeout: 60_000 });
    const item = page.getByRole("menuitem", { name: "Float this note" });
    await expect(item).toBeVisible();
    await item.click();
    await expect.poll(() => calls(page, "floatNote")).toEqual([{ id, title: "Floating plans" }]);
  });

  test("the floating page: the bar, the note's title and text, editing that reaches the main window", async ({ page, context }) => {
    test.setTimeout(120_000);
    const id = await newNote(page, "Packing list", "Tent and stove.");
    const float = await context.newPage();
    await float.addInitScript(desktopWithFloat);
    await float.goto(`/float/${id}`);
    const bar = float.locator("[data-float-bar]");
    await expect(bar.getByRole("heading", { name: "Packing list" })).toBeVisible({ timeout: 60_000 });
    await expect(float.locator("html")).toHaveAttribute("data-float", "window");
    // Compact: no sidebar, tab strip or note dock.
    await expect(float.getByRole("navigation", { name: "Folio" })).toHaveCount(0);
    await expect(float.getByRole("textbox", { name: "Title" })).toHaveValue("Packing list");
    await expect(float.locator(".ProseMirror")).toContainText("Tent and stove.");
    await expect(bar.getByRole("button", { name: "Always on top" })).toHaveAttribute("aria-pressed", "true");
    // Shown at a floating window's size.
    await float.setViewportSize({ width: 380, height: 480 });
    // (After the note's entry animation.)
    await float.waitForTimeout(800);
    if (process.env.FLOAT_SHOTS) await float.screenshot({ path: `${process.env.FLOAT_SHOTS}/float-${test.info().project.name}.png` });

    // Edited in the floating window, the main window has it.
    await float.locator(".ProseMirror").click();
    await float.keyboard.press("End");
    await float.keyboard.type(" Matches too.");
    await page.goto(`/d/${id}`);
    await expect(page.locator(".ProseMirror")).toContainText("Matches too.", { timeout: 20_000 });

    // The bar's buttons ask the app.
    await bar.getByRole("button", { name: "Always on top" }).click();
    await expect(bar.getByRole("button", { name: "Always on top" })).toHaveAttribute("aria-pressed", "false");
    await bar.getByRole("button", { name: "Open in main window" }).click();
    await bar.getByRole("button", { name: "Close" }).click();
    // (Read once or twice as the bar mounts, development's React runs effects twice; then set off.)
    await expect.poll(async () => (await calls(float, "floatOnTop")).at(-1)).toBe(false);
    await expect.poll(() => calls(float, "openInMain")).toEqual([`/d/${id}`]);
    await expect.poll(() => calls(float, "closeWindow")).toHaveLength(1);
    // The floating window keeps its note.
    expect(new URL(float.url()).pathname).toBe(`/float/${id}`);
  });
});
