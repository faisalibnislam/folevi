// Building a flowchart faster: a whole flow from the keyboard, quick add arrows with a mouse and a finger,
// the shape picker where a connector is let go on empty canvas, smart guides and align.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { APP, newPerson, waitForSaved } from "./helpers";

const SHOTS = process.env.FLOWCHART_SHOTS;

async function newFlowchart(page: Page, title: string) {
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Intro");
  await waitForSaved(page);
  await page.keyboard.press("Enter");
  await page.keyboard.type("/flowchart");
  await page.getByRole("option", { name: /Flowchart/ }).first().click();
  const canvas = page.getByRole("application", { name: /Flowchart/ });
  await expect(canvas).toBeVisible();
  return canvas;
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** Every shape's box, for overlap and alignment checks. */
async function boxes(canvas: Locator) {
  return canvas.locator("[data-fc-node]").evaluateAll((els) =>
    els.map((el) => {
      const r = (el.querySelector(".fc-focus") ?? el).getBoundingClientRect();
      return { label: el.getAttribute("aria-label") ?? "", x: r.x, y: r.y, w: r.width, h: r.height };
    }),
  );
}
const overlapping = (bs: { x: number; y: number; w: number; h: number }[]) => bs.some((a, i) => bs.some((b, j) => i < j && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y));

test.describe("Flowchart: building faster", () => {
  test.setTimeout(180_000);

  test("a six-step flow with a branch, written only from the keyboard", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Keyboard Flow Tester");
    const canvas = await newFlowchart(page, "Keyboard flow");
    const node = (name: string) => canvas.getByRole("button", { name: new RegExp(`^${name.replace(/[/]/g, "\\/")}, shape`) });

    // From the canvas, Tab reaches the toolbar (no shapes yet); Enter on "Add start / end" adds one to write in.
    await canvas.focus();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      if ((await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))) === "Add start / end") break;
    }
    await page.keyboard.press("Enter");
    await page.keyboard.type("Start");
    // Tab finishes the text and adds the next step below, connected; each Tab carries on.
    await page.keyboard.press("Tab");
    await page.keyboard.type("Fill in the form");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Review");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Approve");
    // Shift+Tab: a branch beside it, from the same parent.
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.type("Reject");
    await page.keyboard.press("Enter");
    await expect(canvas.locator(".fc-text-input")).toHaveCount(0);
    // Screen readers hear what happened.
    await expect(canvas.locator(".fc-announce")).toHaveText(/Added process beside process Approve, connected\. 5 shapes/);

    // Arrow keys walk the chart: left from Reject is Approve, which keeps the keyboard.
    await page.keyboard.press("ArrowLeft");
    await expect(node("Process: Approve")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(node("Process: Review")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(node("Process: Approve")).toBeFocused();
    // Tab from a selected shape adds the next step; typing replaces nothing but starts its text.
    await page.keyboard.press("Tab");
    await page.keyboard.type("Send confirmation");
    await page.keyboard.press("Enter");
    await expect(node("Process: Send confirmation")).toBeFocused();

    // Enter edits; typing a character on a selected shape starts writing with it.
    await page.keyboard.press("Enter");
    await expect(canvas.locator(".fc-text-input")).toContainText("Send confirmation");
    await page.keyboard.press("Escape");
    await page.keyboard.press("ArrowUp");
    await expect(node("Process: Approve")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await expect(node("Start / end: Start")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(canvas.locator(".fc-announce")).toHaveText(/No shape above/);

    await expect(canvas.locator("[data-fc-node]")).toHaveCount(6);
    await expect(canvas.locator(".fc-edge .fc-edge-line")).toHaveCount(5);
    const bs = await boxes(canvas);
    expect(overlapping(bs)).toBe(false);
    const at = (l: string) => bs.find((b) => b.label.startsWith(l))!;
    // The steps line up down the flow; the two branches sit side by side.
    expect(Math.abs(at("Start / end: Start").x + at("Start / end: Start").w / 2 - (at("Process: Review").x + at("Process: Review").w / 2))).toBeLessThan(2);
    expect(Math.abs(at("Process: Approve").y - at("Process: Reject").y)).toBeLessThan(2);
    expect(at("Process: Send confirmation").y).toBeGreaterThan(at("Process: Approve").y);
    await shot(page, "keyboard-flow");

    // A step added and its text are one undo step.
    await page.keyboard.press("ControlOrMeta+z");
    await expect(canvas.locator("[data-fc-node]")).toHaveCount(5);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(node("Process: Send confirmation")).toHaveCount(1);

    // Esc steps back: the selection, then the note.
    await node("Start / end: Start").focus();
    await page.keyboard.press("Escape");
    await expect(canvas.locator('.fc-node[data-selected]')).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(canvas).not.toBeFocused();
    await expect(page.locator(".fb-flowchart.ProseMirror-selectednode, .fb-flowchart.fb-atom-selected")).toHaveCount(1);

    await waitForSaved(page);
    await page.waitForTimeout(800);
    await waitForSaved(page);
    await page.reload();
    await expect(page.getByRole("application", { name: /Flowchart, 6 shapes/ })).toBeVisible();
    await expect(page.locator(".fb-flowchart .fc-edge .fc-edge-line")).toHaveCount(5);
    await context.close();
  });

  test("quick add arrows, the shape picker, smart guides and align, with a mouse and with a finger", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Quick Add Tester");
    const canvas = await newFlowchart(page, "Quick add");
    const tools = page.getByRole("toolbar", { name: "Flowchart tools" });
    await tools.getByRole("button", { name: "Add process" }).click();
    await page.keyboard.type("One");
    await page.keyboard.press("Enter");
    const one = canvas.getByRole("button", { name: /^Process: One/ });
    const oneId = (await one.getAttribute("data-fc-node"))!;
    // Nothing selected: hovering shows the arrows (with a shape selected, its bar covers the top one).
    await page.keyboard.press("Escape");

    // Hovering shows a + on each side; clicking the right one adds the next shape there, connected and level.
    await one.hover();
    const right = canvas.locator(`[data-fc-quick][data-node="${oneId}"][data-side="right"]`);
    await expect(canvas.locator(`[data-fc-quick][data-node="${oneId}"]`)).toHaveCount(4);
    await shot(page, "quick-add-hover");
    await right.locator(".fc-quick-dot").click();
    await page.keyboard.type("Two");
    await page.keyboard.press("Enter");
    const two = canvas.getByRole("button", { name: /^Process: Two/ });
    await expect(canvas.locator(".fc-edge .fc-edge-line")).toHaveCount(1);
    const [b1, b2] = [(await one.boundingBox())!, (await two.boundingBox())!];
    expect(Math.abs(b1.y - b2.y)).toBeLessThan(2);
    expect(b2.x).toBeGreaterThan(b1.x + b1.width);
    // One undo removes the shape with its text.
    await page.keyboard.press("ControlOrMeta+z");
    await expect(canvas.locator("[data-fc-node]")).toHaveCount(1);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(two).toBeVisible();

    // Dragging a + out and letting go on empty canvas opens the picker there; search and Enter pick a shape.
    const twoId = (await two.getAttribute("data-fc-node"))!;
    await two.hover();
    const down = canvas.locator(`[data-fc-quick][data-node="${twoId}"][data-side="bottom"] .fc-quick-dot`);
    const d = (await down.boundingBox())!;
    await page.mouse.move(d.x + d.width / 2, d.y + d.height / 2);
    await page.mouse.down();
    await page.mouse.move(d.x + d.width / 2, d.y + 110, { steps: 10 });
    await page.mouse.up();
    const picker = canvas.getByRole("dialog", { name: "Choose a shape" });
    await expect(picker).toBeVisible();
    await expect(picker.getByRole("combobox", { name: "Search shapes" })).toBeFocused();
    await expect(picker.getByRole("option").first()).toHaveText("Process");
    await shot(page, "picker");
    await page.keyboard.type("decis");
    await expect(picker.getByRole("option").first()).toHaveText("Decision");
    await page.keyboard.press("Enter");
    await expect(picker).toHaveCount(0);
    await page.keyboard.type("Ready?");
    await page.keyboard.press("Enter");
    const decision = canvas.getByRole("button", { name: /^Decision: Ready\?/ });
    await expect(decision).toBeVisible();
    await expect(canvas.locator(".fc-edge .fc-edge-line")).toHaveCount(2);
    const [dd, tt] = [(await decision.boundingBox())!, (await two.boundingBox())!];
    expect(dd.y).toBeGreaterThan(tt.y + tt.height + 40);
    expect(Math.abs(dd.x + dd.width / 2 - (tt.x + tt.width / 2))).toBeLessThan(12);

    // A new connector from a side handle let go on empty canvas opens the same picker; recent shapes come first.
    await page.mouse.click(10, 10);
    await one.hover();
    const handle = canvas.locator(`[data-fc-handle][data-node="${oneId}"][data-side="bottom"]`);
    const h = (await handle.boundingBox())!;
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + h.width / 2, h.y + 170, { steps: 10 });
    await page.mouse.up();
    await expect(picker).toBeVisible();
    await expect(picker.getByRole("option").first()).toHaveText("Decision");
    // Esc closes it without adding anything.
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await expect(canvas.locator("[data-fc-node]")).toHaveCount(3);
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + h.width / 2, h.y + 170, { steps: 10 });
    await page.mouse.up();
    await picker.getByRole("option", { name: "Database" }).click();
    await page.keyboard.type("Store");
    await page.keyboard.press("Enter");
    await expect(canvas.getByRole("button", { name: /^Database: Store/ })).toBeVisible();
    await expect(canvas.locator(".fc-edge .fc-edge-line")).toHaveCount(3);

    // Smart guides: dragging a shape near another's edge shows a guide and snaps to it.
    const store = canvas.getByRole("button", { name: /^Database: Store/ });
    const s0 = (await store.boundingBox())!;
    const t0 = (await two.boundingBox())!;
    await page.mouse.move(s0.x + s0.width / 2, s0.y + s0.height / 2);
    await page.mouse.down();
    await page.mouse.move(s0.x + s0.width / 2 + 40, s0.y + s0.height / 2 + 20, { steps: 4 });
    // Its left edge three pixels off Two's left edge.
    const target = t0.x + 3 - (s0.x + 40);
    await page.mouse.move(s0.x + s0.width / 2 + 40 + target, s0.y + s0.height / 2 + 20, { steps: 6 });
    // (A guide is a hairline: present, though too thin to count as visible.)
    await expect(canvas.locator(".fc-guide")).not.toHaveCount(0);
    await shot(page, "smart-guide");
    await page.mouse.up();
    await expect(canvas.locator(".fc-guide")).toHaveCount(0);
    const s1 = (await store.boundingBox())!;
    expect(Math.abs(s1.x - t0.x)).toBeLessThan(1.5);

    // Align: select three shapes, align their tops from the selection bar, as one undo step.
    const relBefore = (await store.boundingBox())!.y - (await decision.boundingBox())!.y;
    await one.click();
    await two.click({ modifiers: ["Shift"] });
    await store.click({ modifiers: ["Shift"] });
    const bar = page.getByRole("toolbar", { name: "Selected shapes" });
    await bar.getByRole("button", { name: "Align and distribute" }).click();
    await shot(page, "align-menu");
    await page.getByRole("menuitem", { name: "Align top" }).click();
    const tops = await Promise.all([one, two, store].map(async (l) => (await l.boundingBox())!.y));
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(1.5);
    await expect(canvas.locator(".fc-announce")).toHaveText(/Aligned 3 shapes to the top/);
    // (Measured against the decision, which align didn't move: focusing can scroll the page.)
    const rel = async () => (await store.boundingBox())!.y - (await decision.boundingBox())!.y;
    await canvas.focus();
    await page.keyboard.press("ControlOrMeta+z");
    expect(Math.abs((await rel()) - relBefore)).toBeLessThan(1.5);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await bar.getByRole("button", { name: "Align and distribute" }).click();
    await page.getByRole("menuitem", { name: "Space evenly across" }).click();
    const xs = (await Promise.all([one, two, store].map(async (l) => (await l.boundingBox())!))).sort((a, b) => a.x - b.x);
    expect(Math.abs(xs[1]!.x - (xs[0]!.x + xs[0]!.width) - (xs[2]!.x - (xs[1]!.x + xs[1]!.width)))).toBeLessThan(2);

    // In dark mode the arrows and picker keep their contrast.
    await page.emulateMedia({ colorScheme: "dark" });
    await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
    await page.mouse.click(10, 10);
    await decision.hover();
    await shot(page, "quick-add-dark");
    await page.emulateMedia({ colorScheme: "light" });
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));

    await waitForSaved(page);
    await page.waitForTimeout(800);
    await waitForSaved(page);
    const url = page.url().replace(/\?.*$/, "");
    const state = await context.storageState();

    // A finger: tapping a shape selects it and shows its + arrows (44 pt targets); tapping one adds a shape.
    const phone = await browser.newContext({ storageState: state, viewport: { width: 402, height: 874 }, hasTouch: true, isMobile: true });
    const ph = await phone.newPage();
    await ph.goto(url.replace(/^https?:\/\/[^/]+/, APP));
    await expect(ph.getByRole("application", { name: /Flowchart, 4 shapes/ })).toBeVisible({ timeout: 30_000 });
    const pc = ph.getByRole("application", { name: /Flowchart/ });
    await pc.scrollIntoViewIfNeeded();
    await pc.getByRole("button", { name: "Fit to content" }).click();
    const pOne = pc.getByRole("button", { name: /^Process: One/ });
    const ob = (await pOne.boundingBox())!;
    await ph.touchscreen.tap(ob.x + ob.width / 2, ob.y + ob.height / 2);
    await expect(pc.locator('.fc-node[data-selected]')).toHaveCount(1);
    const arrows = pc.locator(`[data-fc-quick][data-node="${oneId}"]`);
    await expect(arrows.first()).toBeVisible();
    const hit = (await arrows.last().locator(".fc-quick-hit").boundingBox())!;
    expect(Math.min(hit.width, hit.height)).toBeGreaterThanOrEqual(44);
    await shot(ph, "quick-add-touch");
    const below = (await pc.locator(`[data-fc-quick][data-node="${oneId}"][data-side="bottom"] .fc-quick-hit`).boundingBox())!;
    await ph.touchscreen.tap(below.x + below.width / 2, below.y + below.height / 2);
    await expect(pc.locator(".fc-text-input")).toBeVisible();
    await ph.keyboard.type("Zero");
    await ph.keyboard.press("Enter");
    await expect(pc.getByRole("button", { name: /^Process: Zero/ })).toBeVisible();
    await expect(pc.locator("[data-fc-node]")).toHaveCount(5);
    await expect(pc.locator(".fc-edge .fc-edge-line")).toHaveCount(4);
    await shot(ph, "quick-add-touch-after");
    await phone.close();
    await context.close();
  });

  test("shortcuts after clicking a shape, and the + arrows keep off a frame's title", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Shortcut Tester");
    const canvas = await newFlowchart(page, "Shortcuts");
    const tools = page.getByRole("toolbar", { name: "Flowchart tools" });
    await tools.getByRole("button", { name: "Add process" }).click();
    await page.keyboard.type("Solo");
    await page.keyboard.press("Enter");
    const solo = canvas.getByRole("button", { name: /^Process: Solo/ }).first();

    // Clicking a shape gives it the keyboard; the canvas shortcuts still work from there.
    await page.keyboard.press("Escape");
    await solo.click();
    await expect(solo).toBeFocused();
    await page.keyboard.press("ControlOrMeta+d");
    await expect(canvas.locator("[data-fc-node]")).toHaveCount(2);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(canvas.locator("[data-fc-node]")).toHaveCount(1);
    // Also when a toolbar button had the keyboard before the click.
    await page.getByRole("toolbar", { name: "Zoom" }).getByRole("button", { name: "Zoom in" }).click();
    await solo.click();
    await expect(solo).toBeFocused();
    await page.keyboard.press("ControlOrMeta+d");
    await expect(canvas.locator("[data-fc-node]")).toHaveCount(2);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(canvas.locator("[data-fc-node]")).toHaveCount(1);
    await solo.click();
    await page.keyboard.press("ControlOrMeta+a");
    await expect(canvas.locator(".fc-node[data-selected]")).toHaveCount(1);
    await solo.click();
    await page.keyboard.press("Enter");
    await expect(canvas.locator(".fc-text-input")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(canvas.locator(".fc-text-input")).toHaveCount(0);
    await page.keyboard.press("Alt+ArrowRight");
    await page.keyboard.press("Backspace");
    await expect(canvas.locator("[data-fc-node]")).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(canvas.locator("[data-fc-node]")).toHaveCount(1);

    // Framed: the shape's arrows never sit on the frame's title band (pressing there moves the frame).
    await solo.click();
    await tools.getByRole("button", { name: "Frame selection" }).click();
    await expect(canvas.locator(".fc-frame-band")).toHaveCount(1);
    await solo.click();
    await solo.hover();
    const id = (await solo.getAttribute("data-fc-node"))!;
    await expect(canvas.locator(`[data-fc-quick][data-node="${id}"]`).first()).toBeVisible();
    // (Title bands and lane headers; a frame's border is pressed to move it too, but along its edge.)
    const bands = await canvas.locator(".fc-frame-band, .fc-pool-band, .fc-lane-header").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect));
    const hits = await canvas.locator(`[data-fc-quick][data-node="${id}"] .fc-quick-hit`).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect));
    const meets = (a: DOMRect, b: DOMRect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    expect(hits.filter((h) => bands.some((b) => meets(h, b)))).toEqual([]);
    await shot(page, "framed-arrows");
    await context.close();
  });
});
