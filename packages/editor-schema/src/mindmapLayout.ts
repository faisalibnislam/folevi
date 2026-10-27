// Mind map layout: where every idea sits, worked out from the tree alone, so the editor, read-only pages,
// exports and the server all draw the same map. Nothing about positions is stored (mindmap.ts).
//
//   both   the central idea in the middle, main branches split between its right and left (a main
//          branch's `side` when it has one, otherwise balanced by height, keeping their order)
//   right  every main branch to the right of the centre
//   down   a tree from the top: children in a row under their parent
//
// A tidy tree: each idea is centred on the block of its children, siblings stack without overlapping, and
// children line up in one column (one row for "down") beside their parent. Collapsed ideas hide their
// branch and report how many ideas are inside. Text wraps with the same estimate of Instrument Sans that
// the flowchart uses (flowchart.ts measureFlowText), so lines break in the same places everywhere.
//
// Colours: a main branch takes the next automatic colour (MINDMAP_AUTO_COLORS, in order around the map)
// unless it names one; ideas under it inherit it unless they name their own. The centre is neutral.
import { measureFlowText, wrapFlowText } from "./flowchart";
import { mindmapChildren, mindmapRoot, type MindmapColor, type MindmapData, type MindmapLayout, type MindmapSide, type MindNode } from "./mindmap";

/** The colours main branches take in turn (each readable in light and dark; see the block's CSS). */
export const MINDMAP_AUTO_COLORS: readonly MindmapColor[] = ["blue", "green", "yellow", "pink", "purple", "accent"];

export const MINDMAP_COLOR_LABEL: Record<MindmapColor, string> = {
  neutral: "Grey",
  accent: "Accent",
  blue: "Blue",
  green: "Green",
  yellow: "Yellow",
  pink: "Pink",
  purple: "Purple",
};

/** What an empty idea shows (and is measured with). */
export const MINDMAP_PLACEHOLDER = "New idea";

/** How ideas look at each level: the centre, main branches, and everything deeper. */
export const MINDMAP_LEVELS = [
  { font: 17, weight: 600, padX: 18, padY: 11, maxText: 240, minW: 96 },
  { font: 15, weight: 600, padX: 14, padY: 8, maxText: 220, minW: 56 },
  { font: 14, weight: 500, padX: 10, padY: 6, maxText: 220, minW: 40 },
] as const;

export const mindmapLevel = (depth: number) => MINDMAP_LEVELS[Math.min(depth, MINDMAP_LEVELS.length - 1)]!;
export const mindmapLineHeight = (font: number) => Math.round(font * 1.35);

/** Space between a parent and its children's column, by the parent's depth (the centre gets more). */
const H_GAP = [64, 48, 40];
/** Space between stacked siblings, by their depth. */
const V_GAP = [0, 20, 10, 8];
/** "down": space between a parent's bottom and its children's row, and between siblings in a row. */
const DOWN_V_GAP = [64, 52, 44];
const DOWN_H_GAP = [0, 28, 16, 12];
const gap = (list: readonly number[], depth: number) => list[Math.min(depth, list.length - 1)]!;

/** Lines in an idea, at most this many (the rest end in "…"). */
const MAX_LINES = 8;

export interface MindBox {
  id: string;
  parent: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Levels from the centre of what's shown (0 for the centre, or for the focused idea). */
  depth: number;
  lines: string[];
  font: number;
  weight: number;
  lineHeight: number;
  /** Which way its branch grows. */
  side: "left" | "right" | "down";
  /** The idea's colour, inherited or automatic. */
  color: MindmapColor;
  /** Shown children. */
  children: string[];
  /** Has children (shown or not). */
  hasChildren: boolean;
  /** Collapsed: how many ideas are inside (0 otherwise). */
  hidden: number;
  /** The text is empty (the placeholder shows). */
  empty: boolean;
}

export interface MindLink {
  from: string;
  to: string;
  /** An SVG path from the parent to the child. */
  d: string;
  color: MindmapColor;
  /** The child's depth (main branches draw thicker). */
  depth: number;
}

export interface MindLayoutResult {
  rootId: string | null;
  boxes: MindBox[];
  byId: Map<string, MindBox>;
  links: MindLink[];
  /** Around every idea (and the room badges and buttons need beside them), or null when empty. */
  bounds: { x: number; y: number; w: number; h: number } | null;
  layout: MindmapLayout;
}

/** An idea's wrapped lines and size at a depth. */
export function mindNodeSize(text: string, depth: number): { lines: string[]; w: number; h: number; font: number; weight: number; lineHeight: number } {
  const lv = mindmapLevel(depth);
  const shown = text.trim() ? text : MINDMAP_PLACEHOLDER;
  // Semibold text runs a little wider than the estimate (made for weight 500).
  const widen = lv.weight >= 600 ? 1.05 : 1;
  const lines = wrapFlowText(shown, lv.maxText / widen, lv.font, MAX_LINES);
  const textW = Math.max(...lines.map((l) => measureFlowText(l, lv.font) * widen), 0);
  const lineHeight = mindmapLineHeight(lv.font);
  return {
    lines,
    w: Math.ceil(Math.max(lv.minW, textW + lv.padX * 2)),
    h: Math.ceil(lines.length * lineHeight + lv.padY * 2),
    font: lv.font,
    weight: lv.weight,
    lineHeight,
  };
}

/** Each idea's colour: its own, else its nearest coloured ancestor's (below the centre), else its branch's turn. */
export function mindmapColors(map: MindmapData): Map<string, MindmapColor> {
  const out = new Map<string, MindmapColor>();
  const root = mindmapRoot(map);
  if (!root) return out;
  const kids = mindmapChildren(map);
  out.set(root.id, root.color ?? "neutral");
  const walk = (n: MindNode, inherited: MindmapColor) => {
    for (const c of kids.get(n.id) ?? []) {
      const color = c.color ?? inherited;
      out.set(c.id, color);
      walk(c, color);
    }
  };
  (kids.get(root.id) ?? []).forEach((b, i) => {
    const color = b.color ?? MINDMAP_AUTO_COLORS[i % MINDMAP_AUTO_COLORS.length]!;
    out.set(b.id, color);
    walk(b, color);
  });
  return out;
}

/** How many ideas are under one (all levels). */
export function mindmapDescendants(map: MindmapData, id: string, kids = mindmapChildren(map)): number {
  let n = 0;
  const stack = [...(kids.get(id) ?? [])];
  while (stack.length) {
    const c = stack.pop()!;
    n++;
    stack.push(...(kids.get(c.id) ?? []));
  }
  return n;
}

/**
 * Which side each main branch takes in the "both" layout: its own `side` when it has one; the rest keep
 * their order, the first ones to the right and the others to the left, split where the two sides' heights
 * come closest (more on the right when it's even).
 */
export function mindmapSides(branches: { id: string; side?: MindmapSide; height: number }[]): Map<string, MindmapSide> {
  const out = new Map<string, MindmapSide>();
  let right = 0;
  let left = 0;
  const auto: { id: string; height: number }[] = [];
  for (const b of branches) {
    if (b.side === "left") {
      left += b.height;
      out.set(b.id, "left");
    } else if (b.side === "right") {
      right += b.height;
      out.set(b.id, "right");
    } else auto.push(b);
  }
  const total = auto.reduce((s, b) => s + b.height, 0);
  let best = 0;
  let bestDiff = Infinity;
  let run = 0;
  for (let k = 0; k <= auto.length; k++) {
    if (k > 0) run += auto[k - 1]!.height;
    const diff = Math.abs(right + run - (left + total - run));
    // Ties go to the larger k (more on the right).
    if (diff <= bestDiff) {
      bestDiff = diff;
      best = k;
    }
  }
  auto.forEach((b, i) => out.set(b.id, i < best ? "right" : "left"));
  return out;
}

interface Item {
  node: MindNode;
  depth: number;
  size: ReturnType<typeof mindNodeSize>;
  kids: Item[];
  hidden: number;
  hasChildren: boolean;
  /** Extent across the direction of growth: height for left/right, width for down. */
  extent: number;
}

/**
 * Lays the map out. `focus` shows only that idea's branch, with the idea in the centre. `layout` overrides
 * the map's own (a preview of another layout).
 */
export function layoutMindmap(map: MindmapData, opts: { focus?: string | null; layout?: MindmapLayout } = {}): MindLayoutResult {
  const layout = opts.layout ?? map.layout;
  const empty: MindLayoutResult = { rootId: null, boxes: [], byId: new Map(), links: [], bounds: null, layout };
  const realRoot = mindmapRoot(map);
  if (!realRoot) return empty;
  const kids = mindmapChildren(map);
  const colors = mindmapColors(map);
  const top = (opts.focus && map.nodes.find((n) => n.id === opts.focus)) || realRoot;
  const down = layout === "down";

  // Sizes and extents, bottom up (iteratively deep maps stay within the depth limit anyway).
  const build = (node: MindNode, depth: number): Item => {
    const size = mindNodeSize(node.text, depth);
    const children = kids.get(node.id) ?? [];
    const collapsed = Boolean(node.collapsed) && children.length > 0 && depth > 0;
    const shown = collapsed ? [] : children.map((c) => build(c, depth + 1));
    const g = down ? gap(DOWN_H_GAP, depth + 1) : gap(V_GAP, depth + 1);
    const block = shown.reduce((s, k) => s + k.extent, 0) + g * Math.max(0, shown.length - 1);
    const own = down ? size.w : size.h;
    return {
      node,
      depth,
      size,
      kids: shown,
      hidden: collapsed ? mindmapDescendants(map, node.id, kids) : 0,
      hasChildren: children.length > 0,
      extent: Math.max(own, block),
    };
  };
  const root = build(top, 0);

  const boxes: MindBox[] = [];
  const links: MindLink[] = [];
  const box = (it: Item, x: number, y: number, side: MindBox["side"]): MindBox => {
    const b: MindBox = {
      id: it.node.id,
      parent: it.depth === 0 ? null : it.node.parent,
      x: Math.round(x),
      y: Math.round(y),
      w: it.size.w,
      h: it.size.h,
      depth: it.depth,
      lines: it.size.lines,
      font: it.size.font,
      weight: it.size.weight,
      lineHeight: it.size.lineHeight,
      side,
      color: colors.get(it.node.id) ?? "neutral",
      children: it.kids.map((k) => k.node.id),
      hasChildren: it.hasChildren,
      hidden: it.hidden,
      empty: !it.node.text.trim(),
    };
    boxes.push(b);
    return b;
  };
  const link = (p: MindBox, c: MindBox) => {
    let d: string;
    if (c.side === "down") {
      const x1 = p.x + p.w / 2;
      const y1 = p.y + p.h;
      const x2 = c.x + c.w / 2;
      const y2 = c.y;
      const dy = (y2 - y1) / 2;
      d = `M${r1(x1)} ${r1(y1)}C${r1(x1)} ${r1(y1 + dy)} ${r1(x2)} ${r1(y2 - dy)} ${r1(x2)} ${r1(y2)}`;
    } else {
      const right = c.side === "right";
      const x1 = right ? p.x + p.w : p.x;
      const y1 = p.y + p.h / 2;
      const x2 = right ? c.x : c.x + c.w;
      const y2 = c.y + c.h / 2;
      const dx = (x2 - x1) / 2;
      d = `M${r1(x1)} ${r1(y1)}C${r1(x1 + dx)} ${r1(y1)} ${r1(x2 - dx)} ${r1(y2)} ${r1(x2)} ${r1(y2)}`;
    }
    links.push({ from: p.id, to: c.id, d, color: c.color, depth: c.depth });
  };

  // One side of a horizontal tree: `edge` is the column's near edge (left edge going right, right edge going left).
  const placeH = (it: Item, edge: number, topY: number, side: "left" | "right"): MindBox => {
    const y = topY + it.extent / 2 - it.size.h / 2;
    const b = box(it, side === "right" ? edge : edge - it.size.w, y, side);
    placeKidsH(it, b, side);
    return b;
  };
  const placeKidsH = (it: Item, b: MindBox, side: "left" | "right", only?: Item[]) => {
    const list = only ?? it.kids;
    if (!list.length) return;
    const g = gap(V_GAP, it.depth + 1);
    const block = list.reduce((s, k) => s + k.extent, 0) + g * (list.length - 1);
    let y = b.y + b.h / 2 - block / 2;
    const edge = side === "right" ? b.x + b.w + gap(H_GAP, it.depth) : b.x - gap(H_GAP, it.depth);
    for (const k of list) {
      const c = placeH(k, edge, y, side);
      link(b, c);
      y += k.extent + g;
    }
  };
  const placeDown = (it: Item, leftX: number, y: number): MindBox => {
    const b = box(it, leftX + it.extent / 2 - it.size.w / 2, y, "down");
    if (it.kids.length) {
      const g = gap(DOWN_H_GAP, it.depth + 1);
      const block = it.kids.reduce((s, k) => s + k.extent, 0) + g * (it.kids.length - 1);
      let x = b.x + b.w / 2 - block / 2;
      const cy = b.y + b.h + gap(DOWN_V_GAP, it.depth);
      for (const k of it.kids) {
        const c = placeDown(k, x, cy);
        link(b, c);
        x += k.extent + g;
      }
    }
    return b;
  };

  if (down) {
    placeDown(root, -root.extent / 2, -root.size.h / 2);
  } else {
    const rb = box(root, -root.size.w / 2, -root.size.h / 2, "right");
    if (layout === "right") placeKidsH(root, rb, "right");
    else {
      const sides = mindmapSides(root.kids.map((k) => ({ id: k.node.id, side: k.node.side, height: k.extent })));
      const rightKids = root.kids.filter((k) => sides.get(k.node.id) === "right");
      const leftKids = root.kids.filter((k) => sides.get(k.node.id) === "left");
      placeKidsH(root, rb, "right", rightKids);
      placeKidsH(root, rb, "left", leftKids);
    }
  }

  // Bounds, with room for the collapse badge and the add button beside each idea.
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    const extra = b.hidden ? 34 : 0;
    x0 = Math.min(x0, b.x - (b.side === "left" ? extra : 0));
    x1 = Math.max(x1, b.x + b.w + (b.side === "right" && b.depth > 0 ? extra : 0));
    y0 = Math.min(y0, b.y);
    y1 = Math.max(y1, b.y + b.h + (b.side === "down" ? extra : 0));
  }
  return { rootId: top.id, boxes, byId: new Map(boxes.map((b) => [b.id, b])), links, bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, layout };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** The first baseline of an idea's text, and each line's offset from it, centred in its box. */
export function mindTextLayout(b: Pick<MindBox, "x" | "y" | "w" | "h" | "lines" | "font" | "lineHeight">): { x: number; y: number; dy: number } {
  const block = b.lines.length * b.lineHeight;
  return { x: b.x + b.w / 2, y: r1(b.y + b.h / 2 - block / 2 + b.lineHeight / 2 + b.font * 0.36), dy: b.lineHeight };
}

/** The point just outside an idea where its branch grows (for the collapse badge and the add button). */
export function mindOuterPoint(b: Pick<MindBox, "x" | "y" | "w" | "h" | "side" | "depth">, offset: number, rootSide: "left" | "right" = "right"): { x: number; y: number } {
  if (b.side === "down") return { x: b.x + b.w / 2, y: b.y + b.h + offset };
  const side = b.depth === 0 ? rootSide : b.side;
  return side === "right" ? { x: b.x + b.w + offset, y: b.y + b.h / 2 } : { x: b.x - offset, y: b.y + b.h / 2 };
}
