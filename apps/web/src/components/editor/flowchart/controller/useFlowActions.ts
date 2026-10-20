"use client";

// Commands shared by the toolbars, the keyboard, menus and Foli AI: each one is a whole edit (one undo
// step) built from the pure edits in ops.ts.
import { NodeSelection } from "@tiptap/pm/state";
import { flowchartDirection, layoutFlowchart, type FlowShape, type Pt } from "../schema";
import { NO_SELECTION, addNode, boxOf, chartFromDraft, deleteSelection, duplicate, moveNodes, snap, type FlowDraft } from "../ops";
import type { FlowController } from "./types";

export type FlowActions = ReturnType<typeof useFlowActions>;

export function useFlowActions(ctrl: FlowController) {
  const { docRef, commit, setSel, selRef, setEditing, setView, fitView, wrapRef } = ctrl;

  /** Adds a shape (at the middle of the view by default) and, unless `edit` is false, starts writing in it. */
  const add = (shape: FlowShape, at: Pt = ctrl.viewCenter(), edit = true) => {
    const res = addNode(docRef.current, shape, at);
    if (!res) return null;
    commit(res.doc);
    setSel({ nodes: [res.id], edges: [] });
    if (edit) setEditing({ kind: "node", id: res.id, before: res.doc });
    ctrl.focusCanvas();
    return res.id;
  };

  const removeSelection = () => {
    const s = selRef.current;
    if (!s.nodes.length && !s.edges.length) return;
    commit(deleteSelection(docRef.current, s));
    setSel(NO_SELECTION);
  };

  const duplicateSelection = () => {
    const s = selRef.current;
    if (!s.nodes.length) return;
    const res = duplicate(docRef.current, s.nodes);
    commit(res.doc);
    setSel({ nodes: res.ids, edges: [] });
  };

  const tidy = () => {
    const fc = docRef.current;
    if (!fc.nodes.length) return;
    const box = boxOf(fc.nodes)!;
    const next = layoutFlowchart(fc, { direction: flowchartDirection(fc), origin: { x: snap(box.x), y: snap(box.y) } });
    commit(next);
    fitView(next);
  };

  /** Applies a Foli AI draft as one change. */
  const applyDraft = (draft: FlowDraft, mode: "create" | "update") => {
    const next = chartFromDraft(draft, docRef.current, mode);
    commit(next);
    setSel(NO_SELECTION);
    ctrl.setAiOpen(false);
    fitView(next);
    wrapRef.current?.focus({ preventScroll: true });
  };

  /** Gives the keyboard back to the note, with the block selected. */
  const exitToNote = () => {
    const { getPos, editor } = ctrl.props;
    const pos = typeof getPos === "function" ? getPos() : null;
    if (typeof pos !== "number") return;
    setSel(NO_SELECTION);
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
    editor.view.focus();
  };

  /** Moves the selected shapes (or, with nothing selected, the view) by a few points. */
  const nudge = (dx: number, dy: number) => {
    const s = selRef.current;
    const fc = docRef.current;
    if (!s.nodes.length) {
      setView((v) => ({ ...v, x: v.x - dx * 5, y: v.y - dy * 5 }));
      return;
    }
    const origin = new Map(fc.nodes.filter((n) => s.nodes.includes(n.id)).map((n) => [n.id, { x: n.x, y: n.y }]));
    commit(moveNodes(fc, origin, dx, dy), { key: "nudge" });
  };

  return { add, removeSelection, duplicateSelection, tidy, applyDraft, exitToNote, nudge };
}
