"use client";

// Writing in a shape or on a connector: a text box placed over the item (the item hides its own text
// meanwhile), the whole edit recorded as one undo step when it ends. Any press on the canvas ends it.
import { useCallback, useEffect } from "react";
import { FLOWCHART_LIMITS, fitNodeToText, type FlowParagraph, type FlowTextAlign } from "../schema";
import { updateEdges, updateNodes } from "../ops";
import { finishLabelEdit, setLabelText } from "../connectors";
import { EdgeLabelInput } from "./edgeLabels";
import type { FlowController, Interaction } from "../controller/types";
import { setAlign, withParagraphs } from "../contentOps";
import { ShapeTextEditor } from "./shapeText";

export type TextEditing = ReturnType<typeof useTextEditing>;

export function useTextEditing(ctrl: FlowController, { onImage }: { /** An image pasted or dropped while writing in a shape. */ onImage?: (nodeId: string, file: File) => void } = {}) {
  const { docRef, setLive, commit, undo, redo, editing, editingRef, setEditing, setSel, wrapRef, view, byId, routed } = ctrl;

  /** Starts writing in a shape or on a connector; `replaceWith` replaces a shape's text (typing on it). */
  const startEdit = useCallback(
    (kind: "node" | "edge", id: string, replaceWith?: string) => {
      const before = docRef.current;
      if (replaceWith !== undefined && kind === "node") setLive(updateNodes(before, [id], (n) => fitNodeToText({ ...n, text: replaceWith, rich: undefined })));
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
      // A connector's labels left empty go (interactions/edgeLabels.tsx); nothing written, no undo step.
      const next = ed.kind === "edge" ? finishLabelEdit(docRef.current, ed.before, ed.id) : docRef.current;
      if (next !== docRef.current) setLive(next);
      if (next !== ed.before) commit(next, { before: ed.before });
      if (refocus) wrapRef.current?.focus({ preventScroll: true });
    },
    [commit, docRef, editingRef, setEditing, setLive, wrapRef],
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
    else setLive(updateEdges(fc, [ed.id], (x) => setLabelText(x, ed.label ?? 0, value)));
  };

  // ⌘Z / ⇧⌘Z while typing: the text boxes are controlled, so the browser's own undo would reach the
  // note's contenteditable instead (and could undo the whole block). Finish the edit as one step and
  // use the chart's history instead.
  const onEditLabel = (paragraphs: FlowParagraph[]) => {
    const ed = editingRef.current;
    if (ed?.kind === "node") setLive(updateNodes(docRef.current, [ed.id], (n) => fitNodeToText(withParagraphs(n, paragraphs))));
  };
  const onEditAlign = (align: FlowTextAlign) => {
    const ed = editingRef.current;
    if (ed?.kind === "node") setLive(updateNodes(docRef.current, [ed.id], (n) => setAlign(n, align)));
  };

  const historyKey = (e: React.KeyboardEvent | KeyboardEvent) => {
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
    input = (
      <ShapeTextEditor
        key={editNode.id}
        node={editNode}
        view={view}
        canvasWidth={ctrl.width}
        typed={editing?.typed}
        onChange={onEditLabel}
        onAlign={onEditAlign}
        onFinish={finishEdit}
        onHistoryKey={historyKey}
        onImage={onImage ? (file) => onImage(editNode.id, file) : undefined}
      />
    );
  } else if (editEdge) {
    input = <EdgeLabelInput routed={editEdge} index={editing?.label ?? 0} typed={editing?.typed} view={view} onChange={onEditText} onFinish={finishEdit} onHistoryKey={historyKey} />;
  }

  const interaction: Interaction = {
    // A press anywhere on the canvas ends the edit (without taking the keyboard back: the press decides).
    beforePress: () => {
      if (editingRef.current) finishEdit(false);
    },
  };

  return { interaction, startEdit, finishEdit, /** The text box over the item being edited (HTML, above the SVG). */ input };
}
