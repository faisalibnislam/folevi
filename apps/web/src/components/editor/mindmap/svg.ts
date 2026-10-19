// A standalone SVG of the mind map for export (PNG, SVG, PDF, Copy as image; canvas/exportImage.ts) and,
// later, for note exports and pasting into other apps. Light colours, the app's font stack, everything
// escaped. Null while there's nothing to draw (the export items are then unavailable).
//
// Not drawn yet: the mind map editor build fills this in.
export function mindmapSvg(data: string, height: number): string | null {
  void data;
  void height;
  return null;
}
