// Where the main window was and how big, so it opens there next time (if that place is still on a screen).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface Bounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

export interface SavedWindow {
  bounds: Bounds;
  maximized: boolean;
}

const DEFAULT: SavedWindow = { bounds: { width: 1280, height: 840 }, maximized: false };

/** Saved bounds, kept only when most of the window would land on one of today's screens. */
export function restoreWindow(file: string, screens: { x: number; y: number; width: number; height: number }[]): SavedWindow {
  let saved: SavedWindow;
  try {
    saved = JSON.parse(readFileSync(file, "utf8")) as SavedWindow;
  } catch {
    return DEFAULT;
  }
  const b = saved?.bounds;
  if (!b || !(b.width >= 480) || !(b.height >= 360)) return DEFAULT;
  if (b.x === undefined || b.y === undefined) return { bounds: { width: b.width, height: b.height }, maximized: Boolean(saved.maximized) };
  const visible = screens.some((s) => {
    const w = Math.min(b.x! + b.width, s.x + s.width) - Math.max(b.x!, s.x);
    const h = Math.min(b.y! + b.height, s.y + s.height) - Math.max(b.y!, s.y);
    return w > 0 && h > 0 && w * h >= 0.5 * b.width * b.height;
  });
  return visible ? { bounds: b, maximized: Boolean(saved.maximized) } : { bounds: { width: b.width, height: b.height }, maximized: Boolean(saved.maximized) };
}

export function saveWindow(file: string, state: SavedWindow): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(state));
  } catch {
    /* Next time it opens at the default size. */
  }
}
