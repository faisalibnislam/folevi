// Flowchart connectors that adjust to the shapes: two shapes in line, close together, are joined by one
// straight segment (not a loop out to the side); dragging one sideways turns it into an elbow that never
// doubles back; Reverse direction moves the arrowhead to the other shape, and that is saved (it survives a
// reload) and undone in one step.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { newPerson, waitForSaved } from "./helpers";

type Pt = { x: number; y: number };

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

/** Puts a chart into the flowchart block (as another device would) and fits it in view. */
async function seed(page: Page, canvas: Locator, chart: object) {
  await page.evaluate((data) => {
    type PMNode = { type: { name: string }; attrs: Record<string, unknown> };
    const ed = (document.querySelector(".fb-editor") as unknown as { editor: { state: { doc: { forEach: (f: (n: PMNode, off: number) => void) => void; nodeAt: (p: number) => PMNode }; tr: { setNodeMarkup: (p: number, t: undefined, a: Record<string, unknown>) => unknown } }; view: { dispatch: (tr: unknown) => void } } }).editor;
    let pos = -1;
    ed.state.doc.forEach((n, off) => {
      if (n.type.name === "flowchart") pos = off;
    });
    ed.view.dispatch(ed.state.tr.setNodeMarkup(pos, undefined, { ...ed.state.doc.nodeAt(pos).attrs, data }));
  }, JSON.stringify(chart));
  await canvas.getByRole("button", { name: "Fit to content" }).click();
}

/** The chart's connectors (or shapes) as the block stores them. */
async function storedEdges(page: Page, key: "edges" | "nodes" = "edges"): Promise<Record<string, unknown>[]> {
  return page.evaluate((key) => {
    const ed = (document.querySelector(".fb-editor") as unknown as { editor: { state: { doc: { forEach: (f: (n: { type: { name: string }; attrs: Record<string, unknown> }) => void) => void } } } }).editor;
    let data = "";
    ed.state.doc.forEach((n) => {
      if (n.type.name === "flowchart") data = String(n.attrs.data ?? "");
    });
    return data ? (JSON.parse(data)[key] ?? []) : [];
  }, key);
}

/** The connector's drawn line sampled along its length (chart units). */
async function samples(canvas: Locator, id: string, n = 80): Promise<Pt[]> {
  return canvas.locator(`.fc-edges [data-fc-edge="${id}"] .fc-edge-line`).evaluate((path, n) => {
    const el = path as SVGPathElement;
    const len = el.getTotalLength();
    return Array.from({ length: n + 1 }, (_, i) => {
      const p = el.getPointAtLength((len * i) / n);
      return { x: p.x, y: p.y };
    });
  }, n);
}

/** The middle of the connector's arrowhead (chart units). */
async function headAt(canvas: Locator, id: string): Promise<Pt> {
  return canvas.locator(`.fc-edges [data-fc-edge="${id}"] .fc-edge-head`).first().evaluate((el) => {
    const b = (el as SVGGraphicsElement).getBBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
}

/** A point on screen a fraction of the way along a connector. */
async function along(canvas: Locator, id: string, t: number): Promise<Pt> {
  return canvas.locator(`.fc-edges [data-fc-edge="${id}"] .fc-edge-line`).evaluate((path, t) => {
    const el = path as SVGPathElement;
    const p = el.getPointAtLength(el.getTotalLength() * t);
    const m = el.getScreenCTM()!;
    return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
  }, t);
}

/** Along the line, x and y each only ever move one way (no doubling back, no loop). */
function monotonic(pts: readonly Pt[]): boolean {
  for (const key of ["x", "y"] as const) {
    let sign = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = pts[i]![key] - pts[i - 1]![key];
      if (Math.abs(d) < 0.05) continue;
      if (sign && Math.sign(d) !== sign) return false;
      sign = Math.sign(d);
    }
  }
  return true;
}

const node = (id: string, x: number, y: number, text = id) => ({ id, shape: "process", x, y, w: 160, h: 64, text });

test.describe("Flowchart connector routing", () => {
  test.setTimeout(180_000);

  test("in line: straight; moved sideways: an elbow without backtracking; reversed: the arrow turns and stays", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Routing Tester");
    const canvas = await newFlowchart(page, "Routing");
    // The owner's chart: "Nafis" right under "Own Ventures", a small gap between, the connector going up.
    await seed(page, canvas, {
      v: 2,
      nodes: [node("ov", 0, 0, "Own Ventures"), node("nafis", 0, 88, "Nafis")],
      edges: [{ id: "e", from: "nafis", to: "ov", fromSide: "top", toSide: "bottom" }],
    });
    await expect(canvas.locator("[data-fc-node]")).toHaveCount(2);
    const line = canvas.locator('.fc-edges [data-fc-edge="e"] .fc-edge-line');

    // One straight segment between the facing sides.
    await expect(line).toHaveAttribute("d", /^M80 88L80 [\d.]+$/);
    let pts = await samples(canvas, "e");
    for (const p of pts) expect(Math.abs(p.x - 80)).toBeLessThan(0.1);
    expect((await headAt(canvas, "e")).y).toBeLessThan(80);

    // Drag Nafis well to the right: an elbow (vertical out, across, vertical in) that never turns back.
    const nafis = canvas.locator('[data-fc-node="nafis"]');
    const box = (await nafis.boundingBox())!;
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + box.width * 1.6, from.y + 40, { steps: 14 });
    await page.mouse.up();
    await expect.poll(async () => (await samples(canvas, "e")).some((p) => p.x > 120)).toBe(true);
    pts = await samples(canvas, "e");
    expect(monotonic(pts)).toBe(true);
    expect(pts.some((p) => Math.abs(p.x - pts[0]!.x) > 40)).toBe(true);
    // Never out to the left of either shape (the old loop went far left).
    for (const p of pts) expect(p.x).toBeGreaterThan(-1);
    await expect(line).not.toHaveAttribute("d", /NaN/);

    // Reverse direction from the connector's menu: the arrowhead moves to Nafis.
    const card = (await canvas.boundingBox())!;
    await page.mouse.click(card.x + 40, card.y + card.height - 40);
    const before = await headAt(canvas, "e");
    await page.mouse.click(...(Object.values(await along(canvas, "e", 0.5)) as [number, number]), { button: "right" });
    await page.getByRole("menu", { name: "Connector" }).getByRole("menuitem", { name: "Reverse direction" }).click();
    await expect.poll(async () => (await headAt(canvas, "e")).y).toBeGreaterThan(before.y + 20);
    await expect.poll(async () => (await storedEdges(page)).find((x) => x.id === "e")).toMatchObject({ from: "ov", to: "nafis", fromSide: "bottom", toSide: "top" });
    const flipped = (await storedEdges(page)).find((x) => x.id === "e")!;
    expect(flipped.end ?? "arrow").toBe("arrow");

    // It is saved with the note: after a reload the arrow still points at Nafis.
    await waitForSaved(page);
    await page.reload();
    const again = page.getByRole("application", { name: /Flowchart/ });
    await expect(again.locator('.fc-edges [data-fc-edge="e"] .fc-edge-head')).toHaveCount(1);
    const head = await headAt(again, "e");
    const nafisY = Number((await storedEdges(page, "nodes")).find((n) => n.id === "nafis")!.y);
    expect(head.y).toBeGreaterThan(nafisY - 20);
    expect(head.y).toBeLessThan(nafisY + 1);
    expect((await storedEdges(page)).find((x) => x.id === "e")).toMatchObject({ from: "ov", to: "nafis" });

    // One undo turns it back.
    await again.locator('[data-fc-node="ov"]').click();
    await page.mouse.click(...(Object.values(await along(again, "e", 0.5)) as [number, number]), { button: "right" });
    await page.getByRole("menu", { name: "Connector" }).getByRole("menuitem", { name: "Reverse direction" }).click();
    await expect.poll(async () => (await storedEdges(page)).find((x) => x.id === "e")).toMatchObject({ from: "nafis", to: "ov" });
    await again.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(async () => (await storedEdges(page)).find((x) => x.id === "e")).toMatchObject({ from: "ov", to: "nafis" });

    // Back in line: straight again.
    const moved = (await again.locator('[data-fc-node="nafis"]').boundingBox())!;
    const target = (await again.locator('[data-fc-node="ov"]').boundingBox())!;
    await page.mouse.move(moved.x + moved.width / 2, moved.y + moved.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2, moved.y + moved.height / 2, { steps: 14 });
    await page.mouse.up();
    await expect.poll(async () => (await samples(again, "e")).every((p) => Math.abs(p.x - 80) < 0.1)).toBe(true);
    await context.close();
  });

  test("a bend point left behind where the shapes used to be is dropped, so the line runs straight", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Stale Bend Tester");
    const canvas = await newFlowchart(page, "Stale bend");
    await seed(page, canvas, {
      v: 2,
      nodes: [node("top", 0, 0), node("bottom", 0, 200)],
      edges: [{ id: "e", from: "bottom", to: "top", fromSide: "top", toSide: "bottom", bends: [[-300, 82]] }],
    });
    // Drawn straight (the bend is left out) and its handle is not offered.
    await expect.poll(async () => (await samples(canvas, "e")).every((p) => Math.abs(p.x - 80) < 0.1)).toBe(true);
    await page.mouse.click(...(Object.values(await along(canvas, "e", 0.5)) as [number, number]));
    await expect(canvas.locator('[data-fc-bend][data-edge="e"]')).toHaveCount(0);
    // The next edit stores what is drawn: no bend points.
    await page.mouse.click(...(Object.values(await along(canvas, "e", 0.3)) as [number, number]), { button: "right" });
    await page.getByRole("menu", { name: "Connector" }).getByRole("menuitem", { name: "Reverse direction" }).click();
    await expect.poll(async () => (await storedEdges(page)).find((x) => x.id === "e")).toMatchObject({ from: "top", to: "bottom" });
    expect((await storedEdges(page)).find((x) => x.id === "e")!.bends).toBeUndefined();
    await context.close();
  });
});
