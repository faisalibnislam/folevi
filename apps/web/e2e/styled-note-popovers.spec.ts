import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { newPerson, openTool } from "./helpers";

/**
 * A note style changes the page's colours, and editor popovers live inside the page. They take the app's
 * colours back (.ui-app-colors), so their text never sits light on light or dark on dark: a night page in
 * the light theme, and a paper page in the dark theme.
 */
const CASES = [
  { theme: "light", sheet: "Night", attr: "night" },
  { theme: "dark", sheet: "Paper", attr: "paper" },
] as const;

async function contrastViolations(page: Page, selector: string) {
  const results = await new AxeBuilder({ page }).include(selector).withRules(["color-contrast"]).analyze();
  return results.violations.flatMap((v) => v.nodes.map((n) => `${n.target.join(" ")}: ${n.failureSummary ?? ""}`));
}

/**
 * Icon buttons carry no text, so axe's color-contrast rule passes over them (and its colour engine can't
 * measure a glyph in the top layer). Each glyph, drawn in the button's colour, is measured here the same way:
 * against the backgrounds behind it composited down to the first opaque one (glass over the page included),
 * held to the 3:1 of WCAG 1.4.11.
 */
async function iconContrastFailures(page: Page, selector: string) {
  return page.locator(selector).evaluate((root) => {
    type Rgba = [number, number, number, number];
    const parse = (c: string): Rgba | null => {
      const m = c.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/);
      return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])] : null;
    };
    const over = (top: Rgba, under: Rgba): Rgba => [0, 1, 2].map((i) => top[i]! * top[3] + under[i]! * (1 - top[3])).concat(1) as Rgba;
    const luminance = ([r, g, b]: Rgba) => {
      const lin = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const buttons = [...root.querySelectorAll("button")].filter((b) => b.querySelector("svg") && b.getClientRects().length);
    if (!buttons.length) return ["no icon buttons found"];
    return buttons.flatMap((b) => {
      const name = b.getAttribute("aria-label") ?? "button";
      const glyph = b.querySelector("svg")!;
      const layers: Rgba[] = [];
      for (let el: Element | null = b; el; el = el.parentElement) {
        const bg = parse(getComputedStyle(el).backgroundColor);
        if (!bg) return [`${name}: unreadable background on ${el.tagName.toLowerCase()}`];
        if (bg[3] > 0) layers.push(bg);
        if (bg[3] === 1) break;
      }
      const bg = layers.reduceRight<Rgba>((under, top) => over(top, under), [255, 255, 255, 1]);
      const fgRaw = parse(getComputedStyle(glyph).color);
      if (!fgRaw) return [`${name}: unreadable icon colour`];
      const fg = over(fgRaw, bg);
      const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x) as [number, number];
      const ratio = (hi + 0.05) / (lo + 0.05);
      return ratio < 3 ? [`${name}: ${ratio.toFixed(2)}:1 (${getComputedStyle(glyph).color} on rgb(${bg.slice(0, 3).map(Math.round).join(", ")}))`] : [];
    });
  });
}

/** The popover's text is in the app's ink, not the note's. */
async function expectAppInk(page: Page, selector: string, name: string) {
  const colors = await page.locator(selector).first().evaluate((el) => ({
    ink: getComputedStyle(el).getPropertyValue("--color-ink").trim(),
    appInk: getComputedStyle(document.documentElement).getPropertyValue("--app-ink").trim(),
  }));
  expect(colors.ink, `${name} uses the app's ink`).toBe(colors.appInk);
}

for (const { theme, sheet, attr } of CASES) {
  test(`slash menu and formatting toolbar read clearly on a ${attr} note in the ${theme} theme`, async ({ browser }) => {
    const { page } = await newPerson(browser, `Styled ${sheet}`);
    // The profile's appearance is "system": the emulated scheme decides it.
    await page.emulateMedia({ colorScheme: theme });
    await page.evaluate((s) => localStorage.setItem("folevi:appearance", s), theme);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

    // A short note of its own, so the menus open on screen.
    await page.getByRole("button", { name: "New note", exact: true }).click();
    await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
    await page.getByRole("textbox", { name: "Title" }).fill("Night and day");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Words on a styled page");

    await openTool(page, "Style");
    await page.getByRole("button", { name: "Document color" }).click();
    await page.getByRole("radio", { name: `Document color: ${sheet}` }).click();
    await expect(page.locator("article.fb-sheet")).toHaveAttribute("data-sheet", attr);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

    const body = page.getByRole("textbox", { name: "Document body" });
    await body.locator("p.fb-paragraph").first().click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");

    // The slash menu.
    await page.keyboard.type("/");
    const slash = '[role="listbox"][aria-label="Insert block"]';
    await expect(page.locator(slash)).toBeVisible();
    await page.waitForTimeout(200); // the rise animation
    expect(await contrastViolations(page, slash), "slash menu contrast").toEqual([]);
    await expectAppInk(page, slash, "slash menu");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Backspace");

    // The formatting toolbar.
    await body.locator("p.fb-paragraph").first().dblclick();
    const toolbar = '[role="toolbar"][aria-label="Text formatting"]';
    await expect(page.locator(toolbar)).toBeVisible();
    await page.waitForTimeout(200);
    expect(await contrastViolations(page, toolbar), "formatting toolbar contrast").toEqual([]);
    expect(await iconContrastFailures(page, toolbar), "formatting toolbar icon contrast").toEqual([]);
    await expectAppInk(page, toolbar, "formatting toolbar");
  });
}
