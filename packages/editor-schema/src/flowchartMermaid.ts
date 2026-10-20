// Flowchart ⇄ Mermaid. Exports write a `flowchart TD|LR` diagram (so a chart stays portable in Markdown):
// shapes with Mermaid's classic brackets where it has them and its `@{ shape: … }` names otherwise, frames
// and swimlanes as subgraphs, connector styles and ends where Mermaid can say them. "Convert to flowchart"
// reads the common subset of Mermaid's flowchart syntax, best effort:
//
//   flowchart TD            graph LR                   %% comments
//   A[Box] --> B{Choice}    B -- Yes --> C([Pill])      C -.-> D[/In or out/]
//   D ---|label| E((Circle))  E <--> F                   A & B --> C
//   G@{ shape: doc, label: "Report" }                   H ==> I     J --o K
//   subgraph S1 [Checkout] … end                         (subgraphs become frames)
//
// Styling statements (classDef, class, style, linkStyle, click) are skipped.
import {
  FLOWCHART_EDGE_WIDTH,
  FLOWCHART_LIMITS,
  emptyFlowchart,
  fitNodeToText,
  flowId,
  laneBoxes,
  newEdge,
  type FlowchartData,
  type FlowEdge,
  type FlowFrame,
  type FlowHead,
  type FlowLineStyle,
  type FlowNode,
} from "./flowchart";
import { layoutFlowchart, type FlowDirection } from "./flowchartLayout";
import { FLOWCHART_SHAPE_INFO, FLOWCHART_SHAPE_SIZE, type FlowShape } from "./flowchartShapes";

// ------------------------------------------------------------------------------------------ export

/** Mermaid's classic bracket forms, for the shapes that have one. */
const OPEN_CLOSE: Partial<Record<FlowShape, [string, string]>> = {
  process: ["[", "]"],
  decision: ["{", "}"],
  terminator: ["([", "])"],
  io: ["[/", "/]"],
  circle: ["((", "))"],
  note: [">", "]"],
  text: ["[", "]"],
  rounded: ["(", ")"],
  database: ["[(", ")]"],
  cylinder: ["[(", ")]"],
  predefined: ["[[", "]]"],
  preparation: ["{{", "}}"],
  hexagon: ["{{", "}}"],
  trapezoid: ["[/", "\\]"],
  manualOperation: ["[\\", "/]"],
  rectangle: ["[", "]"],
  diamond: ["{", "}"],
};

/** Light-theme fills for exported colours (Mermaid classDefs). */
const MERMAID_FILL: Record<string, [string, string]> = {
  accent: ["#f1f1f3", "#8e8e96"],
  blue: ["#e8f0fe", "#8fb0ea"],
  green: ["#e5f5ea", "#86c79c"],
  yellow: ["#fdf3d0", "#e3c35e"],
  pink: ["#fce8ee", "#eba3b8"],
  purple: ["#efe9fb", "#b6a1e6"],
};

/** Text safe inside a quoted Mermaid label. */
function mermaidText(s: string): string {
  return s
    .replace(/&/g, "#amp;")
    .replace(/"/g, "#quot;")
    .replace(/</g, "#lt;")
    .replace(/>/g, "#gt;")
    .replace(/\|/g, "#124;")
    .replace(/\n/g, "<br/>");
}

/** Which way a chart mostly flows (for the exported direction). */
export function flowchartDirection(fc: FlowchartData): FlowDirection {
  const byId = new Map(fc.nodes.map((n) => [n.id, n]));
  let horizontal = 0;
  let vertical = 0;
  for (const e of fc.edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) continue;
    const dx = Math.abs(b.x + b.w / 2 - (a.x + a.w / 2));
    const dy = Math.abs(b.y + b.h / 2 - (a.y + a.h / 2));
    if (dx > dy) horizontal++;
    else vertical++;
  }
  return horizontal > vertical ? "LR" : "TD";
}

/** Mermaid's link operator for a connector's style and ends (`start` already swapped to the end). */
function linkOp(e: Pick<FlowEdge, "style" | "width">, start: FlowHead, end: FlowHead): string {
  const s = start !== "none";
  const t = end !== "none";
  if (e.style !== "solid") return `${s ? "<" : ""}-.-${t ? ">" : ""}`;
  if (e.width >= 3) return `${s ? "<" : ""}==${t ? ">" : "="}`;
  const head = (h: FlowHead, left: boolean) => (h === "none" ? "" : h === "circle" ? "o" : left ? "<" : ">");
  return `${head(start, true)}--${head(end, false) || "-"}`;
}

/** A Mermaid `flowchart` diagram for the chart (node order kept; ids renamed to n1, n2…). */
export function flowchartToMermaid(fc: FlowchartData): string {
  const lines = [`flowchart ${flowchartDirection(fc)}`];
  const ids = new Map(fc.nodes.map((n, i) => [n.id, `n${i + 1}`]));
  for (const n of fc.nodes) {
    const label = mermaidText(n.text || " ");
    const classic = OPEN_CLOSE[n.shape];
    if (classic) lines.push(`  ${ids.get(n.id)}${classic[0]}"${label}"${classic[1]}`);
    else lines.push(`  ${ids.get(n.id)}@{ shape: ${FLOWCHART_SHAPE_INFO[n.shape].mermaid}, label: "${label}" }`);
  }
  for (const e of fc.edges) {
    let a = ids.get(e.from);
    let b = ids.get(e.to);
    if (!a || !b) continue;
    let start = e.start;
    let end = e.end;
    // A head at the start only reads the same written the other way round.
    if (start !== "none" && end === "none") [a, b, start, end] = [b, a, end, start];
    const label = e.labels.map((l) => l.text).join(" / ");
    lines.push(`  ${a} ${linkOp(e, start, end)}${label ? `|"${mermaidText(label)}"|` : ""} ${b}`);
  }
  // Frames and swimlanes as subgraphs, nested as they are.
  const frames = fc.frames ?? [];
  const sub = new Map<string, string>();
  let k = 0;
  for (const f of frames) sub.set(f.id, `s${++k}`);
  for (const p of fc.pools ?? []) {
    sub.set(p.id, `s${++k}`);
    for (const l of p.lanes) sub.set(l.id, `s${++k}`);
  }
  const childrenOf = (id: string | undefined) => ({
    frames: frames.filter((f) => (f.parent ?? undefined) === id),
    nodes: fc.nodes.filter((n) => (n.parent ?? undefined) === id),
  });
  const block = (id: string, title: string, depth: number): string[] => {
    const pad = "  ".repeat(depth);
    const out = [`${pad}subgraph ${sub.get(id)} ["${mermaidText(title || " ")}"]`];
    const c = childrenOf(id);
    for (const f of c.frames) out.push(...block(f.id, f.title, depth + 1));
    for (const n of c.nodes) out.push(`${pad}  ${ids.get(n.id)}`);
    out.push(`${pad}end`);
    return out;
  };
  for (const f of childrenOf(undefined).frames) lines.push(...block(f.id, f.title, 1));
  for (const p of fc.pools ?? []) {
    lines.push(`  subgraph ${sub.get(p.id)} ["${mermaidText(p.title || " ")}"]`);
    if (p.orient === "columns") lines.push("    direction LR");
    for (const lb of laneBoxes(p)) lines.push(...block(lb.lane.id, lb.lane.title, 2));
    lines.push("  end");
  }
  const used = [...new Set(fc.nodes.map((n) => n.color))].filter((c) => MERMAID_FILL[c]);
  for (const c of used) {
    const [fill, stroke] = MERMAID_FILL[c]!;
    lines.push(`  classDef ${c} fill:${fill},stroke:${stroke}`);
    lines.push(`  class ${fc.nodes.filter((n) => n.color === c).map((n) => ids.get(n.id)).join(",")} ${c}`);
  }
  for (const n of fc.nodes) {
    const style = [n.fill && n.fill !== "none" ? `fill:${n.fill}` : "", n.stroke && n.stroke !== "none" ? `stroke:${n.stroke}` : ""].filter(Boolean);
    if (style.length) lines.push(`  style ${ids.get(n.id)} ${style.join(",")}`);
  }
  return lines.join("\n");
}

// ------------------------------------------------------------------------------------------ import

export type MermaidImport = { ok: true; data: FlowchartData; direction: FlowDirection } | { ok: false; error: string };

// Longest openers first.
const SHAPES: [string, string, FlowShape][] = [
  ["(((", ")))", "circle"],
  ["((", "))", "circle"],
  ["([", "])", "terminator"],
  ["[[", "]]", "predefined"],
  ["[(", ")]", "database"],
  ["{{", "}}", "preparation"],
  ["[/", "/]", "io"],
  ["[/", "\\]", "trapezoid"],
  ["[\\", "\\]", "io"],
  ["[\\", "/]", "manualOperation"],
  ["[", "]", "process"],
  ["(", ")", "rounded"],
  ["{", "}", "decision"],
  [">", "]", "note"],
];

/** Mermaid's `@{ shape: … }` names and aliases. */
const MERMAID_SHAPES: Record<string, FlowShape> = {};
const alias = (shape: FlowShape, ...names: string[]) => names.forEach((n) => (MERMAID_SHAPES[n] = shape));
alias("process", "rect", "proc", "process", "rectangle", "lin-rect", "lined-rectangle", "lin-proc", "lined-process", "shaded-process", "div-rect", "div-proc", "divided-process", "divided-rectangle", "tag-rect", "tagged-rectangle", "tag-proc", "tagged-process", "odd", "bolt", "com-link", "lightning-bolt", "processes", "procs", "st-rect", "stacked-rectangle");
alias("rounded", "rounded", "event");
alias("terminator", "stadium", "pill", "terminal");
alias("predefined", "subproc", "fr-rect", "framed-rectangle", "subprocess", "subroutine");
alias("database", "cyl", "cylinder", "database", "db", "lin-cyl", "disk", "lined-cylinder");
alias("circle", "circle", "circ", "dbl-circ", "double-circle");
alias("connector", "sm-circ", "small-circle", "start", "fr-circ", "framed-circle", "stop", "f-circ", "filled-circle", "junction");
alias("decision", "diam", "decision", "diamond", "question");
alias("preparation", "hex", "hexagon", "prepare");
alias("io", "lean-r", "lean-right", "in-out", "lean-l", "lean-left", "out-in");
alias("trapezoid", "trap-b", "priority", "trapezoid", "trapezoid-bottom");
alias("manualOperation", "trap-t", "manual", "inv-trapezoid", "trapezoid-top");
alias("text", "text");
alias("card", "notch-rect", "card", "notched-rectangle");
alias("rectangle", "fork", "join");
alias("collate", "hourglass", "collate");
alias("annotation", "brace", "brace-l", "comment", "brace-r", "braces");
alias("document", "doc", "document", "lin-doc", "lined-document", "tag-doc", "tagged-document");
alias("documents", "docs", "documents", "st-doc", "stacked-document");
alias("delay", "delay", "half-rounded-rectangle");
alias("directData", "h-cyl", "das", "horizontal-cylinder");
alias("display", "curv-trap", "curved-trapezoid", "display");
alias("extract", "tri", "extract", "triangle");
alias("internalStorage", "win-pane", "internal-storage", "window-pane");
alias("loopLimit", "notch-pent", "loop-limit", "notched-pentagon");
alias("merge", "flip-tri", "flipped-triangle", "manual-file");
alias("manualInput", "sl-rect", "manual-input", "sloped-rectangle");
alias("paperTape", "flag", "paper-tape");
alias("storedData", "bow-rect", "stored-data", "bow-tie-rectangle");
alias("summingJunction", "cross-circ", "summary", "crossed-circle");

const ID_RE = /^[\p{L}\p{N}_](?:[\p{L}\p{N}_.]|-(?![-.>]))*/u;
// -->  --->  ---  -.->  -.-  ==>  ===  <-->  <-.->  --x  --o  o--o
const LINK_RE = /^(<|x|o)?(-{2,}|={2,}|-?\.+-)(>|x|o)?/;
// Inline label forms: -- text -->  -. text .->  == text ==>
const TEXT_LINK_RE = /^(<)?(--|==|-\.)(?![->=.])\s*([^-=.>|][^>]*?)\s*(-{2,}>|={2,}>|\.+->|-{3,}|={3,}|\.+-)/;

function decodeLabel(raw: string): string {
  let s = raw.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  if (s.startsWith("`") && s.endsWith("`")) s = s.slice(1, -1);
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/#quot;/g, '"')
    .replace(/#amp;/g, "&")
    .replace(/#lt;/g, "<")
    .replace(/#gt;/g, ">")
    .replace(/#(\d+);/g, (_, n: string) => String.fromCodePoint(Math.min(0x10ffff, Number(n))))
    .replace(/<[^>]*>/g, "")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

interface ParsedRef {
  id: string;
  text?: string;
  shape?: FlowShape;
}

/** Reads `@{ shape: doc, label: "Report" }` after a node id. */
function readAttrs(rest: string): { shape?: FlowShape; text?: string; rest: string } | null {
  const m = /^@\{([^}]*)\}/.exec(rest);
  if (!m) return null;
  const body = m[1]!;
  const shape = /(?:^|,)\s*shape\s*:\s*([\w-]+)/.exec(body)?.[1];
  const label = /(?:^|,)\s*label\s*:\s*("(?:[^"\\]|\\.)*"|[^,]+)/.exec(body)?.[1];
  return { shape: shape ? (MERMAID_SHAPES[shape.toLowerCase()] ?? "process") : undefined, text: label !== undefined ? decodeLabel(label) : undefined, rest: rest.slice(m[0].length) };
}

/** Reads one node reference (id plus optional shape and label) at the start of `s`. */
function readNode(s: string): { ref: ParsedRef; rest: string } | null {
  const m = ID_RE.exec(s);
  if (!m) return null;
  const id = m[0];
  let rest = s.slice(id.length);
  const attrs = readAttrs(rest);
  if (attrs) return { ref: { id, text: attrs.text, shape: attrs.shape }, rest: attrs.rest.replace(/^:::[\w-]+/, "") };
  for (const [open, close, shape] of SHAPES) {
    if (!rest.startsWith(open)) continue;
    const body = rest.slice(open.length);
    let end = -1;
    if (body.startsWith('"')) {
      const q = body.indexOf('"', 1);
      if (q >= 0 && body.slice(q + 1).startsWith(close)) end = q + 1;
    }
    if (end < 0) end = body.indexOf(close);
    if (end < 0) continue;
    rest = body.slice(end + close.length);
    rest = rest.replace(/^:::[\w-]+/, "");
    return { ref: { id, text: decodeLabel(body.slice(0, end)), shape }, rest };
  }
  rest = rest.replace(/^:::[\w-]+/, "");
  return { ref: { id }, rest };
}

/** Reads a group of node references joined with `&`. */
function readGroup(s: string): { refs: ParsedRef[]; rest: string } | null {
  const refs: ParsedRef[] = [];
  let rest = s;
  for (;;) {
    const r = readNode(rest.trimStart());
    if (!r) return refs.length ? { refs, rest } : null;
    refs.push(r.ref);
    rest = r.rest;
    const amp = /^\s*&\s*/.exec(rest);
    if (!amp) return { refs, rest };
    rest = rest.slice(amp[0].length);
  }
}

interface ParsedLink {
  style: FlowLineStyle;
  start: FlowHead;
  end: FlowHead;
  width: number;
  label: string;
  rest: string;
}

const headOf = (c: string | undefined): FlowHead => (c === ">" || c === "<" ? "arrow" : c === "o" ? "circle" : c === "x" ? "bar" : "none");

function readLink(s: string): ParsedLink | null {
  const t = s.trimStart();
  const tl = TEXT_LINK_RE.exec(t);
  if (tl) {
    const head = tl[4]!;
    const dashed = tl[2] === "-." || head.includes(".");
    const thick = tl[2] === "==";
    const arrowEnd = head.endsWith(">");
    return { style: dashed ? "dashed" : "solid", start: arrowEnd && tl[1] ? "arrow" : "none", end: arrowEnd ? "arrow" : "none", width: thick ? 3 : FLOWCHART_EDGE_WIDTH, label: decodeLabel(tl[3]!), rest: t.slice(tl[0].length) };
  }
  const m = LINK_RE.exec(t);
  if (!m) return null;
  let rest = t.slice(m[0].length);
  const dashed = m[2]!.includes(".");
  const thick = m[2]!.startsWith("=");
  let label = "";
  const lab = /^\s*\|([^|]*)\|/.exec(rest);
  if (lab) {
    label = decodeLabel(lab[1]!);
    rest = rest.slice(lab[0].length);
  }
  return { style: dashed ? "dashed" : "solid", start: headOf(m[1]), end: headOf(m[3]), width: thick ? 3 : FLOWCHART_EDGE_WIDTH, label, rest };
}

/** Parses Mermaid flowchart source into a laid-out flowchart. */
export function mermaidToFlowchart(source: string): MermaidImport {
  const statements = source
    .replace(/%%\{[\s\S]*?\}%%/g, "")
    .split(/\r?\n/)
    .map((l) => l.replace(/%%.*$/, "").trim())
    .flatMap((l) => l.split(/;\s*(?=(?:[^"]*"[^"]*")*[^"]*$)/))
    .map((l) => l.trim())
    .filter(Boolean);
  const header = statements.shift();
  const hm = header ? /^(flowchart|graph)(?:\s+(TD|TB|BT|LR|RL))?\s*$/i.exec(header) : null;
  if (!hm) return { ok: false, error: "Only Mermaid flowcharts (starting with “flowchart” or “graph”) can be converted." };
  const direction: FlowDirection = hm[2] && /^(LR|RL)$/i.test(hm[2]) ? "LR" : "TD";

  const nodes = new Map<string, { text?: string; shape?: FlowShape; parent?: string }>();
  const edges: { from: string; to: string; link: ParsedLink }[] = [];
  const groups = new Map<string, { title: string; parent?: string }>();
  const stack: string[] = [];
  const remember = (r: ParsedRef) => {
    const cur = nodes.get(r.id);
    const parent = stack[stack.length - 1];
    if (!cur) {
      if (nodes.size >= FLOWCHART_LIMITS.maxNodes) return false;
      nodes.set(r.id, { text: r.text, shape: r.shape, parent });
    } else {
      if (r.shape && !cur.shape) Object.assign(cur, { text: r.text, shape: r.shape });
      if (parent && !cur.parent) cur.parent = parent;
    }
    return true;
  };
  let skipped = 0;
  for (const st of statements) {
    const sg = /^subgraph\s+(.+)$/i.exec(st);
    if (sg) {
      if (groups.size >= FLOWCHART_LIMITS.maxFrames || stack.length >= FLOWCHART_LIMITS.maxFrameDepth) {
        stack.push("");
        continue;
      }
      const body = sg[1]!.trim();
      const titled = /^([\p{L}\p{N}_.-]+)\s*\[(.*)\]\s*$/u.exec(body);
      const key = `\u0000g${groups.size}`;
      groups.set(key, { title: decodeLabel(titled ? titled[2]! : body).replace(/\n+/g, " ").slice(0, FLOWCHART_LIMITS.maxTitle), parent: stack.filter(Boolean).pop() });
      stack.push(key);
      continue;
    }
    if (/^end$/i.test(st)) {
      stack.pop();
      continue;
    }
    if (/^direction\b/i.test(st)) continue;
    if (/^(classDef|class|style|linkStyle|click|accTitle|accDescr)\b/.test(st)) continue;
    let g = readGroup(st);
    if (!g) {
      skipped++;
      continue;
    }
    g.refs.forEach(remember);
    let rest = g.rest;
    while (rest.trim()) {
      const link = readLink(rest);
      if (!link) {
        skipped++;
        break;
      }
      const next = readGroup(link.rest);
      if (!next) {
        skipped++;
        break;
      }
      next.refs.forEach(remember);
      for (const a of g.refs) {
        for (const b of next.refs) {
          if (a.id !== b.id && edges.length < FLOWCHART_LIMITS.maxEdges && nodes.has(a.id) && nodes.has(b.id)) edges.push({ from: a.id, to: b.id, link });
        }
      }
      g = next;
      rest = next.rest;
    }
  }
  if (!nodes.size) return { ok: false, error: skipped ? "Couldn’t read any shapes from this diagram." : "The diagram is empty." };

  const frameIds = new Map<string, string>();
  for (const key of groups.keys()) frameIds.set(key, flowId("f"));
  const frames: FlowFrame[] = [...groups.entries()].map(([key, g]) => {
    const f: FlowFrame = { id: frameIds.get(key)!, x: 0, y: 0, w: 320, h: 200, title: g.title, color: "neutral" };
    if (g.parent && frameIds.has(g.parent)) f.parent = frameIds.get(g.parent);
    return f;
  });
  const idMap = new Map<string, string>();
  const flowNodes: FlowNode[] = [...nodes.entries()].map(([raw, n]) => {
    const shape = n.shape ?? "process";
    const id = flowId("n");
    idMap.set(raw, id);
    const text = (n.text ?? raw).slice(0, FLOWCHART_LIMITS.maxText);
    const node: FlowNode = fitNodeToText({ id, shape, x: 0, y: 0, ...FLOWCHART_SHAPE_SIZE[shape], text, color: "neutral" }, { maxWidth: 240 });
    if (n.parent && frameIds.has(n.parent)) node.parent = frameIds.get(n.parent);
    return node;
  });
  const flowEdges: FlowEdge[] = edges.map((e) =>
    newEdge(idMap.get(e.from)!, idMap.get(e.to)!, {
      labels: e.link.label ? [{ text: e.link.label.replace(/\n+/g, " ").slice(0, FLOWCHART_LIMITS.maxLabel), at: 0.5 }] : [],
      style: e.link.style,
      start: e.link.start,
      end: e.link.end,
      width: e.link.width,
    }),
  );
  // Frames left empty (subgraphs that only held other things) go.
  const used = new Set([...flowNodes.map((n) => n.parent), ...frames.map((f) => f.parent)]);
  const keptFrames = frames.filter((f) => used.has(f.id));
  const data = layoutFlowchart({ ...emptyFlowchart(), nodes: flowNodes, edges: flowEdges, frames: keptFrames }, { direction, origin: { x: 0, y: 0 } });
  return { ok: true, data, direction };
}
