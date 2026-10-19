// A drawn chart as plain data: marks (rectangles, paths, circles, lines, text) with paints, the regions
// that answer hover and focus with a tooltip, and a summary for screen readers. draw.ts builds it; the
// screen (ChartSvg.tsx) and exports (svg.ts) draw the same scene, so what's saved is what's shown.
import type { Paint } from "./palette";

export interface RectMark {
  t: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  /** Corner radii: top-left, top-right, bottom-right, bottom-left. */
  r?: [number, number, number, number];
  fill: Paint;
  stroke?: Paint;
  sw?: number;
  opacity?: number;
  /** The hover group it belongs to (dimmed while another one is hovered). */
  g?: number;
}

export interface PathMark {
  t: "path";
  d: string;
  fill?: Paint;
  stroke?: Paint;
  sw?: number;
  opacity?: number;
  g?: number;
}

export interface CircleMark {
  t: "circle";
  cx: number;
  cy: number;
  r: number;
  fill: Paint;
  stroke?: Paint;
  sw?: number;
  opacity?: number;
  g?: number;
}

export interface LineMark {
  t: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: Paint;
  sw?: number;
}

export interface TextMark {
  t: "text";
  x: number;
  y: number;
  text: string;
  size: number;
  fill: Paint;
  weight?: number;
  anchor?: "start" | "middle" | "end";
  /** Degrees, round (x, y). */
  rotate?: number;
  /** Numbers that line up (axis ticks). */
  tabular?: boolean;
  g?: number;
}

export type Mark = RectMark | PathMark | CircleMark | LineMark | TextMark;

export interface TipRow {
  label: string;
  value: string;
  paint: Paint;
  key: "rect" | "line" | "dot";
}

export interface Tip {
  title: string;
  rows: TipRow[];
}

/** A region that shows a tooltip on hover or focus: a rectangle, a circle or a path, in drawing units. */
export type Hit = ({ shape: "rect"; x: number; y: number; w: number; h: number } | { shape: "circle"; cx: number; cy: number; r: number } | { shape: "path"; d: string }) & {
  tip: Tip;
  /** The hover group its marks are in. */
  g: number;
  /** Where the tooltip points (drawing units). */
  at: { x: number; y: number };
  /** A vertical hairline across the plot at this x while it's hovered (line and area charts). */
  crosshair?: { x: number; y1: number; y2: number; dots: { y: number; paint: Paint }[] };
};

export interface Scene {
  /** The drawing's size in pixels. */
  width: number;
  height: number;
  /** What the marks are drawn in (a drawing larger than the room, like a big org chart, is scaled into it). */
  viewBox: [number, number, number, number];
  marks: Mark[];
  hits: Hit[];
  /** One sentence for screen readers: the kind of chart, what it shows, the extremes. */
  summary: string;
  /** Nothing to draw (no numbers, no people, no sets): `summary` says why. */
  empty: boolean;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** A rectangle's path with its own corner radii (bars: rounded at the data end, square at the baseline). */
export function roundedRect(x: number, y: number, w: number, h: number, [tl, tr, br, bl]: [number, number, number, number]): string {
  const k = Math.min(w, h) / 2;
  const [a, b, c, d] = [tl, tr, br, bl].map((v) => Math.max(0, Math.min(v, k)));
  return (
    `M${r1(x + a!)} ${r1(y)}H${r1(x + w - b!)}${b ? `A${r1(b)} ${r1(b)} 0 0 1 ${r1(x + w)} ${r1(y + b)}` : ""}` +
    `V${r1(y + h - c!)}${c ? `A${r1(c)} ${r1(c)} 0 0 1 ${r1(x + w - c)} ${r1(y + h)}` : ""}` +
    `H${r1(x + d!)}${d ? `A${r1(d)} ${r1(d)} 0 0 1 ${r1(x)} ${r1(y + h - d)}` : ""}` +
    `V${r1(y + a!)}${a ? `A${r1(a)} ${r1(a)} 0 0 1 ${r1(x + a)} ${r1(y)}` : ""}Z`
  );
}

/** A path through points (null breaks the line). */
export function linePath(points: ({ x: number; y: number } | null)[]): string {
  let d = "";
  let pen = false;
  for (const p of points) {
    if (!p) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${r1(p.x)} ${r1(p.y)}`;
    pen = true;
  }
  return d;
}

/** A pie or donut slice from angle a0 to a1 (radians, 0 at the top, clockwise). */
export function slicePath(cx: number, cy: number, r: number, inner: number, a0: number, a1: number): string {
  const pt = (rad: number, a: number) => [cx + rad * Math.sin(a), cy - rad * Math.cos(a)] as const;
  // A whole circle can't be one arc: two halves.
  if (a1 - a0 >= Math.PI * 2 - 1e-6) {
    const outer = `M${r1(cx)} ${r1(cy - r)}A${r1(r)} ${r1(r)} 0 1 1 ${r1(cx)} ${r1(cy + r)}A${r1(r)} ${r1(r)} 0 1 1 ${r1(cx)} ${r1(cy - r)}Z`;
    return inner > 0 ? `${outer}M${r1(cx)} ${r1(cy - inner)}A${r1(inner)} ${r1(inner)} 0 1 0 ${r1(cx)} ${r1(cy + inner)}A${r1(inner)} ${r1(inner)} 0 1 0 ${r1(cx)} ${r1(cy - inner)}Z` : outer;
  }
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = pt(r, a0);
  const [x1, y1] = pt(r, a1);
  if (inner <= 0) return `M${r1(cx)} ${r1(cy)}L${r1(x0)} ${r1(y0)}A${r1(r)} ${r1(r)} 0 ${large} 1 ${r1(x1)} ${r1(y1)}Z`;
  const [x2, y2] = pt(inner, a1);
  const [x3, y3] = pt(inner, a0);
  return `M${r1(x0)} ${r1(y0)}A${r1(r)} ${r1(r)} 0 ${large} 1 ${r1(x1)} ${r1(y1)}L${r1(x2)} ${r1(y2)}A${r1(inner)} ${r1(inner)} 0 ${large} 0 ${r1(x3)} ${r1(y3)}Z`;
}

export const round = r1;
