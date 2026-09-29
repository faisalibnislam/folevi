import { describe, expect, it } from "vitest";
import {
  FLOWCHART_LIMITS,
  LIMITS,
  blockSearchText,
  blocksToHtml,
  blocksToMarkdown,
  fitNodeToText,
  flowchartBounds,
  flowchartDataIssue,
  flowchartToMermaid,
  flowchartToSvg,
  layoutFlowchart,
  mermaidToFlowchart,
  normalizeFlowchart,
  parseFlowchart,
  rectsOverlap,
  routeEdges,
  serializeFlowchart,
  validateWireBlock,
  wrapFlowText,
  type FlowchartData,
  type FlowNode,
  type WireBlock,
} from "../src";

let n = 0;
const block = (props: Record<string, unknown>): WireBlock => ({
  id: `01JAFLOWCHART00000000000${String(++n).padStart(2, "0")}`,
  type: "flowchart",
  parentId: null,
  rank: "V",
  schemaVersion: 1,
  text: [],
  props,
});
const codes = (b: WireBlock) => validateWireBlock(b).map((i) => i.code);
const node = (id: string, x = 0, y = 0, extra: Partial<FlowNode> = {}): FlowNode => ({ id, shape: "process", x, y, w: 160, h: 64, text: id, color: "neutral", ...extra });
const chart = (nodes: FlowNode[], edges: [string, string, string?][] = []): FlowchartData => ({
  v: 1,
  nodes,
  edges: edges.map(([from, to, label], i) => ({ id: `e${i}`, from, to, label: label ?? "", style: "solid", arrow: "end" })),
});

describe("flowchart data", () => {
  const ok = serializeFlowchart(chart([node("a"), node("b", 0, 120)], [["a", "b", "Yes"]]));

  it("validates on the server: shape, ids, references, ranges and size", () => {
    expect(codes(block({ data: ok, height: 440 }))).toEqual([]);
    expect(codes(block({ data: "", height: 440 }))).toEqual([]);
    expect(codes(block({ data: "nope", height: 440 }))).toEqual(["shape"]);
    expect(codes(block({ data: ok, height: 20 }))).toEqual(["range"]);
    expect(codes(block({ data: ok }))).toEqual(["required"]);
    const bad = (patch: (o: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] }) => void) => {
      const o = JSON.parse(ok);
      patch(o);
      return flowchartDataIssue(JSON.stringify(o));
    };
    expect(bad((o) => (o.nodes[0]!.shape = "star"))).toMatch(/shape/);
    expect(bad((o) => (o.nodes[1]!.id = "a"))).toMatch(/id/);
    expect(bad((o) => (o.nodes[0]!.id = "<script>"))).toMatch(/id/);
    expect(bad((o) => (o.nodes[0]!.w = 5))).toMatch(/w/);
    expect(bad((o) => (o.nodes[0]!.x = Infinity))).toMatch(/x/);
    expect(bad((o) => (o.nodes[0]!.color = "url(#x)"))).toMatch(/color/);
    expect(bad((o) => (o.nodes[0]!.onclick = "x"))).toMatch(/unexpected/);
    expect(bad((o) => (o.nodes[0]!.text = "x".repeat(FLOWCHART_LIMITS.maxText + 1)))).toMatch(/text/);
    expect(bad((o) => (o.edges[0]!.to = "zzz"))).toMatch(/unknown node/);
    expect(bad((o) => (o.edges[0]!.arrow = "left"))).toMatch(/arrow/);
    expect(bad((o) => (o.edges[0]!.fromSide = "middle"))).toMatch(/fromSide/);
    expect(codes(block({ data: " ".repeat(LIMITS.maxFlowchartDataLength + 1), height: 440 }))).toEqual(["too_long"]);
  });

  it("round-trips through the compact wire form (defaults omitted)", () => {
    const fc = chart([node("a"), node("b", 0, 120, { color: "blue", shape: "decision" })], [["a", "b"]]);
    fc.edges[0]!.fromSide = "bottom";
    const s = serializeFlowchart(fc);
    expect(s).not.toContain('"style"');
    expect(s).not.toContain('"neutral"');
    expect(parseFlowchart(s)).toEqual(fc);
    expect(serializeFlowchart({ v: 1, nodes: [], edges: [] })).toBe("");
  });

  it("reads bad data forgivingly: drops, clamps, dedupes, never throws", () => {
    expect(parseFlowchart("garbage")).toEqual({ v: 1, nodes: [], edges: [] });
    expect(parseFlowchart(null).nodes).toEqual([]);
    const fc = normalizeFlowchart({
      nodes: [
        { id: "a", shape: "hexagon", x: 1e9, y: "3", w: 99999, h: -4, text: 42, color: "chartreuse" },
        { id: "a", shape: "note", x: 10, y: 10, text: `hi\u0000\r\nthere${"!".repeat(900)}` },
        "junk",
        { id: "c" },
      ],
      edges: [
        { from: "a", to: "a" },
        { from: "a", to: "missing" },
        { from: "a", to: "c", label: "go\nnow", style: "wavy", arrow: "both", fromSide: "north" },
        { from: "a", to: "c", label: "duplicate" },
      ],
    });
    expect(fc.nodes).toHaveLength(3);
    const [a, second, c] = fc.nodes as [FlowNode, FlowNode, FlowNode];
    expect(a).toMatchObject({ shape: "process", x: 0, y: 0, w: FLOWCHART_LIMITS.maxWidth, h: FLOWCHART_LIMITS.minSize, text: "", color: "neutral" });
    expect(fc.unplaced).toEqual([a.id, c.id]);
    expect(second.id).not.toBe("a");
    expect(second.text.startsWith("hi\nthere!")).toBe(true);
    expect(second.text.length).toBe(FLOWCHART_LIMITS.maxText);
    expect(fc.edges).toHaveLength(1);
    expect(fc.edges[0]).toMatchObject({ from: "a", to: c.id, label: "go now", style: "solid", arrow: "both" });
    expect(fc.edges[0]!.fromSide).toBeUndefined();
    // Whatever comes out is valid on the server.
    expect(flowchartDataIssue(serializeFlowchart(fc))).toBeNull();
  });

  it("caps node and edge counts", () => {
    const many = normalizeFlowchart({ nodes: Array.from({ length: 700 }, (_, i) => ({ id: `n${i}`, x: i, y: 0 })), edges: [] });
    expect(many.nodes).toHaveLength(FLOWCHART_LIMITS.maxNodes);
  });
});

describe("flowchart text", () => {
  it("wraps words, breaks long words and keeps new lines", () => {
    expect(wrapFlowText("Check the order details", 90)).toEqual(["Check the", "order details"]);
    expect(wrapFlowText("a\nb", 200)).toEqual(["a", "b"]);
    const long = wrapFlowText("Supercalifragilisticexpialidocious", 60);
    expect(long.length).toBeGreaterThan(2);
    expect(long.join("")).toBe("Supercalifragilisticexpialidocious");
  });

  it("grows a node to fit its label", () => {
    const n0 = node("a", 0, 0, { text: "A long label that will not fit on one line of a small box at all" });
    const fitted = fitNodeToText(n0);
    expect(fitted.w).toBe(160);
    expect(fitted.h).toBeGreaterThan(64);
    expect(fitted.h % 8).toBe(0);
    expect(fitNodeToText(node("b", 0, 0, { text: "A somewhat wider label" }), { maxWidth: 240 }).w).toBeGreaterThanOrEqual(160);
  });
});

describe("routing and layout", () => {
  it("routes connectors orthogonally from side to side, with arrowheads and labels", () => {
    const fc = chart([node("a"), node("b", 0, 200)], [["a", "b", "Next"]]);
    const [r] = routeEdges(fc);
    expect(r!.fromSide).toBe("bottom");
    expect(r!.toSide).toBe("top");
    expect(r!.points[0]).toEqual({ x: 80, y: 64 });
    expect(r!.points[r!.points.length - 1]).toEqual({ x: 80, y: 200 });
    for (let i = 1; i < r!.points.length; i++) {
      const [p, q] = [r!.points[i - 1]!, r!.points[i]!];
      expect(p.x === q.x || p.y === q.y).toBe(true);
    }
    expect(r!.heads).toHaveLength(1);
    expect(r!.label).not.toBeNull();
    const side = routeEdges(chart([node("a"), node("b", 400, 0)], [["a", "b"]]))[0]!;
    expect([side.fromSide, side.toSide]).toEqual(["right", "left"]);
  });

  it("sends a decision's second branch out sideways", () => {
    const fc = chart([node("d", 200, 0, { shape: "decision" }), node("y", 200, 200), node("n", 500, 200)], [["d", "y", "Yes"], ["d", "n", "No"]]);
    const routed = routeEdges(fc);
    expect(routed.map((r) => r.fromSide)).toEqual(["bottom", "right"]);
  });

  it("lays out top-down in layers without overlaps, keeping sizes", () => {
    const fc = chart(
      ["start", "a", "b", "c", "end", "lone"].map((id) => node(id, 0, 0)),
      [["start", "a"], ["start", "b"], ["a", "c"], ["b", "c"], ["c", "end"], ["end", "start"]],
    );
    const out = layoutFlowchart(fc, { origin: { x: 0, y: 0 } });
    const at = (id: string) => out.nodes.find((x) => x.id === id)!;
    expect(at("start").y).toBeLessThan(at("a").y);
    expect(at("a").y).toBe(at("b").y);
    expect(at("c").y).toBeGreaterThan(at("a").y);
    expect(at("end").y).toBeGreaterThan(at("c").y);
    for (const p of out.nodes) for (const q of out.nodes) if (p !== q) expect(rectsOverlap(p, q), `${p.id}/${q.id}`).toBe(false);
    expect(out.nodes.every((x) => x.w === 160 && x.h === 64 && x.x % 8 === 0 && x.y % 8 === 0)).toBe(true);
    expect(Math.min(...out.nodes.map((x) => x.x))).toBe(0);
    const lr = layoutFlowchart(fc, { direction: "LR", origin: { x: 0, y: 0 } });
    const lat = (id: string) => lr.nodes.find((x) => x.id === id)!;
    expect(lat("a").x).toBeGreaterThan(lat("start").x);
  });

  it("lays out 200 nodes quickly", () => {
    const nodes = Array.from({ length: 200 }, (_, i) => node(`n${i}`));
    const edges = nodes.slice(1).map((x, i) => [`n${Math.floor(i / 2)}`, x.id] as [string, string]);
    const t = performance.now();
    const out = layoutFlowchart(chart(nodes, edges));
    routeEdges(out);
    expect(performance.now() - t).toBeLessThan(1500);
    expect(flowchartBounds(out)!.w).toBeGreaterThan(0);
  });
});

describe("Mermaid", () => {
  it("reads the common flowchart subset", () => {
    const res = mermaidToFlowchart(
      [
        "flowchart TD",
        "  %% a comment",
        "  A[Start here] --> B{Is it ok?}",
        "  B -- Yes --> C([Done])",
        "  B -->|No| D[/Fix input/]",
        "  D -.-> E((Loop)) --- A",
        '  E <--> F["Say #quot;hi#quot;<br/>twice"]',
        "  classDef red fill:#f00",
        "  subgraph Group",
        "    G & H --> I",
        "  end",
      ].join("\n"),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const byText = (t: string) => res.data.nodes.find((n) => n.text === t)!;
    expect(byText("Start here").shape).toBe("process");
    expect(byText("Is it ok?").shape).toBe("decision");
    expect(byText("Done").shape).toBe("terminator");
    expect(byText("Fix input").shape).toBe("io");
    expect(byText("Loop").shape).toBe("circle");
    expect(byText('Say "hi"\ntwice').shape).toBe("process");
    expect(res.data.nodes).toHaveLength(9);
    const edge = (from: string, to: string) => res.data.edges.find((e) => e.from === byText(from).id && e.to === byText(to).id)!;
    expect(edge("Is it ok?", "Done").label).toBe("Yes");
    expect(edge("Is it ok?", "Fix input").label).toBe("No");
    expect(edge("Fix input", "Loop").style).toBe("dashed");
    expect(edge("Loop", "Start here").arrow).toBe("none");
    expect(edge("Loop", 'Say "hi"\ntwice').arrow).toBe("both");
    expect(res.data.edges.filter((e) => e.to === byText("I").id)).toHaveLength(2);
    expect(flowchartDataIssue(serializeFlowchart(res.data))).toBeNull();
  });

  it("refuses other diagram types", () => {
    const res = mermaidToFlowchart("sequenceDiagram\n  A->>B: hi");
    expect(res.ok).toBe(false);
    expect(mermaidToFlowchart("graph LR\n A --> B")).toMatchObject({ ok: true, direction: "LR" });
  });

  it("exports a flowchart as Mermaid that reads back to the same graph", () => {
    const fc = chart([node("a", 0, 0, { shape: "terminator", text: "Start" }), node("b", 0, 120, { shape: "decision", text: 'Ok "really"?', color: "blue" }), node("c", 0, 240, { text: "Ship | go" })], [["a", "b"], ["b", "c", "Yes"]]);
    fc.edges[0]!.style = "dashed";
    const md = flowchartToMermaid(fc);
    expect(md.split("\n")[0]).toBe("flowchart TD");
    expect(md).toContain('n1(["Start"])');
    expect(md).toContain("n1 -.-> n2");
    expect(md).toContain("classDef blue");
    const back = mermaidToFlowchart(md);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.data.nodes.map((n) => [n.shape, n.text])).toEqual([
      ["terminator", "Start"],
      ["decision", 'Ok "really"?'],
      ["process", "Ship | go"],
    ]);
    expect(back.data.edges.map((e) => [e.label, e.style])).toEqual([
      ["", "dashed"],
      ["Yes", "solid"],
    ]);
  });
});

describe("exports and search", () => {
  const data = serializeFlowchart(chart([node("a", 0, 0, { text: "<b>Start</b>" }), node("b", 0, 120, { text: "End" })], [["a", "b", "then & now"]]));

  it("exports Markdown as a Mermaid fence and HTML as an escaped inline SVG", () => {
    const md = blocksToMarkdown([block({ data, height: 440 })]);
    expect(md.startsWith("```mermaid\nflowchart TD\n")).toBe(true);
    const html = blocksToHtml([block({ data, height: 440 })], { title: "T" });
    expect(html).toContain('<figure class="flowchart"><svg');
    expect(html).toContain("&lt;b&gt;Start&lt;/b&gt;");
    expect(html).not.toContain("<b>Start");
    expect(flowchartToSvg("")).toContain("empty");
    expect(blocksToMarkdown([block({ data: "", height: 440 })]).trim()).toBe("");
  });

  it("makes node text and labels searchable", () => {
    expect(blockSearchText(block({ data, height: 440 }))).toContain("then & now");
  });
});
