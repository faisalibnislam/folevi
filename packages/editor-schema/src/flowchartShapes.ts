// Flowchart shapes: the catalog (names, labels, default sizes, search words, groups) and each shape's
// geometry in one place. A shape is drawn from a small path description in its own box (0…w, 0…h), and the
// same description gives the SVG outline, the polygon used for connection points and hit tests, the
// stroke-only details (the lines inside an internal storage, the inner arc of a cylinder…) and the box its
// label wraps in. Pure functions of a node's shape and size, so the editor, read-only pages, exports and
// the server all agree on every pixel.

export interface Pt {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Every shape a flowchart can hold. The first seven are the v1 shapes (kept as they were); then the
 * flowchart library, then basic shapes. Mermaid names come from Mermaid's `@{ shape: … }` catalog.
 */
export const FLOWCHART_SHAPES = [
  // v1
  "process",
  "decision",
  "terminator",
  "io",
  "circle",
  "note",
  "text",
  // Flowchart library
  "document",
  "documents",
  "database",
  "storedData",
  "manualInput",
  "manualOperation",
  "predefined",
  "delay",
  "preparation",
  "merge",
  "extract",
  "offPage",
  "connector",
  "display",
  "internalStorage",
  "sort",
  "collate",
  "summingJunction",
  "or",
  "loopLimit",
  "card",
  "paperTape",
  "directData",
  "annotation",
  // Basic shapes
  "rectangle",
  "rounded",
  "ellipse",
  "triangle",
  "rightTriangle",
  "diamond",
  "hexagon",
  "octagon",
  "pentagon",
  "parallelogram",
  "trapezoid",
  "star",
  "cross",
  "arrowRight",
  "arrowLeft",
  "arrowUp",
  "arrowDown",
  "doubleArrow",
  "chevron",
  "callout",
  "cloud",
  "cylinder",
] as const;
export type FlowShape = (typeof FLOWCHART_SHAPES)[number];

/** The v1 shapes, in their original order (the editor's quick shape menu). */
export const FLOWCHART_QUICK_SHAPES = ["process", "decision", "terminator", "io", "circle", "note", "text"] as const satisfies readonly FlowShape[];

export type FlowShapeGroup = "flowchart" | "basic" | "notes";

export interface FlowShapeInfo {
  label: string;
  group: FlowShapeGroup;
  /** Extra words the shape panel's search matches. */
  keywords: string;
  w: number;
  h: number;
  /** Keeps a 1:1 aspect when resized and fitted. */
  square?: boolean;
  /** Mermaid `@{ shape: … }` name for exports (the v1 shapes use Mermaid's classic brackets). */
  mermaid: string;
}

const S = (label: string, group: FlowShapeGroup, w: number, h: number, mermaid: string, keywords = "", square = false): FlowShapeInfo => ({ label, group, keywords, w, h, mermaid, ...(square ? { square } : {}) });

export const FLOWCHART_SHAPE_INFO: Record<FlowShape, FlowShapeInfo> = {
  process: S("Process", "flowchart", 160, 64, "rect", "step action task box"),
  decision: S("Decision", "flowchart", 176, 96, "diam", "question choice if branch yes no"),
  terminator: S("Start / end", "flowchart", 160, 56, "stadium", "terminal begin finish pill"),
  io: S("Input / output", "flowchart", 176, 64, "lean-r", "data in out parallelogram"),
  circle: S("Circle", "basic", 104, 104, "circle", "round", true),
  note: S("Sticky note", "notes", 176, 112, "rect", "comment memo"),
  text: S("Text", "notes", 160, 40, "text", "label words"),
  document: S("Document", "flowchart", 160, 72, "doc", "paper report file"),
  documents: S("Multiple documents", "flowchart", 168, 80, "docs", "stacked documents files papers"),
  database: S("Database", "flowchart", 120, 88, "cyl", "stored data storage db cylinder"),
  storedData: S("Stored data", "flowchart", 160, 64, "bow-rect", "storage saved"),
  manualInput: S("Manual input", "flowchart", 160, 64, "sl-rect", "keyboard enter type"),
  manualOperation: S("Manual operation", "flowchart", 160, 64, "trap-t", "hand trapezoid"),
  predefined: S("Predefined process", "flowchart", 176, 64, "fr-rect", "subroutine subprocess function"),
  delay: S("Delay", "flowchart", 144, 64, "delay", "wait pause"),
  preparation: S("Preparation", "flowchart", 176, 64, "hex", "setup initialise hexagon"),
  merge: S("Merge", "flowchart", 96, 80, "flip-tri", "combine join triangle"),
  extract: S("Extract", "flowchart", 96, 80, "tri", "split triangle"),
  offPage: S("Off-page link", "flowchart", 80, 80, "notch-pent", "off page connector continue"),
  connector: S("On-page connector", "flowchart", 56, 56, "sm-circ", "junction jump link", true),
  display: S("Display", "flowchart", 176, 64, "curv-trap", "screen monitor show"),
  internalStorage: S("Internal storage", "flowchart", 128, 88, "win-pane", "memory ram"),
  sort: S("Sort", "flowchart", 112, 96, "diam", "order arrange"),
  collate: S("Collate", "flowchart", 88, 96, "hourglass", "gather hourglass"),
  summingJunction: S("Summing junction", "flowchart", 64, 64, "cross-circ", "sum and", true),
  or: S("Or", "flowchart", 64, 64, "cross-circ", "either plus", true),
  loopLimit: S("Loop limit", "flowchart", 160, 64, "notch-pent", "repeat loop"),
  card: S("Punched card", "flowchart", 144, 72, "notch-rect", "card"),
  paperTape: S("Paper tape", "flowchart", 160, 72, "flag", "tape"),
  directData: S("Direct access storage", "flowchart", 176, 72, "h-cyl", "drum disk horizontal cylinder"),
  annotation: S("Annotation", "notes", 160, 64, "brace", "comment remark bracket"),
  rectangle: S("Rectangle", "basic", 160, 96, "rect", "square box"),
  rounded: S("Rounded rectangle", "basic", 160, 96, "rounded", "box soft"),
  ellipse: S("Ellipse", "basic", 160, 96, "circle", "oval"),
  triangle: S("Triangle", "basic", 112, 96, "tri", "pyramid"),
  rightTriangle: S("Right triangle", "basic", 112, 96, "tri", "corner"),
  diamond: S("Diamond", "basic", 120, 120, "diam", "rhombus"),
  hexagon: S("Hexagon", "basic", 144, 120, "hex", "six"),
  octagon: S("Octagon", "basic", 120, 120, "rect", "stop eight", true),
  pentagon: S("Pentagon", "basic", 120, 112, "rect", "five"),
  parallelogram: S("Parallelogram", "basic", 176, 80, "lean-r", "slant"),
  trapezoid: S("Trapezoid", "basic", 176, 80, "trap-b", "trapezium"),
  star: S("Star", "basic", 120, 116, "rect", "favourite rating"),
  cross: S("Cross", "basic", 104, 104, "rect", "plus add", true),
  arrowRight: S("Arrow right", "basic", 160, 80, "rect", "direction next"),
  arrowLeft: S("Arrow left", "basic", 160, 80, "rect", "direction back"),
  arrowUp: S("Arrow up", "basic", 80, 160, "rect", "direction"),
  arrowDown: S("Arrow down", "basic", 80, 160, "rect", "direction"),
  doubleArrow: S("Double arrow", "basic", 176, 80, "rect", "both ways"),
  chevron: S("Chevron", "basic", 160, 72, "rect", "step stage"),
  callout: S("Callout", "basic", 176, 104, "rounded", "speech bubble comment say"),
  cloud: S("Cloud", "basic", 176, 112, "rounded", "internet server weather"),
  cylinder: S("Cylinder", "basic", 120, 104, "cyl", "tube can"),
};

/** Default size for a new node of each shape. */
export const FLOWCHART_SHAPE_SIZE = Object.fromEntries(FLOWCHART_SHAPES.map((s) => [s, { w: FLOWCHART_SHAPE_INFO[s].w, h: FLOWCHART_SHAPE_INFO[s].h }])) as Record<FlowShape, { w: number; h: number }>;
export const FLOWCHART_SHAPE_LABEL = Object.fromEntries(FLOWCHART_SHAPES.map((s) => [s, FLOWCHART_SHAPE_INFO[s].label])) as Record<FlowShape, string>;

/** Shapes matching a search in the shape panel (label, then keywords), in catalog order. */
export function searchFlowShapes(query: string, group?: FlowShapeGroup): FlowShape[] {
  const q = query.trim().toLowerCase();
  const all = FLOWCHART_SHAPES.filter((s) => !group || FLOWCHART_SHAPE_INFO[s].group === group);
  if (!q) return [...all];
  const words = q.split(/\s+/);
  const score = (s: FlowShape) => {
    const info = FLOWCHART_SHAPE_INFO[s];
    const label = info.label.toLowerCase();
    const hay = `${label} ${info.keywords} ${s.toLowerCase()}`;
    if (!words.every((w) => hay.includes(w))) return -1;
    return label.startsWith(q) ? 2 : label.includes(q) ? 1 : 0;
  };
  return all
    .map((s, i) => ({ s, i, k: score(s) }))
    .filter((x) => x.k >= 0)
    .sort((a, b) => b.k - a.k || a.i - b.i)
    .map((x) => x.s);
}

// ------------------------------------------------------------------------------------------ path ops

type Op = ["M", number, number] | ["L", number, number] | ["Q", number, number, number, number] | ["C", number, number, number, number, number, number] | ["Z"];

const K = 0.5523; // cubic approximation of a quarter circle

class P {
  ops: Op[] = [];
  m(x: number, y: number) {
    this.ops.push(["M", x, y]);
    return this;
  }
  l(x: number, y: number) {
    this.ops.push(["L", x, y]);
    return this;
  }
  q(cx: number, cy: number, x: number, y: number) {
    this.ops.push(["Q", cx, cy, x, y]);
    return this;
  }
  c(a: number, b: number, c: number, d: number, x: number, y: number) {
    this.ops.push(["C", a, b, c, d, x, y]);
    return this;
  }
  z() {
    this.ops.push(["Z"]);
    return this;
  }
  /** A rounded rectangle (corners drawn as quarter circles). */
  rect(x: number, y: number, w: number, h: number, r = 0) {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    if (!rr) return this.m(x, y).l(x + w, y).l(x + w, y + h).l(x, y + h).z();
    const k = rr * (1 - K);
    this.m(x + rr, y).l(x + w - rr, y).c(x + w - k, y, x + w, y + k, x + w, y + rr);
    this.l(x + w, y + h - rr).c(x + w, y + h - k, x + w - k, y + h, x + w - rr, y + h);
    this.l(x + rr, y + h).c(x + k, y + h, x, y + h - k, x, y + h - rr);
    return this.l(x, y + rr).c(x, y + k, x + k, y, x + rr, y).z();
  }
  ellipse(cx: number, cy: number, rx: number, ry: number) {
    const kx = rx * K;
    const ky = ry * K;
    this.m(cx - rx, cy).c(cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry).c(cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy);
    return this.c(cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry).c(cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy).z();
  }
  /** A closed polygon with softened corners (quadratic curves `r` from each corner). */
  poly(pts: readonly (readonly [number, number])[], r = 0) {
    if (!r) {
      pts.forEach(([x, y], i) => (i ? this.l(x, y) : this.m(x, y)));
      return this.z();
    }
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      const prev = pts[(i + pts.length - 1) % pts.length]!;
      const next = pts[(i + 1) % pts.length]!;
      const a = toward(p, prev, r);
      const b = toward(p, next, r);
      if (i === 0) this.m(a[0], a[1]);
      else this.l(a[0], a[1]);
      this.q(p[0], p[1], b[0], b[1]);
    }
    return this.z();
  }
  /** An open polyline (details). */
  line(pts: readonly (readonly [number, number])[]) {
    pts.forEach(([x, y], i) => (i ? this.l(x, y) : this.m(x, y)));
    return this;
  }
}

function toward(from: readonly [number, number], to: readonly [number, number], dist: number): [number, number] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  const d = Math.min(dist, len / 2);
  return [from[0] + (dx / len) * d, from[1] + (dy / len) * d];
}

const r1 = (n: number) => Math.round(n * 10) / 10;

function opsToSvg(ops: readonly Op[], ox: number, oy: number): string {
  let d = "";
  for (const op of ops) {
    switch (op[0]) {
      case "M":
      case "L":
        d += `${op[0]}${r1(op[1] + ox)} ${r1(op[2] + oy)}`;
        break;
      case "Q":
        d += `Q${r1(op[1] + ox)} ${r1(op[2] + oy)} ${r1(op[3] + ox)} ${r1(op[4] + oy)}`;
        break;
      case "C":
        d += `C${r1(op[1] + ox)} ${r1(op[2] + oy)} ${r1(op[3] + ox)} ${r1(op[4] + oy)} ${r1(op[5] + ox)} ${r1(op[6] + oy)}`;
        break;
      case "Z":
        d += "Z";
        break;
    }
  }
  return d;
}

/** Flattens closed sub-paths into polygons (curves sampled). */
function opsToPolygons(ops: readonly Op[], steps = 8): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  let last: Pt = { x: 0, y: 0 };
  for (const op of ops) {
    switch (op[0]) {
      case "M":
        if (cur.length > 2) out.push(cur);
        cur = [{ x: op[1], y: op[2] }];
        last = cur[0]!;
        break;
      case "L":
        last = { x: op[1], y: op[2] };
        cur.push(last);
        break;
      case "Q": {
        const p0 = last;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const u = 1 - t;
          cur.push({ x: u * u * p0.x + 2 * u * t * op[1] + t * t * op[3], y: u * u * p0.y + 2 * u * t * op[2] + t * t * op[4] });
        }
        last = { x: op[3], y: op[4] };
        break;
      }
      case "C": {
        const p0 = last;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const u = 1 - t;
          cur.push({
            x: u * u * u * p0.x + 3 * u * u * t * op[1] + 3 * u * t * t * op[3] + t * t * t * op[5],
            y: u * u * u * p0.y + 3 * u * u * t * op[2] + 3 * u * t * t * op[4] + t * t * t * op[6],
          });
        }
        last = { x: op[5], y: op[6] };
        break;
      }
      case "Z":
        if (cur.length > 2) out.push(cur);
        cur = [];
        break;
    }
  }
  if (cur.length > 2) out.push(cur);
  return out;
}

// ------------------------------------------------------------------------------------------ geometry

interface Geometry {
  outline: Op[];
  /** Stroke-only lines drawn over the fill. */
  details: Op[];
  /** Filled and stroked copies drawn behind the outline (stacked documents). */
  back: Op[][];
  /** No outline drawn (text, annotation): only details and text show. */
  bare?: boolean;
  /** Connection points sit on the bounding box rather than the outline. */
  boxPorts?: boolean;
}

/** The horizontal lean of an input/output parallelogram. */
export function ioSkew(node: { w: number; h: number }): number {
  return Math.min(22, node.h * 0.34, node.w * 0.2);
}

function docWave(w: number, h: number) {
  return Math.min(10, h * 0.1);
}

function geometry(shape: FlowShape, w: number, h: number): Geometry {
  const p = new P();
  const d = new P();
  const g = (extra: Partial<Geometry> = {}): Geometry => ({ outline: p.ops, details: d.ops, back: [], ...extra });
  switch (shape) {
    case "process":
      p.rect(0, 0, w, h, 10);
      return g();
    case "decision":
      p.poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]], Math.min(8, w / 10, h / 10));
      return g();
    case "terminator":
      p.rect(0, 0, w, h, Math.min(h, w) / 2);
      return g();
    case "io": {
      const s = ioSkew({ w, h });
      p.poly([[s, 0], [w, 0], [w - s, h], [0, h]], 6);
      return g();
    }
    case "circle":
    case "ellipse":
    case "connector":
      p.ellipse(w / 2, h / 2, w / 2, h / 2);
      return g();
    case "note":
      p.rect(0, 0, w, h, 4);
      d.m(w - 14, h).l(w, h - 14);
      return g();
    case "text":
      p.rect(0, 0, w, h, 6);
      return g({ bare: true });
    case "document": {
      const k = docWave(w, h);
      p.m(0, 0).l(w, 0).l(w, h - k).c(w * 0.7, h - 3 * k, w * 0.3, h + k, 0, h - k).z();
      return g();
    }
    case "documents": {
      const o = Math.min(8, w * 0.05, h * 0.08);
      const k = docWave(w - 2 * o, h - 2 * o);
      const doc = (x: number, y: number, dw: number, dh: number) => {
        const q = new P();
        q.m(x, y).l(x + dw, y).l(x + dw, y + dh - k).c(x + dw * 0.7, y + dh - 3 * k, x + dw * 0.3, y + dh + k, x, y + dh - k).z();
        return q.ops;
      };
      const back = [doc(2 * o, 0, w - 2 * o, h - 2 * o), doc(o, o, w - 2 * o, h - 2 * o)];
      p.ops = doc(0, 2 * o, w - 2 * o, h - 2 * o);
      return g({ back, boxPorts: true });
    }
    case "database":
    case "cylinder": {
      const ry = Math.min(h * 0.15, 14, w * 0.25);
      const kx = (w / 2) * K;
      const ky = ry * K;
      p.m(0, ry).l(0, h - ry).c(0, h - ry + ky, w / 2 - kx, h, w / 2, h).c(w / 2 + kx, h, w, h - ry + ky, w, h - ry);
      p.l(w, ry).c(w, ry - ky, w / 2 + kx, 0, w / 2, 0).c(w / 2 - kx, 0, 0, ry - ky, 0, ry).z();
      d.m(0, ry).c(0, ry + ky, w / 2 - kx, 2 * ry, w / 2, 2 * ry).c(w / 2 + kx, 2 * ry, w, ry + ky, w, ry);
      return g();
    }
    case "directData": {
      const rx = Math.min(w * 0.12, 14, h * 0.25);
      const kx = rx * K;
      const ky = (h / 2) * K;
      p.m(rx, 0).l(w - rx, 0).c(w - rx + kx, 0, w, h / 2 - ky, w, h / 2).c(w, h / 2 + ky, w - rx + kx, h, w - rx, h);
      p.l(rx, h).c(rx - kx, h, 0, h / 2 + ky, 0, h / 2).c(0, h / 2 - ky, rx - kx, 0, rx, 0).z();
      d.m(w - rx, 0).c(w - rx - kx, 0, w - 2 * rx, h / 2 - ky, w - 2 * rx, h / 2).c(w - 2 * rx, h / 2 + ky, w - rx - kx, h, w - rx, h);
      return g();
    }
    case "storedData": {
      const r = Math.min(w * 0.15, h * 0.3);
      p.m(r, 0).l(w, 0).q(w - 2 * r, h / 2, w, h).l(r, h).q(-r, h / 2, r, 0).z();
      return g();
    }
    case "manualInput":
      p.poly([[0, h * 0.28], [w, 0], [w, h], [0, h]], 4);
      return g();
    case "manualOperation": {
      const s = Math.min(w * 0.15, h * 0.5);
      p.poly([[0, 0], [w, 0], [w - s, h], [s, h]], 4);
      return g();
    }
    case "predefined": {
      const b = Math.min(12, w * 0.08);
      p.rect(0, 0, w, h, 3);
      d.m(b, 0).l(b, h).m(w - b, 0).l(w - b, h);
      return g();
    }
    case "delay": {
      const r = Math.min(h / 2, w / 2);
      const k = r * K;
      p.m(0, 0).l(w - r, 0).c(w - r + k, 0, w, h / 2 - k, w, h / 2).c(w, h / 2 + k, w - r + k, h, w - r, h).l(0, h).z();
      return g();
    }
    case "preparation": {
      const s = Math.min(h * 0.35, w * 0.25);
      p.poly([[s, 0], [w - s, 0], [w, h / 2], [w - s, h], [s, h], [0, h / 2]], 4);
      return g();
    }
    case "hexagon": {
      const s = w * 0.25;
      p.poly([[s, 0], [w - s, 0], [w, h / 2], [w - s, h], [s, h], [0, h / 2]], 4);
      return g();
    }
    case "merge":
      p.poly([[0, 0], [w, 0], [w / 2, h]], 4);
      return g();
    case "extract":
    case "triangle":
      p.poly([[w / 2, 0], [w, h], [0, h]], 4);
      return g();
    case "rightTriangle":
      p.poly([[0, 0], [w, h], [0, h]], 3);
      return g();
    case "offPage":
      p.poly([[0, 0], [w, 0], [w, h * 0.62], [w / 2, h], [0, h * 0.62]], 4);
      return g();
    case "display": {
      const s = Math.min(w * 0.15, h * 0.5);
      const r = Math.min(w * 0.18, h * 0.5);
      p.m(0, h / 2).l(s, 0).l(w - r, 0).c(w - r * 0.45, 0, w, h * 0.25, w, h / 2).c(w, h * 0.75, w - r * 0.45, h, w - r, h).l(s, h).z();
      return g();
    }
    case "internalStorage": {
      const b = Math.min(14, h * 0.22, w * 0.15);
      p.rect(0, 0, w, h, 3);
      d.m(0, b).l(w, b).m(b, 0).l(b, h);
      return g();
    }
    case "sort":
      p.poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]], Math.min(6, w / 10, h / 10));
      d.m(0, h / 2).l(w, h / 2);
      return g();
    case "diamond":
      p.poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]], Math.min(4, w / 10, h / 10));
      return g();
    case "collate":
      p.poly([[0, 0], [w, 0], [w / 2, h / 2], [w, h], [0, h], [w / 2, h / 2]], 3);
      return g();
    case "summingJunction": {
      p.ellipse(w / 2, h / 2, w / 2, h / 2);
      const c = Math.SQRT1_2;
      d.m(w / 2 - (w / 2) * c, h / 2 - (h / 2) * c).l(w / 2 + (w / 2) * c, h / 2 + (h / 2) * c);
      d.m(w / 2 + (w / 2) * c, h / 2 - (h / 2) * c).l(w / 2 - (w / 2) * c, h / 2 + (h / 2) * c);
      return g();
    }
    case "or":
      p.ellipse(w / 2, h / 2, w / 2, h / 2);
      d.m(w / 2, 0).l(w / 2, h).m(0, h / 2).l(w, h / 2);
      return g();
    case "loopLimit": {
      const c = Math.min(14, h * 0.3, w * 0.2);
      p.poly([[c, 0], [w - c, 0], [w, c], [w, h], [0, h], [0, c]], 3);
      return g();
    }
    case "card": {
      const c = Math.min(18, h * 0.35, w * 0.2);
      p.poly([[c, 0], [w, 0], [w, h], [0, h], [0, c]], 3);
      return g();
    }
    case "paperTape": {
      const k = Math.min(10, h * 0.12);
      p.m(0, k).c(w * 0.3, -k, w * 0.7, 3 * k, w, k).l(w, h - k).c(w * 0.7, h + k, w * 0.3, h - 3 * k, 0, h - k).z();
      return g();
    }
    case "annotation":
      p.rect(0, 0, w, h, 0);
      d.m(Math.min(14, w * 0.2), 0).l(0, 0).l(0, h).l(Math.min(14, w * 0.2), h);
      return g({ bare: true });
    case "rectangle":
      p.rect(0, 0, w, h, 0);
      return g();
    case "rounded":
      p.rect(0, 0, w, h, Math.min(20, h / 4, w / 4));
      return g();
    case "octagon": {
      const c = Math.min(w, h) * 0.29;
      p.poly([[c, 0], [w - c, 0], [w, c], [w, h - c], [w - c, h], [c, h], [0, h - c], [0, c]], 3);
      return g();
    }
    case "pentagon":
      p.poly([[w / 2, 0], [w, h * 0.38], [w * 0.81, h], [w * 0.19, h], [0, h * 0.38]], 4);
      return g();
    case "parallelogram": {
      const s = Math.min(w * 0.25, h * 0.6);
      p.poly([[s, 0], [w, 0], [w - s, h], [0, h]], 4);
      return g();
    }
    case "trapezoid": {
      const s = Math.min(w * 0.2, h * 0.6);
      p.poly([[s, 0], [w - s, 0], [w, h], [0, h]], 4);
      return g();
    }
    case "star": {
      const pts: [number, number][] = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 ? 0.4 : 1;
        pts.push([w / 2 + (w / 2) * r * Math.cos(a), h * 0.55 + h * 0.55 * r * Math.sin(a)]);
      }
      // The star's points reach the box (the lowest points sit at y = h).
      const minY = Math.min(...pts.map((q) => q[1]));
      const maxY = Math.max(...pts.map((q) => q[1]));
      p.poly(pts.map(([x, y]) => [x, ((y - minY) / (maxY - minY)) * h] as [number, number]), 2);
      return g();
    }
    case "cross": {
      const tx = w / 3;
      const ty = h / 3;
      p.poly([[tx, 0], [w - tx, 0], [w - tx, ty], [w, ty], [w, h - ty], [w - tx, h - ty], [w - tx, h], [tx, h], [tx, h - ty], [0, h - ty], [0, ty], [tx, ty]], 2);
      return g();
    }
    case "arrowRight":
    case "arrowLeft":
    case "arrowUp":
    case "arrowDown": {
      const vertical = shape === "arrowUp" || shape === "arrowDown";
      const L = vertical ? h : w;
      const T = vertical ? w : h;
      const hd = Math.min(L * 0.4, T * 0.6);
      let pts: [number, number][] = [[0, T * 0.25], [L - hd, T * 0.25], [L - hd, 0], [L, T / 2], [L - hd, T], [L - hd, T * 0.75], [0, T * 0.75]];
      if (shape === "arrowLeft") pts = pts.map(([x, y]) => [L - x, y]);
      if (shape === "arrowDown") pts = pts.map(([x, y]) => [y, x]);
      if (shape === "arrowUp") pts = pts.map(([x, y]) => [y, L - x]);
      p.poly(pts, 2);
      return g();
    }
    case "doubleArrow": {
      const hd = Math.min(w * 0.3, h * 0.6);
      p.poly([[0, h / 2], [hd, 0], [hd, h * 0.25], [w - hd, h * 0.25], [w - hd, 0], [w, h / 2], [w - hd, h], [w - hd, h * 0.75], [hd, h * 0.75], [hd, h]], 2);
      return g();
    }
    case "chevron": {
      const c = Math.min(w * 0.3, h * 0.5);
      p.poly([[0, 0], [w - c, 0], [w, h / 2], [w - c, h], [0, h], [c, h / 2]], 3);
      return g();
    }
    case "callout": {
      const r = Math.min(10, w / 6, h / 6);
      const bh = h * 0.8;
      const k = r * (1 - K);
      p.m(r, 0).l(w - r, 0).c(w - k, 0, w, k, w, r).l(w, bh - r).c(w, bh - k, w - k, bh, w - r, bh);
      p.l(w * 0.38, bh).l(w * 0.16, h).l(w * 0.22, bh).l(r, bh).c(k, bh, 0, bh - k, 0, bh - r).l(0, r).c(0, k, k, 0, r, 0).z();
      return g();
    }
    case "cloud": {
      // A cloud of five bumps, drawn in a unit box and scaled to the node.
      const u = (x: number, y: number): [number, number] => [x * w, y * h];
      const pts: [number, number][][] = [
        [u(0.24, 0.94), u(0.08, 0.94), u(0, 0.8), u(0.03, 0.66)],
        [u(0.03, 0.66), u(-0.02, 0.47), u(0.12, 0.31), u(0.28, 0.35)],
        [u(0.28, 0.35), u(0.3, 0.1), u(0.56, -0.02), u(0.66, 0.2)],
        [u(0.66, 0.2), u(0.8, 0.06), u(1.0, 0.2), u(0.94, 0.42)],
        [u(0.94, 0.42), u(1.04, 0.52), u(1.02, 0.8), u(0.86, 0.86)],
        [u(0.86, 0.86), u(0.82, 1.0), u(0.62, 1.02), u(0.54, 0.92)],
        [u(0.54, 0.92), u(0.44, 1.02), u(0.3, 1.0), u(0.24, 0.94)],
      ];
      p.m(pts[0]![0]![0], pts[0]![0]![1]);
      for (const [, c1, c2, e] of pts) p.c(c1![0], c1![1], c2![0], c2![1], e![0], e![1]);
      p.z();
      return g();
    }
  }
}

// Outlines are asked for many times per frame (ports, hit tests, routing); a small cache keeps that cheap.
const polyCache = new Map<string, Pt[]>();
function outlineLocal(shape: FlowShape, w: number, h: number): Pt[] {
  const key = `${shape}:${r1(w)}:${r1(h)}`;
  let poly = polyCache.get(key);
  if (!poly) {
    const geo = geometry(shape, w, h);
    poly = geo.boxPorts || geo.bare ? [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }] : (opsToPolygons(geo.outline)[0] ?? []);
    if (polyCache.size > 2000) polyCache.clear();
    polyCache.set(key, poly);
  }
  return poly;
}

type Box = Pick<Rect, "x" | "y" | "w" | "h"> & { shape: FlowShape };

/** SVG path for a node's outline. */
export function shapePath(n: Box): string {
  return opsToSvg(geometry(n.shape, n.w, n.h).outline, n.x, n.y);
}

/** Stroke-only lines inside a shape ("" when it has none). */
export function shapeDetailPath(n: Box): string {
  return opsToSvg(geometry(n.shape, n.w, n.h).details, n.x, n.y);
}

/** Copies drawn behind a shape (stacked documents), back to front. */
export function shapeBackPaths(n: Box): string[] {
  return geometry(n.shape, n.w, n.h).back.map((ops) => opsToSvg(ops, n.x, n.y));
}

/** Whether the shape draws no outline of its own (free text, annotations). */
export function isBareShape(shape: FlowShape): boolean {
  return shape === "text" || shape === "annotation";
}

/** The node's outline as a polygon (curves sampled), in chart coordinates. */
export function shapeOutline(n: Box): Pt[] {
  return outlineLocal(n.shape, n.w, n.h).map((p) => ({ x: p.x + n.x, y: p.y + n.y }));
}

/** Whether a point is inside the node's outline. */
export function pointInShape(n: Box, p: Pt): boolean {
  if (p.x < n.x || p.y < n.y || p.x > n.x + n.w || p.y > n.y + n.h) return false;
  const poly = outlineLocal(n.shape, n.w, n.h);
  const x = p.x - n.x;
  const y = p.y - n.y;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export type FlowSide = "top" | "right" | "bottom" | "left";

/**
 * How far along each side connectors may spread (the middle fraction of the side). Round and pointed
 * shapes keep their connectors closer to the tip so lines meet the outline squarely.
 */
export function shapeSpread(shape: FlowShape, side: FlowSide): number {
  switch (shape) {
    case "decision":
    case "diamond":
    case "sort":
    case "circle":
    case "ellipse":
    case "connector":
    case "summingJunction":
    case "or":
    case "star":
      return 0.4;
    case "triangle":
    case "extract":
      return side === "bottom" ? 0.8 : 0.4;
    case "merge":
      return side === "top" ? 0.8 : 0.4;
    case "terminator":
      return side === "left" || side === "right" ? 0.3 : 0.7;
    case "offPage":
      return side === "bottom" ? 0.4 : 0.8;
    default:
      return 0.8;
  }
}

/**
 * Where a line straight in from side `side` at position `t` (0…1 along that side of the bounding box,
 * left to right or top to bottom) first meets the outline. The point a connector attaches to.
 */
export function outlinePoint(n: Box, side: FlowSide, t: number): Pt {
  const poly = outlineLocal(n.shape, n.w, n.h);
  const horizontal = side === "top" || side === "bottom";
  const along = Math.max(0, Math.min(1, t)) * (horizontal ? n.w : n.h);
  let best: number | null = null;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j]!;
    const b = poly[i]!;
    const [a0, a1, b0, b1] = horizontal ? [a.x, a.y, b.x, b.y] : [a.y, a.x, b.y, b.x];
    if ((a0 <= along && b0 >= along) || (b0 <= along && a0 >= along)) {
      const depth = a0 === b0 ? (side === "top" || side === "left" ? Math.min(a1, b1) : Math.max(a1, b1)) : a1 + ((along - a0) / (b0 - a0)) * (b1 - a1);
      if (best === null || (side === "top" || side === "left" ? depth < best : depth > best)) best = depth;
    }
  }
  const fallback = side === "top" || side === "left" ? 0 : horizontal ? n.h : n.w;
  const depth = best ?? fallback;
  return horizontal ? { x: n.x + along, y: n.y + depth } : { x: n.x + depth, y: n.y + along };
}

/**
 * The box a shape's label wraps in, relative to the node's top-left. The v1 shapes keep the widths they
 * always had, so existing charts break their lines in the same places.
 */
export function shapeTextBox(shape: FlowShape, w: number, h: number): Rect {
  const box = (x0: number, y0: number, x1: number, y1: number): Rect => ({ x: x0, y: y0, w: Math.max(8, x1 - x0), h: Math.max(8, y1 - y0) });
  const centred = (tw: number, th: number, cy = h / 2) => box(w / 2 - tw / 2, cy - th / 2, w / 2 + tw / 2, cy + th / 2);
  switch (shape) {
    case "process":
    case "rectangle":
    case "rounded":
      return centred(w - 24, h - 12);
    case "note":
      return box(12, 10, w - 12, h - 10);
    case "decision":
    case "diamond":
    case "sort":
      return centred(w * 0.58 - 6, h * 0.6);
    case "terminator":
      return centred(w - Math.min(h, w) * 0.6 - 8, h - 8);
    case "io":
      return centred(w - 2 * ioSkew({ w, h }) - 12, h - 8);
    case "circle":
    case "ellipse":
    case "connector":
    case "summingJunction":
    case "or":
      return centred(w * 0.7, h * 0.7);
    case "text":
      return centred(w - 8, h - 4);
    case "annotation":
      return box(Math.min(14, w * 0.2) + 6, 4, w - 4, h - 4);
    case "document": {
      const k = docWave(w, h);
      return box(12, 6, w - 12, h - 2 * k - 2);
    }
    case "documents": {
      const o = Math.min(8, w * 0.05, h * 0.08);
      const k = docWave(w - 2 * o, h - 2 * o);
      return box(12, 2 * o + 6, w - 2 * o - 12, h - 2 * k - 2);
    }
    case "database":
    case "cylinder": {
      const ry = Math.min(h * 0.15, 14, w * 0.25);
      return box(10, 2 * ry + 4, w - 10, h - ry - 4);
    }
    case "directData": {
      const rx = Math.min(w * 0.12, 14, h * 0.25);
      return box(rx + 8, 6, w - 2 * rx - 6, h - 6);
    }
    case "storedData": {
      const r = Math.min(w * 0.15, h * 0.3);
      return box(r + 6, 6, w - r - 8, h - 6);
    }
    case "manualInput":
      return box(12, h * 0.28 + 2, w - 12, h - 6);
    case "manualOperation": {
      const s = Math.min(w * 0.15, h * 0.5);
      return box(s + 6, 6, w - s - 6, h - 6);
    }
    case "predefined": {
      const b = Math.min(12, w * 0.08);
      return box(b + 8, 6, w - b - 8, h - 6);
    }
    case "delay":
      return box(12, 6, w - Math.min(h / 2, w / 2) * 0.5 - 8, h - 6);
    case "preparation": {
      const s = Math.min(h * 0.35, w * 0.25);
      return box(s * 0.8, 6, w - s * 0.8, h - 6);
    }
    case "hexagon":
      return box(w * 0.2, h * 0.12, w * 0.8, h * 0.88);
    case "merge":
      return box(w * 0.22, 4, w * 0.78, h * 0.5);
    case "extract":
    case "triangle":
      return box(w * 0.24, h * 0.45, w * 0.76, h - 6);
    case "rightTriangle":
      return box(6, h * 0.45, w * 0.55, h - 6);
    case "offPage":
      return box(8, 6, w - 8, h * 0.62);
    case "display": {
      const s = Math.min(w * 0.15, h * 0.5);
      return box(s + 4, 6, w - Math.min(w * 0.18, h * 0.5) * 0.6 - 6, h - 6);
    }
    case "internalStorage": {
      const b = Math.min(14, h * 0.22, w * 0.15);
      return box(b + 8, b + 4, w - 8, h - 6);
    }
    case "collate":
      return box(w * 0.3, h * 0.36, w * 0.7, h * 0.64);
    case "loopLimit":
    case "card":
      return box(10, Math.min(18, h * 0.35) * 0.6 + 4, w - 10, h - 6);
    case "paperTape": {
      const k = Math.min(10, h * 0.12);
      return box(10, 2 * k + 2, w - 10, h - 2 * k - 2);
    }
    case "octagon":
      return box(w * 0.14, h * 0.14, w * 0.86, h * 0.86);
    case "pentagon":
      return box(w * 0.2, h * 0.32, w * 0.8, h - 8);
    case "parallelogram": {
      const s = Math.min(w * 0.25, h * 0.6);
      return box(s * 0.7 + 4, 6, w - s * 0.7 - 4, h - 6);
    }
    case "trapezoid": {
      const s = Math.min(w * 0.2, h * 0.6);
      return box(s + 4, 6, w - s - 4, h - 6);
    }
    case "star":
      return box(w * 0.3, h * 0.36, w * 0.7, h * 0.76);
    case "cross":
      return box(w / 3 + 2, h / 3 + 2, w - w / 3 - 2, h - h / 3 - 2);
    case "arrowRight":
      return box(8, h * 0.25 + 2, w - Math.min(w * 0.4, h * 0.6) * 0.5, h * 0.75 - 2);
    case "arrowLeft":
      return box(Math.min(w * 0.4, h * 0.6) * 0.5, h * 0.25 + 2, w - 8, h * 0.75 - 2);
    case "arrowUp":
      return box(w * 0.25 + 2, Math.min(h * 0.4, w * 0.6) * 0.5, w * 0.75 - 2, h - 8);
    case "arrowDown":
      return box(w * 0.25 + 2, 8, w * 0.75 - 2, h - Math.min(h * 0.4, w * 0.6) * 0.5);
    case "doubleArrow": {
      const hd = Math.min(w * 0.3, h * 0.6);
      return box(hd * 0.6, h * 0.25 + 2, w - hd * 0.6, h * 0.75 - 2);
    }
    case "chevron": {
      const c = Math.min(w * 0.3, h * 0.5);
      return box(c + 4, 6, w - c - 4, h - 6);
    }
    case "callout":
      return box(12, 6, w - 12, h * 0.8 - 6);
    case "cloud":
      return box(w * 0.16, h * 0.3, w * 0.86, h * 0.84);
  }
}
