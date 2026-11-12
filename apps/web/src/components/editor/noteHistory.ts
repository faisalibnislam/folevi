import { UndoRedo } from "@tiptap/extensions";
import { redo, undo } from "@tiptap/pm/history";
import type { Editor } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";

/** How many steps that change nothing one press may pass over. */
const MAX_EMPTY_STEPS = 50;

/**
 * One press of undo (or redo): the last step that changes something. A step can have nothing left to change:
 * a canvas took its own change back with its own undo, or another device already put the block the way the
 * step would. Left alone, that press would do nothing anyone can see, and the next would look like it undid
 * two things. So such steps are passed over until one shows.
 */
function travel(editor: Editor, state: EditorState, tr: Transaction, dispatch: ((tr: Transaction) => void) | undefined, back: boolean): boolean {
  const run = back ? undo : redo;
  // Only asking whether there is anything to undo, or part of a longer chain of commands: the plain step.
  if (!dispatch || tr.docChanged) return run(state, dispatch);
  // The steps are dispatched here, one at a time, so the command's own (empty) transaction is not.
  tr.setMeta("preventDispatch", true);
  let did = false;
  for (let i = 0; i < MAX_EMPTY_STEPS; i++) {
    const before = editor.state;
    if (!run(before, (step) => editor.view.dispatch(step))) break;
    did = true;
    if (!editor.state.doc.eq(before.doc)) break;
  }
  return did;
}

/** The note's undo history: Tiptap's, with undo and redo passing over steps that change nothing. */
export const NoteHistory = UndoRedo.extend({
  addCommands() {
    return {
      undo:
        () =>
        ({ editor, state, tr, dispatch }) =>
          travel(editor, state, tr, dispatch as ((tr: Transaction) => void) | undefined, true),
      redo:
        () =>
        ({ editor, state, tr, dispatch }) =>
          travel(editor, state, tr, dispatch as ((tr: Transaction) => void) | undefined, false),
    };
  },
});
