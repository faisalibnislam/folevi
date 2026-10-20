"use client";

// Writing a whole flow from the keyboard. Listed before interactions/keyboard.ts, so it takes these keys first:
//
//   Tab        on a selected shape (or while writing in one): a connected next shape in the flow's direction
//   ⇧Tab       the same, as a sibling branch (another child of the shape that leads here)
//   arrows     move the selection to the nearest shape that way, preferring connected ones (⌥ arrows nudge)
//   Enter edits and typing starts writing (interactions/keyboard.ts); Esc steps back: writing, selection,
//   full canvas, the note.
//
// Keyboard focus follows the selection: the selected shape holds it (so screen readers read it out, and Tab
// from it adds the next step). From the canvas itself, Tab goes to the selected shape first.
import { useEffect, useRef } from "react";
import { quickAdd, quickBranch, flowSide, neighbourInDirection } from "../building";
import { addedMessage, placeAdded, reveal } from "./quickAdd";
import type { FlowSide } from "../schema";
import type { FlowController, Interaction } from "../controller/types";
import type { FlowActions } from "../controller/useFlowActions";
import type { TextEditing } from "./textEditing";

const ARROW_SIDE: Record<string, FlowSide> = { ArrowUp: "top", ArrowRight: "right", ArrowDown: "bottom", ArrowLeft: "left" };
const ARROW_WORD: Record<FlowSide, string> = { top: "above", right: "to the right", bottom: "below", left: "to the left" };

/** The element drawing shape `id` in this canvas. */
const nodeEl = (wrap: HTMLElement | null, id: string) => wrap?.querySelector<SVGGElement>(`[data-fc-node="${CSS.escape(id)}"]`) ?? null;

export function useKeyboardFlow(ctrl: FlowController, { actions, finishEdit }: { actions: FlowActions; finishEdit: TextEditing["finishEdit"] }) {
  const { docRef, selRef, setSel, wrapRef, editingRef, say, isDragging } = ctrl;

  /** Tab: the next step, or (⇧) a sibling branch, from shape `id`; then writing in it. */
  const grow = (id: string, branch: boolean) => {
    const before = docRef.current;
    const res = branch ? quickBranch(before, id) : quickAdd(before, id, flowSide(before));
    if (!res) return say("The flowchart is full.");
    placeAdded(ctrl, res, before);
    const from = before.nodes.find((n) => n.id === id);
    say(addedMessage(res, from, branch ? "beside" : flowSide(before) === "right" ? "to the right of" : "below"));
  };

  // Tab while writing in a shape: finish the text and go on to the next step. Caught on the way down (capture),
  // so the text box never sees it and focus never leaves the canvas.
  const growRef = useRef(grow);
  growRef.current = grow;
  const finishRef = useRef(finishEdit);
  finishRef.current = finishEdit;
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      const ed = editingRef.current;
      if (!ed || ed.kind !== "node") return;
      const t = e.target as HTMLElement | null;
      if (t?.closest(".fc-bar, .fc-ai, .fc-picker")) return;
      e.preventDefault();
      e.stopPropagation();
      finishRef.current(false);
      if (docRef.current.nodes.some((n) => n.id === ed.id)) growRef.current(ed.id, e.shiftKey);
    };
    wrap.addEventListener("keydown", onKey, true);
    return () => wrap.removeEventListener("keydown", onKey, true);
  }, [wrapRef, editingRef, docRef]);

  // Focus follows the selection: a newly selected shape (or one whose text was just finished) takes the
  // keyboard, unless it's somewhere else on purpose (a text box, a toolbar, a panel, outside the canvas).
  const singleId = ctrl.single?.id ?? null;
  const writing = ctrl.editing !== null;
  useEffect(() => {
    if (!singleId || writing || isDragging()) return;
    const wrap = wrapRef.current;
    const a = document.activeElement;
    if (!wrap || !(a === wrap || (a instanceof SVGElement && a.closest("[data-fc-node]") && wrap.contains(a)))) return;
    const el = nodeEl(wrap, singleId);
    if (el && el !== a) el.focus({ preventScroll: true });
  }, [singleId, writing, wrapRef, isDragging]);

  // The focused shape went away (undo, delete, a remote change): the keyboard stays on the canvas rather
  // than dropping to the page (where ⌘Z would undo the note instead).
  const lastFocused = useRef<Element | null>(null);
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onFocusIn = (e: FocusEvent) => {
      lastFocused.current = e.target as Element;
    };
    wrap.addEventListener("focusin", onFocusIn);
    return () => wrap.removeEventListener("focusin", onFocusIn);
  }, [wrapRef]);
  const doc = ctrl.doc;
  useEffect(() => {
    const a = document.activeElement;
    const gone = lastFocused.current;
    if (gone && !gone.isConnected && (!a || a === document.body)) {
      lastFocused.current = null;
      wrapRef.current?.focus({ preventScroll: true });
    }
  }, [doc, wrapRef]);

  const interaction: Interaction = {
    keyDown: (e) => {
      if (e.metaKey || e.ctrlKey) return false;
      const s = selRef.current;
      const one = s.nodes.length === 1 && !s.edges.length ? s.nodes[0]! : null;
      if (e.key === "Tab") {
        if (!one || e.altKey) return false;
        const wrap = wrapRef.current;
        // From the canvas itself, Tab goes to the selected shape first.
        if (document.activeElement === wrap) {
          nodeEl(wrap, one)?.focus({ preventScroll: true });
          return true;
        }
        grow(one, e.shiftKey);
        return true;
      }
      const side = ARROW_SIDE[e.key];
      if (!side) return false;
      if (e.altKey) {
        const step = e.shiftKey ? 32 : 8;
        const d = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] }[side];
        actions.nudge(d[0]! * step, d[1]! * step);
        return true;
      }
      if (!one || e.shiftKey) return false;
      const next = neighbourInDirection(docRef.current, one, side);
      if (!next) {
        say(`No shape ${ARROW_WORD[side]}.`);
        return true;
      }
      setSel({ nodes: [next], edges: [] });
      const n = docRef.current.nodes.find((x) => x.id === next);
      if (n) reveal(ctrl, n);
      // Focusing it reads it out (its name says what it is and where it is in the chart).
      nodeEl(wrapRef.current, next)?.focus({ preventScroll: true });
      return true;
    },
  };

  return { interaction, grow };
}
