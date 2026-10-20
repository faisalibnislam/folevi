// A standalone SVG of the whiteboard for export (PNG, SVG, PDF, Copy as image; canvas/exportImage.ts) and for
// pasting into other apps: the whole sheet as it shows in the note (WHITEBOARD_WIDTH by the block's height),
// light stroke colours on white, drawn by the shared schema (whiteboardToSvg, which note exports use too).
// Null while nothing is drawn (the export items are then unavailable).
import { parseWhiteboard, whiteboardToSvg } from "@folevi/editor-schema";

export function whiteboardSvg(data: string, height: number): string | null {
  if (!parseWhiteboard(data).strokes.length) return null;
  return whiteboardToSvg(data, height);
}
