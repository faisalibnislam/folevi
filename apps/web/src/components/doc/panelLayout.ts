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
