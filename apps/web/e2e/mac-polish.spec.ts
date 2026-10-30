// Folevi for Mac's web layer (docs/MAC_POLISH_PLAN.md, package WM4), with the page marked as the Mac app
// (<html data-desktop="mac">, as both apps do before the first paint) and a stand-in for foleviDesktop that records
// what the page tells the app and answers the text services as the native app does. Local mode, against the shell
// dev server, in Chromium (project "local") and in WebKit (the native app's engine, project "mac-webkit"):
//   E2E_LOCAL_BASE_URL=http://localhost:3003 E2E_BASE_URL=http://app.localhost:3002 E2E_NO_SERVER=1 \
//     npx playwright test e2e/mac-polish.spec.ts --project local --project mac-webkit --workers=1
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/localShell";

declare global {
  interface Window {
    __macCalls?: { method: string; value: unknown }[];
    __macEmit?: (command: Record<string, unknown>) => void;
  }
}

/** The Mac app's marks and a stand-in for its bridge (the calls are kept in window.__macCalls). */
function macApp() {
  const calls: { method: string; value: unknown }[] = [];
  const listeners = new Set<(c: unknown) => void>();
  const record = (method: string) => (value?: unknown) => void calls.push({ method, value });
  window.__macCalls = calls;
  window.__macEmit = (c) => listeners.forEach((l) => l(c));
  const mark = () => document.documentElement?.setAttribute("data-desktop", "mac");
  mark();
  document.addEventListener("DOMContentLoaded", mark);
  Object.defineProperty(window, "foleviDesktop", {
    configurable: true,
    value: {
      platform: "mac",
      setBadge: record("setBadge"),
      notify: record("notify"),
      setRecent: record("setRecent"),
      setStatus: record("setStatus"),
      getSettings: async () => ({ settings: { quickAddShortcut: "Alt+Space", openAtLogin: false, menuBarIcon: true, notifications: true }, error: null }),
      setSettings: async () => null,
      placeWindowButtons: record("placeWindowButtons"),
      pauseShortcut: record("pauseShortcut"),
      closeQuickAdd: record("closeQuickAdd"),
      sizeQuickAdd: record("sizeQuickAdd"),
      openInMain: record("openInMain"),
      onCommand: (l: (c: unknown) => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      setMenuState: record("setMenuState"),
      spelling: async (word: string) => (word === "recieve" ? { misspelled: true, guesses: ["receive", "relieve"] } : { misspelled: false, guesses: [] }),
      learnWord: record("learnWord"),
      ignoreWord: record("ignoreWord"),
      lookUp: record("lookUp"),
      share: async (item: unknown) => (calls.push({ method: "share", value: item }), true),
    },
  });
}

const calls = (page: Page, method: string) => page.evaluate((m) => (window.__macCalls ?? []).filter((c) => c.method === m).map((c) => c.value), method);
const sidebar = (page: Page) => page.getByRole("navigation", { name: "Folio" });

async function openHome(page: Page) {
  await page.addInitScript(macApp);
  await page.goto("/documents");
  await expect(sidebar(page).getByRole("link", { name: "Home", exact: true })).toBeVisible({ timeout: 60_000 });
}

test.describe("Folevi for Mac, the web layer", { tag: ["@local", "@mac"] }, () => {
  test.beforeEach(({ backendMode }) => {
    test.skip(backendMode !== "local", "local mode only");
  });

  test("chrome: the arrow on controls, no selectable labels, focus rings only after the keyboard", async ({ page }) => {
    test.setTimeout(120_000);
    await openHome(page);
    const home = sidebar(page).getByRole("link", { name: "Home", exact: true });
    const style = (prop: string) => home.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
    expect(await style("cursor")).toBe("default");
    // The label can't be selected: what takes effect is the nearest setting other than "auto" (the rule is on the
    // sidebar; Chromium reports it on the link, WebKit reports the link's own "auto").
    const selectable = await home.evaluate((el) => {
      for (let e: Element | null = el; e; e = e.parentElement) {
        const s = getComputedStyle(e);
        const v = s.getPropertyValue("-webkit-user-select") || s.getPropertyValue("user-select");
        if (v && v !== "auto") return v;
      }
      return "auto";
    });
    expect(selectable).toBe("none");
    // A click leaves no ring (the mouse moved focus).
    await sidebar(page).getByRole("link", { name: "Tasks" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-input", "pointer");
    const ringed = () => page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      return s.outlineStyle !== "none" && s.outlineWidth !== "0px" ? "outline" : /rgb/.test(s.boxShadow) && el.matches(":focus-visible") ? "ring" : "none";
    });
    expect(await ringed()).not.toBe("outline");
    // Tab: now the keyboard is moving focus, and the ring shows.
    await page.keyboard.press("Tab");
    await expect(page.locator("html")).toHaveAttribute("data-input", "key");
    expect(await ringed()).not.toBe("none");
  });

  test("menus: AppKit's measure, open on mouse-down, press, drag and release picks an item, type-to-select", async ({ page }) => {
    test.setTimeout(120_000);
    await openHome(page);
    const button = sidebar(page).getByRole("button", { name: /settings and help/ });
    const box = (await button.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    const menu = page.getByRole("menu");
    // Open while the button is still held.
    await expect(menu).toBeVisible();
    const item = menu.getByRole("menuitem", { name: /^Settings/ });
    const row = (await item.boundingBox())!;
    // (The account menu's actions are 32 tall, its places 52: components/app/accountMenu.css.)
    expect(Math.round(row.height)).toBe(32);
    expect(await menu.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe("10px");
    await page.mouse.move(row.x + 20, row.y + row.height / 2, { steps: 6 });
    await expect(item).toHaveAttribute("data-highlighted", "true");
    await page.mouse.up();
    await expect(menu).toHaveCount(0);
    await expect(page).toHaveURL(/\/settings/);

    // A click opens it and leaves it open; typing moves to the item named.
    await button.click();
    await expect(menu).toBeVisible();
    await page.keyboard.press("s");
    await expect(menu.locator('[data-highlighted="true"]').first()).toHaveText(/^S/);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  });

  test("the menu bar: commands reach the page and it says what it can do; the page's tab shortcuts without native menus", async ({ page }) => {
    test.setTimeout(120_000);
    await openHome(page);
    // Formatting needs a note: off on Home (DesktopBridge sends what the menu bar can do).
    await expect.poll(async () => ((await calls(page, "setMenuState")).at(-1) as { disabled?: string[] } | undefined)?.disabled ?? []).toContain("format.bold");
    const state = (await calls(page, "setMenuState")).at(-1) as { disabled: string[]; route: string };
    expect(state.disabled).not.toContain("file.new-note");
    expect(state.disabled).not.toContain("go.today");
    await page.evaluate(() => window.__macEmit!({ type: "menu", id: "go.today" }));
    await expect(page).toHaveURL(/\/tasks\/today/);
    await page.evaluate(() => window.__macEmit!({ type: "menu", id: "go.home" }));
    await expect(page).toHaveURL(/\/documents/);
    // A note's own commands reach the Note menu (useMacNoteCommands, in the native app only: data-mac-engine).
    // Without such menus (no data-mac-engine) the page's own tab shortcuts: a note in a tab, then ⌘1 is the first tab.
    await page.locator("a[href^='/d/']").first().click();
    await expect(page).toHaveURL(/\/d\//);
    await page.keyboard.press("Meta+1");
    await expect(page).not.toHaveURL(/\/d\//);
  });

  test("text menu: Folevi's own, with the Mac's spelling guesses and Look Up", async ({ page }) => {
    test.setTimeout(120_000);
    await openHome(page);
    await page.keyboard.press("Meta+k");
    const field = page.getByRole("dialog").getByRole("combobox").or(page.getByRole("dialog").getByRole("textbox")).first();
    await field.fill("recieve");
    await field.click({ button: "right", position: { x: 20, y: 10 } });
    const menu = page.getByRole("menu", { name: "Text options" });
    await expect(menu.getByRole("menuitem", { name: "receive" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Learn spelling" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /Look up “recieve”/ })).toBeVisible();
    await menu.getByRole("menuitem", { name: "receive" }).click();
    await expect(field).toHaveValue("receive");
  });

  test("Quick Add: one field, natural words become chips, Return adds", async ({ page }) => {
    test.setTimeout(150_000);
    await page.addInitScript(macApp);
    await page.goto("/quick-add");
    const panel = page.getByRole("main", { name: "Quick add task" });
    const field = panel.getByPlaceholder("New task");
    await expect(field).toBeVisible({ timeout: 60_000 });
    await expect(field).toBeFocused();
    // One row until there's something to show; the panel is told its height.
    await expect.poll(async () => (await calls(page, "sizeQuickAdd")).at(-1)).toBeLessThan(110);
    await field.fill("Call the printer tomorrow 9am !high");
    const details = panel.getByRole("group", { name: "Task details" });
    await expect(details.getByRole("button", { name: /Due Tomorrow/ })).toBeVisible();
    await expect(details.getByRole("button", { name: "High", exact: true })).toBeVisible();
    await expect.poll(async () => (await calls(page, "sizeQuickAdd")).at(-1)).toBeGreaterThan(100);
    // Keep "!high" as words: the chip goes.
    await details.getByRole("button", { name: "Keep “!high” as text" }).click();
    await expect(details.getByRole("button", { name: "High", exact: true })).toHaveCount(0);
    await field.press("Enter");
    await expect(panel.getByText("Added to")).toBeVisible();
    await expect.poll(async () => (await calls(page, "closeQuickAdd")).length, { timeout: 5_000 }).toBeGreaterThan(0);
  });
});
