// Whiteboard stroke helpers for the editor (WhiteboardView.tsx): moving, recolouring and measuring strokes,
// and finding the stroke under a point. Strokes live in the sheet's logical space (WHITEBOARD_WIDTH wide, the
// block's height tall); nothing here touches the DOM.
import { strokeHit, type WhiteboardStroke } from "@folevi/editor-schema";

export type Point = [number, number];
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** A stroke's identity: two freehand strokes with the same points, colour and width are the same stroke. */
export function strokeKey(s: WhiteboardStroke): string {
  return JSON.stringify([s.color, s.width, s.opacity ?? 1, s.points ?? s.d ?? null]);
}

/** A highlighter stroke (see-through), as opposed to a pen stroke. */
export const isHighlight = (s: WhiteboardStroke) => (s.opacity ?? 1) < 1;

/**
 * An SVG path moved by (dx, dy). Whiteboard paths only use M, L, Q, C, T, S and Z (whiteboardDataIssue), whose
 * arguments are all x y pairs: absolute pairs move, relative ones stay, except a path's opening `m`, which is
 * absolute.
 */
export function translatePath(d: string, dx: number, dy: number): string {
  let out = "";
  let first = true;
  for (const m of d.matchAll(/([MLQCTSZmlqctsz])([^MLQCTSZmlqctsz]*)/g)) {
    const cmd = m[1]!;
    const nums = (m[2]!.match(/-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/gi) ?? []).map(Number);
    const absolute = cmd === cmd.toUpperCase() || (first && cmd === "m");
    first = false;
    if (cmd === "Z" || cmd === "z") {
      out += cmd;
      continue;
    }
    // A relative m opening the path: only its first pair is absolute.
    const moved = nums.map((n, i) => (absolute && (cmd !== "m" || i < 2) ? r1(n + (i % 2 === 0 ? dx : dy)) : n));
    out += `${cmd}${moved.join(" ")}`;
  }
  return out;
}

/** The stroke moved by (dx, dy). */
export function translateStroke(s: WhiteboardStroke, dx: number, dy: number): WhiteboardStroke {
  if (s.points) return { ...s, points: s.points.map(([x, y]) => [r1(x + dx), r1(y + dy)] as Point) };
  return s.d ? { ...s, d: translatePath(s.d, dx, dy) } : s;
}

/** The points a stroke runs through (for a stored path, the coordinates of its absolute commands). */
function strokePoints(s: WhiteboardStroke): Point[] {
  if (s.points) return s.points;
  const out: Point[] = [];
  for (const m of (s.d ?? "").matchAll(/([MLQCTS])([^MLQCTSZmlqctsz]*)/g)) {
    const nums = (m[2]!.match(/-?(?:\d+\.?\d*|\.\d+)/g) ?? []).map(Number);
    for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i]!, nums[i + 1]!]);
  }
  return out;
}

/** The box around the strokes, including their line width (null for none). */
export function strokesBounds(strokes: readonly WhiteboardStroke[]): Box | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of strokes) {
    const half = s.width / 2;
    for (const [x, y] of strokePoints(s)) {
      x0 = Math.min(x0, x - half);
      y0 = Math.min(y0, y - half);
      x1 = Math.max(x1, x + half);
      y1 = Math.max(y1, y + half);
    }
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/**
 * How far a move by (dx, dy) may go so the strokes stay on the sheet (`w` by `h`); a selection larger than the
 * sheet may slide while it still covers it.
 */
export function clampMove(box: Box | null, dx: number, dy: number, w: number, h: number): Point {
  if (!box) return [dx, dy];
  const clamp = (d: number, lo: number, size: number, max: number) => {
    const a = -lo;
    const b = max - (lo + size);
    // (Staying put is always allowed, for strokes drawn over the edge.)
    return Math.max(Math.min(a, b, 0), Math.min(Math.max(a, b, 0), d));
  };
  return [r1(clamp(dx, box.x, box.w, w)), r1(clamp(dy, box.y, box.h, h))];
}

/** Whether any of the stroke runs through the box (the marquee picks strokes it touches). */
export function strokeInBox(s: WhiteboardStroke, b: Box): boolean {
  return strokePoints(s).some(([x, y]) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
}

/** The topmost stroke within `radius` of p, or -1. Stored paths (no points) are found by the DOM instead. */
export function strokeAt(strokes: readonly WhiteboardStroke[], p: Point, radius: number): number {
  for (let i = strokes.length - 1; i >= 0; i--) if (strokeHit(strokes[i]!, p, radius)) return i;
  return -1;
}
