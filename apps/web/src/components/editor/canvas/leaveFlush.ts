"use client";

import { useCallback, useEffect, useRef } from "react";
import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Transaction } from "@tiptap/pm/state";
import { asCanvasStep, travelCanvasStep } from "./noteUndo";

/**
 * Asks every block that holds unsaved work of its own (a canvas, a drawing) to write it to the note now.
 * Sent before the note itself is saved for the last time, when the editor goes away. (A closing page, and the
 * Mac app quitting, reach each block through `pagehide`: useLeaveFlush.)
 */
export const FLUSH_BLOCKS_EVENT = "folevi:flush-blocks";

/** A field inside a block (a sticky being written, a table cell) that keeps what is typed until it's left. */
function fieldInBlock(el: Element | null): HTMLElement | null {
  if (!(el instanceof HTMLElement)) return null;
  if (!el.matches("textarea, input, [contenteditable='true'], [contenteditable='']")) return null;
  if (el.classList.contains("fb-editor")) return null; // the note's own body
  return el.closest("[data-node-view-wrapper]") ? el : null;
}

/** Ends an edit in progress inside a block, so what was typed is the block's before it is saved. */
export function commitOpenField() {
  fieldInBlock(document.activeElement)?.blur();
}

export function flushBlocks() {
  commitOpenField();
  window.dispatchEvent(new CustomEvent(FLUSH_BLOCKS_EVENT));
}

/**
 * Runs `flush` whenever this block's unsaved work could otherwise be lost or left behind: the page is being
 * hidden or closed, the window loses the keyboard, a press lands anywhere (the next gesture, or a click on
 * another note), and when the note asks (flushBlocks). The page's own last save listens for the same events
 * without `capture`, so these run first and their writes are in it.
 */
export function useLeaveFlush(flush: () => void) {
  const ref = useRef(flush);
  ref.current = flush;
  useEffect(() => {
    const run = () => ref.current();
    const closing = () => {
      commitOpenField();
      run();
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") run();
    };
    window.addEventListener("pagehide", closing, true);
    window.addEventListener("visibilitychange", hidden, true);
    window.addEventListener("blur", run);
    window.addEventListener(FLUSH_BLOCKS_EVENT, run);
    document.addEventListener("pointerdown", run, true);
    return () => {
      window.removeEventListener("pagehide", closing, true);
      window.removeEventListener("visibilitychange", hidden, true);
      window.removeEventListener("blur", run);
      window.removeEventListener(FLUSH_BLOCKS_EVENT, run);
      document.removeEventListener("pointerdown", run, true);
    };
  }, []);
}

/**
 * How a block's write stands in the note's undo history: "step" is an undo step of its own (never joined to
 * the typing just before it), "none" is no step at all, and a function is handed the transaction to mark
 * as it needs. Left out: a step like any other change.
 */
export type WriteHistory = "step" | "none" | ((tr: Transaction) => void);

/**
 * Sets attributes on a block. Like a node view's own `updateAttributes`, but it still works while the view
 * is being taken down (the note is closing and the block has one last change to write): the block is then
 * found by its id. False when the block or the editor is gone.
 */
export function setBlockAttrs(editor: Editor, getPos: (() => number | undefined) | boolean | undefined, id: unknown, attrs: Record<string, unknown>, history?: WriteHistory): boolean {
  if (editor.isDestroyed) return false;
  const { state, view } = editor;
  let pos: number | null = null;
  try {
    const at = typeof getPos === "function" ? getPos() : undefined;
    if (typeof at === "number" && state.doc.nodeAt(at) && (typeof id !== "string" || state.doc.nodeAt(at)!.attrs.id === id)) pos = at;
  } catch {
    // The view no longer knows where it is.
  }
  if (pos === null && typeof id === "string") {
    state.doc.descendants((n, p) => {
      if (pos !== null) return false;
      if (n.attrs.id === id) pos = p;
      return pos === null;
    });
  }
  const node = pos === null ? null : state.doc.nodeAt(pos);
  if (pos === null || !node) return false;
  const tr = state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
  if (history === "none") tr.setMeta("addToHistory", false);
  else if (history === "step") closeHistory(tr);
  else if (history) history(tr);
  view.dispatch(tr);
  return true;
}

/**
 * What a canvas says about a write: "live" is a change still being made (text being typed), "undo" and
 * "redo" are the canvas taking back or redoing its own change. Left out: a finished change.
 */
export interface CanvasWrite {
  kind?: "live" | "undo" | "redo";
}

/**
 * A canvas block's `write`: sets its `data`, by position while the view is up and by id while it is going away.
 * How each write stands in the note's undo is canvas/noteUndo.ts: a change is one step of the note's however
 * often it was saved on the way, and the canvas's own undo and redo go through the note's history when they
 * can. `shared` is a board several people change at once (sticky notes): its own undo takes back only this
 * person's part, which the note's history cannot do, so it is always written as no step.
 */
export function useBlockDataWriter(props: { editor: Editor; getPos: (() => number | undefined) | boolean; node: { attrs: Record<string, unknown> } }, shared = false) {
  const ref = useRef(props);
  ref.current = props;
  return useCallback(
    (data: string, how?: CanvasWrite) => {
      const { editor, getPos, node } = ref.current;
      const id = node.attrs.id;
      const kind = how?.kind;
      if (kind === "undo" || kind === "redo") {
        if (!shared && typeof id === "string" && travelCanvasStep(editor, id, data, kind === "undo")) return;
        setBlockAttrs(editor, getPos, id, { data }, "none");
        return;
      }
      if (typeof id !== "string") {
        setBlockAttrs(editor, getPos, id, { data }, "step");
        return;
      }
      const last = kind !== "live";
      const saved = setBlockAttrs(editor, getPos, id, { data }, (tr) => asCanvasStep(editor, tr, id, last));
      // The change is finished: what is typed in the note right after is a step of its own.
      if (saved && last && !editor.isDestroyed) editor.view.dispatch(closeHistory(editor.state.tr).setMeta("addToHistory", false));
    },
    [shared],
  );
}
