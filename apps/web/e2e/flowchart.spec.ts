import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { newPerson, openTool, settle, waitForSaved, openShare } from "./helpers";

async function newPage(page: Page, title: string) {
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Intro");
  await waitForSaved(page);
}

test.describe("Flowchart", () => {
  test.setTimeout(150_000);

  test("draw shapes, connect them, write in them, undo, tidy up: it persists and publishes", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Flowchart Tester");
    await newPage(page, "Flowchart");

    // Slash menu → Flowchart: an empty canvas with its toolbar.
    await page.keyboard.press("Enter");
    await page.keyboard.type("/flowchart");
    await page.getByRole("option", { name: /Flowchart/ }).first().click();
    const canvas = page.getByRole("application", { name: /Flowchart/ });
    await expect(canvas).toBeVisible();
    const tools = page.getByRole("toolbar", { name: "Flowchart tools" });
    await expect(canvas.getByText("Double-click anywhere to add a shape")).toBeVisible();

    // Add a start pill and a process box from the toolbar, typing their text.
    await tools.getByRole("button", { name: "Add start / end" }).click();
    await page.keyboard.type("Start");
    await page.keyboard.press("Enter");
    const svg = canvas.locator("svg.fc-svg");
    const box = (await svg.boundingBox())!;
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height - 60);
    await page.keyboard.type("Review the draft");
    await page.keyboard.press("Enter");
    await expect(canvas.getByRole("button", { name: "Start / end: Start" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Process: Review the draft" })).toBeVisible();

    // Connect: drag from the start pill's bottom handle onto the process box.
    const start = canvas.getByRole("button", { name: "Start / end: Start" });
    const review = canvas.getByRole("button", { name: "Process: Review the draft" });
    await start.hover();
    // The start pill's own bottom handle (another selected shape can show handles too).
    const startId = await start.getAttribute("data-fc-node");
    const handle = canvas.locator(`[data-fc-handle][data-node="${startId}"][data-side="bottom"]`);
    const h = (await handle.boundingBox())!;
    const r = (await review.boundingBox())!;
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2, { steps: 12 });
    await page.mouse.up();
    await expect(canvas.locator(".fc-edge .fc-edge-line")).toHaveCount(1);

    // Undo inside the canvas removes the connector; redo brings it back.
    await page.keyboard.press("ControlOrMeta+z");
    await expect(canvas.locator(".fc-edge .fc-edge-line")).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(canvas.locator(".fc-edge .fc-edge-line")).toHaveCount(1);

    // Colour a shape from the selection bar; Tidy up lays the chart out.
    await review.click();
    await page.getByRole("toolbar", { name: "Selected shapes" }).getByRole("button", { name: "Blue" }).click();
    await expect(canvas.locator('.fc-node[data-color="blue"]')).toHaveCount(1);
    await tools.getByRole("button", { name: /Tidy up/ }).click();

    // Keyboard: Tab reaches the shapes.
    await canvas.focus();
    await page.keyboard.press("Tab");
    await expect(canvas.locator(".fc-node:focus")).toHaveCount(1);

    // The canvas and its toolbars pass axe in light and dark.
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.evaluate((t) => (document.documentElement.dataset.theme = t), scheme);
      await settle(page);
      const results = await new AxeBuilder({ page }).include(".fb-flowchart").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
    }
    await page.emulateMedia({ colorScheme: "light" });
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));

    await waitForSaved(page);
    await page.waitForTimeout(800);
    await waitForSaved(page);
    await page.reload();
    await expect(page.getByRole("application", { name: /Flowchart, 2 shapes/ })).toBeVisible();
    await expect(page.locator(".fb-flowchart .fc-edge .fc-edge-line")).toHaveCount(1);

    // The public share page draws the chart as a static picture.
    await openShare(page);
    const share = page.getByRole("dialog", { name: /Share/ });
    await share.getByRole("button", { name: "Create link" }).click();
    const link = await share.getByLabel("Public link").inputValue();
    const anon = await browser.newContext();
    const anonPage = await anon.newPage();
    await anonPage.goto(link);
    await expect(anonPage.getByRole("img", { name: /Flowchart with 2 shapes: Start, Review the draft/ })).toBeVisible();
    await anon.close();
    await context.close();
  });

  test("⌘Z while typing in a shape undoes the typing, never the flowchart block itself", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Undo Tester");
    await newPage(page, "Undo in shapes");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/flowchart");
    await page.getByRole("option", { name: /Flowchart/ }).first().click();
    const canvas = page.getByRole("application", { name: /Flowchart/ });
    await page.getByRole("toolbar", { name: "Flowchart tools" }).getByRole("button", { name: "Add process" }).click();
    await page.keyboard.type("Draft");
    await page.keyboard.press("Enter");
    await expect(canvas.getByRole("button", { name: "Process: Draft" })).toBeVisible();
    await canvas.getByRole("button", { name: "Process: Draft" }).dblclick();
    await page.keyboard.type(" two");
    await page.keyboard.press("ControlOrMeta+z");
    await expect(canvas).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Process: Draft" })).toBeVisible();
    await context.close();
  });

  test("a Mermaid diagram folds its source away and converts to a flowchart", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Mermaid Tester");
    await newPage(page, "Mermaid");
    const panel = await openTool(page, "Insert");
    await page.locator(".fb-editor > p.fb").last().click();
    await page.keyboard.press("End");
    await panel.getByRole("button", { name: "Mermaid diagram" }).click();
    const card = page.locator(".fb-editor pre.fb-code-mermaid");
    await expect(card.locator("img.fb-mermaid-svg")).toBeVisible({ timeout: 30_000 });
    // Caret elsewhere: the source is folded away.
    await page.locator(".fb-editor > p.fb").first().click();
    await expect(card.locator("code")).toBeHidden();
    await card.hover();
    await card.getByRole("button", { name: "Edit diagram" }).click();
    await expect(card.locator("code")).toBeVisible();
    await card.getByRole("button", { name: "Convert to flowchart" }).click();
    await expect(page.locator(".fb-editor pre.fb-code-mermaid")).toHaveCount(0);
    await expect(page.getByRole("application", { name: /Flowchart, 5 shapes/ })).toBeVisible();
    await context.close();
  });
});
