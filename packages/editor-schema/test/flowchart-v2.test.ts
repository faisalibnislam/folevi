// Flowchart v2: the data model (migration from v1, the server's check, the forgiving reader, repair),
// rich labels, the shape library's geometry, SVG output and Mermaid.
import { describe, expect, it } from "vitest";
import v1Fixtures from "../fixtures/flowchart-v1.json";
import {
  FLOWCHART_EDGE_WIDTH,
  FLOWCHART_ICONS,
  FLOWCHART_LIMITS,
  FLOWCHART_SHAPES,
  FLOWCHART_SHAPE_SIZE,
  containerAt,
  containerMembers,
  edgeArrow,
  edgeLabel,
  emptyFlowchart,
  fitNodeToText,
  flowchart,
  flowchartDataIssue,
  flowchartDataToSvg,
  flowchartText,
  flowchartToMermaid,
  flowchartToSvg,
  laneBoxes,
  mermaidToFlowchart,
  newEdge,
  nodeContentBoxes,
  nodeTextLayout,
  normalizeFlowchart,
  outlinePoint,
  parseFlowchart,
  pointInShape,
  poolRect,
  repairWireBlock,
  richPlainText,
  searchFlowIcons,
  searchFlowShapes,
  serializeFlowchart,
  shapeOutline,
  shapePath,
  shapeTextBox,
  validateWireBlock,
  withArrow,
  withLabel,
  wrapRichText,
  type FlowchartData,
  type FlowNode,
  type FlowParagraph,
  type WireBlock,
} from "../src";

const node = (id: string, x = 0, y = 0, extra: Partial<FlowNode> = {}): FlowNode => ({
  id,
  shape: "process",
  x,
  y,
  w: 160,
  h: 64,
  text: id,
  color: "neutral",
  ...extra,
});
let blockN = 0;
const block = (props: Record<string, unknown>): WireBlock => ({
  id: `01JAFLOWCHARTV20000000000${++blockN % 10}`,
  type: "flowchart",
  parentId: null,
  rank: "V",
  schemaVersion: 1,
  text: [],
  props,
});

/** A v2 chart using every kind of data the model has. */
function richChart(): FlowchartData {
  const rich: FlowParagraph[] = [
    {
      text: [
        { type: "text", text: "Ship ", marks: [{ type: "bold" }] },
        { type: "text", text: "today", marks: [{ type: "link", href: "https://folevi.com" }] },
      ],
    },
    { text: [{ type: "text", text: "Pack" }], list: "bullet" },
    {
      text: [{ type: "text", text: "Label", marks: [{ type: "color", value: "coral" }] }],
      list: "bullet",
    },
  ];
  return flowchart({
    frames: [{ id: "f1", x: -40, y: -60, w: 560, h: 360, title: "Fulfilment", color: "green" }],
    pools: [
      {
        id: "p1",
        x: 0,
        y: 600,
        orient: "rows",
        title: "Teams",
        length: 900,
        lanes: [
          { id: "l1", title: "Sales", size: 160, color: "neutral" },
          { id: "l2", title: "Ops", size: 160, color: "blue" },
        ],
      },
    ],
    nodes: [
      node("a", 0, 0, {
        shape: "document",
        text: richPlainText(rich),
        rich,
        align: "left",
        valign: "top",
        autoHeight: true,
        parent: "f1",
        icon: { name: "file", place: "top" },
      }),
      node("b", 280, 0, {
        shape: "database",
        fill: "#e8f0fe",
        stroke: "#3b6fd4",
        strokeWidth: 2,
        strokeStyle: "dashed",
        parent: "f1",
        note: "Nightly backup",
        link: { documentId: "doc123", title: "Runbook" },
      }),
      node("c", 0, 200, {
        shape: "rounded",
        image: { fileId: "kg2abc/photo.png", fit: "contain" },
        parent: "f1",
      }),
      node("d", 200, 660, { shape: "decision", text: "Paid?", parent: "l1" }),
      node("e", 500, 820, { shape: "cloud", text: "Bank", parent: "l2", icon: { name: "money" } }),
    ],
    edges: [
      newEdge("a", "b", {
        id: "e1",
        fromSide: "right",
        fromAt: 0.3,
        toSide: "left",
        labels: [
          { text: "sync", at: 0.25 },
          { text: "nightly", at: 0.75 },
        ],
      }),
      newEdge("b", "c", {
        id: "e2",
        route: "curved",
        start: "circle",
        end: "diamond",
        width: 2.5,
        color: "#c4466e",
      }),
      newEdge("c", "d", {
        id: "e3",
        route: "straight",
        bends: [{ x: 120, y: 500 }],
        style: "dotted",
        end: "open",
      }),
      newEdge("d", "e", {
        id: "e4",
        labels: [{ text: "Yes", at: 0.5 }],
        color: "green",
        end: "bar",
      }),
      newEdge("e", "", { id: "e5", toPoint: { x: 900, y: 700 } }),
      newEdge("", "a", { id: "e6", fromPoint: { x: -200, y: 20 } }),
    ],
  });
}

describe("v1 data migrates on read", () => {
  for (const fx of v1Fixtures.charts) {
    it(`keeps everything in "${fx.name}"`, () => {
      const raw = JSON.stringify(fx.data);
      // The server still accepts what v1 clients write.
      expect(flowchartDataIssue(raw)).toBeNull();
      const fc = parseFlowchart(raw);
      expect(fc.v).toBe(2);
      expect(fc.nodes.map((n) => n.id)).toEqual(fx.data.nodes.map((n) => n.id));
      expect(fc.nodes.map((n) => n.text)).toEqual(
        fx.data.nodes.map((n) => ("text" in n ? n.text : "") ?? ""),
      );
      expect(fc.nodes.map((n) => [n.x, n.y, n.w, n.h])).toEqual(
        fx.data.nodes.map((n) => [n.x, n.y, n.w, n.h]),
      );
      expect(fc.edges.map((e) => e.id)).toEqual(fx.data.edges.map((e) => e.id));
      for (const [i, raw1] of fx.data.edges.entries()) {
        const e = fc.edges[i]!;
        const v1 = raw1 as {
          from: string;
          to: string;
          label?: string;
          style?: string;
          arrow?: string;
          fromSide?: string;
          toSide?: string;
        };
        expect([e.from, e.to]).toEqual([v1.from, v1.to]);
        expect(edgeLabel(e)).toBe(v1.label ?? "");
        expect(e.labels.every((l) => l.at === 0.5)).toBe(true);
        expect(e.style).toBe(v1.style ?? "solid");
        expect(edgeArrow(e)).toBe(v1.arrow ?? "end");
        expect(e.start === "none" || e.start === "arrow").toBe(true);
        expect(e.fromSide).toBe(v1.fromSide);
        expect(e.toSide).toBe(v1.toSide);
        expect([e.route, e.bends, e.width]).toEqual(["elbow", [], FLOWCHART_EDGE_WIDTH]);
      }
      // Written back as valid v2, and stable from then on.
      const v2 = serializeFlowchart(fc);
      expect(JSON.parse(v2).v).toBe(2);
      expect(flowchartDataIssue(v2)).toBeNull();
      expect(parseFlowchart(v2)).toEqual(fc);
      expect(serializeFlowchart(parseFlowchart(v2))).toBe(v2);
    });
  }

  it("v1 texts wrap and size exactly as before", () => {
    const fc = parseFlowchart(JSON.stringify(v1Fixtures.charts[0]!.data));
    const memo = fc.nodes.find((n) => n.id === "memo")!;
    const t = nodeTextLayout(memo);
    expect(t.lines).toEqual(["Check twice", "on Fridays"]);
    expect(t.anchor).toBe("middle");
    expect(t.x).toBe(memo.x + memo.w / 2);
    expect(
      fitNodeToText(
        node("x", 0, 0, {
          text: "A long label that will not fit on one line of a small box at all",
        }),
      ).h,
    ).toBe(88);
  });
});

describe("the server's check (v2)", () => {
  const ok = serializeFlowchart(richChart());

  it("accepts every field the model has", () => {
    expect(flowchartDataIssue(ok)).toBeNull();
    expect(validateWireBlock(block({ data: ok, height: 600 }))).toEqual([]);
  });

  // The patches reach into arbitrary JSON.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bad = (patch: (o: Record<string, any>) => void) => {
    const o = JSON.parse(ok);
    patch(o);
    return flowchartDataIssue(JSON.stringify(o));
  };

  it("refuses what doesn't fit", () => {
    expect(bad((o) => (o.v = 3))).toMatch(/version/);
    expect(bad((o) => (o.extra = 1))).toMatch(/unexpected/);
    expect(bad((o) => (o.nodes[0].shape = "rocket"))).toMatch(/shape/);
    expect(bad((o) => (o.nodes[1].fill = "red"))).toMatch(/fill/);
    expect(bad((o) => (o.nodes[1].fill = "url(#x)"))).toMatch(/fill/);
    expect(bad((o) => (o.nodes[1].strokeWidth = 40))).toMatch(/strokeWidth/);
    expect(bad((o) => (o.nodes[0].text = "something else"))).toMatch(/rich text/);
    expect(
      bad(
        (o) => (o.nodes[0].rich[0].text[1].marks = [{ type: "link", href: "javascript:alert(1)" }]),
      ),
    ).toMatch(/mark/);
    expect(bad((o) => (o.nodes[0].rich[0].text[0].marks = [{ type: "blink" }]))).toMatch(/mark/);
    expect(bad((o) => (o.nodes[0].rich[1].list = "roman"))).toMatch(/rich/);
    expect(bad((o) => (o.nodes[0].icon = { name: "rocket-ship" }))).toMatch(/icon/);
    expect(bad((o) => (o.nodes[2].image = { fileId: "../../etc/passwd" }))).toMatch(/image/);
    expect(bad((o) => (o.nodes[1].link = { documentId: "<x>" }))).toMatch(/link/);
    expect(bad((o) => (o.nodes[1].note = "x".repeat(FLOWCHART_LIMITS.maxNote + 1)))).toMatch(
      /note/,
    );
    expect(bad((o) => (o.nodes[1].parent = "nowhere"))).toMatch(/parent/);
    expect(bad((o) => (o.nodes[1].id = "f1"))).toMatch(/id/); // one namespace with frames and lanes
    expect(bad((o) => (o.frames[0].parent = "f1"))).toMatch(/parent/);
    expect(
      bad((o) =>
        o.frames.push(
          { id: "f2", x: 0, y: 0, w: 100, h: 100, parent: "f3" },
          { id: "f3", x: 0, y: 0, w: 100, h: 100, parent: "f2" },
        ),
      ),
    ).toMatch(/loop/);
    expect(bad((o) => (o.pools[0].lanes = []))).toMatch(/lanes/);
    expect(bad((o) => (o.pools[0].lanes[0].size = 5))).toMatch(/size/);
    expect(bad((o) => delete o.edges[4].toPoint)).toMatch(/node or a point/);
    expect(bad((o) => (o.edges[0].fromPoint = [0, 0]))).toMatch(/attached/);
    expect(bad((o) => (o.edges[0].to = "ghost"))).toMatch(/unknown node/);
    expect(bad((o) => (o.edges[0].fromAt = 2))).toMatch(/fromAt/);
    expect(bad((o) => (o.edges[1].route = "zigzag"))).toMatch(/route/);
    expect(bad((o) => (o.edges[1].start = "skull"))).toMatch(/start/);
    expect(bad((o) => (o.edges[1].width = 50))).toMatch(/width/);
    expect(bad((o) => (o.edges[1].color = "#zzzzzz"))).toMatch(/color/);
    expect(
      bad(
        (o) =>
          (o.edges[2].bends = Array.from({ length: FLOWCHART_LIMITS.maxBends + 1 }, () => [0, 0])),
      ),
    ).toMatch(/bends/);
    expect(
      bad(
        (o) =>
          (o.edges[0].labels = Array.from({ length: FLOWCHART_LIMITS.maxLabels + 1 }, () => ({
            text: "x",
          }))),
      ),
    ).toMatch(/labels/);
    expect(bad((o) => (o.edges[0].labels[0].at = -1))).toMatch(/label/);
    expect(bad((o) => (o.edges[0].label = "v1 field"))).toMatch(/unexpected/);
  });

  it("repairs refused data instead of losing it", () => {
    const o = JSON.parse(ok);
    o.nodes[0].shape = "rocket";
    o.nodes[1].fill = "red";
    o.edges[0].to = "ghost";
    o.frames[0].parent = "f1";
    const { block: repaired, repaired: changed } = repairWireBlock(
      block({ data: JSON.stringify(o), height: 600 }),
    );
    expect(changed).toBe(true);
    expect(validateWireBlock(repaired)).toEqual([]);
    const fc = parseFlowchart(String(repaired.props.data));
    expect(fc.nodes).toHaveLength(5);
    expect(fc.nodes[0]!.shape).toBe("process");
    expect(fc.nodes[1]!.fill).toBeUndefined();
    expect(fc.edges.map((e) => e.id)).not.toContain("e1");
    expect(fc.frames[0]!.parent).toBeUndefined();
  });
});

describe("the forgiving reader", () => {
  it("round-trips every v2 field through the compact wire form", () => {
    const fc = richChart();
    const s = serializeFlowchart(fc);
    expect(parseFlowchart(s)).toEqual(fc);
    // Defaults stay off the wire.
    const wire = JSON.parse(s);
    expect(wire.edges[3]).not.toHaveProperty("route");
    expect(wire.edges[3]).not.toHaveProperty("start");
    expect(wire.edges[0].labels[0]).toEqual({ text: "sync", at: 0.25 });
    expect(wire.edges[4]).toEqual({ id: "e5", from: "e", toPoint: [900, 700] });
    expect(serializeFlowchart(emptyFlowchart())).toBe("");
    // A chart of only a frame, or only a loose line, is still a chart.
    expect(
      serializeFlowchart(
        flowchart({
          frames: [{ id: "f", x: 0, y: 0, w: 100, h: 100, title: "", color: "neutral" }],
        }),
      ),
    ).not.toBe("");
  });

  it("cleans rich text: unsafe links and unknown marks go, formatting-free text stays plain", () => {
    const fc = normalizeFlowchart({
      nodes: [
        {
          id: "a",
          shape: "process",
          x: 0,
          y: 0,
          rich: [
            {
              text: [
                {
                  type: "text",
                  text: "Click",
                  marks: [
                    { type: "link", href: "javascript:alert(1)" },
                    { type: "bold" },
                    { type: "glow" },
                  ],
                },
              ],
            },
          ],
        },
        {
          id: "b",
          shape: "process",
          x: 0,
          y: 0,
          rich: [{ text: [{ type: "text", text: "plain" }] }],
        },
        {
          id: "c",
          shape: "process",
          x: 0,
          y: 0,
          text: "Edited by an older app",
          rich: [{ text: [{ type: "text", text: "Old", marks: [{ type: "bold" }] }] }],
        },
        {
          id: "d",
          shape: "process",
          x: 0,
          y: 0,
          rich: [
            { text: [{ type: "text", text: "line\nbreak", marks: [{ type: "italic" }] }] },
            { text: [{ type: "text", text: "two" }], list: "ordered" },
          ],
        },
      ],
    });
    const [a, b, c, d] = fc.nodes as [FlowNode, FlowNode, FlowNode, FlowNode];
    expect(a.rich).toEqual([
      { text: [{ type: "text", text: "Click", marks: [{ type: "bold" }] }] },
    ]);
    expect(a.text).toBe("Click");
    expect(b.rich).toBeUndefined();
    expect(b.text).toBe("plain");
    expect(c.rich).toBeUndefined();
    expect(c.text).toBe("Edited by an older app");
    expect(d.text).toBe("line break\ntwo");
    expect(flowchartDataIssue(serializeFlowchart(fc))).toBeNull();
  });

  it("keeps loose ends, forgets missing parents and frame loops, reads AI-style v1 fields", () => {
    const fc = normalizeFlowchart({
      frames: [
        { id: "f1", parent: "f2" },
        { id: "f2", parent: "f1" },
      ],
      nodes: [
        { id: "a", x: 0, y: 0, parent: "f1" },
        { id: "b", x: 300, y: 0, parent: "gone" },
      ],
      edges: [
        { from: "a", toPoint: { x: 500, y: 10 } },
        { fromPoint: [1e9, -5], to: "b", label: "in", arrow: "start" },
        { from: "a", to: "ghost" },
        { from: "a", to: "b", labels: [{ text: "x", at: 9 }, "plain", { text: "" }] },
        { from: "a", to: "a" },
      ],
    });
    expect(fc.frames.filter((f) => f.parent)).toHaveLength(1);
    expect(fc.nodes[0]!.parent).toBe("f1");
    expect(fc.nodes[1]!.parent).toBeUndefined();
    expect(fc.edges).toHaveLength(3);
    expect(fc.edges[0]).toMatchObject({ from: "a", to: "", toPoint: { x: 500, y: 10 } });
    expect(fc.edges[1]).toMatchObject({
      from: "",
      to: "b",
      fromPoint: { x: FLOWCHART_LIMITS.maxCoord, y: -5 },
      start: "arrow",
      end: "none",
    });
    expect(fc.edges[2]!.labels).toEqual([
      { text: "x", at: 1 },
      { text: "plain", at: 0.5 },
    ]);
    expect(flowchartDataIssue(serializeFlowchart(fc))).toBeNull();
  });

  it("caps sizes and keeps the server's limits", () => {
    const many = normalizeFlowchart({
      nodes: Array.from({ length: 700 }, (_, i) => ({ id: `n${i}`, x: i, y: 0 })),
      frames: Array.from({ length: 200 }, (_, i) => ({ id: `f${i}` })),
    });
    expect(many.nodes).toHaveLength(FLOWCHART_LIMITS.maxNodes);
    expect(many.frames).toHaveLength(FLOWCHART_LIMITS.maxFrames);
    // A full chart of ordinary shapes fits the data limit.
    const full = flowchart({
      nodes: Array.from({ length: FLOWCHART_LIMITS.maxNodes }, (_, i) =>
        node(`node${i}`, i * 200, 0, { text: `Step number ${i} of the process` }),
      ),
      edges: Array.from({ length: FLOWCHART_LIMITS.maxEdges }, (_, i) =>
        newEdge(`node${i % 500}`, `node${(i * 7 + 1) % 500}`, {
          id: `edge${i}`,
          labels: [{ text: "label", at: 0.5 }],
        }),
      ),
    });
    const s = serializeFlowchart(full);
    expect(flowchartDataIssue(s)).toBeNull();
  });

  it("always writes what the server accepts, whatever an editor holds", () => {
    const fc = richChart();
    const a = fc.nodes[0]!;
    // The plain text was edited without the formatting (an older editor): the text wins.
    fc.nodes[0] = { ...a, text: "Typed over" };
    fc.edges[0] = { ...fc.edges[0]!, fromAt: 1.7, width: 99, labels: [{ text: "x", at: -3 }, { text: "", at: 0.5 }], bends: [{ x: 1e9, y: 0 }] };
    const s = serializeFlowchart(fc);
    expect(flowchartDataIssue(s)).toBeNull();
    const back = parseFlowchart(s);
    expect(back.nodes[0]!.text).toBe("Typed over");
    expect(back.nodes[0]!.rich).toBeUndefined();
    expect(back.edges[0]).toMatchObject({ fromAt: 1, width: FLOWCHART_LIMITS.maxEdgeWidth, labels: [{ text: "x", at: 0 }], bends: [{ x: FLOWCHART_LIMITS.maxCoord, y: 0 }] });
  });

  it("helpers keep the v1 shorthands working", () => {
    const e = newEdge("a", "b");
    expect(edgeArrow(e)).toBe("end");
    expect(edgeArrow(withArrow({ ...e, end: "diamond" }, "both"))).toBe("both");
    expect(withArrow({ ...e, end: "diamond" }, "both").end).toBe("diamond");
    expect(withArrow(e, "start")).toMatchObject({ start: "arrow", end: "none" });
    expect(edgeLabel(withLabel(e, "Yes\nNo"))).toBe("Yes No");
    expect(withLabel(withLabel(e, "Yes"), "").labels).toEqual([]);
    expect(
      withLabel(
        {
          ...e,
          labels: [
            { text: "a", at: 0.2 },
            { text: "b", at: 0.8 },
          ],
        },
        "c",
      ).labels,
    ).toEqual([
      { text: "c", at: 0.2 },
      { text: "b", at: 0.8 },
    ]);
  });

  it("makes every text searchable", () => {
    const text = flowchartText(richChart());
    for (const s of [
      "Fulfilment",
      "Teams",
      "Sales",
      "Ship today",
      "Nightly backup",
      "Runbook",
      "sync",
      "nightly",
      "Paid?",
    ])
      expect(text).toContain(s);
  });
});

describe("rich labels", () => {
  it("wraps formatted runs, carrying marks across breaks, with list markers and hanging indents", () => {
    const lines = wrapRichText(
      [
        {
          text: [
            { type: "text", text: "A bold start", marks: [{ type: "bold" }] },
            { type: "text", text: " then plain words that wrap" },
          ],
        },
        { text: [{ type: "text", text: "first item that is long" }], list: "ordered" },
        { text: [{ type: "text", text: "second" }], list: "ordered" },
      ],
      120,
    );
    expect(lines[0]!.spans[0]).toEqual({ text: "A bold start", marks: [{ type: "bold" }] });
    expect(lines.map((l) => l.spans.map((s) => s.text).join(""))).toContain("first item that");
    expect(lines.find((l) => l.marker === "1.")).toBeTruthy();
    expect(lines.find((l) => l.marker === "2.")).toBeTruthy();
    const cont = lines.filter((l) => !l.marker && l.indent > 0);
    expect(cont.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.width <= 120 + 1)).toBe(true);
  });

  it("auto-height grows and shrinks a shape with its text", () => {
    const grown = fitNodeToText(
      node("a", 0, 0, {
        autoHeight: true,
        h: 40,
        text: "Many words in this label so that it needs several lines to fit inside the box",
      }),
    );
    expect(grown.h).toBeGreaterThan(64);
    const shrunk = fitNodeToText({ ...grown, text: "Short" });
    expect(shrunk.h).toBeLessThan(grown.h);
    expect(shrunk.h % 8).toBe(0);
  });

  it("leaves room for icons and images", () => {
    const plain = nodeContentBoxes(node("a"));
    const left = nodeContentBoxes(node("a", 0, 0, { icon: { name: "user" } }));
    expect(left.icon).not.toBeNull();
    expect(left.text.x).toBeGreaterThan(plain.text.x);
    const top = nodeContentBoxes(node("a", 0, 0, { h: 120, icon: { name: "user", place: "top" } }));
    expect(top.text.y).toBeGreaterThan(plain.text.y);
    const img = nodeContentBoxes(node("a", 0, 0, { h: 160, image: { fileId: "f1" } }));
    expect(img.image!.y + img.image!.h).toBeLessThanOrEqual(img.text.y);
    expect(
      nodeContentBoxes(node("a", 0, 0, { note: "n", link: { documentId: "d" } })).badges.map(
        (b) => b.kind,
      ),
    ).toEqual(["note", "link"]);
  });
});

describe("the shape library", () => {
  it("draws every shape with an outline, connection points and a label box inside it", () => {
    for (const shape of FLOWCHART_SHAPES) {
      const n = node("s", 100, 50, { shape, ...FLOWCHART_SHAPE_SIZE[shape] });
      expect(shapePath(n), shape).toMatch(/^M[-\d.]+ [-\d.]+.*Z$/);
      const poly = shapeOutline(n);
      expect(poly.length, shape).toBeGreaterThanOrEqual(3);
      for (const p of poly) {
        expect(p.x, shape).toBeGreaterThanOrEqual(n.x - 0.5);
        expect(p.x, shape).toBeLessThanOrEqual(n.x + n.w + 0.5);
        expect(p.y, shape).toBeGreaterThanOrEqual(n.y - 1.5);
        expect(p.y, shape).toBeLessThanOrEqual(n.y + n.h + 1.5);
      }
      for (const side of ["top", "right", "bottom", "left"] as const) {
        const p = outlinePoint(n, side, 0.5);
        expect(p.x, `${shape} ${side}`).toBeGreaterThanOrEqual(n.x - 0.5);
        expect(p.x, `${shape} ${side}`).toBeLessThanOrEqual(n.x + n.w + 0.5);
        expect(p.y, `${shape} ${side}`).toBeGreaterThanOrEqual(n.y - 1.5);
        expect(p.y, `${shape} ${side}`).toBeLessThanOrEqual(n.y + n.h + 1.5);
      }
      const tb = shapeTextBox(shape, n.w, n.h);
      expect(tb.x, shape).toBeGreaterThanOrEqual(0);
      expect(tb.y, shape).toBeGreaterThanOrEqual(0);
      expect(tb.x + tb.w, shape).toBeLessThanOrEqual(n.w + 0.01);
      expect(tb.y + tb.h, shape).toBeLessThanOrEqual(n.h + 0.01);
      expect(pointInShape(n, { x: n.x + tb.x + tb.w / 2, y: n.y + tb.y + tb.h / 2 }), shape).toBe(
        shape === "collate" ? pointInShape(n, { x: n.x + n.w / 2, y: n.y + n.h / 2 }) : true,
      );
    }
  });

  it("meets pointed outlines where they are, not at the box", () => {
    const d = node("d", 0, 0, { shape: "decision", w: 200, h: 100 });
    expect(outlinePoint(d, "top", 0.5).x).toBe(100);
    expect(outlinePoint(d, "top", 0.5).y).toBeLessThan(2); // the tip, softened
    const off = outlinePoint(d, "top", 0.25);
    expect(off.y).toBeGreaterThan(20);
    expect(pointInShape(d, { x: 100, y: 50 })).toBe(true);
    expect(pointInShape(d, { x: 5, y: 5 })).toBe(false);
  });

  it("searches shapes and icons", () => {
    expect(searchFlowShapes("data").slice(0, 3)).toEqual(
      expect.arrayContaining(["io", "database"]),
    );
    expect(searchFlowShapes("db")).toContain("database");
    expect(searchFlowShapes("", "basic")).toContain("star");
    expect(searchFlowShapes("zzz")).toEqual([]);
    expect(searchFlowIcons("mail")).toEqual(["mail"]);
    expect(FLOWCHART_ICONS.length).toBeGreaterThan(30);
  });
});

describe("containers", () => {
  it("knows lanes, frames, members and where a shape belongs", () => {
    const fc = richChart();
    const pool = fc.pools[0]!;
    const lanes = laneBoxes(pool);
    expect(lanes.map((l) => l.rect.h)).toEqual([160, 160]);
    expect(poolRect(pool)).toEqual({ x: 0, y: 600, w: 900, h: 36 + 320 });
    expect(lanes[1]!.content.x).toBe(120);
    expect(containerMembers(fc, "f1").nodes.sort()).toEqual(["a", "b", "c"]);
    expect(containerAt(fc, { x: 300, y: 820, w: 10, h: 10 })).toBe("l2");
    expect(containerAt(fc, { x: 100, y: 100, w: 10, h: 10 })).toBe("f1");
    expect(containerAt(fc, { x: 3000, y: 100, w: 10, h: 10 })).toBeNull();
    const cols = laneBoxes({ ...pool, orient: "columns" });
    expect(cols[1]!.rect.x).toBe(160);
  });
});

describe("SVG", () => {
  it("draws everything, in light and dark", () => {
    const fc = richChart();
    const light = flowchartDataToSvg(fc);
    const dark = flowchartDataToSvg(fc, { theme: "dark" });
    expect(light).toMatchSnapshot("light");
    expect(dark).toMatchSnapshot("dark");
    expect(light).toContain("Fulfilment");
    expect(light).toContain("Teams");
    expect(light).toContain('font-weight="600"');
    expect(light).toContain('<a href="https://folevi.com">');
    expect(light).toMatch(/stroke-dasharray="0.1 /); // dotted
    expect(dark).toContain('fill="#18181b"');
    expect(light).not.toBe(dark);
    // Valid XML-ish: no attribute appears twice on one element.
    for (const tag of light.match(/<[a-z]+ [^>]*>/g)!) {
      const names = [...tag.matchAll(/ ([a-z-]+)="/g)].map((m) => m[1]);
      expect(new Set(names).size, tag).toBe(names.length);
    }
  });

  it("escapes text and only loads safe image addresses", () => {
    const fc = flowchart({
      nodes: [node("a", 0, 0, { text: '<script>"x"</script>', image: { fileId: "f1" } })],
    });
    const svg = flowchartDataToSvg(fc, { imageUrl: () => "javascript:alert(1)" });
    expect(svg).not.toContain("<script>");
    expect(svg).not.toContain("javascript:");
    expect(svg).toContain("&lt;script&gt;");
    expect(
      flowchartDataToSvg(fc, { imageUrl: (id) => `https://files.folevi.com/${id}` }),
    ).toContain('<image href="https://files.folevi.com/f1"');
    expect(flowchartToSvg("")).toContain("empty");
  });
});

describe("Mermaid", () => {
  it("exports the new shapes, containers and line ends, and reads them back", () => {
    const fc = richChart();
    const md = flowchartToMermaid(fc);
    expect(md).toContain('@{ shape: doc, label: "Ship today<br/>Pack<br/>Label" }');
    expect(md).toContain('n2[("');
    expect(md).toMatch(/subgraph s\d+ \["Fulfilment"\]/);
    expect(md).toMatch(/subgraph s\d+ \["Sales"\]/);
    expect(md).toContain("style n2 fill:#e8f0fe,stroke:#3b6fd4");
    const back = mermaidToFlowchart(md);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const shapes = back.data.nodes.map((n) => n.shape);
    // A cloud has no Mermaid shape: it travels as a rounded box.
    expect(shapes).toEqual(["document", "database", "rounded", "decision", "rounded"]);
    expect(back.data.frames.map((f) => f.title)).toEqual(
      expect.arrayContaining(["Fulfilment", "Sales", "Ops"]),
    );
    expect(flowchartDataIssue(serializeFlowchart(back.data))).toBeNull();
  });

  it("reads Mermaid's shape names, subgraphs, thick and circle-ended links", () => {
    const res = mermaidToFlowchart(
      [
        "flowchart LR",
        '  A@{ shape: doc, label: "Report" } ==> B@{ shape: cyl }',
        "  B --o C[(Store)]",
        "  subgraph S1 [Back office]",
        "    C --> D[[Routine]]",
        "  end",
        "  D x--x E{{Prepare}}",
      ].join("\n"),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const by = (id: string) => res.data.nodes.find((n) => n.text === id)!;
    expect(by("Report").shape).toBe("document");
    expect(by("B").shape).toBe("database");
    expect(by("Store").shape).toBe("database");
    expect(by("Routine").shape).toBe("predefined");
    expect(by("Prepare").shape).toBe("preparation");
    const frame = res.data.frames.find((f) => f.title === "Back office")!;
    expect(by("Store").parent).toBe(frame.id);
    expect(by("Routine").parent).toBe(frame.id);
    const edge = (a: string, b: string) =>
      res.data.edges.find((e) => e.from === by(a).id && e.to === by(b).id)!;
    expect(edge("Report", "B").width).toBe(3);
    expect(edge("B", "Store").end).toBe("circle");
    expect([edge("Routine", "Prepare").start, edge("Routine", "Prepare").end]).toEqual([
      "bar",
      "bar",
    ]);
    // Laid out with the frame around its members.
    for (const n of [by("Store"), by("Routine")]) {
      expect(n.x).toBeGreaterThanOrEqual(frame.x);
      expect(n.x + n.w).toBeLessThanOrEqual(frame.x + frame.w);
    }
  });
});
