// Folding and opening a toggle, from its arrow, its key and the menu.
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";

/**
 * The transaction that folds or opens the toggle at `pos` (never an undo step: it changes what shows, not
 * what the note says). Folding with the caret, or either end of the selection, in one of the lines it hides
 * puts the caret at the end of the toggle's own line: left where it was, typing, Enter and Backspace went on
 * editing a line nobody could see.
 */
export function foldToggle(state: EditorState, pos: number, collapsed: boolean): Transaction {
  const tr = state.tr;
  const node = state.doc.nodeAt(pos);
  if (!node || node.type.name !== "toggle") return tr;
  tr.setNodeMarkup(pos, undefined, { ...node.attrs, collapsed }).setMeta("addToHistory", false);
  if (!collapsed) return tr;
  // The lines under it: every following line that is nested deeper.
  const depth = Number(node.attrs.depth ?? 0);
  const first = pos + node.nodeSize;
  let end = first;
  for (let i = state.doc.resolve(pos).index(0) + 1; i < state.doc.childCount; i++) {
    const child = state.doc.child(i);
    if (Number(child.attrs.depth ?? 0) <= depth) break;
    end += child.nodeSize;
  }
  const { from, to } = state.selection;
  const hidden = (p: number) => p >= first && p < end;
  if (hidden(from) || hidden(Math.max(from, to - 1))) tr.setSelection(TextSelection.create(tr.doc, first - 1));
  return tr;
}
