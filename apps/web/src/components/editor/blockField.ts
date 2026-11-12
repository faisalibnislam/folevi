/**
 * Where a key press belongs to a block's own controls and not to the note: a field inside a block (a caption,
 * a cell, a formula's source) and a canvas that has the keyboard (flowchart, mind map, sticky notes, chart,
 * wireframe, whiteboard). These events still bubble up through the note's element, where its shortcuts
 * listen, while the note's own selection is wherever it was before the block was clicked: acting on it there
 * would open a menu, or change text, somewhere the person is not looking.
 */
export const BLOCK_FIELD = "input, textarea, select, [data-draft], .fb-canvas-card";

/** Whether `target` is in a block's own controls (see BLOCK_FIELD). */
export function inBlockControls(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(BLOCK_FIELD));
}
