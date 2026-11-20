// How the page tools panel (Format, Style, Info, ...) shares a note's width (QA audit F02).
//
// The panel sits beside the note when both fit, and slides over the note's edge when they don't: a note never
// shrinks below a writable width to make room for it. What counts is the note's own width (one of two or three
// joined notes is much narrower than the window), not only the window's.

export const PANEL_MIN = 280;
export const PANEL_MAX = 520;
export const PANEL_DEFAULT = 280;

/**
 * The narrowest the note itself (its page, padding included) gets beside the panel: below it a line holds a
 * few words at most. Under it, the panel opens over the note instead.
 */
export const NOTE_MIN_WRITABLE = 440;

/** The panel's width, kept within its bounds. */
export function clampPanelWidth(width: number): number {
  return Math.min(PANEL_MAX, Math.max(PANEL_MIN, Number.isFinite(width) ? width : PANEL_DEFAULT));
}

/**
 * Whether the panel opens over the note rather than beside it: on a narrow window, or when the note's row
 * (`rowWidth`, the note and the panel together; 0 while not measured yet) can't hold the panel and a writable note.
 */
export function toolsPanelOverlays(o: { narrowWindow: boolean; rowWidth: number; panelWidth: number }): boolean {
  if (o.narrowWindow) return true;
  if (!o.rowWidth) return false;
  return o.rowWidth - clampPanelWidth(o.panelWidth) < NOTE_MIN_WRITABLE;
}

/**
 * The window width under which the panel always opens over the note. The web's window holds its own sidebar too
 * (about 260 px of the 1200); in Folevi for Mac's native frame the page is only the card beside the native
 * sidebar, so the same note width is reached 260 px sooner. With the web's number there, the panel covered the
 * note's words in every Mac window narrower than about 1490 pt (2026-11-18).
 */
export function narrowWindowQuery(macNativeFrame: boolean): string {
  return `(max-width: ${macNativeFrame ? 939 : 1199}px)`;
}

/**
 * Whether the panel would lie over a note that is opening now, asked of the window itself. The hooks that watch
 * the window (useMediaQuery, useElementWidth) answer only after the first draw and say "wide" until then, so a
 * note loaded straight into a narrow window opened its panel over itself: in a phone's browser Foli AI covered
 * the whole note. `row` is the note's row when it is already laid out.
 */
export function panelCoversAtOpen(o: { macNativeFrame: boolean; row: HTMLElement | null; panelWidth: number }): boolean {
  if (typeof window === "undefined") return false;
  const narrowWindow = typeof window.matchMedia === "function" && window.matchMedia(narrowWindowQuery(o.macNativeFrame)).matches;
  return toolsPanelOverlays({ narrowWindow, rowWidth: o.row?.getBoundingClientRect().width ?? 0, panelWidth: o.panelWidth });
}
