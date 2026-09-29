// Flowchart block data: shapes and connectors stored as a JSON string in `props.data`.
//
//   { "v": 1,
//     "nodes": [{ "id": "a1", "shape": "process", "x": 0, "y": 0, "w": 160, "h": 64, "text": "Review", "color": "blue" }],
//     "edges": [{ "id": "e1", "from": "a1", "to": "b2", "fromSide": "bottom", "toSide": "top", "label": "Yes",
//                 "style": "dashed", "arrow": "end" }] }
//
// Coordinates are in an unbounded logical space (the editor pans and zooms over it); x/y is a node's top-left
// corner. On the wire `text`, `color`, `label`, `style`, `arrow` and the sides are optional (defaults:
// "", neutral, "", solid, end, automatic), which keeps large charts small. `flowchartDataIssue` is the strict
// check the server runs on every write; `parseFlowchart` is the forgiving reader clients use before drawing
// anything (it drops what it can't use and clamps the rest, so bad data can never break an editor).
import { LIMITS } from "./generated/schema";

export const FLOWCHART_SHAPES = ["process", "decision", "terminator", "io", "circle", "note", "text"] as const;
export type FlowShape = (typeof FLOWCHART_SHAPES)[number];
/** Neutral plus soft tints; `accent` follows the note's style palette in the editor. */
export const FLOWCHART_COLORS = ["neutral", "accent", "blue", "green", "yellow", "pink", "purple"] as const;
export type FlowColor = (typeof FLOWCHART_COLORS)[number];
export const FLOWCHART_SIDES = ["top", "right", "bottom", "left"] as const;
export type FlowSide = (typeof FLOWCHART_SIDES)[number];
export type FlowEdgeStyle = "solid" | "dashed";
export type FlowArrow = "end" | "both" | "none";

export interface FlowNode {
  id: string;
  shape: FlowShape;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  color: FlowColor;
}

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  fromSide?: FlowSide;
  toSide?: FlowSide;
  label: string;
  style: FlowEdgeStyle;
  arrow: FlowArrow;
}

export interface FlowchartData {
  v: 1;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export const FLOWCHART_LIMITS = {
  maxNodes: 500,
  maxEdges: 1000,
  maxText: 300,
  maxLabel: 120,
  maxCoord: 100_000,
  minSize: 24,
  maxWidth: 960,
  maxHeight: 720,
  maxIdLength: 32,
} as const;

export const FLOWCHART_DEFAULT_HEIGHT = 440;
/** Snapping step for positions and sizes (the dot grid is drawn every 3 steps). */
export const FLOWCHART_GRID = 8;
export const FLOWCHART_FONT_SIZE = 14;
export const FLOWCHART_LINE_HEIGHT = 19;
export const FLOWCHART_LABEL_FONT_SIZE = 12.5;

/** Default size for a new node of each shape. */
export const FLOWCHART_SHAPE_SIZE: Record<FlowShape, { w: number; h: number }> = {
  process: { w: 160, h: 64 },
  decision: { w: 176, h: 96 },
  terminator: { w: 160, h: 56 },
  io: { w: 176, h: 64 },
  circle: { w: 104, h: 104 },
  note: { w: 176, h: 112 },
  text: { w: 160, h: 40 },
};

export const FLOWCHART_SHAPE_LABEL: Record<FlowShape, string> = {
  process: "Process",
  decision: "Decision",
  terminator: "Start / end",
  io: "Input / output",
  circle: "Circle",
  note: "Sticky note",
  text: "Text",
};

export const FLOWCHART_COLOR_LABEL: Record<FlowColor, string> = {
  neutral: "Neutral",
  accent: "Accent",
  blue: "Blue",
  green: "Green",
  yellow: "Yellow",
  pink: "Pink",
  purple: "Purple",
};

const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const NODE_KEYS = new Set(["id", "shape", "x", "y", "w", "h", "text", "color"]);
const EDGE_KEYS = new Set(["id", "from", "to", "fromSide", "toSide", "label", "style", "arrow"]);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);

export const emptyFlowchart = (): FlowchartData => ({ v: 1, nodes: [], edges: [] });

/** Why `data` isn't valid flowchart JSON, or null when it is (the server's check on every write). */
export function flowchartDataIssue(data: string): string | null {
  if (data.length > LIMITS.maxFlowchartDataLength) return "flowchart too large";
  if (data === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return "expected JSON";
  }
  if (!isObj(parsed)) return "expected an object";
  for (const k of Object.keys(parsed)) if (k !== "v" && k !== "nodes" && k !== "edges") return `unexpected field ${k}`;
  if (parsed.v !== undefined && parsed.v !== 1) return "unsupported version";
  const { nodes, edges } = parsed;
  if (!Array.isArray(nodes)) return "nodes must be an array";
  if (edges !== undefined && !Array.isArray(edges)) return "edges must be an array";
  if (nodes.length > FLOWCHART_LIMITS.maxNodes) return "too many nodes";
  if ((edges?.length ?? 0) > FLOWCHART_LIMITS.maxEdges) return "too many edges";
  const ids = new Set<string>();
  const L = FLOWCHART_LIMITS;
  for (const [i, n] of nodes.entries()) {
    if (!isObj(n)) return `node ${i} must be an object`;
    for (const k of Object.keys(n)) if (!NODE_KEYS.has(k)) return `node ${i}: unexpected field ${k}`;
    if (typeof n.id !== "string" || !ID_RE.test(n.id) || ids.has(n.id)) return `node ${i}: invalid id`;
    ids.add(n.id);
    if (!oneOf(FLOWCHART_SHAPES, n.shape)) return `node ${i}: invalid shape`;
    for (const k of ["x", "y"] as const) if (!isNum(n[k]) || Math.abs(n[k]) > L.maxCoord) return `node ${i}: invalid ${k}`;
    if (!isNum(n.w) || n.w < L.minSize || n.w > L.maxWidth) return `node ${i}: invalid w`;
    if (!isNum(n.h) || n.h < L.minSize || n.h > L.maxHeight) return `node ${i}: invalid h`;
    if (n.text !== undefined && (typeof n.text !== "string" || n.text.length > L.maxText)) return `node ${i}: invalid text`;
    if (n.color !== undefined && !oneOf(FLOWCHART_COLORS, n.color)) return `node ${i}: invalid color`;
  }
  const edgeIds = new Set<string>();
  for (const [i, e] of (edges ?? []).entries()) {
    if (!isObj(e)) return `edge ${i} must be an object`;
    for (const k of Object.keys(e)) if (!EDGE_KEYS.has(k)) return `edge ${i}: unexpected field ${k}`;
    if (typeof e.id !== "string" || !ID_RE.test(e.id) || edgeIds.has(e.id)) return `edge ${i}: invalid id`;
    edgeIds.add(e.id);
    if (typeof e.from !== "string" || !ids.has(e.from) || typeof e.to !== "string" || !ids.has(e.to)) return `edge ${i}: unknown node`;
    for (const k of ["fromSide", "toSide"] as const) if (e[k] !== undefined && !oneOf(FLOWCHART_SIDES, e[k])) return `edge ${i}: invalid ${k}`;
    if (e.label !== undefined && (typeof e.label !== "string" || e.label.length > L.maxLabel)) return `edge ${i}: invalid label`;
    if (e.style !== undefined && e.style !== "solid" && e.style !== "dashed") return `edge ${i}: invalid style`;
    if (e.arrow !== undefined && e.arrow !== "end" && e.arrow !== "both" && e.arrow !== "none") return `edge ${i}: invalid arrow`;
  }
  return null;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
/** Control characters (other than new lines) never reach the canvas or an export. */
const cleanText = (s: unknown, max: number): string =>
  typeof s === "string"
    ? s
        .replace(/\r\n?/g, "\n")
        .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "")
        .slice(0, max)
    : "";

/** A short random id for new nodes and edges (not a block id; unique within one flowchart). */
export function flowId(prefix = "n"): string {
  let s = prefix;
  for (let i = 0; i < 7; i++) s += "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)];
  return s;
}

function cleanId(v: unknown, used: Set<string>, prefix: string): string {
  let id = typeof v === "string" || typeof v === "number" ? String(v).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) : "";
  while (!id || used.has(id)) id = flowId(prefix);
  used.add(id);
  return id;
}

/**
 * Forgiving reader for any flowchart-shaped value (stored data, AI output, pasted JSON). Never throws:
 * unusable nodes and edges are dropped, numbers are clamped, strings trimmed to their limits, duplicate
 * ids renamed, and edges that point at missing nodes or at their own node removed. Nodes without a
 * position get (0, 0) and are listed in `unplaced` so the caller can lay them out.
 */
export function normalizeFlowchart(input: unknown): FlowchartData & { unplaced: string[] } {
  const out: FlowchartData & { unplaced: string[] } = { v: 1, nodes: [], edges: [], unplaced: [] };
  if (!isObj(input)) return out;
  const L = FLOWCHART_LIMITS;
  const used = new Set<string>();
  const rename = new Map<string, string>();
  for (const raw of Array.isArray(input.nodes) ? input.nodes : []) {
    if (out.nodes.length >= L.maxNodes) break;
    if (!isObj(raw)) continue;
    const shape: FlowShape = oneOf(FLOWCHART_SHAPES, raw.shape) ? raw.shape : "process";
    const size = FLOWCHART_SHAPE_SIZE[shape];
    const original = typeof raw.id === "string" || typeof raw.id === "number" ? String(raw.id) : "";
    const id = cleanId(raw.id, used, "n");
    if (original && !rename.has(original)) rename.set(original, id);
    const placed = isNum(raw.x) && isNum(raw.y);
    if (!placed) out.unplaced.push(id);
    out.nodes.push({
      id,
      shape,
      x: placed ? Math.round(clamp(raw.x as number, -L.maxCoord, L.maxCoord)) : 0,
      y: placed ? Math.round(clamp(raw.y as number, -L.maxCoord, L.maxCoord)) : 0,
      w: Math.round(clamp(isNum(raw.w) ? raw.w : size.w, L.minSize, L.maxWidth)),
      h: Math.round(clamp(isNum(raw.h) ? raw.h : size.h, L.minSize, L.maxHeight)),
      text: cleanText(raw.text, L.maxText),
      color: oneOf(FLOWCHART_COLORS, raw.color) ? raw.color : "neutral",
    });
  }
  const edgeIds = new Set<string>();
  const seen = new Set<string>();
  for (const raw of Array.isArray(input.edges) ? input.edges : []) {
    if (out.edges.length >= L.maxEdges) break;
    if (!isObj(raw)) continue;
    const from = rename.get(String(raw.from ?? ""));
    const to = rename.get(String(raw.to ?? ""));
    if (!from || !to || from === to) continue;
    const fromSide = oneOf(FLOWCHART_SIDES, raw.fromSide) ? raw.fromSide : undefined;
    const toSide = oneOf(FLOWCHART_SIDES, raw.toSide) ? raw.toSide : undefined;
    // The same connection twice (same ends, same sides) draws as one line: keep the first.
    const key = `${from}>${to}>${fromSide ?? ""}>${toSide ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const edge: FlowEdge = {
      id: cleanId(raw.id, edgeIds, "e"),
      from,
      to,
      label: cleanText(raw.label, L.maxLabel).replace(/\n+/g, " "),
      style: raw.style === "dashed" ? "dashed" : "solid",
      arrow: raw.arrow === "both" || raw.arrow === "none" ? raw.arrow : "end",
    };
    if (fromSide) edge.fromSide = fromSide;
    if (toSide) edge.toSide = toSide;
    out.edges.push(edge);
  }
  return out;
}

/** Reads stored flowchart data; anything unusable reads as an empty chart (never throws). */
export function parseFlowchart(data: string | null | undefined): FlowchartData {
  if (!data || data.length > LIMITS.maxFlowchartDataLength) return emptyFlowchart();
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return emptyFlowchart();
  }
  const { nodes, edges } = normalizeFlowchart(raw);
  return { v: 1, nodes, edges };
}

/** Compact wire JSON (defaults omitted). Empty charts serialise to "". */
export function serializeFlowchart(fc: FlowchartData): string {
  if (!fc.nodes.length) return "";
  return JSON.stringify({
    v: 1,
    nodes: fc.nodes.map((n) => {
      const o: Record<string, unknown> = { id: n.id, shape: n.shape, x: Math.round(n.x), y: Math.round(n.y), w: Math.round(n.w), h: Math.round(n.h) };
      if (n.text) o.text = n.text;
      if (n.color !== "neutral") o.color = n.color;
      return o;
    }),
    edges: fc.edges.map((e) => {
      const o: Record<string, unknown> = { id: e.id, from: e.from, to: e.to };
      if (e.fromSide) o.fromSide = e.fromSide;
      if (e.toSide) o.toSide = e.toSide;
      if (e.label) o.label = e.label;
      if (e.style !== "solid") o.style = e.style;
      if (e.arrow !== "end") o.arrow = e.arrow;
      return o;
    }),
  });
}

/** Node texts and connector labels (search, AI context). */
export function flowchartText(fc: FlowchartData): string {
  return [...fc.nodes.map((n) => n.text), ...fc.edges.map((e) => e.label)]
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" · ");
}

// ------------------------------------------------------------------------------------------ text metrics
// Labels wrap with an estimate of Instrument Sans' advance widths rather than a live measurement, so the
// editor, share pages (rendered on the server) and exports all break lines in the same places.

function charWidth(ch: string): number {
  if (ch === " ") return 0.27;
  if ("iljI|!.,:;'`".includes(ch)) return 0.26;
  if ("frt()[]{}/\\-\"".includes(ch)) return 0.36;
  if ("mwMW@%".includes(ch)) return 0.84;
  const code = ch.codePointAt(0) ?? 0;
  if (code >= 0x2e80) return 1;
  if (ch >= "A" && ch <= "Z") return 0.64;
  if (ch >= "0" && ch <= "9") return 0.56;
  if (ch >= "a" && ch <= "z") return 0.52;
  return 0.6;
}

/** Estimated width of a line of text at `fontSize`. */
export function measureFlowText(text: string, fontSize = FLOWCHART_FONT_SIZE): number {
  let w = 0;
  for (const ch of text) w += charWidth(ch);
  return w * fontSize;
}

/** Word-wraps text into lines no wider than `maxWidth` (long words break), keeping explicit new lines. */
export function wrapFlowText(text: string, maxWidth: number, fontSize = FLOWCHART_FONT_SIZE, maxLines = 24): string[] {
  const lines: string[] = [];
  const limit = Math.max(fontSize, maxWidth);
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/ +/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measureFlowText(candidate, fontSize) <= limit) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      // A word wider than the line breaks across lines.
      let piece = "";
      for (const ch of word) {
        if (measureFlowText(piece + ch, fontSize) > limit && piece) {
          lines.push(piece);
          piece = "";
        }
        piece += ch;
      }
      line = piece;
    }
    lines.push(line);
  }
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1]!.replace(/.$/u, "")}…`;
    return kept;
  }
  return lines;
}

/** Width available to a node's label inside its shape. */
export function textWidthFor(node: Pick<FlowNode, "shape" | "w" | "h">): number {
  const { w, h } = node;
  switch (node.shape) {
    case "decision":
      return w * 0.58 - 6;
    case "terminator":
      return w - Math.min(h, w) * 0.6 - 8;
    case "io":
      return w - 2 * ioSkew(node) - 12;
    case "circle":
      return w * 0.7;
    case "text":
      return w - 8;
    default:
      return w - 24;
  }
}

/** The horizontal lean of an input/output parallelogram. */
export function ioSkew(node: Pick<FlowNode, "w" | "h">): number {
  return Math.min(22, node.h * 0.34, node.w * 0.2);
}

/** The label's lines for a node. */
export function nodeLines(node: Pick<FlowNode, "shape" | "w" | "h" | "text">): string[] {
  return node.text ? wrapFlowText(node.text, textWidthFor(node)) : [];
}

/** The smallest height (on the grid) that fits the node's label. */
export function neededHeight(node: Pick<FlowNode, "shape" | "w" | "h" | "text">): number {
  const lines = Math.max(1, nodeLines(node).length);
  const textH = lines * FLOWCHART_LINE_HEIGHT;
  const pad = { decision: textH * 0.9 + 28, circle: textH * 0.45 + 24, note: 28, text: 10, terminator: 18, io: 22, process: 24 }[node.shape];
  const min = node.shape === "text" ? 32 : FLOWCHART_SHAPE_SIZE[node.shape].h * (node.shape === "circle" ? 0.5 : 0.75);
  return snapUp(Math.max(min, textH + pad));
}

const snapUp = (n: number) => Math.ceil(n / FLOWCHART_GRID) * FLOWCHART_GRID;

/**
 * Sizes a node to its label: widens a single long line (up to `maxWidth`), then grows the height so every
 * line fits. Circles stay round. Never shrinks below the node's current size.
 */
export function fitNodeToText(node: FlowNode, opts: { maxWidth?: number } = {}): FlowNode {
  if (!node.text) return node;
  let w = node.w;
  const maxWidth = Math.min(FLOWCHART_LIMITS.maxWidth, opts.maxWidth ?? node.w);
  if (maxWidth > w) {
    const longest = Math.max(...node.text.split("\n").map((l) => measureFlowText(l)));
    const extra = node.w - textWidthFor(node);
    w = Math.min(maxWidth, Math.max(w, snapUp(longest + extra + 4)));
  }
  let next = { ...node, w };
  const h = Math.min(FLOWCHART_LIMITS.maxHeight, Math.max(node.h, neededHeight(next)));
  next = { ...next, h };
  if (node.shape === "circle") {
    const d = Math.max(next.w, next.h);
    next = { ...next, w: d, h: d };
  }
  return next;
}
