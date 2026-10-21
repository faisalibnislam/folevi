// Flowchart connectors from the keyboard (interactions/connectorKeys.ts): ] and [ from a shape reach its
// connectors, each named for where it goes; Enter writes its label, Tab goes into its bar (operated with
// arrows and Enter, Esc back), Home and End go to its shapes, Delete removes it and the keyboard goes back
// to the shape; Tab on a shape still adds the next step. Also: connection points keep off a frame's title
// band, so pressing the band there moves the frame.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { newPerson, settle, waitForSaved } from "./helpers";

const SHOTS = process.env.FLOWCHART_SHOTS;
async function shot(page: Page, name: string) {
  if (SHOTS) await page.locator(".fb-flowchart").screenshot({ path: `${SHOTS}/${name}.png` });
}

type Wire = { nodes: { id: string; x: number; y: number }[]; edges: { id: string; route?: string; labels?: { text: string }[] }[]; frames?: { id: string; x: number; y: number }[] };

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

async function stored(page: Page): Promise<Wire> {
  return page.evaluate(() => {
    const ed = (document.querySelector(".fb-editor") as unknown as { editor: { state: { doc: { forEach: (f: (n: { type: { name: string }; attrs: Record<string, unknown> }) => void) => void } } } }).editor;
    let data = "";
    ed.state.doc.forEach((n) => {
      if (n.type.name === "flowchart") data = String(n.attrs.data ?? "");
    });
    return data ? JSON.parse(data) : { nodes: [], edges: [] };
  });
}

/** What has the keyboard: a connector's or shape's id, or the element's own description. */
const focused = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    if (!a) return "none";
    if (a.hasAttribute("data-fc-edge-line")) return `edge:${a.getAttribute("data-fc-edge")}`;
    if (a.hasAttribute("data-fc-node")) return `node:${a.getAttribute("data-fc-node")}`;
    return `${a.tagName.toLowerCase()}:${a.getAttribute("aria-label") ?? ""}`;
  });

const node = (id: string, x: number, y: number, extra: object = {}) => ({ id, shape: "process", x, y, w: 160, h: 64, text: id, ...extra });

test.describe("Flowchart connectors from the keyboard", () => {
  test.setTimeout(180_000);

  test("] and [ reach a shape's connectors; Enter, the bar, Home and End, Delete and Esc on one", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Keyboard Connector Tester");
    const canvas = await newFlowchart(page, "Keyboard connectors");
    await seed(page, canvas, {
      v: 2,
      nodes: [node("Start", 0, 0), node("Check", 0, 240), node("Ship", 320, 240), node("Alone", 640, 0)],
      edges: [
        { id: "e1", from: "Start", to: "Check", labels: [{ text: "Yes", at: 0.5 }] },
        { id: "e2", from: "Start", to: "Ship" },
      ],
    });
    const announce = canvas.locator(".fc-announce");

    // The connectors are named for where they go, outside the Tab order.
    await expect(canvas.getByRole("button", { name: "Connector from Start to Check, Yes" })).toHaveAttribute("tabindex", "-1");
    await expect(canvas.getByRole("button", { name: "Connector from Start to Ship" })).toHaveCount(1);

    // Focus Start from the keyboard (Tab from the canvas reaches the selected shape).
    await canvas.locator('[data-fc-node="Start"]').click();
    await expect.poll(() => focused(page)).toBe("node:Start");

    // ] goes to its first connector, then the next, wrapping; [ goes back.
    await page.keyboard.press("]");
    await expect.poll(() => focused(page)).toBe("edge:e1");
    await expect(canvas.locator('.fc-edges [data-fc-edge="e1"][data-selected]')).toHaveCount(1);
    await expect(announce).toHaveText(/1 of 2 connectors at Start/);
    await shot(page, "keyboard-connector-focused");
    await page.keyboard.press("]");
    await expect.poll(() => focused(page)).toBe("edge:e2");
    await page.keyboard.press("]");
    await expect.poll(() => focused(page)).toBe("edge:e1");
    await page.keyboard.press("[");
    await expect.poll(() => focused(page)).toBe("edge:e2");

    // Enter writes its label; Enter again finishes and the keyboard is back on the connector.
    await page.keyboard.press("Enter");
    const input = canvas.getByRole("textbox", { name: "Connector label" });
    await expect(input).toBeFocused();
    await input.fill("Ready");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await stored(page)).edges.find((e) => e.id === "e2")?.labels?.[0]?.text).toBe("Ready");
    await expect.poll(() => focused(page)).toBe("edge:e2");
    await expect(canvas.getByRole("button", { name: "Connector from Start to Ship, Ready" })).toHaveCount(1);

    // Tab goes into its bar: arrows move along it, a menu opens with Enter and End picks its last choice.
    await page.keyboard.press("Tab");
    await expect.poll(() => focused(page)).toMatch(/^button:Route: Elbow/);
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => focused(page)).toMatch(/^button:Start:/);
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await stored(page)).edges.find((e) => e.id === "e2")?.route).toBe("straight");
    await expect(announce).toHaveText(/Route straight/);
    // Esc goes back to the connector.
    await page.keyboard.press("Escape");
    await expect.poll(() => focused(page)).toBe("edge:e2");

    // Home and End go to the shapes at its start and end.
    await page.keyboard.press("End");
    await expect.poll(() => focused(page)).toBe("node:Ship");
    await page.keyboard.press("]");
    await expect.poll(() => focused(page)).toBe("edge:e2");
    await page.keyboard.press("Home");
    await expect.poll(() => focused(page)).toBe("node:Start");

    // Esc on a connector reached from a shape goes back to the shape.
    await page.keyboard.press("]");
    await expect.poll(() => focused(page)).toBe("edge:e1");
    await page.keyboard.press("Escape");
    await expect.poll(() => focused(page)).toBe("node:Start");

    // Delete removes it, says so, and the keyboard goes back to the shape; one undo brings it back.
    await page.keyboard.press("]");
    await expect.poll(() => focused(page)).toBe("edge:e1");
    await page.keyboard.press("Delete");
    await expect.poll(async () => (await stored(page)).edges.map((e) => e.id)).toEqual(["e2"]);
    await expect(announce).toHaveText(/Connector deleted/);
    await expect.poll(() => focused(page)).toBe("node:Start");
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(async () => (await stored(page)).edges.length).toBe(2);

    // A shape without connectors says so.
    await canvas.locator('[data-fc-node="Alone"]').click();
    await page.keyboard.press("]");
    await expect(announce).toHaveText(/Alone has no connectors/);
    await expect.poll(() => focused(page)).toBe("node:Alone");

    // Tab on a selected shape still adds the next step.
    await canvas.locator('[data-fc-node="Ship"]').click();
    await expect.poll(() => focused(page)).toBe("node:Ship");
    await page.keyboard.press("Tab");
    await expect.poll(async () => (await stored(page)).nodes.length).toBe(5);
    await page.keyboard.press("Escape");

    // The connectors pass an accessibility check, light and dark.
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await settle(page);
      const results = await new AxeBuilder({ page }).include(".fc-edges").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
    }
    await context.close();
  });

  test("connection points keep off a frame's title band, which still moves the frame", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Title Band Tester");
    const canvas = await newFlowchart(page, "Title band");
    await seed(page, canvas, {
      v: 2,
      nodes: [node("Inside", 40, 44, { parent: "f" }), node("Lower", 40, 200, { parent: "f" })],
      edges: [],
      frames: [{ id: "f", x: 0, y: 0, w: 400, h: 320, title: "Sign up" }],
    });
    // Just under the title: no top point (it would sit on the band); the other three are there.
    await canvas.locator('[data-fc-node="Inside"]').hover();
    await expect(canvas.locator('[data-fc-handle][data-node="Inside"]')).toHaveCount(3);
    await expect(canvas.locator('[data-fc-handle][data-node="Inside"][data-side="top"]')).toHaveCount(0);
    await shot(page, "connection-points-title-band");
    // Further down: all four.
    await canvas.locator('[data-fc-node="Lower"]').hover();
    await expect(canvas.locator('[data-fc-handle][data-node="Lower"]')).toHaveCount(4);

    // With the pointer back on Inside, pressing the band right above it moves the frame (no connector drawn).
    await canvas.locator('[data-fc-node="Inside"]').hover();
    // The middle of the band, right above the shape's top connection point.
    const band = await canvas.locator("svg.fc-svg").evaluate((svg) => {
      const g = svg.querySelector(":scope > g[transform]")!;
      const m = /translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(g.getAttribute("transform")!)!;
      const r = svg.getBoundingClientRect();
      return { x: r.left + Number(m[1]) + 120 * Number(m[3]), y: r.top + Number(m[2]) + 20 * Number(m[3]) };
    });
    await page.mouse.move(band.x, band.y);
    await page.mouse.down();
    await page.mouse.move(band.x + 80, band.y + 40, { steps: 12 });
    await page.mouse.up();
    await expect.poll(async () => (await stored(page)).frames?.[0]?.x ?? 0).toBeGreaterThan(20);
    expect((await stored(page)).edges ?? []).toHaveLength(0);
    await context.close();
  });
});
