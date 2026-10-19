// A standalone SVG of the wireframe for export (PNG, SVG, PDF, Copy as image; canvas/exportImage.ts) and
// pasting into other apps: every screen with its name and the arrows between them, or one screen. Light
// colours and the app's fonts (Mali for the Sketch look, embedded when the file is made), everything
// escaped (./draw.ts). Null while there's nothing to draw (the export items are then unavailable).
import { parseWireframe } from "@folevi/editor-schema";
import { wireframeToSvg } from "./draw";

export function wireframeSvg(data: string, height: number): string | null {
  void height;
  return wireframeToSvg(parseWireframe(data));
}

/** One screen (with its parts) as a standalone SVG, or null when it isn't there. */
export function wireframeScreenSvg(data: string, screenId: string): string | null {
  const wf = parseWireframe(data);
  return wf.screens.some((s) => s.id === screenId) ? wireframeToSvg(wf, new Set([screenId])) : null;
}
