// Folevi's window on Windows 11 and 10: Folevi's own top bar fills the top of the window (the owner's pick,
// 2026-11-24), and Windows draws its real caption buttons (minimize, maximize with Snap layouts, close) over the
// top right corner: Electron's Window Controls Overlay. The page keeps that corner clear (apps/web globals.css,
// :root[data-desktop="windows"], from the CSS env(titlebar-area-*) values Chromium gives it).
// The buttons follow the page's own light or dark look (which may differ from Windows' when the person picked one
// in Folevi), and the window's background follows it too, so nothing flashes white in dark mode.

/**
 * The caption buttons' height: Folevi's top bar (the tab strip) ends 56 px down (the window's 8 px margin, 4 px,
 * then its 44 px), and the buttons stop a little above, like Edge's. Kept in step with the page's CSS.
 */
export const CAPTION_HEIGHT = 48;

/** The app's canvas, as the page draws it before any note: white or near-black (the owner's neutral chrome). */
export const CANVAS = { light: "#FFFFFF", dark: "#0E0E0F" } as const;

/** The caption buttons' colors: a clear background (the page shows through) and symbols in the page's ink. */
export function captionColors(dark: boolean): { color: string; symbolColor: string; height: number } {
  return { color: "#00000000", symbolColor: dark ? "#F2F2F2" : "#1C1C1E", height: CAPTION_HEIGHT };
}

/** The window's background for the page's look (what shows before the page paints, and while it resizes). */
export function windowBackground(dark: boolean): string {
  return dark ? CANVAS.dark : CANVAS.light;
}

/**
 * Windows' accent color as "#RRGGBB" (systemPreferences.getAccentColor gives "RRGGBBAA"), or null when there is
 * none to give. The page uses it for focus rings and selected text, as Windows' own apps do.
 */
export function accentColor(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(raw.trim());
  return m ? `#${m[1]!.toUpperCase()}` : null;
}

/** What the page reports of its look (desktop:theme), checked. */
export function cleanTheme(input: unknown): { dark: boolean } | null {
  if (!input || typeof input !== "object") return null;
  const dark = (input as Record<string, unknown>).dark;
  return typeof dark === "boolean" ? { dark } : null;
}
