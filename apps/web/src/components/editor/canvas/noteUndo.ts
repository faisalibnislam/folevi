import type { Editor } from "@tiptap/core";
import { closeHistory, redo, undo } from "@tiptap/pm/history";
import type { Transaction } from "@tiptap/pm/state";

// One undo for a canvas and the note it is in.
//
// A canvas (flowchart, mind map, wireframe) keeps its own list of what can be undone, and every change it
// saves is also a change to the note, so the note's undo has it too. Left to themselves the two fight: the
// canvas takes a change back by writing the older drawing, the note sees a new change, and Cmd+Z in the note
// then puts back what was just undone (or half of it: the text of a shape as it stood mid-word when it was
// last saved).
//
// So the two are kept in step here:
// - Each change in a canvas is exactly one step of the note's undo, however many times it was saved while it
//   was being made (text is saved as it is typed), and never joined to typing next to it.
// - When the canvas undoes or redoes, it asks the note's history to do it, as long as its change is the last
//   thing the note did (or the next thing it could redo). The step then moves from one list to the other in
//   both places at once.
// - When something else was done in the note since (so the note's last step is not the canvas's), the canvas
//   writes the older drawing as no step at all; the note's own undo later finds that step has nothing left to
//   change and passes over it (noteHistory.ts).
//
// The note's history does not say whose each step is, so a list of that is kept beside it: for each step of
// the note's undo, the canvas block it belongs to, or null for anything else.

/** A canvas write: which block, and whether it joins the step this block has open. */
const CANVAS_META = "foleviCanvasWrite";
/** The names prosemirror-history puts on its own transactions (its keys are not exported). */
const HISTORY_META = "history$";
const CLOSE_META = "closeHistory$";

interface Ledger {
  /** Whose each step of the note's undo is, oldest first: a canvas block's id, or null (several in a row count as one). */
  done: (string | null)[];
  /** The canvas steps on top of what the note could redo, oldest first. */
  undone: string[];
  /** A canvas change being made whose saves so far are one step: later saves of it join that step. */
  open: { id: string; time: number } | null;
  /** The undo or redo now running was asked for here (its bookkeeping is done here too). */
  ours: boolean;
}

const ledgers = new WeakMap<Editor, Ledger>();
const MAX_KEPT = 400;

function ledgerOf(editor: Editor): Ledger {
  const had = ledgers.get(editor);
  if (had) return had;
  const l: Ledger = { done: [], undone: [], open: null, ours: false };
  ledgers.set(editor, l);
  editor.on("transaction", ({ transaction: tr }) => {
    const moved = tr.getMeta(HISTORY_META) as { redo?: boolean } | undefined;
    if (moved) {
      l.open = null;
      if (l.ours) return;
      // The note's own undo or redo. A canvas step on top moves across with it; anything else and the lists
      // no longer say what is on top, so they start over (the canvas then writes its undo as no step).
      if (moved.redo) {
        const top = l.undone.pop();
        if (top !== undefined) l.done.push(top);
        else if (l.done.at(-1) !== null) l.done.push(null);
      } else {
        const top = l.done.at(-1);
        if (typeof top === "string") {
          l.done.pop();
          l.undone.push(top);
        } else {
          l.done = [];
          l.undone = [];
        }
      }
      return;
    }
    const own = tr.getMeta(CANVAS_META) as { id: string; joined: boolean } | undefined;
    // (Anything else that ends the history's current step ends the canvas's open one with it.)
    if (!own && tr.getMeta(CLOSE_META)) l.open = null;
    if (!tr.docChanged || tr.getMeta("addToHistory") === false) return;
    // A new step: nothing can be redone any more.
    l.undone = [];
    if (!own) {
      l.open = null;
      if (l.done.at(-1) !== null) l.done.push(null);
    } else if (!own.joined) {
      l.done.push(own.id);
      if (l.done.length > MAX_KEPT) l.done.splice(0, l.done.length - MAX_KEPT);
    }
  });
  editor.on("destroy", () => ledgers.delete(editor));
  return l;
}

/**
 * Marks a transaction that saves a canvas's change, so it is one step of the note's undo together with the
 * earlier saves of the same change. `last` when the change is finished (the next save starts a new step).
 */
export function asCanvasStep(editor: Editor, tr: Transaction, id: string, last: boolean): Transaction {
  const l = ledgerOf(editor);
  const joined = l.open?.id === id;
  // Joined: the time of the step's first save, so the history takes it as part of that step however long the
  // change took. Not joined: a step of its own.
  if (joined) tr.setTime(l.open!.time);
  else closeHistory(tr);
  tr.setMeta(CANVAS_META, { id, joined });
  l.open = last ? null : { id, time: tr.time };
  return tr;
}

function dataOf(editor: Editor, id: string): string | null {
  let found: string | null = null;
  editor.state.doc.descendants((n) => {
    if (found !== null) return false;
    if (n.attrs.id === id) found = String(n.attrs.data ?? "");
    return found === null;
  });
  return found;
}

/**
 * The canvas `id` undid (or redid) its own change and should now hold `target`: has the note's history do
 * it, a step at a time, while the step on top is this canvas's. True once the block holds `target`; false
 * when the note's history could not get it there (the caller then writes `target` as no step).
 */
export function travelCanvasStep(editor: Editor, id: string, target: string, back: boolean): boolean {
  if (editor.isDestroyed) return false;
  const l = ledgerOf(editor);
  l.open = null;
  const from = back ? l.done : l.undone;
  const to = back ? l.undone : l.done;
  for (let i = 0; i < 100 && from.at(-1) === id; i++) {
    let moved: boolean;
    l.ours = true;
    try {
      moved = (back ? undo : redo)(editor.state, (tr) => editor.view.dispatch(tr));
    } finally {
      l.ours = false;
    }
    from.pop();
    // (The history had nothing there after all: the list was wrong about it, and says so no longer.)
    if (!moved) return false;
    to.push(id);
    if (dataOf(editor, id) === target) return true;
  }
  return false;
}

/** For tests: whose the steps of the note's undo are, oldest first. */
export function canvasLedger(editor: Editor): { done: (string | null)[]; undone: string[] } {
  const l = ledgerOf(editor);
  return { done: [...l.done], undone: [...l.undone] };
}
