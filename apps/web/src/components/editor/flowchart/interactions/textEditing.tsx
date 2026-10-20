"use client";

// Writing in a shape or on a connector: a text box placed over the item (the item hides its own text
// meanwhile), the whole edit recorded as one undo step when it ends. Any press on the canvas ends it.
import { useCallback, useEffect } from "react";
import { FLOWCHART_FONT_SIZE, FLOWCHART_LABEL_FONT_SIZE, FLOWCHART_LIMITS, FLOWCHART_LINE_HEIGHT, fitNodeToText, nodeLines, textWidthFor } from "../schema";
import { updateEdges, updateNodes } from "../ops";
import type { FlowController, Interaction } from "../controller/types";

export type TextEditing = ReturnType<typeof useTextEditing>;

export function useTextEditing(ctrl: FlowController) {
  const { docRef, setLive, commit, undo, redo, editing, editingRef, setEditing, setSel, wrapRef, view, byId, routed } = ctrl;

  /** Starts writing in a shape or on a connector; `replaceWith` replaces a shape's text (typing on it). */
  const startEdit = useCallback(
    (kind: "node" | "edge", id: string, replaceWith?: string) => {
      const before = docRef.current;
      if (replaceWith !== undefined && kind === "node") setLive(updateNodes(before, [id], (n) => fitNodeToText({ ...n, text: replaceWith })));
      setEditing({ kind, id, before, typed: replaceWith !== undefined });
      setSel(kind === "node" ? { nodes: [id], edges: [] } : { nodes: [], edges: [id] });
    },
    [docRef, setLive, setEditing, setSel],
  );

  /** Ends text editing (recorded as one change); `refocus` returns the keyboard to the canvas. */
  const finishEdit = useCallback(
    (refocus = true) => {
      const ed = editingRef.current;
      if (!ed) return;
      editingRef.current = null;
      setEditing(null);
      if (docRef.current !== ed.before) commit(docRef.current, { before: ed.before });
      if (refocus) wrapRef.current?.focus({ preventScroll: true });
    },
    [commit, docRef, editingRef, setEditing, wrapRef],
  );

  const editNode = editing?.kind === "node" ? byId.get(editing.id) : undefined;
  const editEdge = editing?.kind === "edge" ? routed.find((r) => r.edge.id === editing.id) : undefined;
  useEffect(() => {
    // The shape or connector being edited was removed (remote change, undo): stop editing.
    if (editing && !editNode && !editEdge) setEditing(null);
  }, [editing, editNode, editEdge, setEditing]);

  const onEditText = (value: string) => {
    const ed = editingRef.current;
    if (!ed) return;
    const fc = docRef.current;
    if (ed.kind === "node") setLive(updateNodes(fc, [ed.id], (n) => fitNodeToText({ ...n, text: value.slice(0, FLOWCHART_LIMITS.maxText) })));
    else setLive(updateEdges(fc, [ed.id], (x) => ({ ...x, label: value.replace(/\n+/g, " ").slice(0, FLOWCHART_LIMITS.maxLabel) })));
  };

  // ⌘Z / ⇧⌘Z while typing: the text boxes are controlled, so the browser's own undo would reach the
  // note's contenteditable instead (and could undo the whole block). Finish the edit as one step and
  // use the chart's history instead.
  const historyKey = (e: React.KeyboardEvent) => {
    const key = e.key.toLowerCase();
    if (!(e.metaKey || e.ctrlKey) || (key !== "z" && key !== "y")) return false;
    e.preventDefault();
    finishEdit();
    if (key === "y" || e.shiftKey) redo();
    else undo();
    return true;
  };

  let input: React.ReactNode = null;
  if (editNode) {
    const k = view.k;
    const lines = Math.max(1, nodeLines(editNode).length);
    const tw = textWidthFor(editNode) * k;
    const th = lines * FLOWCHART_LINE_HEIGHT * k;
    const cx = (editNode.x + editNode.w / 2) * k + view.x;
    const cy = (editNode.y + editNode.h / 2) * k + view.y;
    input = (
      <textarea
        className="fc-text-input"
        data-color={editNode.color}
        data-shape={editNode.shape}
        autoFocus
        value={editNode.text}
        aria-label={`Text for this ${editNode.shape === "text" ? "text" : "shape"}`}
        style={{ left: cx - tw / 2, top: cy - th / 2, width: tw, height: th + 2, fontSize: FLOWCHART_FONT_SIZE * k, lineHeight: `${FLOWCHART_LINE_HEIGHT * k}px` }}
        onChange={(e) => onEditText(e.target.value)}
        onFocus={(e) => {
          const el = e.currentTarget;
          if (editing?.typed) el.setSelectionRange(el.value.length, el.value.length);
          else el.select();
        }}
        onBlur={() => finishEdit(false)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (historyKey(e)) return;
          if ((e.key === "Enter" && !e.shiftKey) || e.key === "Escape") {
            e.preventDefault();
            finishEdit();
          }
        }}
      />
    );
  } else if (editEdge) {
    const k = view.k;
    const pts = editEdge.points;
    const mid = editEdge.label ? { x: editEdge.label.cx, y: editEdge.label.cy } : (pts[Math.floor(pts.length / 2)] ?? { x: 0, y: 0 });
    const w = Math.max(80, (editEdge.label?.w ?? 60) + 24) * k;
    input = (
      <input
        className="fc-label-input"
        autoFocus
        value={editEdge.edge.label}
        maxLength={FLOWCHART_LIMITS.maxLabel}
        placeholder="Label"
        aria-label="Connector label"
        style={{ left: mid.x * k + view.x - w / 2, top: mid.y * k + view.y - 12 * k, width: w, height: 24 * k, fontSize: FLOWCHART_LABEL_FONT_SIZE * k }}
        onChange={(e) => onEditText(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => finishEdit(false)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (historyKey(e)) return;
          if (e.key === "Enter" || e.key === "Escape") {
            e.preventDefault();
            finishEdit();
          }
        }}
      />
    );
  }

  const interaction: Interaction = {
    // A press anywhere on the canvas ends the edit (without taking the keyboard back: the press decides).
    beforePress: () => {
      if (editingRef.current) finishEdit(false);
    },
  };

  return { interaction, startEdit, finishEdit, /** The text box over the item being edited (HTML, above the SVG). */ input };
}
