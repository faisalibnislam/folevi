#!/usr/bin/env node
// Regenerates apps/macos/FoleviTests/Fixtures/flowchart-reference.json from the TypeScript flowchart
// reference (packages/editor-schema/src/flowchart*.ts and the web canvas's pure edits,
// apps/web/src/components/editor/flowchart/ops.ts). The Swift port in Folevi/Domain/Flowchart*.swift is
// tested against this file (FoleviTests/FlowchartTests.swift).
//   node apps/macos/scripts/generate-flowchart-fixtures.mjs
// Needs Node 22.18+ (type stripping); no node_modules. Nothing is written outside the fixture.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "../../..");
const dir = mkdtempSync(join(tmpdir(), "folevi-flowchart-"));
const copy = (from, to, rewrite = (s) => s) => {
  const text = readFileSync(join(root, from), "utf8").replace(/from "(\.\.?\/[^"]+)"/g, (_, p) => `from "${p}.ts"`);
  mkdirSync(dirname(join(dir, to)), { recursive: true });
  writeFileSync(join(dir, to), rewrite(text));
};
for (const f of ["flowchart", "flowchartGeometry", "flowchartLayout", "flowchartMermaid", "flowchartSvg", "generated/schema"]) {
  copy(`packages/editor-schema/src/${f}.ts`, `${f}.ts`);
}
writeFileSync(join(dir, "barrel.ts"), ['export * from "./flowchart.ts";', 'export * from "./flowchartGeometry.ts";', 'export * from "./flowchartLayout.ts";'].join("\n"));
copy("apps/web/src/components/editor/flowchart/ops.ts", "ops.ts", (s) => s.replace('from "@folevi/editor-schema"', 'from "./barrel.ts"'));

// Random ids (flowId) never reach the fixture, but keep any accidental use stable.
let seed = 42;
Math.random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

const fc = await import(pathToFileURL(join(dir, "flowchart.ts")).href);
const geo = await import(pathToFileURL(join(dir, "flowchartGeometry.ts")).href);
const lay = await import(pathToFileURL(join(dir, "flowchartLayout.ts")).href);
const mer = await import(pathToFileURL(join(dir, "flowchartMermaid.ts")).href);
const svg = await import(pathToFileURL(join(dir, "flowchartSvg.ts")).href);
const ops = await import(pathToFileURL(join(dir, "ops.ts")).href);

const N = (id, shape, x, y, w, h, text = "", color = "neutral") => ({ id, shape, x, y, w, h, text, color });
const E = (id, from, to, extra = {}) => ({ id, from, to, label: "", style: "solid", arrow: "end", ...extra });

const charts = {
  approval: {
    v: 1,
    nodes: [
      N("start", "terminator", 0, 0, 160, 56, "Start"),
      N("review", "process", 0, 120, 160, 64, "Review the request carefully before anything else"),
      N("ok", "decision", -8, 240, 176, 96, "Approved?"),
      N("yes", "process", -8, 400, 176, 64, "Ship it", "green"),
      N("no", "io", 248, 256, 176, 64, "Send back", "pink"),
      N("memo", "note", 480, 40, 176, 112, "Remember to log every step in the tracker", "neutral"),
      N("end", "circle", 24, 520, 104, 104, "End", "purple"),
      N("aside", "text", 480, 200, 160, 40, "A comment", "accent"),
    ],
    edges: [
      E("e1", "start", "review"),
      E("e2", "review", "ok"),
      E("e3", "ok", "yes", { label: "Yes" }),
      E("e4", "ok", "no", { label: "No", style: "dashed" }),
      E("e5", "no", "review", { arrow: "both", fromSide: "top", toSide: "right" }),
      E("e6", "yes", "end", { arrow: "none" }),
      E("e7", "memo", "aside", { label: "a very long connector label that goes on and on and on past the cap" }),
    ],
  },
  sideways: {
    v: 1,
    nodes: [
      N("a", "process", 0, 0, 160, 64, "One"),
      N("b", "process", 240, 8, 160, 64, "Two"),
      N("c", "decision", 480, -16, 176, 96, "Three?"),
      N("d", "terminator", 720, 0, 160, 56, "Four"),
      N("e", "process", 480, 160, 160, 64, "Five"),
    ],
    edges: [E("e1", "a", "b"), E("e2", "b", "c"), E("e3", "c", "d", { label: "ok" }), E("e4", "c", "e"), E("e5", "e", "a", { style: "dashed" })],
  },
  tangled: {
    v: 1,
    nodes: [
      N("p", "process", 300, 300, 160, 64, "P"),
      N("q", "process", 0, 0, 200, 80, "Q"),
      N("r", "decision", 50, 500, 176, 96, "R"),
      N("s", "circle", 900, 100, 104, 104, "S"),
      N("t", "process", 600, 600, 160, 64, "T"),
      N("u", "note", -400, 200, 176, 112, "U"),
      N("v", "text", 100, 900, 160, 40, "V"),
      N("w", "io", 700, 0, 176, 64, "W"),
      N("x", "process", 400, 0, 120, 64, "X"),
    ],
    edges: [
      E("e1", "q", "p"),
      E("e2", "p", "r"),
      E("e3", "r", "q"),
      E("e4", "r", "t"),
      E("e5", "q", "t"),
      E("e6", "s", "w"),
      E("e7", "x", "p"),
      E("e8", "x", "r"),
      E("e9", "q", "r"),
    ],
  },
  fan: {
    v: 1,
    nodes: [
      N("d", "decision", 200, 0, 176, 96, "Which?"),
      N("a", "process", 0, 200, 160, 64, "A"),
      N("b", "process", 200, 200, 160, 64, "B"),
      N("c", "process", 400, 200, 160, 64, "C"),
      N("z", "process", 600, 0, 160, 64, "Z"),
    ],
    edges: [E("e1", "d", "a"), E("e2", "d", "b"), E("e3", "d", "c"), E("e4", "z", "b"), E("e5", "z", "c"), E("e6", "a", "c", { toSide: "bottom", fromSide: "bottom" })],
  },
};

const messy = [
  "",
  "not json",
  "[]",
  '{"v":2,"nodes":[]}',
  '{"nodes":[],"extra":1}',
  '{"nodes":{}}',
  '{"nodes":[{"id":"a","shape":"process","x":0,"y":0,"w":10,"h":40}]}',
  '{"nodes":[{"id":"a","shape":"blob","x":0,"y":0,"w":100,"h":40}]}',
  '{"nodes":[{"id":"a b","shape":"process","x":0,"y":0,"w":100,"h":40}]}',
  '{"nodes":[{"id":"a","shape":"process","x":0,"y":0,"w":100,"h":40,"text":5}]}',
  '{"nodes":[{"id":"a","shape":"process","x":0,"y":0,"w":100,"h":40,"color":"red"}]}',
  '{"nodes":[{"id":"a","shape":"process","x":0,"y":0,"w":100,"h":40,"z":1}]}',
  '{"nodes":[{"id":"a","shape":"process","x":200000,"y":0,"w":100,"h":40}]}',
  '{"nodes":[{"id":"a","shape":"process","x":0,"y":0,"w":100,"h":40}],"edges":[{"id":"e","from":"a","to":"b"}]}',
  '{"nodes":[{"id":"a","shape":"process","x":0,"y":0,"w":100,"h":40},{"id":"b","shape":"process","x":0,"y":0,"w":100,"h":40}],"edges":[{"id":"e","from":"a","to":"b","style":"dotted"}]}',
  '{"nodes":[{"id":"a","shape":"process","x":0,"y":0,"w":100,"h":40},{"id":"b","shape":"process","x":0,"y":0,"w":100,"h":40}],"edges":[{"id":"e","from":"a","to":"b","arrow":"none","fromSide":"top","label":"ok"}]}',
  '{"nodes":[{"id":"a","shape":"process","x":0,"y":0,"w":100,"h":40},{"id":"a","shape":"process","x":0,"y":0,"w":100,"h":40}]}',
  '{"v":1,"nodes":[{"id":"a","shape":"process","x":0,"y":0,"w":100,"h":40}],"edges":[]}',
];

// Normalize inputs whose ids never need a random replacement.
const normalizeInputs = [
  {
    nodes: [
      { id: "a", shape: "decision", x: 10.4, y: -3.6, w: 2000, h: 5, text: "Line\r\nTwo\u0001\u0007 tab\there", color: "blue" },
      { id: 7, shape: "nope", text: 12, color: "orange" },
      { id: "b", shape: "circle", x: "4", y: 2, w: 100.5, h: 100.5, text: "x".repeat(400) },
      null,
      "string",
      { id: "c-d_e", shape: "text", x: -200000, y: 200000 },
    ],
    edges: [
      { id: "e1", from: "a", to: 7, label: "Multi\n\nline\rlabel", style: "dashed", arrow: "both", fromSide: "left", toSide: "nowhere" },
      { id: "e2", from: "a", to: 7, fromSide: "left" },
      { id: "e3", from: "a", to: "a" },
      { id: "e4", from: "a", to: "missing" },
      { id: "e5", from: 7, to: "b", style: "wavy", arrow: "sideways", label: "y".repeat(200) },
      { id: "e6", from: "b", to: "c-d_e", toSide: "top" },
      "nope",
    ],
  },
  { nodes: "nope", edges: [] },
  "string",
];

const wraps = [
  ["Hello world", 200],
  ["Review the request carefully before anything else", 136],
  ["Supercalifragilisticexpialidocious and more", 80],
  ["  leading and   multiple   spaces  ", 90],
  ["Line one\nLine two\n\nLine four", 120],
  ["日本語のテキストを折り返す テスト", 100],
  ["emoji 🎉🎉🎉 party time", 70],
  ["Mix of WWW and iii and MMM and lll", 60],
  [Array.from({ length: 30 }, (_, i) => `row${i}`).join("\n"), 200],
  ["", 100],
  ["a", 1],
];

const measures = ["Hello", "iljI|!.,:;'`", "frt()[]{}/\\-\"", "mwMW@%", "ABC xyz 0123", "日本", "é ü ß", "🎉"];

const fitCases = [
  N("f1", "process", 0, 0, 160, 64, "Short"),
  N("f2", "process", 0, 0, 160, 64, "A much longer label that needs more width to fit on one line"),
  N("f3", "decision", 0, 0, 176, 96, "Is the request complete and signed by a manager?"),
  N("f4", "circle", 0, 0, 104, 104, "A circle with a longer label inside"),
  N("f5", "terminator", 0, 0, 160, 56, "Begin the process\nwith two lines"),
  N("f6", "io", 0, 0, 176, 64, "Input from the customer form"),
  N("f7", "note", 0, 0, 176, 112, "A sticky note can hold a few thoughts about the process and what to check"),
  N("f8", "text", 0, 0, 160, 40, "Plain text"),
  N("f9", "process", 0, 0, 160, 64, ""),
];
const fitOut = fitCases.map((n) => ({
  input: n,
  plain: fc.fitNodeToText(n),
  wide: fc.fitNodeToText(n, { maxWidth: 240 }),
  lines: fc.nodeLines(n),
  needed: fc.neededHeight(n),
  textWidth: fc.textWidthFor(n),
}));

const shapes = fc.FLOWCHART_SHAPES.map((s) => {
  const n = N("s", s, 13.37, -21.5, 171, 83);
  return {
    node: n,
    path: geo.shapePath(n),
    ports: fc.FLOWCHART_SIDES.map((side) => [0.5, 0.18, 0.86].map((t) => geo.portPoint(n, side, t))),
  };
});

const rects = [
  [{ x: 0, y: 0, w: 100, h: 50 }, { x: 0, y: 200, w: 100, h: 50 }],
  [{ x: 0, y: 0, w: 100, h: 50 }, { x: 300, y: 20, w: 100, h: 50 }],
  [{ x: 0, y: 0, w: 100, h: 50 }, { x: -300, y: -100, w: 100, h: 50 }],
  [{ x: 0, y: 0, w: 100, h: 50 }, { x: 120, y: 80, w: 100, h: 50 }],
  [{ x: 0, y: 0, w: 100, h: 50 }, { x: 50, y: 20, w: 100, h: 50 }],
  [{ x: 0, y: 0, w: 100, h: 50 }, { x: 200, y: 140, w: 0, h: 0 }],
];
const nearest = [
  [{ x: 0, y: 0, w: 100, h: 50 }, { x: 50, y: -3 }],
  [{ x: 0, y: 0, w: 100, h: 50 }, { x: 98, y: 25 }],
  [{ x: 0, y: 0, w: 100, h: 50 }, { x: 50, y: 25 }],
  [{ x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 0 }],
];

const routes = Object.fromEntries(
  Object.entries(charts).map(([k, c]) => {
    const r = geo.routeEdges(c);
    return [k, { routed: r.map((x) => ({ id: x.edge.id, points: x.points, d: x.d, heads: x.heads, fromSide: x.fromSide, toSide: x.toSide, label: x.label })), bounds: geo.flowchartBounds(c, r) }];
  }),
);

const ortho = [
  [{ x: 0, y: 50 }, "bottom", { x: 200, y: 300 }, "top", { x: -50, y: 0, w: 100, h: 50 }, { x: 150, y: 300, w: 100, h: 50 }],
  [{ x: 100, y: 25 }, "right", { x: 0, y: 225 }, "left", { x: 0, y: 0, w: 100, h: 50 }, { x: 0, y: 200, w: 100, h: 50 }],
  [{ x: 50, y: 0 }, "top", { x: 50, y: 250 }, "bottom", { x: 0, y: 0, w: 100, h: 50 }, { x: 0, y: 200, w: 100, h: 50 }],
  [{ x: 50, y: 50 }, "bottom", { x: 300, y: 100 }, "left", { x: 0, y: 0, w: 100, h: 50 }, { x: 300, y: 100, w: 0, h: 0 }],
];
const polylines = [
  [[{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }]],
  [[{ x: 0, y: 0 }, { x: 0, y: 7 }, { x: 13.3, y: 7 }, { x: 13.3, y: 90 }], 6],
  [[{ x: 5, y: 5 }]],
  [[]],
];

const layouts = {
  approvalTD: lay.layoutFlowchart(charts.approval, { direction: "TD" }),
  approvalLR: lay.layoutFlowchart(charts.approval, { direction: "LR", origin: { x: 100, y: -40 } }),
  sidewaysAuto: lay.layoutFlowchart(charts.sideways, { direction: mer.flowchartDirection(charts.sideways) }),
  tangledTD: lay.layoutFlowchart(charts.tangled),
  tangledLR: lay.layoutFlowchart(charts.tangled, { direction: "LR", nodeGap: 30, layerGap: 50 }),
  fanTD: lay.layoutFlowchart(charts.fan, { origin: { x: 0, y: 0 } }),
};

const mermaid = Object.fromEntries(Object.entries(charts).map(([k, c]) => [k, { direction: mer.flowchartDirection(c), text: mer.flowchartToMermaid(c) }]));
mermaid.escapes = {
  direction: "TD",
  text: mer.flowchartToMermaid({
    v: 1,
    nodes: [N("a", "process", 0, 0, 100, 40, 'Say "hi" & <wave> | bye\nnext'), N("b", "note", 0, 100, 100, 40, ""), N("c", "io", 0, 200, 100, 40, "c", "blue")],
    edges: [E("x", "a", "b", { label: "a|b", arrow: "both", style: "dashed" }), E("y", "b", "c", { arrow: "none" }), E("z", "b", "c", { arrow: "none", style: "dashed" }), E("w", "a", "c", { arrow: "both" }), E("q", "a", "gone")],
  }),
};

const svgs = {
  approval: svg.flowchartToSvg(fc.serializeFlowchart(charts.approval)),
  approvalTitled: svg.flowchartToSvg(fc.serializeFlowchart(charts.approval), { title: 'My <"chart"> & co', padding: 10 }),
  fan: svg.flowchartToSvg(fc.serializeFlowchart(charts.fan)),
  escapes: svg.flowchartToSvg(JSON.stringify({ nodes: [N("a", "process", 0, 0, 160, 64, "<b>bold</b> & \"q\"")], edges: [] })),
  empty: svg.flowchartToSvg(""),
};

const resizeCases = [];
for (const handle of ["n", "ne", "e", "se", "s", "sw", "w", "nw"]) {
  for (const [dx, dy, keep] of [[37, 21, false], [-300, -300, false], [55, -12, true]]) {
    resizeCases.push({ handle, dx, dy, keep, node: N("r", "process", 16, 24, 160, 64), out: ops.resizeNode(N("r", "process", 16, 24, 160, 64), handle, dx, dy, keep) });
  }
}
resizeCases.push({ handle: "se", dx: 40, dy: 3, keep: false, node: N("c", "circle", 0, 0, 104, 104), out: ops.resizeNode(N("c", "circle", 0, 0, 104, 104), "se", 40, 3, false) });
resizeCases.push({ handle: "e", dx: 2000, dy: 0, keep: false, node: N("t", "text", 0, 0, 160, 40), out: ops.resizeNode(N("t", "text", 0, 0, 160, 40), "e", 2000, 0, false) });

const others = [{ x: 200, y: 0, w: 160, h: 64 }, { x: 0, y: 300, w: 100, h: 40 }];
const snapCases = [
  { x: 3, y: 5, w: 160, h: 64 },
  { x: 197, y: 150, w: 160, h: 64 },
  { x: 43, y: 297, w: 100, h: 40 },
  { x: 150, y: 2, w: 40, h: 40 },
].map((m) => ({ moving: m, out: ops.snapGroup(m, others, 6) }));

const shapeChange = fc.FLOWCHART_SHAPES.map((s) => ({ shape: s, out: ops.setShape({ v: 1, nodes: [N("a", "process", 3, 5, 200, 64, "A label that wraps over a couple of lines here", "blue")], edges: [] }, ["a"], s).nodes[0] }));

const draft = {
  nodes: [
    { id: "s", shape: "terminator", text: "Start" },
    { id: "r", shape: "process", text: "Review the refund request and check the receipt" },
    { id: "d", shape: "decision", text: "Within 30 days?", color: "yellow" },
    { id: "y", shape: "process", text: "Refund", color: "green" },
    { id: "n", shape: "io", text: "Explain the policy" },
    { id: "bad", shape: "hexagon", text: "Odd shape" },
  ],
  edges: [
    { from: "s", to: "r" },
    { from: "r", to: "d" },
    { from: "d", to: "y", label: "Yes" },
    { from: "d", to: "n", label: "No", style: "dashed" },
    { from: "n", to: "bad", arrow: "none" },
  ],
  direction: "TD",
};
// Edge ids in a draft are new (random) on the web; give them fixed ids so the fixture is stable.
draft.edges.forEach((e, i) => (e.id = `de${i}`));
const current = { v: 1, nodes: [N("r", "process", 100, 100, 240, 96, "Old review", "pink"), N("y", "decision", 300, 300, 176, 96, "Old", "blue")], edges: [] };
const drafts = {
  create: ops.chartFromDraft(draft, fc.emptyFlowchart(), "create"),
  update: ops.chartFromDraft({ ...draft, direction: "LR" }, current, "update"),
};

const out = {
  flowchartData: Object.fromEntries(Object.entries(charts).map(([k, c]) => [k, fc.serializeFlowchart(c)])),
  issues: messy.map((s) => ({ data: s, issue: fc.flowchartDataIssue(s), parsed: fc.serializeFlowchart(fc.parseFlowchart(s)) })),
  tooLarge: fc.flowchartDataIssue("x".repeat(200001)),
  normalize: normalizeInputs.map((input) => ({ input, out: fc.normalizeFlowchart(input) })),
  texts: Object.fromEntries(Object.entries(charts).map(([k, c]) => [k, fc.flowchartText(c)])),
  measures: measures.map((s) => ({ text: s, w14: fc.measureFlowText(s), w12: fc.measureFlowText(s, 12.5) })),
  wraps: wraps.map(([text, width]) => ({ text, width, lines: fc.wrapFlowText(text, width) })),
  fit: fitOut,
  shapes,
  autoSides: rects.map(([a, b]) => ({ a, b, sides: geo.autoSides(a, b) })),
  nearest: nearest.map(([n, p]) => ({ n, p, side: geo.nearestSide(n, p) })),
  ortho: ortho.map((args) => ({ args, points: geo.orthogonalRoute(...args) })),
  polylines: polylines.map((args) => ({ points: args[0], radius: args[1] ?? null, d: geo.roundedPolyline(...args) })),
  routes,
  layouts,
  mermaid,
  svgs,
  resize: resizeCases,
  snap: snapCases,
  setShape: shapeChange,
  drafts,
  draft,
  current,
};
const target = join(root, "apps/macos/FoleviTests/Fixtures/flowchart-reference.json");
writeFileSync(target, `${JSON.stringify(out, null, 1)}\n`);
console.log(`wrote ${target}`);
