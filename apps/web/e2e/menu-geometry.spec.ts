// Every menu, pixel for pixel (the owner, 2026-11-26: "make sure all the context menus are pixel perfect, no spacing
// issues, on every platform"): the page's "…" menu and a submenu, a tab's, a block's (from its grip and from a
// right-click on text), a note card's, a folder card's and the account menu, as the web (and Folevi for Windows and
// Linux) draws them and as Folevi for Mac does (`data-desktop="mac"`, and its native look `data-mac-native`), light
// and dark. Each menu is measured: the same room above and below every separator and the same everywhere, a
// separator you can see on the menu, no separator first, last or doubled, no empty rows, rows of one height, icons
// and labels in one column, the menu's padding even on all sides. Local mode, against the shell dev server:
//   E2E_LOCAL_BASE_URL=http://localhost:3003 E2E_NO_SERVER=1 \
//     npx playwright test e2e/menu-geometry.spec.ts --project local --project mac-webkit --workers=1
// MENU_SHOTS=<folder> also saves a picture of every menu.
import type { Locator, Page } from "@playwright/test";
import { expect, prepareContext, test } from "./fixtures/localShell";
import { openTool } from "./helpers";

const shots = process.env.MENU_SHOTS;

type Look = { name: string; desktop?: "mac"; macNative?: boolean; dark?: boolean };
const LOOKS: Look[] = [
  { name: "web" },
  { name: "web-dark", dark: true },
  { name: "mac", desktop: "mac" },
  { name: "mac-dark", desktop: "mac", dark: true },
  { name: "mac-native", desktop: "mac", macNative: true },
  { name: "mac-native-dark", desktop: "mac", macNative: true, dark: true },
];

/** What is wrong with a menu's layout, measured in the page (empty when nothing is). */
function measure(menu: Element): string[] {
  const problems: string[] = [];
  const m = menu.getBoundingClientRect();
  const kids = [...menu.children].filter((c) => getComputedStyle(c).display !== "none" && (c as HTMLElement).getBoundingClientRect().height > 0) as HTMLElement[];
  const rect = (e: Element) => e.getBoundingClientRect();
  const isSep = (e: Element) => e.getAttribute("role") === "separator";
  const isRow = (e: Element) => /^menuitem/.test(e.getAttribute("role") ?? "");
  if (!kids.length) return ["empty menu"];
  if (isSep(kids[0]!)) problems.push("starts with a separator");
  if (isSep(kids.at(-1)!)) problems.push("ends with a separator");
  // Padding: the same on every side (within half a pixel).
  const first = rect(kids[0]!);
  const last = rect(kids.at(-1)!);
  const pads = { top: first.top - m.top, bottom: m.bottom - last.bottom, left: first.left - m.left, right: m.right - first.right };
  const scrolls = menu.scrollHeight > menu.clientHeight + 1;
  if (!scrolls && Math.abs(pads.top - pads.bottom) > 0.5) problems.push(`padding top ${pads.top.toFixed(1)} != bottom ${pads.bottom.toFixed(1)}`);
  if (Math.abs(pads.left - pads.right) > 0.5) problems.push(`padding left ${pads.left.toFixed(1)} != right ${pads.right.toFixed(1)}`);
  // Separators: equal room above and below, the same in the whole menu, never doubled, and visible.
  const gaps = new Set<string>();
  const bg = getComputedStyle(menu).backgroundColor;
  kids.forEach((k, i) => {
    if (!isSep(k)) {
      const r = rect(k);
      if (!isRow(k) && !(k.textContent ?? "").trim() && !k.querySelector("input, svg, img")) problems.push(`empty element ${k.tagName.toLowerCase()} (${r.height.toFixed(1)} px tall)`);
      return;
    }
    const prev = kids[i - 1];
    const next = kids[i + 1];
    if (prev && isSep(prev)) problems.push("two separators in a row");
    if (!prev || !next) return;
    const above = rect(k).top - rect(prev).bottom;
    const below = rect(next).top - rect(k).bottom;
    if (Math.abs(above - below) > 0.5) problems.push(`separator ${i}: ${above.toFixed(1)} above, ${below.toFixed(1)} below`);
    gaps.add(`${above.toFixed(1)}/${below.toFixed(1)}/${rect(k).height.toFixed(1)}`);
    const s = getComputedStyle(k);
    const line = s.backgroundColor;
    if (line === "rgba(0, 0, 0, 0)" || line === "transparent" || s.opacity === "0") problems.push(`separator ${i} has no line`);
    (k as HTMLElement).dataset.probeLine = line;
  });
  if (gaps.size > 1) problems.push(`separators differ: ${[...gaps].join(", ")}`);
  // Rows: one height (a row with a second line excepted); icons and labels each in one column.
  const rows = kids.filter((k) => isRow(k) && !k.querySelector('[data-menu-part="description"]') && !k.hasAttribute("aria-description"));
  const heights = new Set(rows.map((r) => rect(r).height.toFixed(1)));
  if (heights.size > 1) problems.push(`row heights differ: ${[...heights].join(", ")}`);
  const col = (part: string) => new Set(rows.map((r) => r.querySelector(`[data-menu-part="${part}"]`)).filter(Boolean).map((p) => rect(p!).left.toFixed(1)));
  const icons = col("icon");
  if (icons.size > 1) problems.push(`icons not in one column: ${[...icons].join(", ")}`);
  const withIcon = rows.filter((r) => r.querySelector('[data-menu-part="icon"]'));
  // Every label in one column (a row without an icon too, in a menu where others have one).
  const labels = new Set(rows.map((r) => r.querySelector('[data-menu-part="label"]')).filter(Boolean).map((p) => rect(p!).left.toFixed(1)));
  if (labels.size > 1) problems.push(`labels not in one column: ${[...labels].join(", ")}`);
  const shortcuts = new Set(rows.map((r) => r.querySelector('[data-menu-part="shortcut"]')).filter(Boolean).map((p) => rect(p!).right.toFixed(1)));
  if (shortcuts.size > 1) problems.push(`shortcuts not right-aligned: ${[...shortcuts].join(", ")}`);
  // Each row's icon centred on its row.
  for (const r of withIcon) {
    const ic = rect(r.querySelector('[data-menu-part="icon"]')!);
    const rr = rect(r);
    if (Math.abs(ic.top + ic.height / 2 - (rr.top + rr.height / 2)) > 1) problems.push(`icon off-centre in "${r.textContent?.slice(0, 20)}"`);
  }
  void bg;
  return problems;
}

/** The separator's line against the menu: how far apart their lightness is (0 to 1), from a pixel probe. */
async function separatorContrast(page: Page, menu: Locator): Promise<number[]> {
  return menu.evaluate((m) => {
    // Any CSS colour (rgb, color(srgb ...), oklab from a color-mix) as 0 to 255 channels and an alpha, read back
    // from a one-pixel canvas.
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    const parse = (c: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return a ? { r: r!, g: g!, b: b!, a: a! / 255 } : { r: 0, g: 0, b: 0, a: 0 };
    };
    const lum = (c: { r: number; g: number; b: number }) => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
    const base = parse(getComputedStyle(m).backgroundColor);
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    // The menu's glass over the page behind it, where it lets light through: plain paper, and a coloured note
    // (Irises' mint, or a deep green in dark), the worst case for a light grey line.
    const pages = dark ? [{ r: 28, g: 28, b: 30 }, { r: 20, g: 48, b: 40 }] : [{ r: 255, g: 255, b: 255 }, { r: 214, g: 240, b: 228 }];
    return [...m.querySelectorAll(':scope > [role="separator"]')].map((s) => {
      const l = parse(getComputedStyle(s).backgroundColor);
      return Math.min(
        ...pages.map((pg) => {
          const over = { r: base.r * base.a + pg.r * (1 - base.a), g: base.g * base.a + pg.g * (1 - base.a), b: base.b * base.a + pg.b * (1 - base.a) };
          const mixed = { r: l.r * l.a + over.r * (1 - l.a), g: l.g * l.a + over.g * (1 - l.a), b: l.b * l.a + over.b * (1 - l.a) };
          return Math.abs(lum(mixed) - lum(over));
        }),
      );
    });
  });
}

/** An init script: these marks on <html> from the start and kept there (an init script runs before <html> exists,
 *  and the app sets its own as it loads). */
function keepMarks(marks: Record<string, string>) {
  const apply = () => {
    const root = document.documentElement;
    if (!root) return;
    for (const [k, v] of Object.entries(marks)) if (root.getAttribute(k) !== v) root.setAttribute(k, v);
  };
  apply();
  new MutationObserver(apply).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: Object.keys(marks) });
}

let seen = new Map<string, string[]>();

async function check(page: Page, menu: Locator, label: string, look: Look) {
  await expect(menu).toBeVisible();
  // Measured in the look it claims (the app may set its own marks as it loads).
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-desktop")), `${label}: the look`).toBe(look.desktop ?? null);
  await page.waitForTimeout(250);
  if (shots) await menu.screenshot({ path: `${shots}/${look.name}-${label.replace(/\W+/g, "-")}.png` });
  const problems = await menu.evaluate(measure);
  // Every menu spaces its separators alike.
  const sig = await menu.evaluate((m) =>
    [...m.querySelectorAll(':scope > [role="separator"]')].map((s) => {
      const st = getComputedStyle(s);
      return `${st.marginTop}/${st.marginBottom}/${st.height}/${st.marginLeft}`;
    }),
  );
  for (const g of sig) {
    seen.set(g, [...(seen.get(g) ?? []), label]);
  }
  expect.soft(problems, `${label} (${look.name})`).toEqual([]);
  const contrast = await separatorContrast(page, menu);
  for (const c of contrast) expect.soft(c, `${label} (${look.name}): a separator too faint to see`).toBeGreaterThan(0.1);
}

async function openNote(page: Page) {
  await page.goto("/documents");
  const card = page.locator("main a[href^='/d/']").first();
  await expect(card).toBeVisible({ timeout: 60_000 });
  await card.click();
  await expect(page.getByRole("textbox", { name: "Document body" })).toBeVisible({ timeout: 30_000 });
}

test.describe("menu geometry", { tag: ["@local", "@mac"] }, () => {
  test.beforeEach(({ backendMode }) => {
    test.skip(backendMode !== "local", "local mode only");
  });

  for (const look of LOOKS) {
    test(`every menu, ${look.name}`, async ({ browser }, testInfo) => {
      test.setTimeout(180_000);
      const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: look.dark ? "dark" : "light" });
      await prepareContext(context, testInfo, { libraryName: `menus-${look.name}-${Date.now()}`, platform: "mac" });
      await context.addInitScript(keepMarks, {
        ...(look.desktop ? { "data-desktop": look.desktop } : {}),
        ...(look.macNative ? { "data-mac-native": "" } : {}),
        "data-theme": look.dark ? "dark" : "light",
      });
      const page = await context.newPage();
      seen = new Map();
      await openNote(page);
      const esc = () => page.keyboard.press("Escape");

      // The page's "…" menu and its first submenu.
      await page.getByRole("group", { name: "Page" }).getByRole("button", { name: "Document actions" }).click();
      const docMenu = page.getByRole("menu", { name: "Document actions", exact: true });
      await check(page, docMenu, "document actions", look);
      const sub = docMenu.locator('[aria-haspopup="menu"]').first();
      await sub.click();
      const subName = (await sub.locator('[data-menu-part="label"]').textContent())!.trim();
      await check(page, page.getByRole("menu", { name: subName, exact: true }), `submenu ${subName}`, look);
      await esc();
      await esc();

      // A right-click on selected text.
      const para = page.locator(".ProseMirror p").filter({ hasText: /\w{4,}/ }).first();
      await para.dblclick({ position: { x: 12, y: 8 } });
      await para.click({ button: "right", position: { x: 12, y: 8 } });
      await check(page, page.getByRole("menu").last(), "text right-click", look);
      await esc();

      // A block's grip.
      const grip = page.getByRole("button", { name: /^Drag to move/ });
      await expect(async () => {
        await page.mouse.move(0, 0);
        await para.hover({ position: { x: 20, y: 8 } });
        await expect(grip).toBeVisible({ timeout: 1_000 });
      }).toPass({ timeout: 20_000 });
      await grip.click();
      await check(page, page.getByRole("menu", { name: /Block options|Options for/ }), "block options", look);
      await esc();

      // The tab's right-click menu.
      const title = (await page.getByRole("textbox", { name: "Title" }).inputValue()).trim() || "Untitled";
      await page.getByRole("link", { name: title }).first().click({ button: "right" });
      await check(page, page.getByRole("menu", { name: "Tab options" }), "tab options", look);
      await esc();

      // Home: a note card's and a folder card's menus.
      await page.goto("/documents");
      const card = page.locator('[aria-label="Recent notes"] li').first();
      await expect(card).toBeVisible({ timeout: 30_000 });
      await card.hover();
      await card.getByRole("button", { name: /^More actions for/ }).click();
      await check(page, page.getByRole("menu", { name: /^More actions for/ }), "note card", look);
      await esc();
      const folder = page.locator('[aria-labelledby="home-folders-title"] li').first();
      if (await folder.count()) {
        await folder.hover();
        await folder.getByRole("button", { name: /^Folder options for|^More actions for/ }).click();
        await check(page, page.getByRole("menu", { name: /^Folder options for|^More actions for/ }), "folder card", look);
        await esc();
      }

      // The account menu.
      // The account menu (the library switcher in local mode).
      const account = page.getByRole("navigation", { name: "Folio" }).getByRole("button", { name: /account|library/i }).first();
      if (await account.count()) {
        await account.click();
        await check(page, page.getByRole("menu").last(), "account", look);
      }
      expect.soft([...seen.entries()].map(([g, menus]) => `${g}: ${[...new Set(menus)].join(", ")}`), "separators spaced alike in every menu").toHaveLength(1);
      await context.close();
    });
  }

  // The owner's screenshot (2026-11-26): a note with the Irises theme floated in a narrow window on the Mac. Its
  // text menu is the desktop's (a mouse points at it, however narrow the window: Paste, the block's actions in their
  // places) and its separators show over the coloured note.
  test("a floating note's text menu, as the Mac draws it", async ({ browser }, testInfo) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await prepareContext(context, testInfo, { libraryName: `menus-float-${Date.now()}`, platform: "mac" });
    await context.addInitScript(keepMarks, { "data-desktop": "mac" });
    const page = await context.newPage();
    await openNote(page);
    const id = /\/d\/([0-9A-Z]{26})/.exec(page.url())![1]!;
    await openTool(page, "Style");
    await page.getByRole("group", { name: "Note Theme" }).getByRole("button").first().click();
    await page.getByRole("radio", { name: "Note theme: Irises" }).click();
    await page.getByRole("dialog", { name: "Note theme" }).getByRole("button", { name: "Done" }).click();
    const float = await context.newPage();
    await float.setViewportSize({ width: 580, height: 650 });
    await float.goto(`/float/${id}`);
    const para = float.locator(".ProseMirror p").filter({ hasText: /\w{4,}/ }).first();
    await expect(para).toBeVisible({ timeout: 60_000 });
    await float.waitForTimeout(800);
    await para.dblclick({ position: { x: 12, y: 8 } });
    await para.click({ button: "right", position: { x: 12, y: 8 } });
    const menu = float.getByRole("menu").last();
    await check(float, menu, "floating text right-click", { name: "mac-float", desktop: "mac" });
    const labels = await menu.locator('[data-menu-part="label"]').allTextContents();
    expect(labels).toContain("Paste");
    expect(labels.indexOf("Turn into")).toBeLessThan(labels.indexOf("Delete block"));
    await context.close();
  });

  // The Vault's "…" menu (the owner, 2026-11-26): a menu opened in the Vault's inverted panel (.ui-invert) is solid
  // in the Vault's own colours on the Mac too, not the app's light glass under the Vault's light words.
  for (const native of [false, true]) {
    test(`a menu in the Vault is solid in its colours${native ? ", Mac native look" : ", Mac"}`, async ({ browser }, testInfo) => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
      await prepareContext(context, testInfo, { libraryName: `menus-vault-${Date.now()}`, platform: "mac" });
      await context.addInitScript(keepMarks, { "data-desktop": "mac", ...(native ? { "data-mac-native": "" } : {}) });
      const page = await context.newPage();
      await page.goto("/documents");
      await expect(page.getByRole("heading", { name: "Recent notes" })).toBeVisible({ timeout: 60_000 });
      const look = await page.evaluate(() => {
        if (document.documentElement.getAttribute("data-desktop") !== "mac") throw new Error("not the Mac look");
        const vault = document.createElement("div");
        vault.className = "ui-invert";
        vault.style.setProperty("--color-surface-raised", "rgb(30, 30, 33)");
        const menu = document.createElement("div");
        menu.setAttribute("role", "menu");
        menu.className = "ui-pop";
        vault.appendChild(menu);
        document.body.appendChild(vault);
        const st = getComputedStyle(menu);
        const out = { background: st.backgroundColor, blur: st.backdropFilter || st.getPropertyValue("-webkit-backdrop-filter") };
        vault.remove();
        return out;
      });
      expect(look.background).toBe("rgb(30, 30, 33)");
      expect(look.blur).toBe("none");
      await context.close();
    });
  }
});
