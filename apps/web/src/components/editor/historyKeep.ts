import type { Editor } from "@tiptap/core";
import { closeHistory, history, redo, undo, undoDepth } from "@tiptap/pm/history";
import { Node as PMNode } from "@tiptap/pm/model";
import { EditorState, type Plugin } from "@tiptap/pm/state";
import { Step } from "@tiptap/pm/transform";

// A note's undo history, kept for a while after the note is left.
//
// A note's editor is taken down whenever the note leaves the screen: another note is opened in its place, or,
// in the Mac app, its tab is hidden (only the tab on screen is a page). Its undo history went with it, so
// Cmd+Z did nothing after a glance at another tab.
//
// The history cannot simply be handed to the note's next editor: every editor has a schema of its own, and a
// step made in one cannot be applied in another. So what is kept is the history written out: the note as it
// was before the first step, and each step as data. The next editor reads that back and plays it forward,
// which makes a history of its own that says the same thing. It only does so if the note then reads exactly
// as it did when it was left (the steps say "at this place, put this back", and that is only true of that
// text): a note that changed in between (another device, another person) starts with no history, as before.
// What could be redone is not kept.

interface Kept {
  /** The note before the first step still in its history. */
  base: unknown;
  /** Each undo step, oldest first: the changes that made it. */
  events: unknown[][];
  /** The note as it was left (what it must still read as for the steps to be true). */
  final: string;
  at: number;
}

/** Notes remembered per window (the ones just left are the ones people come back to). */
const MAX_NOTES = 8;
/** A history older than this is dropped: Cmd+Z reaching that far back would be a surprise. */
const MAX_AGE = 20 * 60_000;
/** A history bigger than this written out is not kept (many changes to a large drawing). */
const MAX_SIZE = 4_000_000;
/** The name prosemirror-history stores its state under in an editor state (its key is not exported). */
const HISTORY_FIELD = "history$";

const kept = new Map<string, Kept>();

const historyPlugin = (state: EditorState): Plugin | null => state.plugins.find((p) => (p as unknown as { key: string }).key === HISTORY_FIELD) ?? null;
const read = (state: EditorState) => (state as unknown as Record<string, unknown>)[HISTORY_FIELD];
const text = (doc: PMNode) => JSON.stringify(doc.toJSON());

/** Holds on to `state`'s undo history under `key` (the note being left). */
export function keepNoteHistory(key: string, state: EditorState): void {
  kept.delete(key);
  const plugin = historyPlugin(state);
  if (!plugin || undoDepth(state) === 0) return;
  try {
    // The same note and history with nothing else attached (no other plugin runs, nothing is shown or saved):
    // undone all the way back, then redone a step at a time to read each step's changes.
    let bare = EditorState.create({ doc: state.doc, plugins: [plugin] });
    (bare as unknown as Record<string, unknown>)[HISTORY_FIELD] = read(state);
    let steps = 0;
    while (undo(bare, (tr) => (bare = bare.apply(tr)))) if (++steps > 1000) return;
    const base = bare.doc.toJSON() as unknown;
    const events: unknown[][] = [];
    for (let i = 0; i < steps; i++) {
      let event: unknown[] | null = null;
      redo(bare, (tr) => {
        event = tr.steps.map((s) => s.toJSON() as unknown);
        bare = bare.apply(tr);
      });
      if (!event) break;
      events.push(event);
    }
    const final = text(bare.doc);
    // (Redone, it has to be the note that was left; anything else and the steps are not to be trusted.)
    if (events.length !== steps || final !== text(state.doc)) return;
    if (JSON.stringify(events).length + final.length > MAX_SIZE) return;
    kept.set(key, { base, events, final, at: Date.now() });
    // (A Map keeps the order things were added in: the oldest go first.)
    for (const old of kept.keys()) {
      if (kept.size <= MAX_NOTES) break;
      kept.delete(old);
    }
  } catch {
    // A history that cannot be read back is not kept: the note opens with none, as it always did.
  }
}

/**
 * Gives a just-made editor the history its note was left with, when the note reads exactly as it did then.
 * True when it took it.
 */
export function restoreNoteHistory(key: string, editor: Editor): boolean {
  const was = kept.get(key);
  if (!was) return false;
  kept.delete(key);
  if (editor.isDestroyed || Date.now() - was.at > MAX_AGE) return false;
  const state = editor.state;
  const plugin = historyPlugin(state);
  if (!plugin || undoDepth(state) > 0 || text(state.doc) !== was.final) return false;
  try {
    const { schema } = state;
    const config = (plugin.spec as { config?: { depth?: number; newGroupDelay?: number } }).config ?? {};
    // Played forward from the note as it was, a step at a time, with only a history listening.
    let bare = EditorState.create({ doc: PMNode.fromJSON(schema, was.base), plugins: [history(config)] });
    for (const event of was.events) {
      const tr = bare.tr;
      for (const step of event) tr.step(Step.fromJSON(schema, step));
      bare = bare.apply(closeHistory(tr));
    }
    if (text(bare.doc) !== was.final) return false;
    // The editor's state takes that history as its own (a state keeps each plugin's part under the plugin's
    // name), and everything that shows whether there is something to undo is told to look again.
    (editor.state as unknown as Record<string, unknown>)[HISTORY_FIELD] = read(bare);
    editor.view.dispatch(editor.state.tr.setMeta("addToHistory", false));
    return true;
  } catch {
    return false;
  }
}

/** For tests. */
export function forgetNoteHistories(): void {
  kept.clear();
}
