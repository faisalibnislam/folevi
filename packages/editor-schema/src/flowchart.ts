// Flowchart block data (v2): shapes, connectors, frames and swimlanes, stored as a JSON string in `props.data`.
//
//   { "v": 2,
//     "nodes": [{ "id": "a1", "shape": "process", "x": 0, "y": 0, "w": 160, "h": 64, "text": "Review",
//                 "color": "blue", "rich": [...], "align": "left", "autoHeight": true, "fill": "#e8f0fe",
//                 "icon": { "name": "user", "place": "left" }, "image": { "fileId": "…" }, "note": "…",
//                 "link": { "documentId": "…", "title": "Plan" }, "parent": "f1" }],
//     "edges": [{ "id": "e1", "from": "a1", "to": "b2", "fromSide": "bottom", "fromAt": 0.3, "toSide": "top",
//                 "route": "curved", "bends": [[40, 200]], "start": "circle", "end": "arrow",
//                 "style": "dashed", "width": 2, "color": "blue", "labels": [{ "text": "Yes", "at": 0.25 }] },
//               { "id": "e2", "from": "a1", "toPoint": [400, 80] }],
//     "frames": [{ "id": "f1", "x": -40, "y": -60, "w": 600, "h": 400, "title": "Checkout", "color": "green" }],
//     "pools": [{ "id": "p1", "x": 0, "y": 600, "orient": "rows", "title": "Teams", "length": 1200,
//                 "lanes": [{ "id": "l1", "title": "Sales", "size": 200 }, { "id": "l2", "title": "Ops", "size": 200 }] }] }
//
// Coordinates are in an unbounded logical space (the editor pans and zooms over it); x/y is a node's top-left
// corner. On the wire everything with a default is optional, which keeps large charts small.
//
//   Nodes   `text` is always the label's plain text (search, Mermaid, screen readers, older readers);
//           `rich` holds the formatted label (paragraphs of text runs with the editor's marks, optionally
//           bulleted or numbered) when it has any formatting, and its plain text always equals `text`.
//           `parent` names the frame or swimlane lane the node belongs to.
//   Edges   each end is attached to a node (`from`/`to`, optionally a side and a position 0…1 along it;
//           without a side the router picks one) or floats free at a point (`fromPoint`/`toPoint`, and
//           `from`/`to` are "" in memory). `bends` are points the route must pass through, in order.
//   Frames  boxes with a title that group shapes (members name them as `parent`); frames nest.
//   Pools   swimlanes: a titled set of lanes stacked as rows or side by side as columns; a lane's members
//           name the lane as `parent`.
//
// v1 data (`{ v: 1, nodes, edges }` with `label`, `arrow` and dashed `style` on edges) is migrated when read,
// never dropped. `flowchartDataIssue` is the strict check the server runs on every write (it accepts v1 and
// v2); `normalizeFlowchart` / `parseFlowchart` are the forgiving readers clients use before drawing anything
// (they drop what they can't use and clamp the rest, so bad data can never break an editor).
import { HighlightColorValues, LIMITS, MarkTypes, TextColorValues, type InlineNode, type Mark } from "./generated/schema";
import { normalizeInline, normalizeMarks, sanitizeHref } from "./richtext";
import { FLOWCHART_ICONS, type FlowIconName } from "./flowchartIcons";
import {
  FLOWCHART_QUICK_SHAPES,
  FLOWCHART_SHAPES,
  FLOWCHART_SHAPE_INFO,
  FLOWCHART_SHAPE_SIZE,
  shapeTextBox,
  type FlowShape,
  type FlowSide,
  type Pt,
  type Rect,
} from "./flowchartShapes";

export type { FlowShape, FlowSide } from "./flowchartShapes";

/** Neutral plus soft tints; `accent` follows the note's style palette in the editor. */
export const FLOWCHART_COLORS = ["neutral", "accent", "blue", "green", "yellow", "pink", "purple"] as const;
export type FlowColor = (typeof FLOWCHART_COLORS)[number];
export const FLOWCHART_SIDES = ["top", "right", "bottom", "left"] as const satisfies readonly FlowSide[];
/** Line ends: none, a filled arrow, an open arrow, a circle, a diamond or a bar. */
export const FLOWCHART_HEADS = ["none", "arrow", "open", "circle", "diamond", "bar"] as const;
export type FlowHead = (typeof FLOWCHART_HEADS)[number];
export const FLOWCHART_ROUTES = ["elbow", "curved", "straight"] as const;
export type FlowRoute = (typeof FLOWCHART_ROUTES)[number];
export const FLOWCHART_LINE_STYLES = ["solid", "dashed", "dotted"] as const;
export type FlowLineStyle = (typeof FLOWCHART_LINE_STYLES)[number];
/** v1 name for the line style. */
export type FlowEdgeStyle = FlowLineStyle;
/** Which ends carry a head (the v1 setting, and a shorthand for the editor's quick buttons). */
export type FlowArrow = "end" | "start" | "both" | "none";
export const FLOWCHART_TEXT_ALIGNS = ["left", "center", "right"] as const;
export type FlowTextAlign = (typeof FLOWCHART_TEXT_ALIGNS)[number];
export const FLOWCHART_TEXT_VALIGNS = ["top", "middle", "bottom"] as const;
export type FlowTextValign = (typeof FLOWCHART_TEXT_VALIGNS)[number];
export const FLOWCHART_ICON_PLACES = ["left", "top", "badge"] as const;
export type FlowIconPlace = (typeof FLOWCHART_ICON_PLACES)[number];
export const FLOWCHART_IMAGE_FITS = ["cover", "contain"] as const;
export type FlowImageFit = (typeof FLOWCHART_IMAGE_FITS)[number];
export const FLOWCHART_POOL_ORIENTS = ["rows", "columns"] as const;
export type FlowPoolOrient = (typeof FLOWCHART_POOL_ORIENTS)[number];

/** A text run of a rich label: the editor's inline text with its marks (bold, italic, link…). */
export type FlowRun = Extract<InlineNode, { type: "text" }>;
export interface FlowParagraph {
  text: FlowRun[];
  list?: "bullet" | "ordered";
}

export interface FlowNode {
  id: string;
  shape: FlowShape;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The label's plain text (paragraphs joined with new lines). */
  text: string;
  color: FlowColor;
  /** The formatted label, when it has formatting; its plain text equals `text`. */
  rich?: FlowParagraph[];
  align?: FlowTextAlign;
  valign?: FlowTextValign;
  /** The shape grows and shrinks with its text. */
  autoHeight?: boolean;
  /** Custom fill and outline ("#rrggbb" or "none"), over the colour's own. */
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeStyle?: FlowLineStyle;
  /** An image from Folevi's file storage (or the local library in local mode). */
  image?: { fileId: string; fit?: FlowImageFit };
  /** A longer note, shown as a badge that opens it. */
  note?: string;
  /** A link to a Folevi page, shown as a badge. */
  link?: { documentId: string; title?: string };
  icon?: { name: FlowIconName; place?: FlowIconPlace };
  /** The frame or swimlane lane this node belongs to. */
  parent?: string;
}

export interface FlowEdgeLabel {
  text: string;
  /** Where the label sits along the connector (0 start … 1 end). */
  at: number;
}

export interface FlowEdge {
  id: string;
  /** Start node, or "" when the start floats free at `fromPoint`. */
  from: string;
  /** End node, or "" when the end floats free at `toPoint`. */
  to: string;
  fromSide?: FlowSide;
  toSide?: FlowSide;
  /** Position along the side (0…1, left to right or top to bottom); spread automatically without one. */
  fromAt?: number;
  toAt?: number;
  fromPoint?: Pt;
  toPoint?: Pt;
  route: FlowRoute;
  /** Points the route passes through, in order. */
  bends: Pt[];
  start: FlowHead;
  end: FlowHead;
  style: FlowLineStyle;
  width: number;
  /** A palette colour or "#rrggbb"; the default grey without one. */
  color?: string;
  labels: FlowEdgeLabel[];
}

export interface FlowFrame {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  color: FlowColor;
  /** The frame or lane this frame sits in. */
  parent?: string;
}

export interface FlowLane {
  id: string;
  title: string;
  /** Height of a row lane, width of a column lane. */
  size: number;
  color: FlowColor;
}

export interface FlowPool {
  id: string;
  x: number;
  y: number;
  orient: FlowPoolOrient;
  title: string;
  /** Width of a pool of rows, height (below the title) of a pool of columns. */
  length: number;
  lanes: FlowLane[];
}

export interface FlowchartData {
  v: 2;
  nodes: FlowNode[];
  edges: FlowEdge[];
  frames: FlowFrame[];
  pools: FlowPool[];
}

export const FLOWCHART_LIMITS = {
  maxNodes: 500,
  maxEdges: 1000,
  maxText: 1000,
  maxLabel: 120,
  maxLabels: 8,
  maxBends: 32,
  maxNote: 2000,
  maxTitle: 120,
  maxParagraphs: 40,
  maxRuns: 400,
  maxCoord: 100_000,
  minSize: 24,
  maxWidth: 1200,
  maxHeight: 1200,
  maxIdLength: 32,
  maxFrames: 100,
  maxFrameSize: 20_000,
  maxFrameDepth: 6,
  maxPools: 10,
  maxLanes: 20,
  minLaneSize: 80,
  maxLaneSize: 5000,
  minEdgeWidth: 0.5,
  maxEdgeWidth: 8,
  maxStrokeWidth: 8,
} as const;

export const FLOWCHART_DEFAULT_HEIGHT = 440;
/** Snapping step for positions and sizes (the dot grid is drawn every 3 steps). */
export const FLOWCHART_GRID = 8;
export const FLOWCHART_FONT_SIZE = 14;
export const FLOWCHART_LINE_HEIGHT = 19;
export const FLOWCHART_LABEL_FONT_SIZE = 12.5;
export const FLOWCHART_EDGE_WIDTH = 1.5;
/** A frame's title band. */
export const FLOWCHART_FRAME_TITLE = 32;
/** A pool's title band (across the top), and each lane's header (left of a row, top of a column). */
export const FLOWCHART_POOL_TITLE = 36;
export const FLOWCHART_LANE_HEADER_ROW = 120;
export const FLOWCHART_LANE_HEADER_COLUMN = 40;

/** Shapes as v1 knew them (a quick list for menus); every shape is in FLOWCHART_SHAPES. */
export { FLOWCHART_QUICK_SHAPES };

export const FLOWCHART_COLOR_LABEL: Record<FlowColor, string> = {
  neutral: "Neutral",
  accent: "Accent",
  blue: "Blue",
  green: "Green",
  yellow: "Yellow",
  pink: "Pink",
  purple: "Purple",
};

export const FLOWCHART_HEAD_LABEL: Record<FlowHead, string> = {
  none: "None",
  arrow: "Arrow",
  open: "Open arrow",
  circle: "Circle",
  diamond: "Diamond",
  bar: "Bar",
};

const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const FILE_RE = /^(?!.*\.\.)[A-Za-z0-9_:./-]{1,128}$/;
const DOC_RE = /^[A-Za-z0-9_-]{1,64}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export const emptyFlowchart = (): FlowchartData => ({ v: 2, nodes: [], edges: [], frames: [], pools: [] });

/** A chart from parts (missing collections empty). */
export function flowchart(parts: Partial<Omit<FlowchartData, "v">> = {}): FlowchartData {
  return { v: 2, nodes: parts.nodes ?? [], edges: parts.edges ?? [], frames: parts.frames ?? [], pools: parts.pools ?? [] };
}

/** A short random id for new nodes and edges (not a block id; unique within one flowchart). */
export function flowId(prefix = "n"): string {
  let s = prefix;
  for (let i = 0; i < 7; i++) s += "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)];
  return s;
}

/** A connector with every default filled in. */
export function newEdge(from: string, to: string, extra: Partial<FlowEdge> = {}): FlowEdge {
  return { id: flowId("e"), from, to, route: "elbow", bends: [], start: "none", end: "arrow", style: "solid", width: FLOWCHART_EDGE_WIDTH, labels: [], ...extra };
}

/** Which ends carry a head, as the v1 `arrow` setting. */
export function edgeArrow(e: Pick<FlowEdge, "start" | "end">): FlowArrow {
  const s = e.start !== "none";
  const t = e.end !== "none";
  return s && t ? "both" : t ? "end" : s ? "start" : "none";
}

/** Heads at the ends `arrow` names (keeping a head's kind where an end keeps one). */
export function withArrow<E extends Pick<FlowEdge, "start" | "end">>(e: E, arrow: FlowArrow): E {
  const keep = (h: FlowHead) => (h === "none" ? "arrow" : h);
  return { ...e, start: arrow === "both" || arrow === "start" ? keep(e.start) : "none", end: arrow === "both" || arrow === "end" ? keep(e.end) : "none" };
}

/** The connector's first label ("" without one). */
export function edgeLabel(e: Pick<FlowEdge, "labels">): string {
  return e.labels[0]?.text ?? "";
}

/** Sets the first label's text (added halfway along when there was none; removed when empty). */
export function withLabel<E extends Pick<FlowEdge, "labels">>(e: E, text: string): E {
  const clean = cleanText(text, FLOWCHART_LIMITS.maxLabel).replace(/\n+/g, " ");
  const [first, ...rest] = e.labels;
  if (!clean) return { ...e, labels: rest };
  return { ...e, labels: [{ text: clean, at: first?.at ?? 0.5 }, ...rest] };
}

// ------------------------------------------------------------------------------------------ rich text

/** A rich label's plain text: paragraphs joined with new lines. */
export function richPlainText(rich: readonly FlowParagraph[]): string {
  return rich.map((p) => p.text.map((r) => r.text).join("")).join("\n");
}

/** Plain text as paragraphs (one per line, no formatting). */
export function plainToRich(text: string): FlowParagraph[] {
  return text.split("\n").map((line) => ({ text: line ? [{ type: "text", text: line }] : [] }));
}

/** The node's label as paragraphs (its rich text, or its plain text). */
export function nodeParagraphs(n: Pick<FlowNode, "text" | "rich">): FlowParagraph[] {
  return n.rich ?? plainToRich(n.text);
}

const MARK_SET = new Set<string>(MarkTypes);

function cleanMark(raw: unknown): Mark | null {
  if (!isObj(raw) || typeof raw.type !== "string" || !MARK_SET.has(raw.type)) return null;
  switch (raw.type) {
    case "link": {
      const href = typeof raw.href === "string" ? sanitizeHref(raw.href) : null;
      return href ? { type: "link", href } : null;
    }
    case "color":
      return oneOf(TextColorValues, raw.value) ? { type: "color", value: raw.value } : null;
    case "highlight":
      return oneOf(HighlightColorValues, raw.value) ? { type: "highlight", value: raw.value } : null;
    default:
      return { type: raw.type as "bold" | "italic" | "underline" | "strike" | "code" };
  }
}

/**
 * Rich text made safe: unknown marks dropped, links made safe, runs merged, the text kept to `max`
 * characters. Returns undefined when nothing in it needs more than plain text.
 */
function cleanRich(raw: unknown, max: number): FlowParagraph[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: FlowParagraph[] = [];
  let left = max;
  let runs = 0;
  for (const p of raw.slice(0, FLOWCHART_LIMITS.maxParagraphs)) {
    if (!isObj(p) || left < 0) break;
    const text: FlowRun[] = [];
    for (const r of Array.isArray(p.text) ? p.text : []) {
      if (!isObj(r) || typeof r.text !== "string" || runs >= FLOWCHART_LIMITS.maxRuns) continue;
      const t = cleanText(r.text, Math.max(0, left)).replace(/\n/g, " ");
      if (!t) continue;
      left -= t.length;
      runs++;
      const marks = normalizeMarks((Array.isArray(r.marks) ? r.marks : []).map(cleanMark).filter((m): m is Mark => m !== null));
      text.push(marks ? { type: "text", text: t, marks } : { type: "text", text: t });
    }
    const para: FlowParagraph = { text: normalizeInline(text) as FlowRun[] };
    if (p.list === "bullet" || p.list === "ordered") para.list = p.list;
    out.push(para);
    left -= 1; // the new line between paragraphs
  }
  if (!out.length) return undefined;
  const formatted = out.some((p) => p.list || p.text.some((r) => r.marks?.length));
  return formatted ? out : undefined;
}

/** Why rich text isn't valid, or null. */
function richIssue(raw: unknown, text: string): string | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > FLOWCHART_LIMITS.maxParagraphs) return "invalid rich text";
  let runs = 0;
  for (const p of raw) {
    if (!isObj(p)) return "invalid rich text";
    for (const k of Object.keys(p)) if (k !== "text" && k !== "list") return "invalid rich text";
    if (p.list !== undefined && p.list !== "bullet" && p.list !== "ordered") return "invalid rich text";
    if (!Array.isArray(p.text)) return "invalid rich text";
    for (const r of p.text) {
      runs++;
      if (!isObj(r) || r.type !== "text" || typeof r.text !== "string" || r.text.includes("\n")) return "invalid rich text";
      for (const k of Object.keys(r)) if (k !== "type" && k !== "text" && k !== "marks") return "invalid rich text";
      if (r.marks !== undefined) {
        if (!Array.isArray(r.marks)) return "invalid rich text";
        for (const m of r.marks) {
          const c = cleanMark(m);
          if (!c || JSON.stringify(c) !== JSON.stringify(m)) return "invalid mark";
        }
      }
    }
  }
  if (runs > FLOWCHART_LIMITS.maxRuns) return "invalid rich text";
  if (richPlainText(raw as FlowParagraph[]) !== text) return "rich text doesn't match text";
  return null;
}

// ------------------------------------------------------------------------------------------ strict check

const V1_NODE_KEYS = new Set(["id", "shape", "x", "y", "w", "h", "text", "color"]);
const V1_EDGE_KEYS = new Set(["id", "from", "to", "fromSide", "toSide", "label", "style", "arrow"]);
const NODE_KEYS = new Set(["id", "shape", "x", "y", "w", "h", "text", "color", "rich", "align", "valign", "autoHeight", "fill", "stroke", "strokeWidth", "strokeStyle", "image", "note", "link", "icon", "parent"]);
const EDGE_KEYS = new Set(["id", "from", "to", "fromSide", "toSide", "fromAt", "toAt", "fromPoint", "toPoint", "route", "bends", "start", "end", "style", "width", "color", "labels"]);
const FRAME_KEYS = new Set(["id", "x", "y", "w", "h", "title", "color", "parent"]);
const POOL_KEYS = new Set(["id", "x", "y", "orient", "title", "length", "lanes"]);
const LANE_KEYS = new Set(["id", "title", "size", "color"]);

const coordOk = (n: unknown) => isNum(n) && Math.abs(n) <= FLOWCHART_LIMITS.maxCoord;
const pointOk = (p: unknown) => Array.isArray(p) && p.length === 2 && coordOk(p[0]) && coordOk(p[1]);
const paintOk = (v: unknown) => v === "none" || (typeof v === "string" && HEX_RE.test(v));
const edgeColorOk = (v: unknown) => oneOf(FLOWCHART_COLORS, v) || (typeof v === "string" && HEX_RE.test(v));
const unexpected = (o: Record<string, unknown>, keys: Set<string>) => Object.keys(o).find((k) => !keys.has(k));
const titleOk = (v: unknown) => v === undefined || (typeof v === "string" && v.length <= FLOWCHART_LIMITS.maxTitle);

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
  if (parsed.v === undefined || parsed.v === 1) return v1Issue(parsed);
  if (parsed.v !== 2) return "unsupported version";
  return v2Issue(parsed);
}

/** The v1 rules, for data written by clients that predate v2. */
function v1Issue(parsed: Record<string, unknown>): string | null {
  for (const k of Object.keys(parsed)) if (k !== "v" && k !== "nodes" && k !== "edges") return `unexpected field ${k}`;
  const { nodes, edges } = parsed;
  if (!Array.isArray(nodes)) return "nodes must be an array";
  if (edges !== undefined && !Array.isArray(edges)) return "edges must be an array";
  if (nodes.length > FLOWCHART_LIMITS.maxNodes) return "too many nodes";
  if ((edges?.length ?? 0) > FLOWCHART_LIMITS.maxEdges) return "too many edges";
  const ids = new Set<string>();
  const L = FLOWCHART_LIMITS;
  for (const [i, n] of nodes.entries()) {
    if (!isObj(n)) return `node ${i} must be an object`;
    const extra = unexpected(n, V1_NODE_KEYS);
    if (extra) return `node ${i}: unexpected field ${extra}`;
    if (typeof n.id !== "string" || !ID_RE.test(n.id) || ids.has(n.id)) return `node ${i}: invalid id`;
    ids.add(n.id);
    if (!oneOf(FLOWCHART_QUICK_SHAPES, n.shape)) return `node ${i}: invalid shape`;
    for (const k of ["x", "y"] as const) if (!coordOk(n[k])) return `node ${i}: invalid ${k}`;
    if (!isNum(n.w) || n.w < L.minSize || n.w > L.maxWidth) return `node ${i}: invalid w`;
    if (!isNum(n.h) || n.h < L.minSize || n.h > L.maxHeight) return `node ${i}: invalid h`;
    if (n.text !== undefined && (typeof n.text !== "string" || n.text.length > L.maxText)) return `node ${i}: invalid text`;
    if (n.color !== undefined && !oneOf(FLOWCHART_COLORS, n.color)) return `node ${i}: invalid color`;
  }
  const edgeIds = new Set<string>();
  for (const [i, e] of (edges ?? []).entries()) {
    if (!isObj(e)) return `edge ${i} must be an object`;
    const extra = unexpected(e, V1_EDGE_KEYS);
    if (extra) return `edge ${i}: unexpected field ${extra}`;
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

function v2Issue(parsed: Record<string, unknown>): string | null {
  const L = FLOWCHART_LIMITS;
  for (const k of Object.keys(parsed)) if (!["v", "nodes", "edges", "frames", "pools"].includes(k)) return `unexpected field ${k}`;
  const { nodes, edges, frames, pools } = parsed;
  if (!Array.isArray(nodes)) return "nodes must be an array";
  for (const [k, v] of [["edges", edges], ["frames", frames], ["pools", pools]] as const) if (v !== undefined && !Array.isArray(v)) return `${k} must be an array`;
  const E = (edges ?? []) as unknown[];
  const F = (frames ?? []) as unknown[];
  const Pl = (pools ?? []) as unknown[];
  if (nodes.length > L.maxNodes) return "too many nodes";
  if (E.length > L.maxEdges) return "too many edges";
  if (F.length > L.maxFrames) return "too many frames";
  if (Pl.length > L.maxPools) return "too many pools";

  // One namespace for nodes, frames, pools and lanes (parents refer to frames and lanes).
  const ids = new Set<string>();
  const nodeIds = new Set<string>();
  const containers = new Map<string, string | undefined>();
  const takeId = (v: unknown) => {
    if (typeof v !== "string" || !ID_RE.test(v) || ids.has(v)) return false;
    ids.add(v);
    return true;
  };

  for (const [i, f] of F.entries()) {
    if (!isObj(f)) return `frame ${i} must be an object`;
    const extra = unexpected(f, FRAME_KEYS);
    if (extra) return `frame ${i}: unexpected field ${extra}`;
    if (!takeId(f.id)) return `frame ${i}: invalid id`;
    for (const k of ["x", "y"] as const) if (!coordOk(f[k])) return `frame ${i}: invalid ${k}`;
    for (const k of ["w", "h"] as const) if (!isNum(f[k]) || f[k] < L.minSize || f[k] > L.maxFrameSize) return `frame ${i}: invalid ${k}`;
    if (!titleOk(f.title)) return `frame ${i}: invalid title`;
    if (f.color !== undefined && !oneOf(FLOWCHART_COLORS, f.color)) return `frame ${i}: invalid color`;
    if (f.parent !== undefined && typeof f.parent !== "string") return `frame ${i}: invalid parent`;
    containers.set(f.id as string, f.parent as string | undefined);
  }
  for (const [i, p] of Pl.entries()) {
    if (!isObj(p)) return `pool ${i} must be an object`;
    const extra = unexpected(p, POOL_KEYS);
    if (extra) return `pool ${i}: unexpected field ${extra}`;
    if (!takeId(p.id)) return `pool ${i}: invalid id`;
    for (const k of ["x", "y"] as const) if (!coordOk(p[k])) return `pool ${i}: invalid ${k}`;
    if (p.orient !== undefined && !oneOf(FLOWCHART_POOL_ORIENTS, p.orient)) return `pool ${i}: invalid orient`;
    if (!titleOk(p.title)) return `pool ${i}: invalid title`;
    if (!isNum(p.length) || p.length < L.minLaneSize || p.length > L.maxFrameSize) return `pool ${i}: invalid length`;
    if (!Array.isArray(p.lanes) || !p.lanes.length || p.lanes.length > L.maxLanes) return `pool ${i}: invalid lanes`;
    for (const [j, lane] of p.lanes.entries()) {
      if (!isObj(lane)) return `pool ${i} lane ${j} must be an object`;
      const ex = unexpected(lane, LANE_KEYS);
      if (ex) return `pool ${i} lane ${j}: unexpected field ${ex}`;
      if (!takeId(lane.id)) return `pool ${i} lane ${j}: invalid id`;
      if (!titleOk(lane.title)) return `pool ${i} lane ${j}: invalid title`;
      if (!isNum(lane.size) || lane.size < L.minLaneSize || lane.size > L.maxLaneSize) return `pool ${i} lane ${j}: invalid size`;
      if (lane.color !== undefined && !oneOf(FLOWCHART_COLORS, lane.color)) return `pool ${i} lane ${j}: invalid color`;
      containers.set(lane.id as string, undefined);
    }
  }
  // Frame parents: an existing frame or lane, no loops, not too deep.
  for (const [id, parent] of containers) {
    if (parent === undefined) continue;
    if (!containers.has(parent) || parent === id) return `frame ${id}: unknown parent`;
    let depth = 0;
    for (let cur: string | undefined = parent; cur !== undefined; cur = containers.get(cur)) {
      if (cur === id || ++depth > L.maxFrameDepth) return `frame ${id}: parent loop`;
    }
  }

  for (const [i, n] of nodes.entries()) {
    if (!isObj(n)) return `node ${i} must be an object`;
    const extra = unexpected(n, NODE_KEYS);
    if (extra) return `node ${i}: unexpected field ${extra}`;
    if (!takeId(n.id)) return `node ${i}: invalid id`;
    nodeIds.add(n.id as string);
    if (!oneOf(FLOWCHART_SHAPES, n.shape)) return `node ${i}: invalid shape`;
    for (const k of ["x", "y"] as const) if (!coordOk(n[k])) return `node ${i}: invalid ${k}`;
    if (!isNum(n.w) || n.w < L.minSize || n.w > L.maxWidth) return `node ${i}: invalid w`;
    if (!isNum(n.h) || n.h < L.minSize || n.h > L.maxHeight) return `node ${i}: invalid h`;
    if (n.text !== undefined && (typeof n.text !== "string" || n.text.length > L.maxText)) return `node ${i}: invalid text`;
    if (n.color !== undefined && !oneOf(FLOWCHART_COLORS, n.color)) return `node ${i}: invalid color`;
    if (n.rich !== undefined) {
      const issue = richIssue(n.rich, typeof n.text === "string" ? n.text : "");
      if (issue) return `node ${i}: ${issue}`;
    }
    if (n.align !== undefined && !oneOf(FLOWCHART_TEXT_ALIGNS, n.align)) return `node ${i}: invalid align`;
    if (n.valign !== undefined && !oneOf(FLOWCHART_TEXT_VALIGNS, n.valign)) return `node ${i}: invalid valign`;
    if (n.autoHeight !== undefined && typeof n.autoHeight !== "boolean") return `node ${i}: invalid autoHeight`;
    for (const k of ["fill", "stroke"] as const) if (n[k] !== undefined && !paintOk(n[k])) return `node ${i}: invalid ${k}`;
    if (n.strokeWidth !== undefined && (!isNum(n.strokeWidth) || n.strokeWidth < 0 || n.strokeWidth > L.maxStrokeWidth)) return `node ${i}: invalid strokeWidth`;
    if (n.strokeStyle !== undefined && !oneOf(FLOWCHART_LINE_STYLES, n.strokeStyle)) return `node ${i}: invalid strokeStyle`;
    if (n.image !== undefined) {
      const im = n.image;
      if (!isObj(im) || unexpected(im, new Set(["fileId", "fit"])) || typeof im.fileId !== "string" || !FILE_RE.test(im.fileId)) return `node ${i}: invalid image`;
      if (im.fit !== undefined && !oneOf(FLOWCHART_IMAGE_FITS, im.fit)) return `node ${i}: invalid image`;
    }
    if (n.note !== undefined && (typeof n.note !== "string" || n.note.length > L.maxNote)) return `node ${i}: invalid note`;
    if (n.link !== undefined) {
      const ln = n.link;
      if (!isObj(ln) || unexpected(ln, new Set(["documentId", "title"])) || typeof ln.documentId !== "string" || !DOC_RE.test(ln.documentId) || !titleOk(ln.title)) return `node ${i}: invalid link`;
    }
    if (n.icon !== undefined) {
      const ic = n.icon;
      if (!isObj(ic) || unexpected(ic, new Set(["name", "place"])) || !oneOf(FLOWCHART_ICONS, ic.name)) return `node ${i}: invalid icon`;
      if (ic.place !== undefined && !oneOf(FLOWCHART_ICON_PLACES, ic.place)) return `node ${i}: invalid icon`;
    }
    if (n.parent !== undefined && (typeof n.parent !== "string" || !containers.has(n.parent))) return `node ${i}: unknown parent`;
  }

  const edgeIds = new Set<string>();
  for (const [i, e] of E.entries()) {
    if (!isObj(e)) return `edge ${i} must be an object`;
    const extra = unexpected(e, EDGE_KEYS);
    if (extra) return `edge ${i}: unexpected field ${extra}`;
    if (typeof e.id !== "string" || !ID_RE.test(e.id) || edgeIds.has(e.id)) return `edge ${i}: invalid id`;
    edgeIds.add(e.id);
    for (const [end, point] of [["from", "fromPoint"], ["to", "toPoint"]] as const) {
      if (e[end] === undefined) {
        if (!pointOk(e[point])) return `edge ${i}: ${end} needs a node or a point`;
      } else {
        if (typeof e[end] !== "string" || !nodeIds.has(e[end] as string)) return `edge ${i}: unknown node`;
        if (e[point] !== undefined) return `edge ${i}: ${point} on an attached end`;
      }
    }
    for (const k of ["fromSide", "toSide"] as const) if (e[k] !== undefined && !oneOf(FLOWCHART_SIDES, e[k])) return `edge ${i}: invalid ${k}`;
    for (const k of ["fromAt", "toAt"] as const) if (e[k] !== undefined && (!isNum(e[k]) || e[k] < 0 || e[k] > 1)) return `edge ${i}: invalid ${k}`;
    if (e.route !== undefined && !oneOf(FLOWCHART_ROUTES, e.route)) return `edge ${i}: invalid route`;
    if (e.bends !== undefined && (!Array.isArray(e.bends) || e.bends.length > L.maxBends || !e.bends.every(pointOk))) return `edge ${i}: invalid bends`;
    for (const k of ["start", "end"] as const) if (e[k] !== undefined && !oneOf(FLOWCHART_HEADS, e[k])) return `edge ${i}: invalid ${k}`;
    if (e.style !== undefined && !oneOf(FLOWCHART_LINE_STYLES, e.style)) return `edge ${i}: invalid style`;
    if (e.width !== undefined && (!isNum(e.width) || e.width < L.minEdgeWidth || e.width > L.maxEdgeWidth)) return `edge ${i}: invalid width`;
    if (e.color !== undefined && !edgeColorOk(e.color)) return `edge ${i}: invalid color`;
    if (e.labels !== undefined) {
      if (!Array.isArray(e.labels) || e.labels.length > L.maxLabels) return `edge ${i}: invalid labels`;
      for (const lb of e.labels) {
        if (!isObj(lb) || unexpected(lb, new Set(["text", "at"])) || typeof lb.text !== "string" || lb.text.length > L.maxLabel) return `edge ${i}: invalid label`;
        if (lb.at !== undefined && (!isNum(lb.at) || lb.at < 0 || lb.at > 1)) return `edge ${i}: invalid label`;
      }
    }
  }
  return null;
}

// ------------------------------------------------------------------------------------------ forgiving reader

/** Control characters (other than new lines) never reach the canvas or an export. */
function cleanText(s: unknown, max: number): string {
  return typeof s === "string"
    ? s
        .replace(/\r\n?/g, "\n")
        .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "")
        .slice(0, max)
    : "";
}
const oneLine = (s: unknown, max: number) => cleanText(s, max).replace(/\n+/g, " ");

function cleanId(v: unknown, used: Set<string>, prefix: string): string {
  let id = typeof v === "string" || typeof v === "number" ? String(v).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) : "";
  while (!id || used.has(id)) id = flowId(prefix);
  used.add(id);
  return id;
}

function readPoint(v: unknown): Pt | undefined {
  const L = FLOWCHART_LIMITS.maxCoord;
  let x: unknown;
  let y: unknown;
  if (Array.isArray(v)) [x, y] = v;
  else if (isObj(v)) ({ x, y } = v);
  if (!isNum(x) || !isNum(y)) return undefined;
  return { x: Math.round(clamp(x, -L, L)), y: Math.round(clamp(y, -L, L)) };
}

const rawKey = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "");

/**
 * Forgiving reader for any flowchart-shaped value (stored data of either version, AI output, pasted JSON).
 * Never throws: unusable items are dropped, numbers clamped, strings trimmed to their limits, duplicate ids
 * renamed, connectors whose ends are missing (and that have no free point) or that join a node to itself
 * removed, parents that don't exist or would loop forgotten. v1 fields (`label`, `arrow`) are migrated.
 * Nodes without a position get (0, 0) and are listed in `unplaced` so the caller can lay them out.
 */
export function normalizeFlowchart(input: unknown): FlowchartData & { unplaced: string[] } {
  const out: FlowchartData & { unplaced: string[] } = { ...emptyFlowchart(), unplaced: [] };
  if (!isObj(input)) return out;
  const L = FLOWCHART_LIMITS;
  const used = new Set<string>();
  const nodeRename = new Map<string, string>();
  const boxRename = new Map<string, string>();
  const framesRaw: { frame: FlowFrame; parent: string }[] = [];

  for (const raw of Array.isArray(input.frames) ? input.frames : []) {
    if (out.frames.length >= L.maxFrames) break;
    if (!isObj(raw)) continue;
    const original = rawKey(raw.id);
    const id = cleanId(raw.id, used, "f");
    if (original && !boxRename.has(original)) boxRename.set(original, id);
    const frame: FlowFrame = {
      id,
      x: Math.round(clamp(isNum(raw.x) ? raw.x : 0, -L.maxCoord, L.maxCoord)),
      y: Math.round(clamp(isNum(raw.y) ? raw.y : 0, -L.maxCoord, L.maxCoord)),
      w: Math.round(clamp(isNum(raw.w) ? raw.w : 480, L.minSize, L.maxFrameSize)),
      h: Math.round(clamp(isNum(raw.h) ? raw.h : 320, L.minSize, L.maxFrameSize)),
      title: oneLine(raw.title, L.maxTitle),
      color: oneOf(FLOWCHART_COLORS, raw.color) ? raw.color : "neutral",
    };
    out.frames.push(frame);
    framesRaw.push({ frame, parent: rawKey(raw.parent) });
  }
  for (const raw of Array.isArray(input.pools) ? input.pools : []) {
    if (out.pools.length >= L.maxPools) break;
    if (!isObj(raw)) continue;
    const original = rawKey(raw.id);
    const id = cleanId(raw.id, used, "p");
    if (original && !boxRename.has(original)) boxRename.set(original, id);
    const lanes: FlowLane[] = [];
    for (const lr of Array.isArray(raw.lanes) ? raw.lanes : []) {
      if (lanes.length >= L.maxLanes) break;
      if (!isObj(lr)) continue;
      const lo = rawKey(lr.id);
      const lid = cleanId(lr.id, used, "l");
      if (lo && !boxRename.has(lo)) boxRename.set(lo, lid);
      lanes.push({ id: lid, title: oneLine(lr.title, L.maxTitle), size: Math.round(clamp(isNum(lr.size) ? lr.size : 200, L.minLaneSize, L.maxLaneSize)), color: oneOf(FLOWCHART_COLORS, lr.color) ? lr.color : "neutral" });
    }
    if (!lanes.length) lanes.push({ id: cleanId("", used, "l"), title: "", size: 200, color: "neutral" });
    out.pools.push({
      id,
      x: Math.round(clamp(isNum(raw.x) ? raw.x : 0, -L.maxCoord, L.maxCoord)),
      y: Math.round(clamp(isNum(raw.y) ? raw.y : 0, -L.maxCoord, L.maxCoord)),
      orient: raw.orient === "columns" ? "columns" : "rows",
      title: oneLine(raw.title, L.maxTitle),
      length: Math.round(clamp(isNum(raw.length) ? raw.length : 960, L.minLaneSize, L.maxFrameSize)),
      lanes,
    });
  }
  const laneIds = new Set(out.pools.flatMap((p) => p.lanes.map((l) => l.id)));
  const frameIds = new Set(out.frames.map((f) => f.id));
  const parentOf = new Map<string, string | undefined>();
  for (const { frame, parent } of framesRaw) {
    const p = boxRename.get(parent);
    if (p && p !== frame.id && (frameIds.has(p) || laneIds.has(p))) parentOf.set(frame.id, p);
  }
  // Forget parents that would make a loop or nest too deep.
  for (const f of out.frames) {
    let depth = 0;
    let ok = true;
    for (let cur = parentOf.get(f.id); cur !== undefined; cur = parentOf.get(cur)) {
      if (cur === f.id || ++depth > L.maxFrameDepth) {
        ok = false;
        break;
      }
    }
    if (!ok) parentOf.delete(f.id);
  }
  for (const f of out.frames) {
    const p = parentOf.get(f.id);
    if (p) f.parent = p;
  }

  for (const raw of Array.isArray(input.nodes) ? input.nodes : []) {
    if (out.nodes.length >= L.maxNodes) break;
    if (!isObj(raw)) continue;
    const shape: FlowShape = oneOf(FLOWCHART_SHAPES, raw.shape) ? raw.shape : "process";
    const size = FLOWCHART_SHAPE_SIZE[shape];
    const original = rawKey(raw.id);
    const id = cleanId(raw.id, used, "n");
    if (original && !nodeRename.has(original)) nodeRename.set(original, id);
    const placed = isNum(raw.x) && isNum(raw.y);
    if (!placed) out.unplaced.push(id);
    const text = cleanText(raw.text, L.maxText);
    const rich = cleanRich(raw.rich, L.maxText);
    const node: FlowNode = {
      id,
      shape,
      x: placed ? Math.round(clamp(raw.x as number, -L.maxCoord, L.maxCoord)) : 0,
      y: placed ? Math.round(clamp(raw.y as number, -L.maxCoord, L.maxCoord)) : 0,
      w: Math.round(clamp(isNum(raw.w) ? raw.w : size.w, L.minSize, L.maxWidth)),
      h: Math.round(clamp(isNum(raw.h) ? raw.h : size.h, L.minSize, L.maxHeight)),
      text,
      color: oneOf(FLOWCHART_COLORS, raw.color) ? raw.color : "neutral",
    };
    if (rich) {
      // A reader that only knows plain text changed the label: its text wins over the stale formatting.
      const plain = richPlainText(rich);
      if (typeof raw.text !== "string" || text === plain) {
        node.text = plain;
        node.rich = rich;
      }
    }
    if (oneOf(FLOWCHART_TEXT_ALIGNS, raw.align) && raw.align !== "center") node.align = raw.align;
    if (oneOf(FLOWCHART_TEXT_VALIGNS, raw.valign)) node.valign = raw.valign;
    if (raw.autoHeight === true) node.autoHeight = true;
    for (const k of ["fill", "stroke"] as const) if (paintOk(raw[k])) node[k] = (raw[k] as string).toLowerCase();
    if (isNum(raw.strokeWidth)) node.strokeWidth = Math.round(clamp(raw.strokeWidth, 0, L.maxStrokeWidth) * 2) / 2;
    if (oneOf(FLOWCHART_LINE_STYLES, raw.strokeStyle) && raw.strokeStyle !== "solid") node.strokeStyle = raw.strokeStyle;
    if (isObj(raw.image) && typeof raw.image.fileId === "string" && FILE_RE.test(raw.image.fileId)) {
      node.image = { fileId: raw.image.fileId };
      if (oneOf(FLOWCHART_IMAGE_FITS, raw.image.fit) && raw.image.fit !== "cover") node.image.fit = raw.image.fit;
    }
    const note = cleanText(raw.note, L.maxNote);
    if (note.trim()) node.note = note;
    if (isObj(raw.link) && typeof raw.link.documentId === "string" && DOC_RE.test(raw.link.documentId)) {
      node.link = { documentId: raw.link.documentId };
      const title = oneLine(raw.link.title, L.maxTitle);
      if (title) node.link.title = title;
    }
    const icon = typeof raw.icon === "string" ? { name: raw.icon } : raw.icon;
    if (isObj(icon) && oneOf(FLOWCHART_ICONS, icon.name)) {
      node.icon = { name: icon.name };
      if (oneOf(FLOWCHART_ICON_PLACES, icon.place) && icon.place !== "left") node.icon.place = icon.place;
    }
    const parent = boxRename.get(rawKey(raw.parent));
    if (parent && (frameIds.has(parent) || laneIds.has(parent))) node.parent = parent;
    out.nodes.push(node);
  }

  const edgeIds = new Set<string>();
  const seen = new Set<string>();
  for (const raw of Array.isArray(input.edges) ? input.edges : []) {
    if (out.edges.length >= L.maxEdges) break;
    if (!isObj(raw)) continue;
    const ends: { node: string; point?: Pt }[] = [];
    for (const [end, point] of [["from", "fromPoint"], ["to", "toPoint"]] as const) {
      const node = nodeRename.get(rawKey(raw[end]));
      if (node) ends.push({ node });
      else {
        const p = readPoint(raw[point]);
        if (!p) break;
        ends.push({ node: "", point: p });
      }
    }
    if (ends.length < 2) continue;
    const [a, b] = ends as [{ node: string; point?: Pt }, { node: string; point?: Pt }];
    if (a.node && a.node === b.node) continue;
    const edge: FlowEdge = {
      id: "",
      from: a.node,
      to: b.node,
      route: oneOf(FLOWCHART_ROUTES, raw.route) ? raw.route : "elbow",
      bends: (Array.isArray(raw.bends) ? raw.bends : []).map(readPoint).filter((p): p is Pt => !!p).slice(0, L.maxBends),
      start: "none",
      end: "arrow",
      style: oneOf(FLOWCHART_LINE_STYLES, raw.style) ? raw.style : "solid",
      width: isNum(raw.width) ? Math.round(clamp(raw.width, L.minEdgeWidth, L.maxEdgeWidth) * 2) / 2 : FLOWCHART_EDGE_WIDTH,
      labels: [],
    };
    if (a.point) edge.fromPoint = a.point;
    if (b.point) edge.toPoint = b.point;
    if (a.node && oneOf(FLOWCHART_SIDES, raw.fromSide)) edge.fromSide = raw.fromSide;
    if (b.node && oneOf(FLOWCHART_SIDES, raw.toSide)) edge.toSide = raw.toSide;
    if (edge.fromSide && isNum(raw.fromAt)) edge.fromAt = Math.round(clamp(raw.fromAt, 0, 1) * 1000) / 1000;
    if (edge.toSide && isNum(raw.toAt)) edge.toAt = Math.round(clamp(raw.toAt, 0, 1) * 1000) / 1000;
    // Heads: v2 names each end; v1 said which ends had an arrow.
    if (oneOf(FLOWCHART_HEADS, raw.start) || oneOf(FLOWCHART_HEADS, raw.end)) {
      edge.start = oneOf(FLOWCHART_HEADS, raw.start) ? raw.start : "none";
      edge.end = oneOf(FLOWCHART_HEADS, raw.end) ? raw.end : "arrow";
    } else {
      const arrow = raw.arrow === "both" || raw.arrow === "none" || raw.arrow === "start" ? raw.arrow : "end";
      Object.assign(edge, withArrow({ start: "none", end: "arrow" }, arrow));
    }
    if (edgeColorOk(raw.color)) edge.color = HEX_RE.test(raw.color as string) ? (raw.color as string).toLowerCase() : (raw.color as string);
    // Labels: v2 lists them; v1 had one, halfway along.
    const labelsRaw: unknown[] = Array.isArray(raw.labels) ? raw.labels : typeof raw.label === "string" ? [{ text: raw.label, at: 0.5 }] : [];
    for (const lr of labelsRaw) {
      if (edge.labels.length >= L.maxLabels) break;
      const lt = isObj(lr) ? lr.text : lr;
      const text = oneLine(lt, L.maxLabel);
      if (!text.trim()) continue;
      const at = isObj(lr) && isNum(lr.at) ? Math.round(clamp(lr.at, 0, 1) * 1000) / 1000 : 0.5;
      edge.labels.push({ text, at });
    }
    // The same connection twice (same ends, sides, positions and bends) draws as one line: keep the first.
    if (edge.from && edge.to) {
      const key = `${edge.from}>${edge.to}>${edge.fromSide ?? ""}${edge.fromAt ?? ""}>${edge.toSide ?? ""}${edge.toAt ?? ""}>${edge.bends.map((p) => `${p.x},${p.y}`).join(";")}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    edge.id = cleanId(raw.id, edgeIds, "e");
    out.edges.push(edge);
  }
  return out;
}

/** Reads stored flowchart data (v1 or v2); anything unusable reads as an empty chart (never throws). */
export function parseFlowchart(data: string | null | undefined): FlowchartData {
  if (!data || data.length > LIMITS.maxFlowchartDataLength) return emptyFlowchart();
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return emptyFlowchart();
  }
  const { unplaced: _u, ...fc } = normalizeFlowchart(raw);
  return fc;
}

const pt = (p: Pt) => [Math.round(p.x), Math.round(p.y)];

/** Compact v2 wire JSON (defaults omitted). Empty charts serialise to "". */
export function serializeFlowchart(fc: FlowchartData): string {
  const frames = fc.frames ?? [];
  const pools = fc.pools ?? [];
  if (!fc.nodes.length && !fc.edges.length && !frames.length && !pools.length) return "";
  const out: Record<string, unknown> = {
    v: 2,
    nodes: fc.nodes.map((n) => {
      const o: Record<string, unknown> = { id: n.id, shape: n.shape, x: Math.round(n.x), y: Math.round(n.y), w: Math.round(n.w), h: Math.round(n.h) };
      if (n.text) o.text = n.text;
      if (n.color !== "neutral") o.color = n.color;
      if (n.rich) o.rich = n.rich;
      if (n.align && n.align !== "center") o.align = n.align;
      if (n.valign) o.valign = n.valign;
      if (n.autoHeight) o.autoHeight = true;
      if (n.fill) o.fill = n.fill;
      if (n.stroke) o.stroke = n.stroke;
      if (n.strokeWidth !== undefined) o.strokeWidth = n.strokeWidth;
      if (n.strokeStyle && n.strokeStyle !== "solid") o.strokeStyle = n.strokeStyle;
      if (n.image) o.image = n.image.fit && n.image.fit !== "cover" ? { fileId: n.image.fileId, fit: n.image.fit } : { fileId: n.image.fileId };
      if (n.note) o.note = n.note;
      if (n.link) o.link = n.link.title ? { documentId: n.link.documentId, title: n.link.title } : { documentId: n.link.documentId };
      if (n.icon) o.icon = n.icon.place && n.icon.place !== "left" ? { name: n.icon.name, place: n.icon.place } : { name: n.icon.name };
      if (n.parent) o.parent = n.parent;
      return o;
    }),
  };
  if (fc.edges.length)
    out.edges = fc.edges.map((e) => {
      const o: Record<string, unknown> = { id: e.id };
      if (e.from) o.from = e.from;
      else if (e.fromPoint) o.fromPoint = pt(e.fromPoint);
      if (e.to) o.to = e.to;
      else if (e.toPoint) o.toPoint = pt(e.toPoint);
      if (e.from && e.fromSide) o.fromSide = e.fromSide;
      if (e.from && e.fromSide && e.fromAt !== undefined) o.fromAt = e.fromAt;
      if (e.to && e.toSide) o.toSide = e.toSide;
      if (e.to && e.toSide && e.toAt !== undefined) o.toAt = e.toAt;
      if (e.route !== "elbow") o.route = e.route;
      if (e.bends.length) o.bends = e.bends.map(pt);
      if (e.start !== "none") o.start = e.start;
      if (e.end !== "arrow") o.end = e.end;
      if (e.style !== "solid") o.style = e.style;
      if (e.width !== FLOWCHART_EDGE_WIDTH) o.width = e.width;
      if (e.color) o.color = e.color;
      if (e.labels.length) o.labels = e.labels.map((l) => (l.at === 0.5 ? { text: l.text } : { text: l.text, at: l.at }));
      return o;
    });
  if (frames.length)
    out.frames = frames.map((f) => {
      const o: Record<string, unknown> = { id: f.id, x: Math.round(f.x), y: Math.round(f.y), w: Math.round(f.w), h: Math.round(f.h) };
      if (f.title) o.title = f.title;
      if (f.color !== "neutral") o.color = f.color;
      if (f.parent) o.parent = f.parent;
      return o;
    });
  if (pools.length)
    out.pools = pools.map((p) => {
      const o: Record<string, unknown> = { id: p.id, x: Math.round(p.x), y: Math.round(p.y) };
      if (p.orient !== "rows") o.orient = p.orient;
      if (p.title) o.title = p.title;
      o.length = Math.round(p.length);
      o.lanes = p.lanes.map((l) => {
        const lo: Record<string, unknown> = { id: l.id };
        if (l.title) lo.title = l.title;
        lo.size = Math.round(l.size);
        if (l.color !== "neutral") lo.color = l.color;
        return lo;
      });
      return o;
    });
  return JSON.stringify(out);
}

/** Node texts and notes, connector labels, frame, pool and lane titles (search, AI context). */
export function flowchartText(fc: FlowchartData): string {
  return [
    ...(fc.frames ?? []).map((f) => f.title),
    ...(fc.pools ?? []).flatMap((p) => [p.title, ...p.lanes.map((l) => l.title)]),
    ...fc.nodes.flatMap((n) => [n.text, n.note ?? "", n.link?.title ?? ""]),
    ...fc.edges.flatMap((e) => e.labels.map((l) => l.text)),
  ]
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" · ");
}

// ------------------------------------------------------------------------------------------ containers

/** A pool's whole box. */
export function poolRect(p: FlowPool): Rect {
  const across = p.lanes.reduce((s, l) => s + l.size, 0);
  return p.orient === "rows" ? { x: p.x, y: p.y, w: p.length, h: FLOWCHART_POOL_TITLE + across } : { x: p.x, y: p.y, w: across, h: FLOWCHART_POOL_TITLE + p.length };
}

export interface LaneBox {
  lane: FlowLane;
  pool: FlowPool;
  index: number;
  /** The whole lane, its header (title) and the part shapes go in. */
  rect: Rect;
  header: Rect;
  content: Rect;
}

/** Each lane's boxes, in order. */
export function laneBoxes(p: FlowPool): LaneBox[] {
  const out: LaneBox[] = [];
  let at = FLOWCHART_POOL_TITLE;
  p.lanes.forEach((lane, index) => {
    if (p.orient === "rows") {
      const rect = { x: p.x, y: p.y + at, w: p.length, h: lane.size };
      const hw = Math.min(FLOWCHART_LANE_HEADER_ROW, p.length / 3);
      out.push({ lane, pool: p, index, rect, header: { ...rect, w: hw }, content: { x: rect.x + hw, y: rect.y, w: rect.w - hw, h: rect.h } });
    } else {
      const rect = { x: p.x + (at - FLOWCHART_POOL_TITLE), y: p.y + FLOWCHART_POOL_TITLE, w: lane.size, h: p.length };
      const hh = Math.min(FLOWCHART_LANE_HEADER_COLUMN, p.length / 3);
      out.push({ lane, pool: p, index, rect, header: { ...rect, h: hh }, content: { x: rect.x, y: rect.y + hh, w: rect.w, h: rect.h - hh } });
    }
    at += lane.size;
  });
  return out;
}

/** The part of a frame below its title band. */
export function frameContent(f: FlowFrame): Rect {
  const t = f.title ? FLOWCHART_FRAME_TITLE : 12;
  return { x: f.x, y: f.y + t, w: f.w, h: Math.max(0, f.h - t) };
}

export interface FlowContainer {
  id: string;
  kind: "frame" | "lane";
  rect: Rect;
  content: Rect;
  parent?: string;
  depth: number;
}

/** Every frame and lane by id, with its boxes and nesting depth (a lane is at depth 0). */
export function flowContainers(fc: FlowchartData): Map<string, FlowContainer> {
  const map = new Map<string, FlowContainer>();
  for (const p of fc.pools ?? []) for (const lb of laneBoxes(p)) map.set(lb.lane.id, { id: lb.lane.id, kind: "lane", rect: lb.rect, content: lb.content, depth: 0 });
  const frames = new Map((fc.frames ?? []).map((f) => [f.id, f]));
  const depthOf = (f: FlowFrame, seen = 0): number => {
    if (!f.parent || seen > FLOWCHART_LIMITS.maxFrameDepth) return f.parent && map.get(f.parent)?.kind === "lane" ? 1 : 0;
    const p = frames.get(f.parent);
    return p ? depthOf(p, seen + 1) + 1 : 1;
  };
  for (const f of fc.frames ?? []) map.set(f.id, { id: f.id, kind: "frame", rect: { x: f.x, y: f.y, w: f.w, h: f.h }, content: frameContent(f), parent: f.parent, depth: depthOf(f) });
  return map;
}

/** Nodes and frames inside a container (with `deep`, everything nested in its frames too). */
export function containerMembers(fc: FlowchartData, id: string, deep = true): { nodes: string[]; frames: string[] } {
  const frames: string[] = [];
  const nodes: string[] = [];
  const queue = [id];
  const seen = new Set<string>();
  while (queue.length) {
    const cur = queue.shift()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const f of fc.frames ?? []) if (f.parent === cur) {
      frames.push(f.id);
      if (deep) queue.push(f.id);
    }
    for (const n of fc.nodes) if (n.parent === cur) nodes.push(n.id);
  }
  return { nodes, frames };
}

/**
 * The innermost frame or lane whose content holds the centre of `r` (where a dropped shape belongs), or
 * null. `exclude` skips a frame and everything in it (a frame can't go inside itself).
 */
export function containerAt(fc: FlowchartData, r: Rect, exclude?: string): string | null {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const skip = new Set<string>();
  if (exclude) {
    skip.add(exclude);
    for (const f of containerMembers(fc, exclude).frames) skip.add(f);
  }
  let best: FlowContainer | null = null;
  for (const c of flowContainers(fc).values()) {
    if (skip.has(c.id)) continue;
    const b = c.content;
    if (cx < b.x || cy < b.y || cx > b.x + b.w || cy > b.y + b.h) continue;
    if (!best || c.depth > best.depth || (c.depth === best.depth && c.rect.w * c.rect.h < best.rect.w * best.rect.h)) best = c;
  }
  return best?.id ?? null;
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

const has = (marks: readonly Mark[] | undefined, t: Mark["type"]) => !!marks?.some((m) => m.type === t);

/** Estimated width of a styled piece of text (bold is a little wider, code is monospaced). */
export function measureStyled(text: string, marks: readonly Mark[] | undefined, fontSize = FLOWCHART_FONT_SIZE): number {
  if (has(marks, "code")) return [...text].length * 0.6 * fontSize * 0.92;
  return measureFlowText(text, fontSize) * (has(marks, "bold") ? 1.07 : 1);
}

export interface FlowTextSpan {
  text: string;
  marks?: Mark[];
}
export interface FlowTextLine {
  spans: FlowTextSpan[];
  /** Estimated width of the line (marker and indent included). */
  width: number;
  /** Space before the text (list items' continuation lines). */
  indent: number;
  /** A list marker ("•", "1.") drawn before the first line of an item. */
  marker?: string;
}

/**
 * Lays rich paragraphs out in lines no wider than `maxWidth`: words wrap (long words break), formatting
 * carries across breaks, list items get a marker and a hanging indent. Capped at `maxLines`.
 */
export function wrapRichText(paragraphs: readonly FlowParagraph[], maxWidth: number, fontSize = FLOWCHART_FONT_SIZE, maxLines = 24): FlowTextLine[] {
  const limit = Math.max(fontSize, maxWidth);
  const lines: FlowTextLine[] = [];
  let number = 0;
  for (const para of paragraphs) {
    number = para.list === "ordered" ? number + 1 : 0;
    const marker = para.list === "bullet" ? "•" : para.list === "ordered" ? `${number}.` : undefined;
    const indent = marker ? measureFlowText(para.list === "ordered" ? "00. " : "•  ", fontSize) : 0;
    const width = limit - indent;
    // Words as lists of styled pieces.
    const words: FlowTextSpan[][] = [];
    let cur: FlowTextSpan[] = [];
    for (const run of para.text) {
      const parts = run.text.split(/( +)/);
      for (const part of parts) {
        if (!part) continue;
        if (/^ +$/.test(part)) {
          if (cur.length) words.push(cur);
          cur = [];
          continue;
        }
        cur.push(run.marks ? { text: part, marks: run.marks } : { text: part });
      }
    }
    if (cur.length) words.push(cur);
    const wordWidth = (w: FlowTextSpan[]) => w.reduce((s, p) => s + measureStyled(p.text, p.marks, fontSize), 0);
    let line: FlowTextSpan[][] = [];
    let lineW = 0;
    let first = true;
    const flush = () => {
      const spans: FlowTextSpan[] = [];
      line.forEach((w, i) => {
        const pieces = i ? [{ ...w[0]!, text: ` ${w[0]!.text}` }, ...w.slice(1)] : w;
        for (const p of pieces) {
          const last = spans[spans.length - 1];
          if (last && JSON.stringify(last.marks ?? []) === JSON.stringify(p.marks ?? [])) last.text += p.text;
          else spans.push({ ...p });
        }
      });
      lines.push({ spans, width: lineW + indent, indent, ...(first && marker ? { marker } : {}) });
      first = false;
      line = [];
      lineW = 0;
    };
    for (const word of words) {
      const ww = wordWidth(word);
      const space = line.length ? measureStyled(" ", line[line.length - 1]!.at(-1)!.marks, fontSize) : 0;
      if (lineW + space + ww <= width) {
        line.push(word);
        lineW += space + ww;
        continue;
      }
      if (line.length) flush();
      if (ww <= width) {
        line = [word];
        lineW = ww;
        continue;
      }
      // A word wider than the line breaks across lines.
      let piece: FlowTextSpan[] = [];
      let pw = 0;
      for (const span of word) {
        for (const ch of span.text) {
          const cw = measureStyled(ch, span.marks, fontSize);
          if (pw + cw > width && pw > 0) {
            line = [piece];
            lineW = pw;
            flush();
            piece = [];
            pw = 0;
          }
          const last = piece[piece.length - 1];
          if (last && last.marks === span.marks) last.text += ch;
          else piece.push(span.marks ? { text: ch, marks: span.marks } : { text: ch });
          pw += cw;
        }
      }
      line = [piece];
      lineW = pw;
    }
    flush();
  }
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    const last = kept[maxLines - 1]!;
    const lastSpan = last.spans[last.spans.length - 1];
    if (lastSpan) lastSpan.text = `${lastSpan.text.replace(/.$/u, "")}…`;
    else last.spans.push({ text: "…" });
    return kept;
  }
  return lines;
}

// ------------------------------------------------------------------------------------------ node content

type ContentNode = Pick<FlowNode, "shape" | "x" | "y" | "w" | "h" | "text"> & Partial<Pick<FlowNode, "rich" | "icon" | "image" | "note" | "link" | "align" | "valign">>;

export interface NodeBadge {
  kind: "note" | "link";
  cx: number;
  cy: number;
  r: number;
}

export interface NodeContentBoxes {
  /** Where the label wraps. */
  text: Rect;
  icon: Rect | null;
  image: Rect | null;
  badges: NodeBadge[];
}

const ICON = 22;
const BADGE_ICON = 16;

/** Where a node's label, icon, image and badges go (chart coordinates). */
export function nodeContentBoxes(n: ContentNode): NodeContentBoxes {
  const local = shapeTextBox(n.shape, n.w, n.h);
  let text: Rect = { x: n.x + local.x, y: n.y + local.y, w: local.w, h: local.h };
  let icon: Rect | null = null;
  let image: Rect | null = null;
  const hasText = !!n.text;
  if (n.image) {
    if (!hasText) image = { ...text };
    else {
      const lines = Math.max(1, (n.rich ? wrapRichText(n.rich, text.w).length : wrapFlowText(n.text, text.w).length));
      const th = Math.min(text.h * 0.6, lines * FLOWCHART_LINE_HEIGHT + 4);
      image = { x: text.x, y: text.y, w: text.w, h: Math.max(16, text.h - th - 6) };
      text = { x: text.x, y: text.y + image.h + 6, w: text.w, h: text.h - image.h - 6 };
    }
  }
  if (n.icon) {
    const place = n.image ? "badge" : (n.icon.place ?? "left");
    if (place === "badge") icon = { x: n.x + 6, y: n.y + 6, w: BADGE_ICON, h: BADGE_ICON };
    else if (!hasText) {
      const s = Math.max(12, Math.min(32, text.w, text.h));
      icon = { x: text.x + text.w / 2 - s / 2, y: text.y + text.h / 2 - s / 2, w: s, h: s };
    } else if (place === "top") {
      const s = Math.min(ICON, text.h / 2);
      icon = { x: text.x + text.w / 2 - s / 2, y: text.y + 2, w: s, h: s };
      text = { x: text.x, y: text.y + s + 6, w: text.w, h: Math.max(8, text.h - s - 6) };
    } else {
      const s = Math.min(ICON, text.h, text.w / 3);
      icon = { x: text.x, y: text.y + text.h / 2 - s / 2, w: s, h: s };
      text = { x: text.x + s + 6, y: text.y, w: Math.max(8, text.w - s - 6), h: text.h };
    }
  }
  const badges: NodeBadge[] = [];
  let bx = n.x + n.w - 10;
  for (const kind of ["note", "link"] as const) {
    if (kind === "note" ? !n.note : !n.link) continue;
    badges.push({ kind, cx: bx, cy: n.y + 10, r: 8 });
    bx -= 20;
  }
  return { text, icon, image, badges };
}

/** Width available to a node's label inside its shape. */
export function textWidthFor(node: ContentNode | Pick<FlowNode, "shape" | "w" | "h">): number {
  if (!("x" in node)) return shapeTextBox(node.shape, node.w, node.h).w;
  return nodeContentBoxes(node).text.w;
}

/** The label's lines for a node (plain text of each line). */
export function nodeLines(node: ContentNode | Pick<FlowNode, "shape" | "w" | "h" | "text">): string[] {
  if (!node.text) return [];
  const w = textWidthFor(node);
  const rich = "rich" in node ? node.rich : undefined;
  if (rich) return wrapRichText(rich, w).map((l) => `${l.marker ? `${l.marker} ` : ""}${l.spans.map((s) => s.text).join("")}`);
  return wrapFlowText(node.text, w);
}

/** The label laid out in lines (rich or plain), each with its spans. */
export function nodeTextLines(node: ContentNode): FlowTextLine[] {
  if (!node.text) return [];
  const w = nodeContentBoxes(node).text.w;
  if (node.rich) return wrapRichText(node.rich, w);
  return wrapFlowText(node.text, w).map((t) => ({ spans: t ? [{ text: t }] : [], width: measureFlowText(t), indent: 0 }));
}

const isV1Plain = (n: Partial<FlowNode> & { shape: FlowShape }) => (FLOWCHART_QUICK_SHAPES as readonly string[]).includes(n.shape) && !n.rich && !n.icon && !n.image;

const snapUp = (n: number) => Math.ceil(n / FLOWCHART_GRID) * FLOWCHART_GRID;

function minHeight(shape: FlowShape): number {
  if (shape === "text" || shape === "annotation") return 32;
  const info = FLOWCHART_SHAPE_INFO[shape];
  return Math.max(FLOWCHART_LIMITS.minSize, info.h * (info.square ? 0.5 : 0.75));
}

/** The smallest height (on the grid) that fits the node's label. */
export function neededHeight(node: ContentNode | Pick<FlowNode, "shape" | "w" | "h" | "text">): number {
  const full: ContentNode = { x: 0, y: 0, ...node };
  if (isV1Plain(full) && !full.note && !full.link) {
    // The v1 rule, so v1 charts size exactly as they did.
    const lines = Math.max(1, nodeLines(full).length);
    const textH = lines * FLOWCHART_LINE_HEIGHT;
    const shape = full.shape as (typeof FLOWCHART_QUICK_SHAPES)[number];
    const pad = { decision: textH * 0.9 + 28, circle: textH * 0.45 + 24, note: 28, text: 10, terminator: 18, io: 22, process: 24 }[shape];
    const min = shape === "text" ? 32 : FLOWCHART_SHAPE_SIZE[shape].h * (shape === "circle" ? 0.5 : 0.75);
    return snapUp(Math.max(min, textH + pad));
  }
  const min = snapUp(minHeight(full.shape));
  for (let h = min; h <= FLOWCHART_LIMITS.maxHeight; h += FLOWCHART_GRID) {
    const probe = { ...full, h };
    const lines = Math.max(1, nodeTextLines(probe).length);
    if (nodeContentBoxes(probe).text.h >= lines * FLOWCHART_LINE_HEIGHT + 2) return h;
  }
  return FLOWCHART_LIMITS.maxHeight;
}

/**
 * Sizes a node to its label: widens a single long line (up to `maxWidth`), then grows the height so every
 * line fits (or, with auto-height, sets it exactly). Square shapes stay square. Never shrinks the width.
 */
export function fitNodeToText(node: FlowNode, opts: { maxWidth?: number } = {}): FlowNode {
  if (!node.text && !node.autoHeight) return node;
  let w = node.w;
  const maxWidth = Math.min(FLOWCHART_LIMITS.maxWidth, opts.maxWidth ?? node.w);
  if (maxWidth > w && node.text) {
    const longest = Math.max(...nodeParagraphs(node).map((p) => p.text.reduce((s, r) => s + measureStyled(r.text, r.marks), 0)));
    const extra = node.w - textWidthFor(node);
    w = Math.min(maxWidth, Math.max(w, snapUp(longest + extra + 4)));
  }
  let next = { ...node, w };
  const needed = node.text ? neededHeight(next) : snapUp(minHeight(node.shape));
  const h = Math.min(FLOWCHART_LIMITS.maxHeight, node.autoHeight ? needed : Math.max(node.h, needed));
  next = { ...next, h };
  if (FLOWCHART_SHAPE_INFO[node.shape].square) {
    const d = Math.max(next.w, next.h);
    next = { ...next, w: d, h: d };
  }
  return next;
}

/** The node's label positioned for drawing: centred (or aligned) in its text box, first baseline first. */
export function nodeTextLayout(n: ContentNode): { x: number; y: number; lines: string[]; anchor: "start" | "middle" | "end"; rich: FlowTextLine[] } {
  const rich = nodeTextLines(n);
  const lines = rich.map((l) => `${l.marker ? `${l.marker} ` : ""}${l.spans.map((s) => s.text).join("")}`);
  const box = nodeContentBoxes(n).text;
  const block = rich.length * FLOWCHART_LINE_HEIGHT;
  const valign = n.valign ?? (n.shape === "note" || n.shape === "annotation" ? "top" : "middle");
  const mid = box.y + box.h / 2;
  const cy = valign === "top" ? Math.min(mid, box.y + 4 + block / 2) : valign === "bottom" ? Math.max(mid, box.y + box.h - 4 - block / 2) : mid;
  // First baseline: centre the block, then drop by ~0.72em (cap height) within the first line.
  const y = cy - block / 2 + FLOWCHART_LINE_HEIGHT / 2 + FLOWCHART_FONT_SIZE * 0.36;
  const align = n.align ?? "center";
  const x = align === "left" ? box.x : align === "right" ? box.x + box.w : box.x + box.w / 2;
  return { x, y, lines, anchor: align === "left" ? "start" : align === "right" ? "end" : "middle", rich };
}
