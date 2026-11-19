import type { Editor } from "@tiptap/core";
import { closeHistory, redoNoScroll, undoNoScroll } from "@tiptap/pm/history";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import {
  LIMITS,
  mergeStickies,
  parseFlowchart,
  parseMindmap,
  parseStickies,
  parseWhiteboard,
  parseWireframe,
  serializeFlowchart,
  serializeMindmap,
  serializeStickies,
  serializeWhiteboard,
  serializeWireframe,
  whiteboardDataIssue,
} from "@folevi/editor-schema";
import { strokeKey } from "../whiteboard/ops";
import { mergeCanvasData } from "./canvasMerge";

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
//   thing the note did (or the next thing it could redo) and that step is exactly the move the canvas is
//   making. The step then moves from one list to the other in both places at once.
// - When something else was done in the note since (so the note's last step is not the canvas's), or the two
//   do not line up, the canvas writes the older drawing as no step at all; the note's own undo later finds
//   that step has nothing left to change and passes over it (noteHistory.ts).
// - The note's history puts a block's whole drawing back, as it was before the step. When someone else has
//   changed the same drawing since (another device, another person), that would take their work away with
//   it. So what each step wrote is kept here, and such an undo or redo is turned into taking back only what
//   the step itself did, on the drawing as it is now (keepOthersCanvasWork).
//
// The note's history does not say whose each step is, so a list of that is kept beside it: for each step of
// the note's undo, the canvas step it is, or null for anything else.

/** A canvas write: which block, whether it joins the step this block has open, and what the step wrote. */
const CANVAS_META = "foleviCanvasWrite";
/** The names prosemirror-history puts on its own transactions (its keys are not exported). */
const HISTORY_META = "history$";
const CLOSE_META = "closeHistory$";

/** What one step of the note's undo did to a canvas block: its `data` before and after. */
interface CanvasStep {
  id: string;
  before: string;
  after: string;
  /** On a shared board: whose step it is (votes are kept per person). */
  me?: string;
}

interface Ledger {
  /** Whose each step of the note's undo is, oldest first: a canvas block's step, or null (several in a row count as one). */
  done: (CanvasStep | null)[];
  /** The canvas steps on top of what the note could redo, oldest first. */
  undone: CanvasStep[];
  /** A canvas change being made whose saves so far are one step: later saves of it join that step. */
  open: { id: string; time: number; step: CanvasStep } | null;
  /** The undo or redo now running was asked for here (its bookkeeping is done here too). */
  ours: boolean;
}

const ledgers = new WeakMap<Editor, Ledger>();
const MAX_KEPT = 400;

// What the canvas steps wrote, by block. Kept apart from the ledger because it has to outlive the editor: a
// note's history is handed to its next editor (historyKeep.ts), and its steps still put whole drawings back.
const written = new Map<string, CanvasStep[]>();
const MAX_BLOCKS = 64;
const MAX_STEPS = 200;

function remember(step: CanvasStep): void {
  const list = written.get(step.id) ?? [];
  // (Added again so the blocks worked in last are the last to be dropped.)
  written.delete(step.id);
  list.push(step);
  if (list.length > MAX_STEPS) list.shift();
  written.set(step.id, list);
  for (const old of written.keys()) {
    if (written.size <= MAX_BLOCKS) break;
    written.delete(old);
  }
}

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
        if (top) {
          l.done.pop();
          l.undone.push(top);
        } else {
          l.done = [];
          l.undone = [];
        }
      }
      return;
    }
    const own = tr.getMeta(CANVAS_META) as { id: string; joined: boolean; step: CanvasStep } | undefined;
    // (Anything else that ends the history's current step ends the canvas's open one with it.)
    if (!own && tr.getMeta(CLOSE_META)) l.open = null;
    if (!tr.docChanged || tr.getMeta("addToHistory") === false) return;
    // A new step: nothing can be redone any more.
    l.undone = [];
    if (!own) {
      l.open = null;
      if (l.done.at(-1) !== null) l.done.push(null);
    } else if (!own.joined) {
      l.done.push(own.step);
      if (l.done.length > MAX_KEPT) l.done.splice(0, l.done.length - MAX_KEPT);
    }
  });
  editor.on("destroy", () => ledgers.delete(editor));
  return l;
}

function dataIn(doc: PMNode, id: string): string | null {
  let found: string | null = null;
  doc.descendants((n) => {
    if (found !== null) return false;
    if (n.attrs.id === id) found = String(n.attrs.data ?? "");
    return found === null && !n.inlineContent;
  });
  return found;
}

/**
 * Marks a transaction that saves a canvas's change, so it is one step of the note's undo together with the
 * earlier saves of the same change. `last` when the change is finished (the next save starts a new step).
 * `me` on a shared board: the person whose change it is.
 */
export function asCanvasStep(editor: Editor, tr: Transaction, id: string, last: boolean, me?: string): Transaction {
  const l = ledgerOf(editor);
  const joined = l.open?.id === id;
  const after = dataIn(tr.doc, id) ?? "";
  let step: CanvasStep;
  if (joined) {
    // The time of the step's first save, so the history takes it as part of that step however long the
    // change took.
    tr.setTime(l.open!.time);
    step = l.open!.step;
    step.after = after;
  } else {
    // A step of its own.
    closeHistory(tr);
    step = { id, before: dataIn(tr.before, id) ?? "", after, ...(me ? { me } : {}) };
    remember(step);
  }
  tr.setMeta(CANVAS_META, { id, joined, step });
  // (A change being made that is back where it began, an edit given up after it was saved on the way, has
  // nothing in its step: whatever is done next starts a new one.)
  l.open = last || step.after === step.before ? null : { id, time: tr.time, step };
  return tr;
}

/**
 * The change the canvas `id` was making is finished, and its last save already holds all of it: ends the
 * step that save left open, so the next change to this canvas is a step of its own.
 */
export function endCanvasStep(editor: Editor, id: string): void {
  if (editor.isDestroyed) return;
  const l = ledgerOf(editor);
  if (l.open?.id !== id) return;
  l.open = null;
  // (And what is typed in the note right after is a step of its own.)
  editor.view.dispatch(closeHistory(editor.state.tr).setMeta("addToHistory", false));
}

/**
 * The canvas `id` undid (or redid) its own change and should now hold `target`: has the note's history do
 * it, when the step on top is this canvas's and is exactly that move (the block holds what the step wrote,
 * and the step began at `target`). True once the block holds `target`; false when the note's history was
 * left alone (the caller then writes `target` as no step).
 */
export function travelCanvasStep(editor: Editor, id: string, target: string, back: boolean): boolean {
  if (editor.isDestroyed) return false;
  const l = ledgerOf(editor);
  l.open = null;
  const from = back ? l.done : l.undone;
  const to = back ? l.undone : l.done;
  const top = from.at(-1);
  if (!top || top.id !== id) return false;
  // Not the same move (two changes saved as one step, a change merged with someone else's): one step of the
  // note's history would land somewhere else, and more than one would take back more than was asked.
  if (dataIn(editor.state.doc, id) !== (back ? top.after : top.before) || target !== (back ? top.before : top.after)) return false;
  const run = (undoing: boolean) => {
    l.ours = true;
    try {
      // (Without scrolling to the note's caret: the canvas is what is being looked at.)
      return (undoing ? undoNoScroll : redoNoScroll)(editor.state, (tr) => editor.view.dispatch(tr));
    } finally {
      l.ours = false;
    }
  };
  const moved = run(back);
  from.pop();
  // (The history had nothing there after all: the list was wrong about it, and says so no longer.)
  if (!moved) return false;
  to.push(top);
  if (dataIn(editor.state.doc, id) === target) return true;
  // The history's step was not the one listed: put back, and the lists start over.
  run(!back);
  l.done = [];
  l.undone = [];
  return false;
}

// ---------------------------------------------------------------------------- other people's work

/** The merged `data`; null when it would be too large to store; undefined when some side cannot be read here. */
type Merge = (base: string, theirs: string, mine: string, me: string) => string | null | undefined;

/** A canvas kept as lists of items with ids: merged item by item, then read by the block's own reader. */
function itemMerge<T extends object>(parse: (data: string) => T, serialize: (doc: T) => string, max: number, merge: (base: T, theirs: T, mine: T, me: string) => T = mergeCanvasData): Merge {
  const blank = serialize(parse(""));
  // (A reader hands back an empty canvas for anything it cannot read: a drawing from a newer version of the
  // app, say. Merging that would wipe it, so such data is left exactly as the history put it.)
  const readable = (data: string) => data === "" || data === blank || serialize(parse(data)) !== blank;
  return (base, theirs, mine, me) => {
    if (!readable(base) || !readable(theirs) || !readable(mine)) return undefined;
    const text = serialize(merge(parse(base), parse(theirs), parse(mine), me));
    // Too large to store: it would read back as an empty canvas.
    if (text.length > max) return null;
    return serialize(parse(text));
  };
}

/**
 * How each kind of canvas block takes one change back on a drawing others have changed since: `mine` (what
 * the note's history is putting back) with what `theirs` (the block as it is now) did since `base` (what the
 * step being moved had written).
 */
const MERGE: Record<string, Merge> = {
  flowchart: itemMerge(parseFlowchart, serializeFlowchart, LIMITS.maxFlowchartDataLength),
  mindmap: itemMerge(parseMindmap, serializeMindmap, LIMITS.maxMindmapDataLength),
  wireframe: itemMerge(parseWireframe, serializeWireframe, LIMITS.maxWireframeDataLength),
  stickies: itemMerge(parseStickies, serializeStickies, LIMITS.maxStickiesDataLength, mergeStickies),
  // Strokes carry no id: what the step did is the strokes it added and the ones it took away, and that is
  // what is taken back, on the drawing as it is now.
  whiteboard: (base, theirs, mine) => {
    if ([base, theirs, mine].some((data) => whiteboardDataIssue(data) !== null)) return undefined;
    const from = parseWhiteboard(base).strokes;
    const to = parseWhiteboard(mine).strokes;
    const fromKeys = new Set(from.map(strokeKey));
    const toKeys = new Set(to.map(strokeKey));
    const kept = parseWhiteboard(theirs).strokes.filter((s) => {
      const k = strokeKey(s);
      return !fromKeys.has(k) || toKeys.has(k);
    });
    const have = new Set(kept.map(strokeKey));
    const next = [...kept, ...to.filter((s) => !fromKeys.has(strokeKey(s)) && !have.has(strokeKey(s)))];
    const text = next.length ? serializeWhiteboard({ strokes: next }) : "";
    return text.length > LIMITS.maxWhiteboardDataLength ? null : text;
  },
};

/** The step of block `id` that an undo (or redo) which just put `restored` back was moving, if it is known. */
function stepFor(id: string, restored: string, current: string, back: boolean): CanvasStep | null {
  const list = written.get(id);
  if (!list) return null;
  let found: CanvasStep | null = null;
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i]!;
    if ((back ? s.before : s.after) !== restored) continue;
    // (The one the block still held, when there is one: then nobody changed it since.)
    if ((back ? s.after : s.before) === current) return s;
    found ??= s;
  }
  return found;
}

/**
 * For the note's history plugin (noteHistory.ts, as its `appendTransaction`). An undo or redo that has just
 * put a canvas block's whole `data` back, where the block no longer held what that step had written (someone
 * else changed it since): the block gets the merge instead, the others' work with only this step taken back.
 * Part of the same change to the note, so the drawing without their work is never shown or sent.
 */
export function keepOthersCanvasWork(trs: readonly Transaction[], oldState: EditorState, newState: EditorState): Transaction | null {
  const moved = trs.map((tr) => tr.getMeta(HISTORY_META) as { redo?: boolean } | undefined).find(Boolean);
  if (!moved || oldState.doc.eq(newState.doc)) return null;
  const back = !moved.redo;
  const was = new Map<string, string>();
  oldState.doc.descendants((n) => {
    if (MERGE[n.type.name] && typeof n.attrs.id === "string") was.set(n.attrs.id, String(n.attrs.data ?? ""));
    return !n.inlineContent;
  });
  if (!was.size) return null;
  let fix: Transaction | null = null;
  newState.doc.descendants((n, pos) => {
    const merge = MERGE[n.type.name];
    const id: unknown = n.attrs.id;
    if (!merge || typeof id !== "string") return !n.inlineContent;
    const theirs = was.get(id);
    const mine = String(n.attrs.data ?? "");
    if (theirs === undefined || theirs === mine) return false;
    const step = stepFor(id, mine, theirs, back);
    const base = step ? (back ? step.after : step.before) : null;
    if (!step || base === null || base === theirs) return false;
    let merged: string | null | undefined;
    try {
      merged = merge(base, theirs, mine, step.me ?? "");
    } catch {
      // Data no reader here understands.
    }
    if (merged === undefined) return false;
    // (Too large to store merged: the block stays as the others have it, and this step is not taken back.)
    const next = merged ?? theirs;
    if (next !== mine) fix = (fix ?? newState.tr).setNodeMarkup(pos, undefined, { ...n.attrs, data: next });
    return false;
  });
  return fix ? (fix as Transaction).setMeta("addToHistory", false) : null;
}

/** For tests: whose the steps of the note's undo are, oldest first. */
export function canvasLedger(editor: Editor): { done: (string | null)[]; undone: string[] } {
  const l = ledgerOf(editor);
  return { done: l.done.map((s) => s?.id ?? null), undone: l.undone.map((s) => s.id) };
}

/** For tests. */
export function forgetCanvasSteps(): void {
  written.clear();
}
