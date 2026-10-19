// Drawing details shared by the canvas, the read-only map (render.tsx) and the exported picture (svg.ts):
// plain values, no React, so the export can use them anywhere.
import type { MindLayoutResult } from "@folevi/editor-schema";

/** Corners by level: the centre, main branches, the rest (on the corner scale: control, small, chip). */
export const MIND_RADIUS = [10, 8, 6] as const;
export const mindRadius = (depth: number) => MIND_RADIUS[Math.min(depth, MIND_RADIUS.length - 1)]!;

/** Main branches draw thicker than the twigs. */
export const linkWidth = (depth: number) => (depth <= 1 ? 3 : depth === 2 ? 2 : 1.5);

/** The side the centre's own badge and add button sit on (the right, unless every branch is on the left). */
export function rootSide(l: MindLayoutResult): "left" | "right" {
  const kids = l.boxes.filter((b) => b.depth === 1);
  return kids.length && kids.every((b) => b.side === "left") ? "left" : "right";
}

/** A collapsed idea's count as shown in its badge, and the badge's width. */
export function badgeOf(hidden: number): { label: string; w: number } {
  const label = String(hidden > 999 ? "999+" : hidden);
  return { label, w: Math.max(22, 10 + label.length * 7) };
}
