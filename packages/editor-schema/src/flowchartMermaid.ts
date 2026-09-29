// Flowchart ⇄ Mermaid. Exports write a `flowchart TD|LR` diagram (so a chart stays portable in Markdown);
// "Convert to flowchart" reads the common subset of Mermaid's flowchart syntax, best effort:
//
//   flowchart TD            graph LR                   %% comments
//   A[Box] --> B{Choice}    B -- Yes --> C([Pill])      C -.-> D[/In or out/]
//   D ---|label| E((Circle))  E <--> F                   A & B --> C
//
// Subgraphs are flattened, styling statements (classDef, class, style, linkStyle, click) are skipped.
import { FLOWCHART_LIMITS, FLOWCHART_SHAPE_SIZE, fitNodeToText, flowId, type FlowArrow, type FlowchartData, type FlowEdge, type FlowEdgeStyle, type FlowNode, type FlowShape } from "./flowchart";
import { layoutFlowchart, type FlowDirection } from "./flowchartLayout";

// ------------------------------------------------------------------------------------------ export

const OPEN_CLOSE: Record<FlowShape, [string, string]> = {
  process: ["[", "]"],
  decision: ["{", "}"],
  terminator: ["([", "])"],
  io: ["[/", "/]"],
  circle: ["((", "))"],
  note: [">", "]"],
  text: ["[", "]"],
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

/** A Mermaid `flowchart` diagram for the chart (node order kept; ids renamed to n1, n2…). */
export function flowchartToMermaid(fc: FlowchartData): string {
  const lines = [`flowchart ${flowchartDirection(fc)}`];
  const ids = new Map(fc.nodes.map((n, i) => [n.id, `n${i + 1}`]));
  for (const n of fc.nodes) {
    const [open, close] = OPEN_CLOSE[n.shape];
    lines.push(`  ${ids.get(n.id)}${open}"${mermaidText(n.text || " ")}"${close}`);
  }
  for (const e of fc.edges) {
    const a = ids.get(e.from);
    const b = ids.get(e.to);
    if (!a || !b) continue;
    const dashed = e.style === "dashed";
    const op = e.arrow === "none" ? (dashed ? "-.-" : "---") : e.arrow === "both" ? (dashed ? "<-.->" : "<-->") : dashed ? "-.->" : "-->";
    lines.push(`  ${a} ${op}${e.label ? `|"${mermaidText(e.label)}"|` : ""} ${b}`);
  }
  const used = [...new Set(fc.nodes.map((n) => n.color))].filter((c) => MERMAID_FILL[c]);
  for (const c of used) {
    const [fill, stroke] = MERMAID_FILL[c]!;
    lines.push(`  classDef ${c} fill:${fill},stroke:${stroke}`);
    lines.push(`  class ${fc.nodes.filter((n) => n.color === c).map((n) => ids.get(n.id)).join(",")} ${c}`);
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
  ["[[", "]]", "process"],
  ["[(", ")]", "process"],
  ["{{", "}}", "decision"],
  ["[/", "/]", "io"],
  ["[/", "\\]", "io"],
  ["[\\", "\\]", "io"],
  ["[\\", "/]", "io"],
  ["[", "]", "process"],
  ["(", ")", "process"],
  ["{", "}", "decision"],
  [">", "]", "note"],
];

const ID_RE = /^[\p{L}\p{N}_](?:[\p{L}\p{N}_.]|-(?![-.>]))*/u;
// -->  --->  ---  -.->  -.-  ==>  ===  <-->  <-.->  --x  --o
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

/** Reads one node reference (id plus optional shape and label) at the start of `s`. */
function readNode(s: string): { ref: ParsedRef; rest: string } | null {
  const m = ID_RE.exec(s);
  if (!m) return null;
  const id = m[0];
  let rest = s.slice(id.length);
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

function readLink(s: string): { style: FlowEdgeStyle; arrow: FlowArrow; label: string; rest: string } | null {
  const t = s.trimStart();
  const tl = TEXT_LINK_RE.exec(t);
  if (tl) {
    const head = tl[4]!;
    const dashed = tl[2] === "-." || head.includes(".");
    const arrowEnd = head.endsWith(">");
    return { style: dashed ? "dashed" : "solid", arrow: arrowEnd ? (tl[1] ? "both" : "end") : "none", label: decodeLabel(tl[3]!), rest: t.slice(tl[0].length) };
  }
  const m = LINK_RE.exec(t);
  if (!m) return null;
  let rest = t.slice(m[0].length);
  const dashed = m[2]!.includes(".");
  const start = m[1] === "<";
  const end = m[3] === ">";
  let label = "";
  const lab = /^\s*\|([^|]*)\|/.exec(rest);
  if (lab) {
    label = decodeLabel(lab[1]!);
    rest = rest.slice(lab[0].length);
  }
  return { style: dashed ? "dashed" : "solid", arrow: start && end ? "both" : end || start ? "end" : "none", label, rest };
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

  const nodes = new Map<string, { text?: string; shape?: FlowShape }>();
  const edges: { from: string; to: string; style: FlowEdgeStyle; arrow: FlowArrow; label: string }[] = [];
  const remember = (r: ParsedRef) => {
    const cur = nodes.get(r.id);
    if (!cur) {
      if (nodes.size >= FLOWCHART_LIMITS.maxNodes) return false;
      nodes.set(r.id, { text: r.text, shape: r.shape });
    } else if (r.shape && !cur.shape) nodes.set(r.id, { text: r.text, shape: r.shape });
    return true;
  };
  let skipped = 0;
  for (const st of statements) {
    if (/^(subgraph\b|end$|direction\b)/i.test(st)) continue;
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
          if (a.id !== b.id && edges.length < FLOWCHART_LIMITS.maxEdges && nodes.has(a.id) && nodes.has(b.id)) edges.push({ from: a.id, to: b.id, style: link.style, arrow: link.arrow, label: link.label });
        }
      }
      g = next;
      rest = next.rest;
    }
  }
  if (!nodes.size) return { ok: false, error: skipped ? "Couldn’t read any shapes from this diagram." : "The diagram is empty." };

  const idMap = new Map<string, string>();
  const flowNodes: FlowNode[] = [...nodes.entries()].map(([raw, n]) => {
    const shape = n.shape ?? "process";
    const id = flowId("n");
    idMap.set(raw, id);
    const text = (n.text ?? raw).slice(0, FLOWCHART_LIMITS.maxText);
    return fitNodeToText({ id, shape, x: 0, y: 0, ...FLOWCHART_SHAPE_SIZE[shape], text, color: "neutral" }, { maxWidth: 240 });
  });
  const flowEdges: FlowEdge[] = edges.map((e) => ({
    id: flowId("e"),
    from: idMap.get(e.from)!,
    to: idMap.get(e.to)!,
    label: e.label.replace(/\n+/g, " ").slice(0, FLOWCHART_LIMITS.maxLabel),
    style: e.style,
    arrow: e.arrow,
  }));
  const data = layoutFlowchart({ v: 1, nodes: flowNodes, edges: flowEdges }, { direction, origin: { x: 0, y: 0 } });
  return { ok: true, data, direction };
}
