// Block-level (multi-block) selection: a contiguous run of top-level blocks, identified by the ids of
// the block where the selection started (anchor) and the block it currently extends to (head). Ids
// (not positions), so the selection survives moves, remote updates and re-renders. The plugin that
// owns the state and its keyboard/clipboard behaviour lives in blockSelection.ts; this module only
// holds the key and pure helpers so commands.ts can read it without an import cycle.
import { PluginKey, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/**
 * Makes ProseMirror read the DOM selection now. Keyboard selections (Shift+arrows) reach ProseMirror via
 * the async "selectionchange" event; a shortcut pressed right after them must not act on a stale range.
 */
export function syncDomSelection(view: EditorView): void {
  (view as unknown as { domObserver?: { flush?: () => void } }).domObserver?.flush?.();
}

export interface BlockSelection {
  anchor: string;
  head: string;
}

export type BlockSelectionMeta = { set: BlockSelection } | { clear: true };

export const blockSelectionKey = new PluginKey<BlockSelection | null>("foleviBlockSelection");

/** Top-level index of the block with `id`, or -1. */
export function indexOfBlock(state: EditorState, id: string): number {
  let found = -1;
  state.doc.forEach((node, _offset, index) => {
    if (found < 0 && node.attrs.id === id) found = index;
  });
  return found;
}

/** The selected index range (inclusive, ordered), or null when no block selection is active. */
export function blockSelectionRange(state: EditorState): { from: number; to: number } | null {
  const sel = blockSelectionKey.getState(state);
  if (!sel) return null;
  const a = indexOfBlock(state, sel.anchor);
  const h = indexOfBlock(state, sel.head);
  if (a < 0 || h < 0) return null;
  return { from: Math.min(a, h), to: Math.max(a, h) };
}

/** Indices of blocks hidden inside a collapsed toggle (they can't be selected on their own). */
export function hiddenIndices(state: EditorState): Set<number> {
  const hidden = new Set<number>();
  let hideBelow: number | null = null;
  state.doc.forEach((node, _offset, index) => {
    const depth = Number(node.attrs.depth ?? 0);
    if (hideBelow !== null && depth <= hideBelow) hideBelow = null;
    if (hideBelow !== null) hidden.add(index);
    else if (node.type.name === "toggle" && node.attrs.collapsed) hideBelow = depth;
  });
  return hidden;
}

/** The nearest visible block index from `index` in direction `dir`, or null at the edge. */
export function neighbourIndex(state: EditorState, index: number, dir: -1 | 1): number | null {
  const hidden = hiddenIndices(state);
  for (let i = index + dir; i >= 0 && i < state.doc.childCount; i += dir) {
    if (!hidden.has(i)) return i;
  }
  return null;
}
