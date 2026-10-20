// Where the bar over the selected idea goes (MindmapView.tsx). Plain maths in the canvas's own pixels (after
// zoom and pan), so it can be tested: above the idea, else below it, else beside it on the side with more
// room, sliding along that side past whatever is in the way, else the nearest clear spot around it. It never covers another idea, the selected one,
// or the controls to keep clear (the add button, the fold toggle, the zoom bar); it stays inside the canvas
// below the card's toolbar. When nothing is clear (a crowded map zoomed in), it takes the spot covering least.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BarPlacement {
  x: number;
  y: number;
  /** Which way it went: above, below, beside, the nearest clear spot, or wherever covers least. */
  where: "above" | "below" | "right" | "left" | "near" | "fallback";
}

const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** True when the two rectangles share any area. */
export function intersects(a: Rect, b: Rect): boolean {
  return overlap(a, b) > 0;
}

export function placeIdeaBar(o: {
  /** The selected idea. */
  sel: Rect;
  /** The bar's size. */
  bar: { w: number; h: number };
  /** Every other idea on screen (and their count badges). */
  ideas: Rect[];
  /** Controls to keep clear: the add button, the fold toggle, the zoom bar. */
  avoid?: Rect[];
  /** The canvas. */
  view: { w: number; h: number };
  /** The highest the bar may sit (under the card's toolbar). */
  top?: number;
  /** Space between the bar and the idea. */
  gap?: number;
  /** Space kept from the canvas's edges. */
  margin?: number;
}): BarPlacement {
  const { sel, bar, view } = o;
  const gap = o.gap ?? 8;
  const margin = o.margin ?? 8;
  const minY = Math.max(margin, o.top ?? 0);
  const maxX = Math.max(margin, view.w - bar.w - margin);
  const maxY = Math.max(minY, view.h - bar.h - margin);
  // Everything the bar mustn't cover, a few pixels larger so it never touches them either.
  const pad = 2;
  const blocks = [sel, ...o.ideas, ...(o.avoid ?? [])].map((r) => ({ x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 }));
  const covered = (r: Rect) => blocks.reduce((s, b) => s + overlap(r, b), 0);
  const fits = (x: number, y: number) => x >= margin - 0.5 && x <= maxX + 0.5 && y >= minY - 0.5 && y <= maxY + 0.5;

  const cx = sel.x + sel.w / 2;
  const cy = sel.y + sel.h / 2;
  let best: { x: number; y: number; cost: number; dist: number } | null = null;
  const consider = (where: BarPlacement["where"], x: number, y: number): BarPlacement | null => {
    const at = { x: Math.round(x), y: Math.round(y), w: bar.w, h: bar.h };
    // Still beside its idea: sharing some of its span on the axis it slid along.
    const attached = where === "above" || where === "below" ? at.x < sel.x + sel.w && at.x + at.w > sel.x : at.y < sel.y + sel.h && at.y + at.h > sel.y;
    if (!fits(at.x, at.y) || !attached) return null;
    const cost = covered(at);
    if (cost === 0) return { x: at.x, y: at.y, where };
    const dist = Math.hypot(at.x + bar.w / 2 - cx, at.y + bar.h / 2 - cy);
    if (!best || cost < best.cost || (cost === best.cost && dist < best.dist)) best = { x: at.x, y: at.y, cost, dist };
    return null;
  };

  /** Positions along one axis: centred on the idea, then slid just past each block in the way, nearest first. */
  const slides = (centre: number, size: number, lo: number, hi: number, edges: number[]) => {
    const out = [centre - size / 2, ...edges].map((v) => Math.min(hi, Math.max(lo, v)));
    const first = out[0]!;
    return [first, ...out.slice(1).sort((a, b) => Math.abs(a - first) - Math.abs(b - first))];
  };

  // Above, then below: slide sideways along the idea past the blocks at that height.
  const rows: [BarPlacement["where"], number][] = [
    ["above", sel.y - gap - bar.h],
    ["below", sel.y + sel.h + gap],
  ];
  for (const [where, y0] of rows) {
    const y = Math.min(maxY, Math.max(minY, y0));
    const inRow = blocks.filter((b) => b.y < y + bar.h && b.y + b.h > y);
    const edges = inRow.flatMap((b) => [b.x + b.w + 1, b.x - bar.w - 1]);
    for (const x of slides(cx, bar.w, margin, maxX, edges)) {
      const hit = consider(where, x, y);
      if (hit) return hit;
    }
  }

  // Beside it, the roomier side first: slide up and down past the blocks in that column, and step out past
  // controls hugging the idea (its add button and fold toggle).
  const roomRight = view.w - (sel.x + sel.w);
  const roomLeft = sel.x;
  const sides: ("right" | "left")[] = roomRight >= roomLeft ? ["right", "left"] : ["left", "right"];
  for (const where of sides) {
    const near = (o.avoid ?? []).filter((a) => a.y < sel.y + sel.h && a.y + a.h > sel.y && (where === "right" ? a.x >= sel.x + sel.w - 1 : a.x + a.w <= sel.x + 1));
    const xs =
      where === "right"
        ? [sel.x + sel.w + gap, ...near.map((a) => a.x + a.w + gap)]
        : [sel.x - gap - bar.w, ...near.map((a) => a.x - gap - bar.w)];
    for (const x0 of xs) {
      const x = Math.min(maxX, Math.max(margin, x0));
      const inCol = blocks.filter((b) => b.x < x + bar.w && b.x + b.w > x);
      const edges = inCol.flatMap((b) => [b.y + b.h + 1, b.y - bar.h - 1]);
      for (const y of slides(cy, bar.h, minY, maxY, edges)) {
        const hit = consider(where, x, y);
        if (hit) return hit;
      }
    }
  }

  // Still nothing: the nearest clear spot around the idea (a corner, past its add button), within reach.
  const reach = 72;
  const step = 6;
  let near: { x: number; y: number; d: number } | null = null;
  const x0 = Math.max(margin, sel.x - bar.w - reach), x1 = Math.min(maxX, sel.x + sel.w + reach);
  const y0 = Math.max(minY, sel.y - bar.h - reach), y1 = Math.min(maxY, sel.y + sel.h + reach);
  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x <= x1; x += step) {
      const at = { x: Math.round(x), y: Math.round(y), w: bar.w, h: bar.h };
      const dx = Math.max(0, sel.x - (at.x + at.w), at.x - (sel.x + sel.w));
      const dy = Math.max(0, sel.y - (at.y + at.h), at.y - (sel.y + sel.h));
      const d = Math.hypot(dx, dy);
      if (d > reach || (near && d >= near.d)) continue;
      if (covered(at) === 0) near = { x: at.x, y: at.y, d };
    }
  }
  if (near) return { x: near.x, y: near.y, where: "near" };

  const b = best as { x: number; y: number } | null;
  if (b) return { x: b.x, y: b.y, where: "fallback" };
  // Nothing beside the idea fits the canvas at all: centred above it, kept inside.
  return { x: Math.min(maxX, Math.max(margin, cx - bar.w / 2)), y: Math.min(maxY, Math.max(minY, sel.y - gap - bar.h)), where: "fallback" };
}
