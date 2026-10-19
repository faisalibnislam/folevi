// The table cell being edited, for the tools that format text outside the cell: the selection toolbar
// (EditorMenus) and the Format panel. While a cell's editor is open its text marks go to it, not to the note.
import type { Editor } from "@tiptap/core";
import { useSyncExternalStore } from "react";

export interface ActiveCell {
  /** The cell's own small editor. */
  editor: Editor;
  /** The note's editor the table is in. */
  note: Editor;
}

let active: ActiveCell | null = null;
const listeners = new Set<() => void>();

export function setActiveCell(next: ActiveCell | null): void {
  if (active === next) return;
  active = next;
  for (const l of listeners) l();
}

/** Forgets `editor` if it's the active cell's (it closed). */
export function clearActiveCell(editor: Editor): void {
  if (active?.editor === editor) setActiveCell(null);
}

export function activeCell(): ActiveCell | null {
  return active && !active.editor.isDestroyed ? active : null;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The active cell's editor while one is open in a table of `note` (any note when it's not given). */
export function useActiveCellEditor(note?: Editor | null): Editor | null {
  const cell = useSyncExternalStore(subscribe, activeCell, () => null);
  if (!cell || (note && cell.note !== note)) return null;
  return cell.editor;
}
