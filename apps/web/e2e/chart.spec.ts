// The chart block (components/editor/chart): an example to start from, every kind, the data table edited in
// place, Style, tooltips from the keyboard, pasted rows, a table turned into a chart that follows it, a
// ```chart fence pasted as Markdown, export, full canvas, saving, the public share page (read-only, zoom,
// the data as a table), axe in light and dark, and the iPhone app (panels as sheets, 44 pt cells).
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { APP, newPerson, openShare, settle, waitForSaved } from "./helpers";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FoleviiOS/1.0";

async function newPage(page: Page, title: string) {
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Intro");
  await waitForSaved(page);
}

/** Pastes text into the note at the caret, as from another app. */
async function paste(page: Page, text: string) {
  await page.evaluate((t) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", t);
    document.querySelector(".fb-editor")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
}

async function caretToEnd(page: Page) {
  await page.locator(".fb-editor > p.fb").last().click();
  await page.keyboard.press("End");
}

test.describe("Chart", () => {
  test.setTimeout(240_000);

  test("every kind, the data in place, style, tooltips, a table turned into a chart, export, share", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Chart Tester");
    await newPage(page, "Charts");

    // Slash menu → Chart: an empty card that offers an example.
    await page.keyboard.press("Enter");
    await page.keyboard.type("/chart");
    await page.getByRole("option", { name: /^Chart/ }).first().click();
    const card = page.locator(".fb-editor .fb-chart").first();
    const tools = card.getByRole("toolbar", { name: "Chart tools" });
    await expect(card.locator(".fb-vc-empty")).toBeVisible({ timeout: 20_000 });
    await card.getByRole("button", { name: "Start with an example" }).click();
    await expect(card.getByRole("img", { name: /^Bar: Sign ups by month\. 4 categories from Jan to Apr/ })).toBeVisible();

    // The data table, edited in place: the chart follows.
    await tools.getByRole("button", { name: "Data", exact: true }).click();
    const grid = card.getByRole("table", { name: "Chart data" });
    await grid.getByRole("textbox", { name: "Web, row 1" }).fill("$1,500");
    await page.keyboard.press("Enter");
    await expect(card.getByRole("img", { name: /Highest Web in Jan \(\$?1,500\)/ })).toBeVisible();
    await expect(grid.getByRole("textbox", { name: "Web, row 2" })).toBeFocused();
    await tools.getByRole("button", { name: "Data", exact: true }).click();
    await expect(grid).toHaveCount(0);

    // Every kind from the same table, switched after the fact.
    const kinds: [string, RegExp][] = [
      ["Stacked bar", /^Stacked bar: /],
      ["Line", /^Line: /],
      ["Area", /^Area: /],
      ["Pie", /^Pie: .*4 slices/],
      ["Donut", /^Donut: /],
      ["Scatter", /^Scatter: .*4 points/],
      ["Bubble", /^Bubble: /],
    ];
    for (const [label, name] of kinds) {
      await tools.getByRole("button", { name: "Chart type" }).click();
      await page.getByRole("menuitemradio", { name: label, exact: true }).click();
      await expect(card.getByRole("img", { name })).toBeVisible();
    }
    // Org charts and Venn diagrams read their table differently: they say so, and fill in an example (the
    // chart keeps its title).
    for (const [label, name] of [["Org chart", /^Org chart: Sign ups by month\. 6 people; at the top Ada/], ["Venn", /^Venn: Sign ups by month\. 3 sets: Design, Code, Writing/]] as const) {
      await tools.getByRole("button", { name: "Chart type" }).click();
      await page.getByRole("menuitemradio", { name: label, exact: true }).click();
      await card.getByRole("button", { name: "Fill with an example" }).click();
      await expect(card.getByRole("img", { name })).toBeVisible();
    }

    // Pasted rows replace the data; back to bars, with Style: value labels and the legend below.
    await tools.getByRole("button", { name: "Data from" }).click();
    const source = page.getByRole("dialog", { name: "Where the chart's numbers come from" });
    await source.getByRole("button", { name: /Pasted rows/ }).click();
    await source.getByRole("textbox", { name: "Rows to paste" }).fill("Region\tSales\tReturns\nNorth\t$4,200\t$300\nSouth\t$3,100\t$450\nEast\t$5,000\t$120");
    await source.getByRole("button", { name: "Use these rows" }).click();
    await tools.getByRole("button", { name: "Chart type" }).click();
    await page.getByRole("menuitemradio", { name: "Bar", exact: true }).click();
    await expect(card.getByRole("img", { name: /^Bar: Sign ups by month\. 3 categories from North to East; 2 series: Sales, Returns/ })).toBeVisible();
    await tools.getByRole("button", { name: "Style" }).click();
    const style = page.getByRole("dialog", { name: "Chart style" });
    await style.getByRole("switch", { name: "Value labels" }).click();
    await style.getByRole("button", { name: "Bottom" }).click();
    await style.getByRole("radiogroup", { name: "Color for Returns" }).getByRole("radio", { name: "Red" }).click();
    await page.keyboard.press("Escape");
    await expect(style).toHaveCount(0);
    await expect(card.locator("svg.fb-chart-svg text", { hasText: "$5,000" })).toHaveCount(1);
    await expect(card.locator('svg.fb-chart-svg path[fill="var(--chart-red)"]')).toHaveCount(3);

    // The title and takeaway are the block's own text.
    await card.getByRole("textbox", { name: "Chart title" }).fill("Sales by region");
    await card.getByRole("textbox", { name: "Takeaway" }).fill("East sold the most.");

    // Tooltips from the keyboard: the arrows move through the categories, Esc hides it.
    await card.locator(".fb-canvas-body").focus();
    await page.keyboard.press("ArrowRight");
    const tip = card.locator(".fb-chart-tip");
    await expect(tip).toContainText("North");
    await expect(tip).toContainText("$4,200");
    await page.keyboard.press("ArrowRight");
    await expect(tip).toContainText("South");
    await page.keyboard.press("Escape");
    await expect(tip).toHaveCount(0);

    // Full canvas and back.
    await tools.getByRole("button", { name: "Full canvas" }).click();
    await expect(card.locator(".fb-canvas-card")).toHaveAttribute("data-full", "true");
    await page.keyboard.press("Escape");
    await expect(card.locator(".fb-canvas-card")).not.toHaveAttribute("data-full", "true");

    // Export: an SVG of the chart with its title.
    await tools.getByRole("button", { name: "Export" }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Export as SVG" }).click();
    const file = await (await download).path();
    const svg = readFileSync(file!, "utf8");
    expect(svg).toContain("<svg");
    expect(svg).toContain("Sales by region");

    // A table turned into a chart under it: it follows the table.
    await caretToEnd(page);
    await page.keyboard.press("Enter");
    await paste(page, "| Item | Cost |\n| --- | --- |\n| Rent | 1200 |\n| Food | 400 |\n| Travel | 300 |");
    const table = page.locator(".fb-editor .fb-table").last();
    await expect(table).toBeVisible();
    await caretToEnd(page);
    // The grip shows beside the block under the pointer (the table in view first: with Linux's fonts it starts
    // below the window, and the pointer there finds another block's grip).
    const grip = page.getByRole("button", { name: /Drag to move, click for block options/ });
    await expect(async () => {
      await table.scrollIntoViewIfNeeded();
      const tb = (await table.boundingBox())!;
      await page.mouse.move(tb.x + 20, tb.y - 30);
      await page.mouse.move(tb.x + 60, tb.y + tb.height / 2, { steps: 5 });
      await expect(grip).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    await grip.click();
    await page.getByRole("menuitem", { name: "Turn into chart" }).click();
    const fromTable = page.locator(".fb-editor .fb-chart").nth(1);
    // (With Foli AI on, it may have written a title by now.)
    await expect(fromTable.getByRole("img", { name: /^Bar(: [^.]+)?\. 3 categories from Rent to Travel; Cost/ })).toBeVisible();
    await fromTable.getByRole("toolbar", { name: "Chart tools" }).getByRole("button", { name: "Data", exact: true }).click();
    await expect(fromTable.getByText("From table 1 in this note.")).toBeVisible();
    await expect(fromTable.getByRole("textbox", { name: "Cost, row 1" })).toHaveAttribute("readonly", "");

    // A ```chart fence pasted as Markdown becomes a chart (as Foli AI and connected apps write them).
    await caretToEnd(page);
    await paste(page, 'Shares\n\n```chart\n{"kind":"donut","title":"Shares","columns":["Team","People"],"rows":[["Design",4],["Code",9]]}\n```\n');
    await expect(page.getByRole("img", { name: /^Donut: Shares\. 2 slices adding up to 13/ })).toBeVisible();

    // The chart and its panels pass axe in light and dark.
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.evaluate((t) => (document.documentElement.dataset.theme = t), scheme);
      await settle(page);
      const results = await new AxeBuilder({ page }).include(".fb-chart").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
      // Every series colour, as the page resolves it in this theme, reaches 3:1 against the card's tint
      // and the raised surface (tooltips) it's drawn on.
      const low = await page.evaluate(() => {
        const card = document.querySelector<HTMLElement>(".fb-editor .fb-chart .fb-canvas-card")!;
        const cs = getComputedStyle(card);
        const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
        const paint = (...layers: string[]) => {
          ctx.clearRect(0, 0, 1, 1);
          for (const l of layers) { ctx.fillStyle = "#000"; ctx.fillStyle = l; ctx.fillRect(0, 0, 1, 1); }
          return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)].map((v) => v / 255);
        };
        const lum = (c: number[]) => { const [r, g, b] = c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!; };
        const ratio = (a: number[], b: number[]) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi! + 0.05) / (lo! + 0.05); };
        const v = (n: string) => cs.getPropertyValue(n).trim();
        const surfaces = { card: paint(v("--color-surface"), v("--fb-canvas-bg")), raised: paint(v("--color-surface"), v("--color-surface-raised")) };
        const out: string[] = [];
        for (const name of ["blue", "orange", "teal", "yellow", "pink", "green", "violet", "red", "gray"]) {
          const c = paint(v(`--chart-${name}`));
          for (const [where, s] of Object.entries(surfaces)) if (ratio(c, s) < 3) out.push(`${name} ${v(`--chart-${name}`)} on ${where}: ${ratio(c, s).toFixed(2)}`);
        }
        return out;
      });
      expect(low, `series under 3:1 in ${scheme}`).toEqual([]);
    }
    await page.emulateMedia({ colorScheme: "light" });
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));

    // At phone width the toolbar never scrolls sideways: what doesn't fit folds into More, and a panel opened
    // from More floats by it, inside the window.
    await expect(tools.getByRole("button", { name: "More chart tools" })).toHaveCount(0);
    await page.setViewportSize({ width: 375, height: 812 });
    await card.scrollIntoViewIfNeeded();
    const fits = () => tools.evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && [...el.querySelectorAll("button")].filter((b) => b.offsetParent).every((b) => b.getBoundingClientRect().right <= el.getBoundingClientRect().right + 1));
    await expect.poll(fits).toBe(true);
    const moreTools = tools.getByRole("button", { name: "More chart tools" });
    await expect(moreTools).toBeVisible();
    await expect(tools.getByRole("button", { name: "Chart type" })).toBeVisible();
    await moreTools.click();
    await page.getByRole("menu", { name: "More chart tools" }).getByRole("menuitem", { name: "Data from" }).click();
    const fromPanel = page.getByRole("dialog", { name: "Where the chart's numbers come from" });
    await expect(fromPanel).toBeVisible();
    const pb = (await fromPanel.boundingBox())!;
    expect(pb.x).toBeGreaterThanOrEqual(0);
    expect(pb.x + pb.width).toBeLessThanOrEqual(375);
    await fromPanel.getByRole("button").first().focus();
    await page.keyboard.press("Escape");
    await expect(fromPanel).toHaveCount(0);
    await expect(moreTools).toBeFocused();
    await page.setViewportSize({ width: 1280, height: 720 });

    // Saved: after a reload everything is still there.
    await waitForSaved(page);
    await page.waitForTimeout(800);
    await waitForSaved(page);
    await page.reload();
    await expect(page.getByRole("img", { name: /^Bar: Sales by region\./ })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("img", { name: /^Donut: Shares/ })).toBeVisible();

    // The public share page draws the charts read-only, with zoom, and their data as a table.
    await openShare(page);
    const share = page.getByRole("dialog", { name: /Share/ });
    await share.getByRole("button", { name: "Create link" }).click();
    const link = await share.getByLabel("Public link").inputValue();
    const anon = await browser.newContext();
    const anonPage = await anon.newPage();
    await anonPage.goto(link);
    await expect(anonPage.getByRole("img", { name: /^Bar: Sales by region\./ })).toBeVisible({ timeout: 30_000 });
    await expect(anonPage.getByText("East sold the most.")).toBeVisible();
    const shown = anonPage.locator(".fb-chart-static").first();
    await shown.getByText("Show data").click();
    await expect(shown.getByRole("rowheader", { name: "North" })).toBeVisible();
    await shown.hover();
    await shown.getByRole("button", { name: "Zoom in" }).click();
    await expect(shown.locator(".fb-chart-static-plot")).toHaveAttribute("data-zoomed", "true");
    await anon.close();

    // In the iPhone app: the panels are sheets, the cells 44 points tall.
    const state = await context.storageState();
    const url = page.url();
    const phone = await browser.newContext({ storageState: state, viewport: { width: 402, height: 874 }, userAgent: IPHONE_UA, hasTouch: true });
    await phone.addInitScript(() => {
      Object.defineProperty(window, "foleviNative", { value: { platform: "ios", version: "1.0", haptic: () => undefined, setStatusBar: () => undefined, openExternal: async () => true, getSettings: async () => ({ lock: false, lockAfter: 0, method: "faceID" }), setSettings: async () => ({ lock: false, lockAfter: 0, method: "faceID" }), onCommand: () => () => undefined } });
      const mark = () => document.documentElement?.setAttribute("data-native", "ios");
      mark();
      if (!document.documentElement) new MutationObserver((_, watch) => document.documentElement && (mark(), watch.disconnect())).observe(document, { childList: true });
    });
    const iphone = await phone.newPage();
    await iphone.goto(url.startsWith("http") ? url : `${APP}${url}`);
    await expect(iphone.locator("html")).toHaveAttribute("data-iphone", "", { timeout: 30_000 });
    const phoneCard = iphone.locator(".fb-editor .fb-chart").first();
    await expect(phoneCard.getByRole("img", { name: /^Bar: Sales by region/ })).toBeVisible({ timeout: 20_000 });
    // The iPhone's 44 point toolbar folds what doesn't fit into More; Style opens from there as a sheet.
    const phoneTools = phoneCard.getByRole("toolbar", { name: "Chart tools" });
    await expect.poll(() => phoneTools.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    const phoneMore = phoneTools.getByRole("button", { name: "More chart tools" });
    await expect(phoneMore).toBeVisible();
    await phoneMore.tap();
    await iphone.getByRole("menu", { name: "More chart tools" }).getByRole("menuitem", { name: "Style" }).tap();
    const sheet = iphone.getByRole("dialog", { name: "Chart style" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("switch", { name: "Value labels" })).toBeVisible();
    await iphone.keyboard.press("Escape");
    await phoneCard.getByRole("button", { name: "Data", exact: true }).tap();
    const cell = phoneCard.getByRole("textbox", { name: "Sales, row 1" });
    expect((await cell.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await phoneMore.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await phoneTools.getByRole("button", { name: "Data", exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await phone.close();
    await context.close();
  });
});
