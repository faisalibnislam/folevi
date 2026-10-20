// Flowchart connectors: connection points and snapping (a side, a point, the whole shape, a free end),
// reconnecting and detaching, ends spread along a side, elbow, curved and straight routes re-routing live,
// hops at crossings, bend points, styling several connectors at once, several labels dragged along the
// line, the connector menu, a finger, and a 200-shape chart that stays smooth while a shape is dragged.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { APP, newPerson, settle, waitForSaved } from "./helpers";

const SHOTS = process.env.FLOWCHART_SHOTS;
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

type Pt = { x: number; y: number };
type Wire = { nodes: { id: string }[]; edges: Record<string, unknown>[] };

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

/** The chart as the block stores it (written shortly after each change). */
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
const edges = async (page: Page) => (await stored(page)).edges ?? [];
const edge = async (page: Page, id: string) => (await edges(page)).find((e) => e.id === id);
const labelsOf = async (page: Page, id: string) => ((await edge(page, id))?.labels as { text: string; at?: number }[] | undefined) ?? [];
const bendsOf = async (page: Page, id: string) => ((await edge(page, id))?.bends as number[][] | undefined) ?? [];

/** A chart point on screen. */
async function screen(canvas: Locator, p: Pt): Promise<Pt> {
  return canvas.locator("svg.fc-svg").evaluate((svg, p) => {
    const g = svg.querySelector(":scope > g[transform]")!;
    const m = /translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(g.getAttribute("transform")!)!;
    const r = svg.getBoundingClientRect();
    return { x: r.left + Number(m[1]) + p.x * Number(m[3]), y: r.top + Number(m[2]) + p.y * Number(m[3]) };
  }, p);
}

/** A point a fraction of the way along a connector's drawn line, on screen. */
async function along(canvas: Locator, id: string, t: number): Promise<Pt> {
  return canvas.locator(`.fc-edges [data-fc-edge="${id}"] .fc-edge-line`).evaluate((path, t) => {
    const el = path as SVGPathElement;
    const p = el.getPointAtLength(el.getTotalLength() * t);
    const m = el.getScreenCTM()!;
    return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
  }, t);
}

const center = async (l: Locator): Promise<Pt> => {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

async function drag(page: Page, from: Pt, to: Pt, opts: { steps?: number; before?: () => Promise<void>; alt?: boolean } = {}) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: opts.steps ?? 12 });
  if (opts.before) await opts.before();
  if (opts.alt) await page.keyboard.down("Alt");
  await page.mouse.move(to.x + 0.5, to.y + 0.5);
  await page.mouse.up();
  if (opts.alt) await page.keyboard.up("Alt");
}

const node = (id: string, x: number, y: number, extra: object = {}) => ({ id, shape: "process", x, y, w: 160, h: 64, text: id, ...extra });

test.describe("Flowchart connectors", () => {
  test.setTimeout(180_000);

  test("connection points, snapping to a side, a point or the shape, spreading, reconnecting and free ends", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Connector Tester");
    const canvas = await newFlowchart(page, "Connectors");
    await seed(page, canvas, { v: 2, nodes: [node("A", 0, 0), node("B", 0, 240), node("C", 320, 240)] });
    await expect(canvas.locator("[data-fc-node]")).toHaveCount(3);

    // Hovering a shape shows a connection point on each side.
    await canvas.locator('[data-fc-node="A"]').hover();
    await expect(canvas.locator('[data-fc-handle][data-node="A"]')).toHaveCount(4);
    await shot(page, "connection-points");

    // Drawing out of A's bottom point onto B's top connection point: B shows its points, the top one lit.
    const aBottom = await center(canvas.locator('[data-fc-handle][data-node="A"][data-side="bottom"] .fc-port-hit'));
    await drag(page, aBottom, await screen(canvas, { x: 80, y: 241 }), {
      before: async () => {
        await expect(canvas.locator(".fc-port-target")).toHaveCount(4);
        await expect(canvas.locator('.fc-port-target[data-on][data-fc-target-side="top"]')).toHaveCount(1);
        await shot(page, "connecting-snap-side");
      },
    });
    await expect.poll(async () => (await edges(page)).length).toBe(1);
    expect((await edges(page))[0]).toMatchObject({ from: "A", to: "B", fromSide: "bottom", toSide: "top" });
    expect((await edges(page))[0]!.toAt).toBeUndefined();

    // Onto B's outline a quarter of the way along its top: that exact spot.
    await canvas.locator('[data-fc-node="A"]').hover();
    await drag(page, await center(canvas.locator('[data-fc-handle][data-node="A"][data-side="bottom"] .fc-port-hit')), await screen(canvas, { x: 40, y: 241 }), {
      before: async () => expect(canvas.locator(".fc-snap-point")).toHaveCount(1),
    });
    await expect.poll(async () => (await edges(page)).length).toBe(2);
    expect((await edges(page))[1]).toMatchObject({ from: "A", to: "B", toSide: "top", toAt: 0.25 });

    // Into the middle of C: the shape as a whole (the router picks the side).
    await canvas.locator('[data-fc-node="A"]').hover();
    await drag(page, await center(canvas.locator('[data-fc-handle][data-node="A"][data-side="right"] .fc-port-hit')), await screen(canvas, { x: 400, y: 272 }));
    await expect.poll(async () => (await edges(page)).length).toBe(3);
    const third = (await edges(page))[2]!;
    expect(third).toMatchObject({ from: "A", to: "C", fromSide: "right" });
    expect(third.toSide).toBeUndefined();

    // Two connectors on A's bottom spread along it instead of stacking.
    const [e1, e2] = (await edges(page)).map((e) => String(e.id));
    const startX = async (id: string) => Number(/^M([-\d.]+)/.exec((await canvas.locator(`.fc-edges [data-fc-edge="${id}"] .fc-edge-line`).getAttribute("d"))!)![1]);
    expect(Math.abs((await startX(e1!)) - (await startX(e2!)))).toBeGreaterThan(12);

    // Reconnect: select the first connector and drag its end onto C's left connection point.
    await page.mouse.click(...Object.values(await along(canvas, e1!, 0.5)) as [number, number]);
    await expect(canvas.locator(`.fc-edges [data-fc-edge="${e1}"][data-selected]`)).toHaveCount(1);
    await expect(page.getByRole("toolbar", { name: "Selected connectors" })).toBeVisible();
    await drag(page, await center(canvas.locator(`[data-fc-end="to"][data-edge="${e1}"] .fc-handle-hit`)), await screen(canvas, { x: 321, y: 272 }));
    await expect.poll(async () => (await edges(page)).find((e) => e.id === e1)).toMatchObject({ from: "A", to: "C", toSide: "left" });

    // Detach: the end let go on empty canvas floats free there.
    await drag(page, await center(canvas.locator(`[data-fc-end="to"][data-edge="${e1}"] .fc-handle-hit`)), await screen(canvas, { x: 200, y: 440 }));
    await expect.poll(async () => (await edges(page)).find((e) => e.id === e1)?.toPoint).toBeTruthy();
    const free = (await edges(page)).find((e) => e.id === e1)!;
    expect(free.to).toBeUndefined();
    expect(Math.abs((free.toPoint as number[])[0]! - 200)).toBeLessThan(4);
    await expect(canvas.locator(`.fc-edges [data-fc-edge="${e1}"][data-free]`)).toHaveCount(1);
    await shot(page, "free-end");

    // ⌥ while letting go of a new connector leaves its end free; one undo takes it away again.
    await canvas.locator('[data-fc-node="B"]').hover();
    await drag(page, await center(canvas.locator('[data-fc-handle][data-node="B"][data-side="left"] .fc-port-hit')), await screen(canvas, { x: -160, y: 272 }), { alt: true });
    await expect.poll(async () => (await edges(page)).length).toBe(4);
    expect((await edges(page))[3]).toMatchObject({ from: "B", fromSide: "left" });
    expect((await edges(page))[3]!.toPoint).toBeTruthy();
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(async () => (await edges(page)).length).toBe(3);
    await context.close();
  });

  test("elbow, curved and straight routes, hops at crossings, bend points and live re-routing", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Route Tester");
    const canvas = await newFlowchart(page, "Routes");
    await seed(page, canvas, {
      v: 2,
      nodes: [node("A", 0, 0), node("B", 0, 320), node("C", -260, 140), node("D", 260, 140)],
      edges: [
        { id: "v1", from: "A", to: "B", fromSide: "bottom", toSide: "top" },
        { id: "h1", from: "C", to: "D", fromSide: "right", toSide: "left" },
      ],
    });
    const line = (id: string) => canvas.locator(`.fc-edges [data-fc-edge="${id}"] .fc-edge-line`);
    // The horizontal connector hops over the vertical one where they cross.
    await expect(line("h1")).toHaveAttribute("d", /A4\.5 4\.5/);
    await shot(page, "hop");

    // Route style from the connector bar.
    await page.mouse.click(...Object.values(await along(canvas, "v1", 0.2)) as [number, number]);
    const bar = page.getByRole("toolbar", { name: "Selected connectors" });
    await expect(bar).toBeVisible();
    for (const [label, test] of [["Curved", /C/], ["Straight", /^M[-\d. ]+L[-\d. ]+$/], ["Elbow", /^[^C]*$/]] as const) {
      await bar.getByRole("button", { name: /^Route:/ }).click();
      await page.getByRole("menuitemradio", { name: label }).or(page.getByRole("menuitem", { name: label })).first().click();
      await expect(line("v1")).toHaveAttribute("d", test);
    }
    await expect.poll(async () => (await edges(page)).find((e) => e.id === "v1")?.route).toBeUndefined();

    // Dragging the line adds a bend point there; dragging the point moves it (onto the grid).
    await drag(page, await along(canvas, "v1", 0.3), await screen(canvas, { x: -60, y: 120 }));
    await expect.poll(async () => (await bendsOf(page, "v1")).length).toBe(1);
    await expect(canvas.locator('[data-fc-bend="0"]')).toHaveCount(1);
    await drag(page, await center(canvas.locator('[data-fc-bend="0"] .fc-handle-hit')), await screen(canvas, { x: -100, y: 200 }));
    // On the grid (every 8): the nearest grid point to (-100, 200).
    await expect.poll(async () => (await bendsOf(page, "v1"))[0]).toEqual([-96, 200]);
    // A hollow point between stops adds another.
    await expect(canvas.locator("[data-fc-bend-add]").first()).toBeVisible();
    await drag(page, await center(canvas.locator("[data-fc-bend-add] .fc-handle-hit").last()), await screen(canvas, { x: 40, y: 280 }));
    await expect.poll(async () => (await bendsOf(page, "v1")).length).toBe(2);
    await shot(page, "bends");
    // Double-clicking a point removes it; undo puts it back.
    await canvas.locator('[data-fc-bend="0"] .fc-bend').dblclick();
    await expect.poll(async () => (await bendsOf(page, "v1")).length).toBe(1);
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(async () => (await bendsOf(page, "v1")).length).toBe(2);

    // Connectors re-route live while a shape moves (before it is let go).
    const before = await line("h1").getAttribute("d");
    const d = await center(canvas.locator('[data-fc-node="D"] .fc-shape'));
    await page.mouse.move(d.x, d.y);
    await page.mouse.down();
    await page.mouse.move(d.x + 40, d.y + 120, { steps: 10 });
    await expect(line("h1")).not.toHaveAttribute("d", before!);
    await page.mouse.up();
    await context.close();
  });

  test("several connectors styled together, several labels dragged along the line, the connector menu", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Style Tester");
    const canvas = await newFlowchart(page, "Styles");
    await seed(page, canvas, {
      v: 2,
      nodes: [node("A", 0, 0), node("B", -200, 260), node("C", 200, 260)],
      edges: [
        { id: "ab", from: "A", to: "B" },
        { id: "ac", from: "A", to: "C" },
      ],
    });
    // Shift-click selects both; the bar changes them together.
    await page.mouse.click(...Object.values(await along(canvas, "ab", 0.6)) as [number, number]);
    await page.keyboard.down("Shift");
    await page.mouse.click(...Object.values(await along(canvas, "ac", 0.25)) as [number, number]);
    await page.keyboard.up("Shift");
    const bar = page.getByRole("toolbar", { name: "2 selected connectors" });
    await expect(bar).toBeVisible();
    const pickIn = async (button: RegExp, item: string) => {
      await bar.getByRole("button", { name: button }).click();
      await page.getByRole("menuitemradio", { name: item, exact: true }).or(page.getByRole("menuitem", { name: item, exact: true })).first().click();
    };
    await pickIn(/^End:/, "Diamond");
    await pickIn(/^Start:/, "Circle");
    await pickIn(/^Line:/, "Dotted");
    await pickIn(/^Line:/, "Thick");
    await pickIn(/^Colour:/, "Blue");
    await expect.poll(async () => (await edges(page)).map((e) => [e.start, e.end, e.style, e.width, e.color])).toEqual([
      ["circle", "diamond", "dotted", 4, "blue"],
      ["circle", "diamond", "dotted", 4, "blue"],
    ]);
    await shot(page, "styled-together");

    // The bar passes axe in light and dark.
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.evaluate((t) => (document.documentElement.dataset.theme = t), scheme);
      await settle(page);
      if (scheme === "dark") await shot(page, "styled-dark");
      const results = await new AxeBuilder({ page }).include(".fc-bar-edge").include(".fc-edges").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
    }
    await page.emulateMedia({ colorScheme: "light" });
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));

    // Labels: double-click the line to add one where it was clicked; several per connector.
    await page.keyboard.press("Escape");
    await page.mouse.dblclick(...Object.values(await along(canvas, "ab", 0.3)) as [number, number]);
    await expect(canvas.locator(".fc-label-input")).toBeFocused();
    await page.keyboard.type("Yes");
    await page.keyboard.press("Enter");
    await page.mouse.dblclick(...Object.values(await along(canvas, "ab", 0.8)) as [number, number]);
    await page.keyboard.type("Later");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await labelsOf(page, "ab")).map((l) => l.text)).toEqual(["Yes", "Later"]);
    const yes = canvas.locator('[data-fc-edge="ab"][data-fc-label="0"]');
    await expect(yes).toHaveText("Yes");
    // Dragging a label slides it along the line.
    const at0 = (await labelsOf(page, "ab"))[0]?.at ?? 0.5;
    await drag(page, await center(yes), await along(canvas, "ab", 0.62));
    await expect.poll(async () => ((await labelsOf(page, "ab"))[0]?.at ?? 0.5) - at0).toBeGreaterThan(0.15);
    // Double-clicking a label writes in it.
    await canvas.locator('[data-fc-edge="ab"][data-fc-label="1"]').dblclick();
    await expect(canvas.locator(".fc-label-input")).toHaveValue("Later");
    await page.keyboard.type("Soon");
    await page.keyboard.press("Enter");
    await expect(canvas.locator('[data-fc-edge="ab"][data-fc-label="1"]')).toHaveText("Soon");
    // Typing on a selected connector writes its first label.
    await page.keyboard.press("Escape");
    await page.mouse.click(...Object.values(await along(canvas, "ac", 0.4)) as [number, number]);
    await page.keyboard.type("No");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await labelsOf(page, "ac")).map((l) => l.text)).toEqual(["No"]);
    await shot(page, "labels");

    // The connector's own menu: reverse it, then remove a label from the label's menu.
    await page.keyboard.press("Escape");
    await page.mouse.click(...Object.values(await along(canvas, "ab", 0.5)) as [number, number], { button: "right" });
    const menu = page.getByRole("menu", { name: "Connector" });
    await expect(menu.getByRole("menuitem", { name: "Reverse direction" })).toBeVisible();
    await expect(menu.getByRole("menuitemradio", { name: "Curved line" }).or(menu.getByRole("menuitem", { name: "Curved line" })).first()).toBeVisible();
    await menu.getByRole("menuitem", { name: "Reverse direction" }).click();
    await expect.poll(async () => (await edges(page)).find((e) => e.id === "ab")).toMatchObject({ from: "B", to: "A", start: "diamond", end: "circle" });
    await page.keyboard.press("Escape");
    await canvas.locator('[data-fc-edge="ab"][data-fc-label="0"]').click({ button: "right" });
    await page.getByRole("menu", { name: "Connector" }).getByRole("menuitem", { name: "Remove label" }).click();
    await expect.poll(async () => (await labelsOf(page, "ab")).length).toBe(1);

    // Phone width: the bar fits.
    await page.setViewportSize({ width: 390, height: 844 });
    await canvas.scrollIntoViewIfNeeded();
    await page.mouse.click(...Object.values(await along(canvas, "ac", 0.5)) as [number, number]);
    const one = page.getByRole("toolbar", { name: "Selected connectors" });
    await expect(one).toBeVisible();
    const b = (await one.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(390);
    await shot(page, "phone");
    await context.close();
  });

  test("with a finger: tap a connector, 44 pt controls, drag its end to reconnect", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Touch Tester");
    const canvas = await newFlowchart(page, "Touch");
    await seed(page, canvas, { v: 2, nodes: [node("A", 0, 0), node("B", 0, 240), node("C", 320, 240)], edges: [{ id: "ab", from: "A", to: "B" }] });
    await waitForSaved(page);
    await page.waitForTimeout(800);
    await waitForSaved(page);
    const url = page.url().replace(/\?.*$/, "");
    const state = await context.storageState();
    const phone = await browser.newContext({ storageState: state, viewport: { width: 402, height: 874 }, hasTouch: true, isMobile: true });
    const ph = await phone.newPage();
    await ph.goto(url.replace(/^https?:\/\/[^/]+/, APP));
    const pc = ph.getByRole("application", { name: /Flowchart, 3 shapes/ });
    await expect(pc).toBeVisible({ timeout: 30_000 });
    await pc.scrollIntoViewIfNeeded();
    await pc.getByRole("button", { name: "Fit to content" }).click();
    const p = await along(pc, "ab", 0.5);
    await ph.touchscreen.tap(p.x, p.y);
    const bar = ph.getByRole("toolbar", { name: "Selected connectors" });
    await expect(bar).toBeVisible();
    for (const b of await bar.getByRole("button").all()) {
      const box = (await b.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    // The end handles are finger-sized.
    const hit = (await pc.locator('[data-fc-end="to"][data-edge="ab"] .fc-handle-hit').boundingBox())!;
    expect(hit.width).toBeGreaterThanOrEqual(40);
    await shot(ph, "touch");
    // A finger drags the end onto C's left connection point (a real touch, so the canvas sees a finger).
    const cdp = await phone.newCDPSession(ph);
    const from = await center(pc.locator('[data-fc-end="to"][data-edge="ab"] .fc-handle-hit'));
    const to = await screen(pc, { x: 322, y: 272 });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from.x, y: from.y }] });
    for (let i = 1; i <= 12; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x + ((to.x - from.x) * i) / 12, y: from.y + ((to.y - from.y) * i) / 12 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(async () => edge(ph, "ab")).toMatchObject({ from: "A", to: "C", toSide: "left" });
    await phone.close();
    await context.close();
  });

  test("a 200-shape chart stays smooth: dragging a shape redraws only the connectors near it", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Perf Tester");
    const canvas = await newFlowchart(page, "Big chart");
    // 200 shapes on a grid, 300 connectors (mostly neighbours, a few long ones).
    const nodes = Array.from({ length: 200 }, (_, i) => node(`n${i}`, (i % 16) * 240, Math.floor(i / 16) * 180));
    const list: object[] = [];
    const seen = new Set<string>();
    let seedN = 7;
    const rnd = () => ((seedN = (seedN * 16807) % 2147483647) / 2147483647);
    for (let k = 0; list.length < 300 && k < 2000; k++) {
      const a = Math.floor(rnd() * 200);
      const b = rnd() < 0.85 ? a + [1, 16, 17][Math.floor(rnd() * 3)]! : Math.floor(rnd() * 200);
      // The same connection twice is read as one: keep each pair once.
      if (b >= 200 || a === b || seen.has(`${a}>${b}`)) continue;
      seen.add(`${a}>${b}`);
      list.push({ id: `e${list.length}`, from: `n${a}`, to: `n${b}` });
    }
    await seed(page, canvas, { v: 2, nodes, edges: list });
    await expect(canvas.locator(".fc-edges .fc-edge")).toHaveCount(300);
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.getByRole("button", { name: "Zoom in" }).click();
    await shot(page, "big-chart");

    // Count frames, and the connector paths redrawn in each frame, while one shape is dragged.
    await page.evaluate(() => {
      type Perf = { frames: number[]; redrawn: number[]; frame: Set<string>; all: Set<string>; stop: boolean };
      const perf: Perf = { frames: [], redrawn: [], frame: new Set(), all: new Set(), stop: false };
      (window as unknown as { __fcPerf: Perf }).__fcPerf = perf;
      const obs = new MutationObserver((records) => {
        for (const r of records) {
          const g = (r.target as Element).closest?.("[data-fc-edge]");
          if (!g) continue;
          perf.frame.add(g.getAttribute("data-fc-edge")!);
          perf.all.add(g.getAttribute("data-fc-edge")!);
        }
      });
      obs.observe(document.querySelector(".fc-edges")!, { attributes: true, subtree: true, attributeFilter: ["d"] });
      let last = performance.now();
      const tick = (t: number) => {
        perf.frames.push(t - last);
        if (perf.frame.size) perf.redrawn.push(perf.frame.size);
        perf.frame = new Set();
        last = t;
        if (!perf.stop) requestAnimationFrame(tick);
        else obs.disconnect();
      };
      requestAnimationFrame(tick);
    });
    const target = canvas.locator('[data-fc-node="n37"] .fc-shape');
    await target.scrollIntoViewIfNeeded();
    const s = await center(target);
    await page.mouse.move(s.x, s.y);
    await page.mouse.down();
    for (let i = 1; i <= 60; i++) await page.mouse.move(s.x + i * 2, s.y + i, { steps: 1 });
    await page.mouse.up();
    const perf = await page.evaluate(() => {
      const w = window as unknown as { __fcPerf: { frames: number[]; redrawn: number[]; all: Set<string>; stop: boolean } };
      w.__fcPerf.stop = true;
      const f = w.__fcPerf.frames.slice(2).sort((a, b) => a - b);
      const r = [...w.__fcPerf.redrawn].sort((a, b) => a - b);
      return { median: f[Math.floor(f.length / 2)] ?? 0, p90: f[Math.floor(f.length * 0.9)] ?? 0, frames: f.length, perFrame: r[Math.floor(r.length / 2)] ?? 0, worstFrame: r.at(-1) ?? 0, all: w.__fcPerf.all.size };
    });
    console.info(
      `[perf] drag on 200 shapes / 300 connectors: median frame ${perf.median.toFixed(1)} ms, p90 ${perf.p90.toFixed(1)} ms over ${perf.frames} frames; connectors redrawn per frame: median ${perf.perFrame}, worst ${perf.worstFrame} (${perf.all} different ones over the whole drag)`,
    );
    // Each frame redraws only the connectors around the dragged shape (its own, and the few whose hops or
    // spacing changed), never the whole chart.
    expect(perf.perFrame).toBeLessThan(60);
    expect(perf.worstFrame).toBeLessThan(150);
    // A development build is slower than production; this still guards against whole-chart work per move.
    expect(perf.median).toBeLessThan(34);
    await context.close();
  });
});
