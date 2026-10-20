import { readFileSync, mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { newPerson, settle, waitForSaved } from "./helpers";

// Frames and swimlanes in the flowchart: frame a selection, move a frame with what's in it, nest frames, delete
// a frame keeping its shapes; swimlanes in rows and columns, shapes dropped into lanes, lanes renamed from the
// keyboard, resized (their shapes reflow) and reordered, Tidy up keeping lanes, and the export drawing them.

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

const centre = async (l: Locator) => {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
};

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 14 });
  await page.mouse.up();
}

const inside = (outer: { x: number; y: number; width: number; height: number }, inner: { x: number; y: number; width: number; height: number }) =>
  inner.x >= outer.x - 1 && inner.y >= outer.y - 1 && inner.x + inner.width <= outer.x + outer.width + 1 && inner.y + inner.height <= outer.y + outer.height + 1;

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.locator(".fb-flowchart").screenshot({ path: `${SHOTS}/${name}.png` });
}

async function axe(page: Page) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate((t) => (document.documentElement.dataset.theme = t), scheme);
    await settle(page);
    await shot(page, `${test.info().title.slice(0, 24).replace(/\W+/g, "-")}-${scheme}`);
    // The frames, pools and lanes, and their toolbar buttons (e2e/flowchart.spec.ts checks the whole canvas).
    const results = await new AxeBuilder({ page }).include(".fc-containers").include('[aria-label="Frames and swimlanes"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
}

test.describe("Flowchart frames and swimlanes", () => {
  test.setTimeout(180_000);

  test("frame a selection, move the frame with its shapes, nest frames, delete keeping the shapes", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Frames Tester");
    const canvas = await newFlowchart(page, "Frames");
    const tools = page.getByRole("toolbar", { name: "Flowchart tools" });
    const svg = canvas.locator("svg.fc-svg");
    const box = (await svg.boundingBox())!;

    // Two shapes side by side, and a third further down.
    for (const [x, y, text] of [
      [140, 170, "Pick items"],
      [380, 170, "Pay"],
      [260, 360, "Ship"],
    ] as const) {
      await page.mouse.dblclick(box.x + x, box.y + y);
      await page.keyboard.type(text);
      await page.keyboard.press("Enter");
    }
    const pick = canvas.getByRole("button", { name: "Process: Pick items" });
    const pay = canvas.getByRole("button", { name: "Process: Pay" });
    const ship = canvas.getByRole("button", { name: "Process: Ship" });
    await expect(ship).toBeVisible();

    // Frame the first two from the toolbar; the frame's title is ready to type.
    await pick.click();
    await pay.click({ modifiers: ["Shift"] });
    await tools.getByRole("button", { name: "Frame selection" }).click();
    await expect(canvas.getByRole("textbox", { name: "Frame title" })).toBeFocused();
    await page.keyboard.type("Checkout");
    await page.keyboard.press("Enter");
    const checkout = canvas.getByRole("button", { name: "Frame: Checkout, 2 shapes" });
    await expect(checkout).toBeVisible();
    await shot(page, "frame-selection");

    // Drag the frame by its title: both shapes move with it, the third stays.
    const band = checkout.locator(".fc-frame-band");
    const before = { pick: (await pick.boundingBox())!, ship: (await ship.boundingBox())!, band: await centre(band) };
    const grabAt = { x: before.band.b.x + 24, y: before.band.y };
    await drag(page, grabAt, { x: grabAt.x + 60, y: grabAt.y - 40 });
    await expect(async () => {
      const now = (await pick.boundingBox())!;
      expect(Math.round(now.x - before.pick.x)).toBeGreaterThan(40);
      expect(Math.round(now.y - before.pick.y)).toBeLessThan(-20);
    }).toPass();
    expect((await ship.boundingBox())!.x).toBeCloseTo(before.ship.x, 0);
    // The frame holds its shapes.
    expect(inside((await checkout.locator(".fc-frame-body").boundingBox())!, (await pay.boundingBox())!)).toBe(true);

    // Put the third shape in a frame of its own with ⌥⌘G, then drag that frame into Checkout: it nests.
    await ship.click();
    await page.keyboard.press("ControlOrMeta+Alt+g");
    await page.keyboard.type("Delivery");
    await page.keyboard.press("Enter");
    const delivery = canvas.getByRole("button", { name: "Frame: Delivery, 1 shape" });
    await expect(delivery).toBeVisible();
    const dBand = await centre(delivery.locator(".fc-frame-band"));
    const target = await centre(checkout.locator(".fc-frame-body"));
    // Held by the title (the shape's own handles sit near the middle of the band).
    const dBody = (await delivery.locator(".fc-frame-body").boundingBox())!;
    await drag(page, { x: dBand.b.x + 24, y: dBand.y }, { x: target.x - dBody.width / 2 + 24, y: target.y - dBody.height / 2 + (dBand.y - dBody.y) });
    await expect(canvas.getByRole("button", { name: "Frame: Checkout, 3 shapes" })).toBeVisible();
    await shot(page, "nested-frames");

    // Undo takes the nesting back as one step; redo brings it back.
    await page.keyboard.press("ControlOrMeta+z");
    await expect(canvas.getByRole("button", { name: "Frame: Checkout, 2 shapes" })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(canvas.getByRole("button", { name: "Frame: Checkout, 3 shapes" })).toBeVisible();

    // Delete the outer frame, keeping what's inside: the shapes and the inner frame stay.
    await canvas.getByRole("button", { name: "Frame: Checkout, 3 shapes" }).locator(".fc-frame-band").click();
    await page.keyboard.press("Delete");
    await page.getByRole("menuitem", { name: "Delete frame, keep shapes" }).click();
    await expect(canvas.locator('[data-kind="frame"]')).toHaveCount(1);
    await expect(canvas.getByRole("button", { name: "Frame: Delivery, 1 shape" })).toBeVisible();
    await expect(canvas.locator("[data-fc-node]")).toHaveCount(3);

    // Right-click a frame: its menu; renaming from the keyboard.
    await canvas.getByRole("button", { name: "Frame: Delivery, 1 shape" }).locator(".fc-frame-band").click({ button: "right" });
    await expect(page.getByRole("menu", { name: "Frame" })).toBeVisible();
    await page.keyboard.press("Escape");
    await canvas.focus();
    await page.keyboard.press("Tab");
    await expect(canvas.getByRole("button", { name: "Frame: Delivery, 1 shape" })).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Shipping");
    await page.keyboard.press("Enter");
    await expect(canvas.getByRole("button", { name: "Frame: Shipping, 1 shape" })).toBeVisible();
    // Colour it from its bar.
    await page.getByRole("toolbar", { name: "Selected frame" }).getByRole("button", { name: "Green" }).click();
    await expect(canvas.locator('.fc-frame[data-color="green"]')).toHaveCount(1);

    await axe(page);

    // It all persists.
    await waitForSaved(page);
    await page.waitForTimeout(800);
    await waitForSaved(page);
    await page.reload();
    await expect(page.getByRole("application", { name: /Flowchart, 3 shapes/ }).getByRole("button", { name: "Frame: Shipping, 1 shape" })).toBeVisible();
    await context.close();
  });

  test("swimlanes in rows and columns: drop into lanes, rename, resize with reflow, reorder, tidy, export", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Lanes Tester");
    const canvas = await newFlowchart(page, "Swimlanes");
    const tools = page.getByRole("toolbar", { name: "Flowchart tools" });

    // Swimlanes in rows from the toolbar; name the pool.
    await tools.getByRole("button", { name: "Add swimlanes" }).click();
    await page.getByRole("menuitem", { name: "Swimlanes in rows" }).click();
    await expect(canvas.getByRole("textbox", { name: "Swimlanes title" })).toBeFocused();
    await page.keyboard.type("Teams");
    await page.keyboard.press("Enter");
    await expect(canvas.getByRole("button", { name: "Swimlanes: Teams, 3 rows, empty" })).toBeVisible();
    const lanes = canvas.locator('[data-kind="lane"]');
    await expect(lanes).toHaveCount(3);
    const laneIds = await lanes.evaluateAll((els) => els.map((e) => e.getAttribute("data-fc-box")!));
    const lane = (id: string) => canvas.locator(`[data-fc-box="${id}"]`);
    const body = (id: string) => lane(id).locator(".fc-lane-body");

    // A shape added in the first lane belongs to it.
    const l0 = await centre(body(laneIds[0]!));
    await page.mouse.dblclick(l0.x - 120, l0.y);
    await page.keyboard.type("Quote");
    await page.keyboard.press("Enter");
    await expect(lane(laneIds[0]!)).toHaveAccessibleName(/^Lane: Lane 1, 1 shape, lane 1 of 3 in Teams$/);
    const quote = canvas.getByRole("button", { name: "Process: Quote" });

    // Drag it into the second lane, half over the edge: it snaps fully inside that lane.
    const q = await centre(quote);
    const l1 = await centre(body(laneIds[1]!));
    await drag(page, q, { x: q.x + 140, y: l1.b.y + 12 });
    await expect(lane(laneIds[1]!)).toHaveAccessibleName(/1 shape/);
    await expect(lane(laneIds[0]!)).toHaveAccessibleName(/empty/);
    await expect(async () => expect(inside((await body(laneIds[1]!).boundingBox())!, (await quote.boundingBox())!)).toBe(true)).toPass();

    // A second shape in the third lane, connected.
    const l2 = await centre(body(laneIds[2]!));
    await page.mouse.dblclick(l2.x + 120, l2.y);
    await page.keyboard.type("Deliver");
    await page.keyboard.press("Enter");
    const deliver = canvas.getByRole("button", { name: "Process: Deliver" });
    await expect(lane(laneIds[2]!)).toHaveAccessibleName(/1 shape/);
    await quote.hover();
    const quoteId = await quote.getAttribute("data-fc-node");
    const handle = await centre(canvas.locator(`[data-fc-handle][data-node="${quoteId}"][data-side="bottom"]`));
    await drag(page, handle, await centre(deliver));
    await expect(canvas.locator(".fc-edge .fc-edge-line")).toHaveCount(1);

    // Keyboard: Tab reaches the pool, then its lanes; Enter renames the lane.
    await canvas.focus();
    await page.keyboard.press("Tab");
    await expect(canvas.getByRole("button", { name: /^Swimlanes: Teams/ })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(lane(laneIds[0]!)).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(lane(laneIds[1]!)).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Sales");
    await page.keyboard.press("Enter");
    await expect(lane(laneIds[1]!)).toHaveAccessibleName(/^Lane: Sales, 1 shape, lane 2 of 3/);

    // Resize the Sales lane by its edge: smaller, its shape reflows to stay inside.
    await lane(laneIds[1]!).locator(".fc-lane-header").click();
    const grip = await centre(canvas.locator(`[data-fc-lane-resize="${laneIds[1]}"] .fc-grip`));
    const tall = (await body(laneIds[1]!).boundingBox())!.height;
    await drag(page, grip, { x: grip.x, y: grip.y - 120 });
    await expect(async () => expect((await body(laneIds[1]!).boundingBox())!.height).toBeLessThan(tall - 20)).toPass();
    expect(inside((await body(laneIds[1]!).boundingBox())!, (await quote.boundingBox())!)).toBe(true);
    // The Deliver lane moved up with its shape.
    expect(inside((await body(laneIds[2]!).boundingBox())!, (await deliver.boundingBox())!)).toBe(true);
    await shot(page, "lane-resized");

    // Reorder: ⌥↑ moves the Sales lane to the top, its shape with it; the bar's button moves it back down.
    await page.keyboard.press("Alt+ArrowUp");
    await expect(lane(laneIds[1]!)).toHaveAccessibleName(/lane 1 of 3/);
    expect(inside((await body(laneIds[1]!).boundingBox())!, (await quote.boundingBox())!)).toBe(true);
    await page.getByRole("toolbar", { name: "Selected lane" }).getByRole("button", { name: "Move lane down" }).click();
    await expect(lane(laneIds[1]!)).toHaveAccessibleName(/lane 2 of 3/);

    // Add a lane from the bar, then Tidy up: every shape stays in its lane.
    await page.getByRole("toolbar", { name: "Selected lane" }).getByRole("button", { name: "Add lane" }).click();
    await page.keyboard.press("Enter");
    await expect(lanes).toHaveCount(4);
    await tools.getByRole("button", { name: /Tidy up/ }).click();
    await expect(async () => {
      expect(inside((await body(laneIds[1]!).boundingBox())!, (await quote.boundingBox())!)).toBe(true);
      expect(inside((await body(laneIds[2]!).boundingBox())!, (await deliver.boundingBox())!)).toBe(true);
    }).toPass();

    // The export draws the lanes and their titles.
    await tools.getByRole("button", { name: "Export" }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Export as SVG" }).click();
    const file = readFileSync((await (await download).path())!, "utf8");
    expect(file).toContain("<svg");
    expect(file).toContain("Teams");
    expect(file).toContain("Sales");
    expect(file).toContain("Lane 3");

    // Swimlanes in columns too.
    await tools.getByRole("button", { name: "Add swimlanes" }).click();
    await page.getByRole("menuitem", { name: "Swimlanes in columns" }).click();
    await page.keyboard.type("Stages");
    await page.keyboard.press("Enter");
    await expect(canvas.getByRole("button", { name: "Swimlanes: Stages, 3 columns, empty" })).toBeVisible();
    // Colour a column; remove the empty lane added above (nothing inside, so no question).
    const columns = canvas.locator('[data-kind="lane"][aria-label*="in Stages"]');
    await columns.first().locator(".fc-lane-header").click();
    await page.getByRole("toolbar", { name: "Selected lane" }).getByRole("button", { name: "Blue" }).click();
    await expect(canvas.locator('.fc-lane[data-color="blue"]')).toHaveCount(1);
    await page.getByRole("button", { name: "Fit to content" }).click();
    const added = canvas.locator('[data-kind="lane"][aria-label*="in Teams"]').filter({ hasNotText: /Sales|Lane 1|Lane 3/ });
    await added.focus();
    await page.keyboard.press("Delete");
    await expect(canvas.locator('[data-kind="lane"][aria-label*="in Teams"]')).toHaveCount(3);
    await shot(page, "rows-and-columns");

    await axe(page);

    // Phone width: the canvas and its bars still fit.
    await page.setViewportSize({ width: 390, height: 844 });
    await settle(page);
    await page.getByRole("button", { name: "Fit to content" }).click();
    await lane(laneIds[1]!).focus();
    await expect(page.getByRole("toolbar", { name: "Selected lane" })).toBeVisible();
    const bar = (await page.getByRole("toolbar", { name: "Selected lane" }).boundingBox())!;
    expect(bar.x).toBeGreaterThanOrEqual(0);
    expect(bar.x + bar.width).toBeLessThanOrEqual(390);
    await shot(page, "phone");
    await page.setViewportSize({ width: 1280, height: 800 });

    await waitForSaved(page);
    await page.waitForTimeout(800);
    await waitForSaved(page);
    await page.reload();
    const again = page.getByRole("application", { name: /Flowchart, 2 shapes/ });
    await expect(again.getByRole("button", { name: /^Lane: Sales, 1 shape/ })).toBeVisible();
    await expect(again.getByRole("button", { name: "Swimlanes: Stages, 3 columns, empty" })).toBeVisible();
    await expect(again.locator('.fc-lane[data-color="blue"]')).toHaveCount(1);
    await expect(again.locator('[data-kind="lane"][aria-label*="in Teams"]')).toHaveCount(3);
    await context.close();
  });
});
