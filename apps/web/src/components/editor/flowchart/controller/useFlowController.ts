"use client";

// The flowchart editor's state in one place: the chart and its history (useFlowDoc), the selection, text
// editing state, the viewport, and the canvas elements. Interactions, the renderer and the chrome all
// receive this controller; none of them keeps a second copy of the chart or the selection.
import { useCallback, useId, useMemo, useRef, useState } from "react";
import type { ReactNodeViewProps } from "@tiptap/react";
import { routeEdges, type FlowNode } from "../schema";
import { NO_SELECTION, type Selection } from "../ops";
import { clampFlowHeight } from "../render";
import { useFlowDoc } from "../useFlowDoc";
import { useViewport } from "./useViewport";
import type { ActiveDrag, Editing, FlowController } from "./types";

export function useFlowController(props: ReactNodeViewProps): FlowController {
  const { node, updateAttributes } = props;
  const data = String(node.attrs.data ?? "");
  const savedHeight = clampFlowHeight(node.attrs.height);
  const write = useCallback((s: string) => updateAttributes({ data: s }), [updateAttributes]);
  const { doc, docRef, setLive, commit, undo, redo, canUndo, canRedo, tooLarge } = useFlowDoc(data, write);
  const routed = useMemo(() => routeEdges(doc), [doc]);
  const byId = useMemo(() => new Map(doc.nodes.map((n) => [n.id, n])), [doc]);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");

  const wrapRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const [active, setActive] = useState(false);
  const activeRef = useRef(active);
  activeRef.current = active;

  const viewport = useViewport({ docRef, cardRef, wrapRef, svgRef, activeRef, savedHeight });

  const [sel, setSel] = useState<Selection>(NO_SELECTION);
  const selRef = useRef(sel);
  selRef.current = sel;
  const [editing, setEditing] = useState<Editing | null>(null);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const [aiOpen, setAiOpen] = useState(false);
  const dragRef = useRef<ActiveDrag | null>(null);
  const isDragging = useCallback(() => dragRef.current !== null, []);

  const focusCanvas = () => {
    const a = document.activeElement;
    if (!wrapRef.current?.contains(a) || a instanceof HTMLTextAreaElement || a instanceof HTMLInputElement) wrapRef.current?.focus({ preventScroll: true });
  };

  const onFocusNode = useCallback((id: string) => {
    if (dragRef.current) return;
    if (!selRef.current.nodes.includes(id)) setSel({ nodes: [id], edges: [] });
  }, []);

  const selNodes = sel.nodes.map((id) => byId.get(id)).filter((n): n is FlowNode => Boolean(n));
  const selEdges = sel.edges.map((id) => doc.edges.find((x) => x.id === id)).filter((x): x is NonNullable<typeof x> => Boolean(x));
  const single = selNodes.length === 1 && !selEdges.length && !editing ? selNodes[0]! : null;
  const selectedEdge = selEdges.length === 1 && !selNodes.length ? routed.find((r) => r.edge.id === selEdges[0]!.id) : undefined;

  return {
    props,
    doc,
    docRef,
    setLive,
    commit,
    undo,
    redo,
    canUndo,
    canRedo,
    tooLarge,
    routed,
    byId,
    sel,
    selRef,
    setSel,
    selNodes,
    selEdges,
    single,
    selectedEdge,
    editing,
    editingRef,
    setEditing,
    ...viewport,
    savedHeight,
    active,
    activeRef,
    setActive,
    aiOpen,
    setAiOpen,
    isDragging,
    dragRef,
    cardRef,
    wrapRef,
    svgRef,
    uid,
    focusCanvas,
    onFocusNode,
  };
}
