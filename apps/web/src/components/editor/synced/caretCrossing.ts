"use client";

import { useEffect } from "react";
import type { Editor } from "@tiptap/core";
import { NodeSelection, Selection, TextSelection } from "@tiptap/pm/state";
import { inBlockControls } from "../blockField";
import { triggerKey } from "../plugins";

type Dir = "up" | "down" | "left" | "right";
const DIRS: Record<string, Dir> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

const plain = (e: KeyboardEvent) => !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey && !e.isComposing && e.keyCode !== 229;

/**
 * The caret walks into and out of a synced block with the arrow keys, as it does between any two lines.
 *
 * A synced block shows its content in an editor of its own inside the note's editor (SyncedView.tsx), and a
 * caret cannot cross from one editor to the other by itself: Down on the line above selected the block as one
 * object, and inside it the caret stopped dead at the first and last line. So:
 * - in the note, Down or Right at the end of the line just above the block puts the caret at the block's start,
 *   Up or Left at the start of the line just below puts it at the block's end, and Enter on the selected block
 *   goes in;
 * - in the block, Up or Left at its very start and Down or Right at its very end put the caret in the note's
 *   line before or after (the block is selected when there is no such line).
 * Escape in the block, as before, returns to the note with the block selected.
 */
export function useCaretCrossing(outer: Editor, inner: Editor | null, getPos: (() => number | undefined) | boolean | undefined) {
  useEffect(() => {
    if (!inner) return;
    const where = () => {
      try {
        const pos = typeof getPos === "function" ? getPos() : undefined;
        const node = typeof pos === "number" ? outer.state.doc.nodeAt(pos) : null;
        return typeof pos === "number" && node?.type.name === "synced" ? { pos, end: pos + node.nodeSize } : null;
      } catch {
        return null;
      }
    };
    // At once, not on the next frame as the editor's own focus command does: what is typed right after the
    // arrow has to land in the block.
    const enter = (at: "start" | "end") => {
      if (inner.isDestroyed) return;
      const { doc, tr } = inner.state;
      inner.view.dispatch(tr.setSelection(at === "start" ? Selection.atStart(doc) : Selection.atEnd(doc)).scrollIntoView());
      inner.view.focus();
    };

    // In the note: before its own key handling (which would select the block as one object).
    const outerDom = outer.view.dom as HTMLElement;
    const onOuterKey = (e: KeyboardEvent) => {
      if (e.target !== outerDom || !plain(e) || outer.isDestroyed || inner.isDestroyed) return;
      // (Hidden in a folded toggle: there is nothing to walk into.)
      if (!(inner.view.dom as HTMLElement).offsetParent) return;
      const at = where();
      if (!at) return;
      const { state, view } = outer;
      const sel = state.selection;
      if (e.key === "Enter" && sel instanceof NodeSelection && sel.from === at.pos) {
        e.preventDefault();
        e.stopImmediatePropagation();
        enter("start");
        return;
      }
      const dir = DIRS[e.key];
      // A menu that is open under the caret ("/", "@") has the arrows.
      if (!dir || !(sel instanceof TextSelection) || !sel.empty || triggerKey.getState(state)) return;
      const $c = sel.$from;
      if ($c.depth < 1) return;
      const forward = dir === "down" || dir === "right";
      if (forward) {
        if ($c.after(1) !== at.pos) return;
        if (dir === "right" ? $c.pos !== $c.end(1) : !view.endOfTextblock("down")) return;
      } else {
        if ($c.before(1) !== at.end) return;
        if (dir === "left" ? $c.pos !== $c.start(1) : !view.endOfTextblock("up")) return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      enter(forward ? "start" : "end");
    };

    // In the block: after its own key handling, and only when that left the key alone (a caret that could
    // still move, a menu that took the arrow, a table cell).
    const innerDom = inner.view.dom as HTMLElement;
    const onInnerKey = (e: KeyboardEvent) => {
      const dir = DIRS[e.key];
      if (!dir || e.defaultPrevented || !plain(e) || outer.isDestroyed || inner.isDestroyed) return;
      if (e.target !== innerDom && inBlockControls(e.target)) return;
      const { state, view } = inner;
      const sel = state.selection;
      if (triggerKey.getState(state)) return;
      const forward = dir === "down" || dir === "right";
      const edge = forward ? sel.$to.indexAfter(0) === state.doc.childCount : sel.$from.index(0) === 0;
      if (!edge) return;
      if (sel instanceof TextSelection) {
        if (!sel.empty) return;
        const $c = sel.$from;
        if (dir === "left" && $c.pos !== Selection.atStart(state.doc).from) return;
        if (dir === "right" && $c.pos !== Selection.atEnd(state.doc).to) return;
        if ((dir === "up" || dir === "down") && !view.endOfTextblock(dir)) return;
      } else if (!(sel instanceof NodeSelection) || dir === "left" || dir === "right") return;
      const at = where();
      if (!at) return;
      e.preventDefault();
      const doc = outer.state.doc;
      // The line (or the picture, table, other block) next to it that way; none: the block itself, selected.
      const near = forward ? Selection.findFrom(doc.resolve(at.end), 1) : Selection.findFrom(doc.resolve(at.pos), -1);
      outer.view.dispatch(outer.state.tr.setSelection(near ?? NodeSelection.create(doc, at.pos)).scrollIntoView());
      outer.view.focus();
    };

    outerDom.addEventListener("keydown", onOuterKey, true);
    innerDom.addEventListener("keydown", onInnerKey);
    return () => {
      outerDom.removeEventListener("keydown", onOuterKey, true);
      innerDom.removeEventListener("keydown", onInnerKey);
    };
  }, [outer, inner, getPos]);
}
