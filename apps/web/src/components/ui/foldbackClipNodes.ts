import type { LucideIconNode } from "lucide-react";

// Folevi's own icons, drawn the lucide way (24 grid, strokes only, round caps and joins). The one source of
// their drawing: FoldbackClip.tsx makes lucide components of them, and scripts/icons-codegen.mjs copies them
// into the native apps' WebIcon (as .foldbackClip, .foldbackClipOff). Plain data only: Node reads this file.

/** A foldback clip as it sits on a note card's top edge (the index card look's clip, DocumentCard.tsx): a flat
 *  bar gripping the paper, its wire handle a rounded loop above, narrower than the bar. */
export const foldbackClipNode: LucideIconNode[] = [
  ["path", { d: "M6.5 13h11a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 17.5v-3A1.5 1.5 0 0 1 6.5 13z", key: "fbc-bar" }],
  ["path", { d: "M8.5 13v-2.5A3.5 3.5 0 0 1 12 7a3.5 3.5 0 0 1 3.5 3.5V13", key: "fbc-handle" }],
];

/** The clip struck through, like lucide's *-off icons: its lines stop short of the slash. */
export const foldbackClipOffNode: LucideIconNode[] = [
  ["path", { d: "M11 13H6.5A1.5 1.5 0 0 0 5 14.5v3A1.5 1.5 0 0 0 6.5 19H17", key: "fbco-bar" }],
  ["path", { d: "M15 13h2.5a1.5 1.5 0 0 1 1.5 1.5V17", key: "fbco-bar-corner" }],
  ["path", { d: "M8.5 13v-2.5", key: "fbco-handle-left" }],
  ["path", { d: "M10.25 7.47A3.5 3.5 0 0 1 15.5 10.5V13", key: "fbco-handle" }],
  ["path", { d: "m2 2 20 20", key: "fbco-slash" }],
];

/** Icon file name (as lucide names them) -> drawing, for the codegen. */
export const foleviIconNodes: Record<string, LucideIconNode[]> = {
  "foldback-clip": foldbackClipNode,
  "foldback-clip-off": foldbackClipOffNode,
};
