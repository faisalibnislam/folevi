"use client";

// Flowchart block: an infinite canvas inside the note (after Whimsical and Miro). Shapes and connectors
// are SVG; the chart lives in the block's `data` (see packages/editor-schema/src/flowchart.ts).
//
//   Pointer   click select · shift-click add · drag move (snaps to the grid and to other shapes' edges)
//             drag empty space to select an area · space-drag, middle-drag or scroll to pan
//             ⌘/ctrl-scroll or pinch to zoom · drag a side handle to connect (drop on empty space for a
//             new connected shape) · double-click to write in a shape or on a connector, or to add one
//   Keyboard  Tab through shapes · Enter edit · arrows nudge (⇧ more) · ⌫ delete · ⌘D duplicate
//             ⌘A select all · ⌘Z / ⇧⌘Z undo and redo · +/− zoom · ⇧1 fit · Esc back to the note
//
// While the canvas has focus it owns ⌘Z (its own history, useFlowDoc); outside it the editor's undo
// reverts whole flowchart edits, and the canvas follows.
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  FLOWCHART_FONT_SIZE,
  FLOWCHART_LABEL_FONT_SIZE,
  FLOWCHART_LIMITS,
  FLOWCHART_LINE_HEIGHT,
  LIMITS,
  OPPOSITE,
  autoSides,
  fitNodeToText,
  flowchartBounds,
  flowchartDirection,
  layoutFlowchart,
  nearestSide,
  nodeLines,
  orthogonalRoute,
  portPoint,
  rectsOverlap,
  roundedPolyline,
  routeEdges,
  serializeFlowchart,
  textWidthFor,
  type FlowchartData,
  type FlowNode,
  type FlowShape,
  type FlowSide,
  type Pt,
  type Rect,
  type RoutedEdge,
} from "@folevi/editor-schema";
import { useAiEnabled } from "@/components/ai/useAi";
import { FlowEdgeLabel, FlowEdgeLine, FlowNodeShape, FlowchartStatic, clampFlowHeight, nodeAriaLabel } from "./render";
import { EdgeBar, MainToolbar, NodeBar, ZoomBar } from "./FlowchartChrome";
import { FlowchartAi } from "./FlowchartAi";
import {
  NO_SELECTION,
  addNode,
  boxOf,
  chartFromDraft,
  connect,
  deleteSelection,
  duplicate,
  moveNodes,
  nodeAt,
  resizeNode,
  setColor,
  setShape,
  snap,
  snapGroup,
  updateEdges,
  updateNodes,
  type FlowDraft,
  type Guide,
  type ResizeHandle,
  type Selection,
} from "./ops";
import { useFlowDoc } from "./useFlowDoc";

const MIN_K = 0.2;
const MAX_K = 2.5;
const HEIGHT_STEP = 40;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

interface View {
  x: number;
  y: number;
  k: number;
}

type Drag =
  | { kind: "pan"; pointer: number; sx: number; sy: number; view: View }
  | { kind: "move"; pointer: number; start: Pt; sx: number; sy: number; origin: Map<string, Pt>; before: FlowchartData; box: Rect; moved: boolean; clicked: string; toggled: boolean }
  | { kind: "marquee"; pointer: number; start: Pt; base: Selection }
  | { kind: "resize"; pointer: number; start: Pt; orig: FlowNode; handle: ResizeHandle; before: FlowchartData }
  | { kind: "link"; pointer: number; from: string; side: FlowSide; sx: number; sy: number; reconnect?: { edge: string; end: "from" | "to" } }
  | { kind: "pinch"; dist: number; view: View; mid: Pt };

/** Text being written in a shape or on a connector; `typed` when it started with a keystroke. */
type Editing = { kind: "node" | "edge"; id: string; before: FlowchartData; typed?: boolean };

/** The flowchart block's node view: the editable canvas, or a static picture in read-only notes. */
export function FlowchartView(props: ReactNodeViewProps) {
  const { node, selected, editor } = props;
  if (!editor.isEditable) {
    return (
      <NodeViewWrapper className={`fb-atom fb-flowchart ${selected ? "fb-atom-selected" : ""}`} aria-label="Flowchart">
        <div contentEditable={false} className="fc-card fc-card-static">
          <FlowchartStatic data={String(node.attrs.data ?? "")} height={Number(node.attrs.height)} />
        </div>
      </NodeViewWrapper>
    );
  }
  return <FlowchartEditor {...props} />;
}

const NodeItem = memo(function NodeItem({ node, selected, hideText, onFocusNode }: { node: FlowNode; selected: boolean; hideText: boolean; onFocusNode: (id: string) => void }) {
  return (
    <g
      className="fc-node"
      data-fc-node={node.id}
      data-shape={node.shape}
      data-color={node.color}
      data-selected={selected || undefined}
      tabIndex={0}
      role="button"
      aria-pressed={selected}
      aria-label={nodeAriaLabel(node)}
      onFocus={() => onFocusNode(node.id)}
    >
      <FlowNodeShape node={node} hideText={hideText} />
      <rect className="fc-focus" x={node.x - 4} y={node.y - 4} width={node.w + 8} height={node.h + 8} rx={12} />
    </g>
  );
});

const EdgeItem = memo(function EdgeItem({ routed, selected }: { routed: RoutedEdge; selected: boolean }) {
  return (
    <g className="fc-edge" data-fc-edge={routed.edge.id} data-selected={selected || undefined}>
      <path className="fc-edge-hit" d={roundedPolyline(routed.points)} />
      <FlowEdgeLine routed={routed} />
    </g>
  );
});

function FlowchartEditor({ node, selected, updateAttributes, editor, getPos }: ReactNodeViewProps) {
  const data = String(node.attrs.data ?? "");
  const savedHeight = clampFlowHeight(node.attrs.height);
  const write = useCallback((s: string) => updateAttributes({ data: s }), [updateAttributes]);
  const { doc, docRef, setLive, commit, undo, redo, canUndo, canRedo, tooLarge } = useFlowDoc(data, write);
  const routed = useMemo(() => routeEdges(doc), [doc]);
  const byId = useMemo(() => new Map(doc.nodes.map((n) => [n.id, n])), [doc]);
  const aiOn = useAiEnabled();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(0);
  const [liveHeight, setLiveHeight] = useState<number | null>(null);
  const height = liveHeight ?? savedHeight;
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [sel, setSel] = useState<Selection>(NO_SELECTION);
  const selRef = useRef(sel);
  selRef.current = sel;
  const [editing, setEditing] = useState<Editing | null>(null);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const [hover, setHover] = useState<string | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [link, setLink] = useState<{ points: Pt[]; target: string | null } | null>(null);
  const [active, setActive] = useState(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  const [aiOpen, setAiOpen] = useState(false);
  const [spaceDown, setSpaceDown] = useState(false);
  const [panning, setPanning] = useState(false);
  const drag = useRef<Drag | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number; type: string }>());
  const frame = useRef<number | null>(null);
  const lastMove = useRef<PointerEvent | null>(null);

  // ------------------------------------------------------------------------------ viewport

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitView = useCallback(
    (fc: FlowchartData = docRef.current, w = wrapRef.current?.clientWidth ?? 0, h = height) => {
      if (!w) return;
      const top = 52; // room for the toolbar
      const b = flowchartBounds(fc);
      if (!b) {
        setView({ x: w / 2, y: (h + top) / 2, k: 1 });
        return;
      }
      const pad = 40;
      const k = clamp(Math.min((w - pad * 2) / Math.max(1, b.w), (h - top - pad * 1.5) / Math.max(1, b.h), 1), MIN_K, MAX_K);
      setView({ k, x: w / 2 - (b.x + b.w / 2) * k, y: top + (h - top) / 2 - (b.y + b.h / 2) * k });
    },
    [docRef, height],
  );

  // Fit once, when the canvas first has a size.
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || !width) return;
    fitted.current = true;
    fitView(docRef.current, width);
  }, [width, fitView, docRef]);

  const toWorld = useCallback((clientX: number, clientY: number): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - r.left - v.x) / v.k, y: (clientY - r.top - v.y) / v.k };
  }, []);

  const zoomAt = useCallback((k: number, sx: number, sy: number) => {
    const v = viewRef.current;
    const nk = clamp(k, MIN_K, MAX_K);
    const wx = (sx - v.x) / v.k;
    const wy = (sy - v.y) / v.k;
    setView({ k: nk, x: sx - wx * nk, y: sy - wy * nk });
  }, []);
  const zoomBy = (f: number) => zoomAt(viewRef.current.k * f, width / 2, height / 2);

  // Wheel: ⌘/ctrl (and trackpad pinch) zooms; plain scrolling pans once the canvas is active, and
  // otherwise scrolls the page as usual.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const r = el.getBoundingClientRect();
        zoomAt(viewRef.current.k * Math.exp(-e.deltaY * unit * 0.0022), e.clientX - r.left, e.clientY - r.top);
      } else if (activeRef.current) {
        e.preventDefault();
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
        setView((v) => ({ ...v, x: v.x - dx * unit, y: v.y - dy * unit }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // ------------------------------------------------------------------------------ edits

  const focusCanvas = () => {
    const a = document.activeElement;
    if (!wrapRef.current?.contains(a) || a instanceof HTMLTextAreaElement || a instanceof HTMLInputElement) wrapRef.current?.focus({ preventScroll: true });
  };

  const startEdit = useCallback((kind: "node" | "edge", id: string, replaceWith?: string) => {
    const before = docRef.current;
    if (replaceWith !== undefined && kind === "node") setLive(updateNodes(before, [id], (n) => fitNodeToText({ ...n, text: replaceWith })));
    setEditing({ kind, id, before, typed: replaceWith !== undefined });
    setSel(kind === "node" ? { nodes: [id], edges: [] } : { nodes: [], edges: [id] });
  }, [docRef, setLive]);

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
    [commit, docRef],
  );

  const viewCenter = (): Pt => {
    const v = viewRef.current;
    return { x: (width / 2 - v.x) / v.k, y: (height / 2 + 20 - v.y) / v.k };
  };

  const add = (shape: FlowShape, at: Pt = viewCenter(), edit = true) => {
    const res = addNode(docRef.current, shape, at);
    if (!res) return null;
    commit(res.doc);
    setSel({ nodes: [res.id], edges: [] });
    if (edit) setEditing({ kind: "node", id: res.id, before: res.doc });
    focusCanvas();
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

  const applyDraft = (draft: FlowDraft, mode: "create" | "update") => {
    const next = chartFromDraft(draft, docRef.current, mode);
    commit(next);
    setSel(NO_SELECTION);
    setAiOpen(false);
    fitView(next);
    wrapRef.current?.focus({ preventScroll: true });
  };

  const exitToNote = () => {
    const pos = typeof getPos === "function" ? getPos() : null;
    if (typeof pos !== "number") return;
    setSel(NO_SELECTION);
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
    editor.view.focus();
  };

  // ------------------------------------------------------------------------------ pointer input

  const onFocusNode = useCallback((id: string) => {
    if (drag.current) return;
    if (!selRef.current.nodes.includes(id)) setSel({ nodes: [id], edges: [] });
  }, []);

  const process = useCallback(
    (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      if (d.kind === "pinch") return;
      if (d.kind === "pan") {
        setView({ ...d.view, x: d.view.x + (e.clientX - d.sx), y: d.view.y + (e.clientY - d.sy) });
        return;
      }
      const p = toWorld(e.clientX, e.clientY);
      const k = viewRef.current.k;
      if (d.kind === "move") {
        if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 3) return;
        d.moved = true;
        const dx = p.x - d.start.x;
        const dy = p.y - d.start.y;
        const moving = { ...d.box, x: d.box.x + dx, y: d.box.y + dy };
        // Only nearby shapes offer alignment (keeps big charts fast and guides relevant).
        const reach = { x: moving.x - 600, y: moving.y - 600, w: moving.w + 1200, h: moving.h + 1200 };
        const others = d.before.nodes.filter((n) => !d.origin.has(n.id) && rectsOverlap(n, reach));
        const s = e.altKey ? { dx: 0, dy: 0, guides: [] } : snapGroup(moving, others, 6 / k);
        setLive(moveNodes(d.before, d.origin, dx + s.dx, dy + s.dy));
        setGuides(s.guides);
      } else if (d.kind === "marquee") {
        const r = { x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y), w: Math.abs(p.x - d.start.x), h: Math.abs(p.y - d.start.y) };
        setMarquee(r);
        const hits = docRef.current.nodes.filter((n) => rectsOverlap(n, r)).map((n) => n.id);
        setSel({ nodes: [...new Set([...d.base.nodes, ...hits])], edges: d.base.edges });
      } else if (d.kind === "resize") {
        const next = resizeNode(d.orig, d.handle, p.x - d.start.x, p.y - d.start.y, e.shiftKey);
        setLive(updateNodes(d.before, [d.orig.id], () => next));
      } else if (d.kind === "link") {
        const fc = docRef.current;
        const src = fc.nodes.find((n) => n.id === d.from);
        if (!src) return;
        const target = nodeAt(fc, p, 8);
        const tgt = target && target.id !== d.from ? target : null;
        const from = portPoint(src, d.side);
        if (tgt) {
          const side = nearestSide(tgt, p);
          setLink({ points: orthogonalRoute(from, d.side, portPoint(tgt, side), side, src, tgt), target: tgt.id });
        } else {
          const probe = { x: p.x, y: p.y, w: 0, h: 0 };
          const side = autoSides(src, probe)[1];
          setLink({ points: orthogonalRoute(from, d.side, p, side, src, probe), target: null });
        }
      }
    },
    [docRef, setLive, toWorld],
  );

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const pts = pointers.current;
    // Hovering near a shape shows its connection handles (a margin keeps them while reaching for one).
    if (!drag.current && e.pointerType !== "touch") {
      const n = nodeAt(docRef.current, toWorld(e.clientX, e.clientY), 26 / viewRef.current.k);
      const next = n?.id ?? null;
      if (next !== hover) setHover(next);
    }
    if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    const d = drag.current;
    if (d?.kind === "pinch" && pts.size >= 2) {
      const [a, b] = [...pts.values()].slice(0, 2) as [Pt, Pt] | [];
      if (!a || !b) return;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const r = svgRef.current!.getBoundingClientRect();
      const mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
      const k = clamp(d.view.k * (dist / d.dist), MIN_K, MAX_K);
      const wx = (d.mid.x - d.view.x) / d.view.k;
      const wy = (d.mid.y - d.view.y) / d.view.k;
      setView({ k, x: mid.x - wx * k, y: mid.y - wy * k });
      return;
    }
    if (!d || !("pointer" in d) || d.pointer !== e.pointerId) return;
    lastMove.current = e.nativeEvent;
    if (frame.current === null) {
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        if (lastMove.current) process(lastMove.current);
      });
    }
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (editingRef.current) finishEdit(false);
    focusCanvas();
    const pts = pointers.current;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    // Two fingers: pinch to zoom (and pan), whatever the first finger was doing.
    if (pts.size === 2 && e.pointerType === "touch") {
      const cur = drag.current;
      if (cur && (cur.kind === "move" || cur.kind === "resize")) setLive(cur.before);
      const [a, b] = [...pts.values()].slice(0, 2) as [Pt, Pt] | [];
      if (!a || !b) return;
      const r = svgRef.current!.getBoundingClientRect();
      drag.current = { kind: "pinch", dist: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), view: viewRef.current, mid: { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top } };
      setMarquee(null);
      setLink(null);
      setGuides([]);
      return;
    }
    if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 1) return;
    const target = e.target as Element;
    const p = toWorld(e.clientX, e.clientY);
    e.currentTarget.setPointerCapture(e.pointerId);
    const onBackground = !target.closest("[data-fc-node],[data-fc-edge],[data-fc-handle],[data-fc-resize],[data-fc-end]");
    if (e.button === 1 || spaceDown || (onBackground && e.pointerType === "touch")) {
      e.preventDefault();
      drag.current = { kind: "pan", pointer: e.pointerId, sx: e.clientX, sy: e.clientY, view: viewRef.current };
      setPanning(true);
      return;
    }
    const fc = docRef.current;
    const handle = target.closest("[data-fc-handle]");
    if (handle) {
      drag.current = { kind: "link", pointer: e.pointerId, from: handle.getAttribute("data-node")!, side: handle.getAttribute("data-side") as FlowSide, sx: e.clientX, sy: e.clientY };
      return;
    }
    const end = target.closest("[data-fc-end]");
    if (end) {
      const edge = fc.edges.find((x) => x.id === end.getAttribute("data-edge"));
      if (!edge) return;
      const which = end.getAttribute("data-fc-end") as "from" | "to";
      const fixed = which === "to" ? edge.from : edge.to;
      const r = routed.find((x) => x.edge.id === edge.id);
      drag.current = { kind: "link", pointer: e.pointerId, from: fixed, side: (which === "to" ? r?.fromSide : r?.toSide) ?? "bottom", sx: e.clientX, sy: e.clientY, reconnect: { edge: edge.id, end: which } };
      return;
    }
    const resize = target.closest("[data-fc-resize]");
    if (resize) {
      const n = fc.nodes.find((x) => x.id === resize.getAttribute("data-node"));
      if (!n) return;
      drag.current = { kind: "resize", pointer: e.pointerId, start: p, orig: n, handle: resize.getAttribute("data-fc-resize") as ResizeHandle, before: fc };
      return;
    }
    const nodeEl = target.closest("[data-fc-node]");
    if (nodeEl) {
      const id = nodeEl.getAttribute("data-fc-node")!;
      const s = selRef.current;
      let nodes = s.nodes;
      let toggled = false;
      if (e.shiftKey || e.metaKey) {
        toggled = true;
        nodes = s.nodes.includes(id) ? s.nodes.filter((x) => x !== id) : [...s.nodes, id];
        setSel({ nodes, edges: s.edges });
      } else if (!s.nodes.includes(id)) {
        nodes = [id];
        setSel({ nodes, edges: [] });
      }
      const moving = fc.nodes.filter((n) => nodes.includes(n.id));
      if (!moving.length) return;
      drag.current = {
        kind: "move",
        pointer: e.pointerId,
        start: p,
        sx: e.clientX,
        sy: e.clientY,
        origin: new Map(moving.map((n) => [n.id, { x: n.x, y: n.y }])),
        before: fc,
        box: boxOf(moving)!,
        moved: false,
        clicked: id,
        toggled,
      };
      return;
    }
    const edgeEl = target.closest("[data-fc-edge]");
    if (edgeEl) {
      const id = edgeEl.getAttribute("data-fc-edge")!;
      const s = selRef.current;
      if (e.shiftKey || e.metaKey) setSel({ nodes: s.nodes, edges: s.edges.includes(id) ? s.edges.filter((x) => x !== id) : [...s.edges, id] });
      else setSel({ nodes: [], edges: [id] });
      return;
    }
    // Empty canvas: select an area (adding to the selection with shift).
    const base = e.shiftKey || e.metaKey ? selRef.current : NO_SELECTION;
    if (!e.shiftKey && !e.metaKey) setSel(NO_SELECTION);
    drag.current = { kind: "marquee", pointer: e.pointerId, start: p, base };
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    const d = drag.current;
    if (d?.kind === "pinch") {
      if (pointers.current.size < 2) drag.current = null;
      return;
    }
    if (!d || d.pointer !== e.pointerId) return;
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
      if (e.type !== "pointercancel") process(e.nativeEvent);
    }
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setPanning(false);
    setGuides([]);
    setMarquee(null);
    if (e.type === "pointercancel") {
      if (d.kind === "move" || d.kind === "resize") setLive(d.before);
      setLink(null);
      return;
    }
    if (d.kind === "move") {
      if (d.moved) commit(docRef.current, { before: d.before });
      else if (!d.toggled && selRef.current.nodes.length > 1) setSel({ nodes: [d.clicked], edges: [] });
    } else if (d.kind === "resize") {
      if (docRef.current !== d.before) commit(docRef.current, { before: d.before });
    } else if (d.kind === "link") {
      setLink(null);
      finishLink(d, e);
    }
  };

  const finishLink = (d: Extract<Drag, { kind: "link" }>, e: React.PointerEvent) => {
    const fc = docRef.current;
    const p = toWorld(e.clientX, e.clientY);
    const src = fc.nodes.find((n) => n.id === d.from);
    if (!src) return;
    const hit = nodeAt(fc, p, 8);
    const target = hit && hit.id !== d.from ? hit : null;
    if (d.reconnect) {
      if (!target) return;
      const side = nearestSide(target, p);
      const edges = updateEdges(fc, [d.reconnect.edge], (x) => (d.reconnect!.end === "to" ? { ...x, to: target.id, toSide: side } : { ...x, from: target.id, fromSide: side }));
      commit(edges);
      return;
    }
    if (target) {
      const res = connect(fc, d.from, target.id, d.side, nearestSide(target, p));
      if (res && res.doc !== fc) {
        commit(res.doc);
        setSel({ nodes: [], edges: [res.id] });
      }
      return;
    }
    // Dropped on empty space: a new shape there, connected (unless it was just a click on the handle).
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 12) return;
    const shape: FlowShape = src.shape === "decision" || src.shape === "terminator" || src.shape === "text" ? "process" : src.shape;
    const inSide = OPPOSITE[d.side];
    const size = { w: src.shape === shape ? src.w : 160, h: src.shape === shape ? src.h : 64 };
    const offset = { top: { x: 0, y: size.h / 2 }, bottom: { x: 0, y: -size.h / 2 }, left: { x: size.w / 2, y: 0 }, right: { x: -size.w / 2, y: 0 } }[inSide];
    const added = addNode(fc, shape, { x: p.x + offset.x, y: p.y + offset.y }, { w: size.w, h: size.h, color: src.color });
    if (!added) return;
    const res = connect(added.doc, d.from, added.id, d.side, inSide);
    if (!res) return;
    commit(res.doc, { before: fc });
    setEditing({ kind: "node", id: added.id, before: res.doc });
    setSel({ nodes: [added.id], edges: [] });
  };

  const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const target = e.target as Element;
    const nodeEl = target.closest("[data-fc-node]");
    if (nodeEl) return startEdit("node", nodeEl.getAttribute("data-fc-node")!);
    const edgeEl = target.closest("[data-fc-edge]");
    if (edgeEl) return startEdit("edge", edgeEl.getAttribute("data-fc-edge")!);
    if (target.closest("[data-fc-handle],[data-fc-resize],[data-fc-end]")) return;
    add("process", toWorld(e.clientX, e.clientY));
  };

  // ------------------------------------------------------------------------------ keyboard

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

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLTextAreaElement || t instanceof HTMLInputElement || t.closest(".fc-bar, .fc-ai")) return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    const s = selRef.current;
    const done = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (e.key === " " && !mod) {
      if (!spaceDown) setSpaceDown(true);
      return done();
    }
    if (mod && key === "z") {
      if (e.shiftKey) redo();
      else undo();
      return done();
    }
    if (mod && key === "y") {
      redo();
      return done();
    }
    if (mod && key === "d") {
      duplicateSelection();
      return done();
    }
    if (mod && key === "a") {
      setSel({ nodes: docRef.current.nodes.map((n) => n.id), edges: docRef.current.edges.map((x) => x.id) });
      return done();
    }
    if (mod) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      removeSelection();
      return done();
    }
    if (e.key === "Escape") {
      if (aiOpen) setAiOpen(false);
      else if (s.nodes.length || s.edges.length) setSel(NO_SELECTION);
      else exitToNote();
      return done();
    }
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const dir = arrows[e.key];
    if (dir) {
      const step = e.shiftKey ? 32 : 8;
      nudge(dir[0] * step, dir[1] * step);
      return done();
    }
    if (e.key === "Enter") {
      if (s.nodes.length === 1 && !s.edges.length) startEdit("node", s.nodes[0]!);
      else if (s.edges.length === 1 && !s.nodes.length) startEdit("edge", s.edges[0]!);
      return done();
    }
    if (e.key === "+" || e.key === "=") {
      zoomBy(1.2);
      return done();
    }
    if (e.key === "-" || e.key === "_") {
      zoomBy(1 / 1.2);
      return done();
    }
    if (e.key === "!" && e.shiftKey) {
      fitView();
      return done();
    }
    // Typing on a selected shape replaces its text.
    if (e.key.length === 1 && !e.altKey && s.nodes.length === 1 && !s.edges.length) {
      startEdit("node", s.nodes[0]!, e.key);
      return done();
    }
  };

  const onKeyUp = (e: React.KeyboardEvent) => {
    if (e.key === " ") setSpaceDown(false);
  };

  // ------------------------------------------------------------------------------ text editing overlay

  const editNode = editing?.kind === "node" ? byId.get(editing.id) : undefined;
  const editEdge = editing?.kind === "edge" ? routed.find((r) => r.edge.id === editing.id) : undefined;
  useEffect(() => {
    // The shape or connector being edited was removed (remote change, undo): stop editing.
    if (editing && !editNode && !editEdge) setEditing(null);
  }, [editing, editNode, editEdge]);

  const onEditText = (value: string) => {
    const ed = editingRef.current;
    if (!ed) return;
    const fc = docRef.current;
    if (ed.kind === "node") setLive(updateNodes(fc, [ed.id], (n) => fitNodeToText({ ...n, text: value.slice(0, FLOWCHART_LIMITS.maxText) })));
    else setLive(updateEdges(fc, [ed.id], (x) => ({ ...x, label: value.replace(/\n+/g, " ").slice(0, FLOWCHART_LIMITS.maxLabel) })));
  };

  let textEditor: React.ReactNode = null;
  if (editNode) {
    const k = view.k;
    const lines = Math.max(1, nodeLines(editNode).length);
    const tw = textWidthFor(editNode) * k;
    const th = lines * FLOWCHART_LINE_HEIGHT * k;
    const cx = (editNode.x + editNode.w / 2) * k + view.x;
    const cy = (editNode.y + editNode.h / 2) * k + view.y;
    textEditor = (
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
    const mid = editEdge.label ? { x: editEdge.label.cx, y: editEdge.label.cy } : pts[Math.floor(pts.length / 2)] ?? { x: 0, y: 0 };
    const w = Math.max(80, (editEdge.label?.w ?? 60) + 24) * k;
    textEditor = (
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
          if (e.key === "Enter" || e.key === "Escape") {
            e.preventDefault();
            finishEdit();
          }
        }}
      />
    );
  }

  // ------------------------------------------------------------------------------ overlays

  const selNodes = sel.nodes.map((id) => byId.get(id)).filter((n): n is FlowNode => Boolean(n));
  const selEdges = sel.edges.map((id) => doc.edges.find((x) => x.id === id)).filter((x): x is NonNullable<typeof x> => Boolean(x));
  const single = selNodes.length === 1 && !selEdges.length && !editing ? selNodes[0]! : null;
  const portNode = link ? null : (single ?? (hover && !editing ? byId.get(hover) ?? null : null));
  const k = view.k;
  const sBox = boxOf([...selNodes, ...selEdges.flatMap((x) => {
    const r = routed.find((rr) => rr.edge.id === x.id);
    return r ? [boxOf(r.points.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })))!] : [];
  })]);
  const showBar = sBox && !drag.current && !editing && (selNodes.length || selEdges.length);
  const barStyle: React.CSSProperties | undefined = sBox
    ? (() => {
        const top = sBox.y * k + view.y;
        const bottom = (sBox.y + sBox.h) * k + view.y;
        const cx = clamp((sBox.x + sBox.w / 2) * k + view.x, 150, Math.max(150, width - 150));
        const above = top - 52 > 56;
        return { left: cx, top: above ? top - 52 : Math.min(height - 48, bottom + 12) };
      })()
    : undefined;
  const same = <T,>(list: T[]): T | null => (list.length && list.every((x) => x === list[0]) ? list[0]! : null);
  const dot = 24 * k < 10 ? 48 * k : 24 * k;
  const resizeHandles: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  const handlePos = (n: FlowNode, h: ResizeHandle): Pt => ({
    x: h.includes("w") ? n.x : h.includes("e") ? n.x + n.w : n.x + n.w / 2,
    y: h.includes("n") ? n.y : h.includes("s") ? n.y + n.h : n.y + n.h / 2,
  });
  const selectedEdge = selEdges.length === 1 && !selNodes.length ? routed.find((r) => r.edge.id === selEdges[0]!.id) : undefined;

  // Height: drag the bottom edge, or focus it and use the arrow keys.
  const resizing = useRef<{ startY: number; startH: number } | null>(null);
  const commitHeight = (h: number) => {
    setLiveHeight(null);
    if (h !== savedHeight) updateAttributes({ height: h });
  };
  const clampH = (h: number) => Math.round(Math.max(LIMITS.minFlowchartHeight, Math.min(LIMITS.maxFlowchartHeight, h)));

  const nodeCount = doc.nodes.length;
  return (
    <NodeViewWrapper className={`fb-atom fb-flowchart ${selected ? "fb-atom-selected" : ""}`} aria-label="Flowchart">
      <div contentEditable={false} className="fc-card" data-active={active || undefined}>
        <div
          ref={wrapRef}
          className="fc-canvas"
          style={{ height }}
          tabIndex={0}
          role="application"
          aria-roledescription="flowchart editor"
          aria-label={`Flowchart, ${nodeCount} shape${nodeCount === 1 ? "" : "s"}`}
          aria-describedby={`${uid}-help`}
          data-panning={panning || undefined}
          data-space={spaceDown || undefined}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onFocus={() => setActive(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setActive(false);
              setSpaceDown(false);
              setHover(null);
            }
          }}
        >
          <p id={`${uid}-help`} className="sr-only">
            Tab moves between shapes. Enter edits the selected shape, arrow keys move it, Delete removes it, Command D duplicates. Command Z undoes. Escape returns to the note.
          </p>
          <svg
            ref={svgRef}
            className="fc-root fc-svg"
            width={width}
            height={height}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={onDoubleClick}
            onMouseDown={(e) => e.preventDefault()}
            onPointerLeave={() => !drag.current && setHover(null)}
          >
            <defs>
              <pattern id={`${uid}-dots`} width={dot} height={dot} patternUnits="userSpaceOnUse" x={view.x % dot} y={view.y % dot}>
                <circle cx={dot / 2} cy={dot / 2} r={1} className="fc-dot" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill={`url(#${uid}-dots)`} />
            <g transform={`translate(${view.x} ${view.y}) scale(${k})`}>
              <g aria-hidden>
                {routed.map((r) => (
                  <EdgeItem key={r.edge.id} routed={r} selected={sel.edges.includes(r.edge.id)} />
                ))}
              </g>
              <g>
                {doc.nodes.map((n) => (
                  <NodeItem key={n.id} node={n} selected={sel.nodes.includes(n.id)} hideText={editing?.kind === "node" && editing.id === n.id} onFocusNode={onFocusNode} />
                ))}
              </g>
              <g aria-hidden>
                {routed.map((r) =>
                  r.label ? (
                    <g key={r.edge.id} className="fc-edge" data-fc-edge={r.edge.id} data-selected={sel.edges.includes(r.edge.id) || undefined}>
                      <FlowEdgeLabel routed={r} hidden={editing?.kind === "edge" && editing.id === r.edge.id} />
                    </g>
                  ) : null,
                )}
              </g>
              <g aria-hidden className="fc-overlay">
                {selNodes.map((n) => (
                  <rect key={n.id} className="fc-sel-box" x={n.x - 3 / k} y={n.y - 3 / k} width={n.w + 6 / k} height={n.h + 6 / k} rx={8} />
                ))}
                {guides.map((g, i) =>
                  g.axis === "x" ? <line key={i} className="fc-guide" x1={g.at} x2={g.at} y1={g.from - 16} y2={g.to + 16} /> : <line key={i} className="fc-guide" y1={g.at} y2={g.at} x1={g.from - 16} x2={g.to + 16} />,
                )}
                {link ? <path className="fc-link-preview" d={roundedPolyline(link.points)} /> : null}
                {link?.target && byId.get(link.target) ? (() => {
                  const t = byId.get(link.target)!;
                  return <rect className="fc-drop-target" x={t.x - 4 / k} y={t.y - 4 / k} width={t.w + 8 / k} height={t.h + 8 / k} rx={10} />;
                })() : null}
                {single
                  ? resizeHandles.map((h) => {
                      const p = handlePos(single, h);
                      const s = 8 / k;
                      return <rect key={h} className="fc-resize" data-fc-resize={h} data-node={single.id} data-dir={h} x={p.x - s / 2} y={p.y - s / 2} width={s} height={s} rx={2 / k} />;
                    })
                  : null}
                {portNode && !drag.current
                  ? (["top", "right", "bottom", "left"] as FlowSide[]).map((side) => {
                      const p = portPoint(portNode, side);
                      const off = 14 / k;
                      const o = { top: [0, -off], right: [off, 0], bottom: [0, off], left: [-off, 0] }[side];
                      return (
                        <g key={side} className="fc-port" data-fc-handle="" data-node={portNode.id} data-side={side}>
                          <circle cx={p.x + o[0]!} cy={p.y + o[1]!} r={12 / k} className="fc-port-hit" />
                          <circle cx={p.x + o[0]!} cy={p.y + o[1]!} r={4.5 / k} className="fc-port-dot" />
                        </g>
                      );
                    })
                  : null}
                {selectedEdge && !editing
                  ? (["from", "to"] as const).map((end) => {
                      const p = end === "from" ? selectedEdge.points[0]! : selectedEdge.points[selectedEdge.points.length - 1]!;
                      return <circle key={end} className="fc-end" data-fc-end={end} data-edge={selectedEdge.edge.id} cx={p.x} cy={p.y} r={5 / k} />;
                    })
                  : null}
                {marquee ? <rect className="fc-marquee" x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} /> : null}
              </g>
            </g>
          </svg>
          {textEditor}
          {!nodeCount && !editing ? (
            <div className="fc-empty">
              <p>Double-click anywhere to add a shape, or pick one above.</p>
              {aiOn ? (
                <button type="button" className="fc-btn fc-btn-text fc-empty-ai" onClick={() => setAiOpen(true)} onPointerDown={(e) => e.stopPropagation()}>
                  Create with AI
                </button>
              ) : null}
            </div>
          ) : null}
          <MainToolbar
            onAdd={(s) => add(s)}
            onTidy={tidy}
            onUndo={undo}
            onRedo={redo}
            canUndo={canUndo}
            canRedo={canRedo}
            canTidy={nodeCount > 1}
            onAi={aiOn ? () => setAiOpen((o) => !o) : null}
            aiOpen={aiOpen}
          />
          <ZoomBar zoom={k} onZoomIn={() => zoomBy(1.2)} onZoomOut={() => zoomBy(1 / 1.2)} onFit={() => fitView()} />
          {showBar && barStyle && selNodes.length && !selEdges.length ? (
            <NodeBar
              style={barStyle}
              color={same(selNodes.map((n) => n.color))}
              shape={same(selNodes.map((n) => n.shape))}
              onColor={(c) => commit(setColor(docRef.current, sel.nodes, c))}
              onShape={(s) => commit(setShape(docRef.current, sel.nodes, s))}
              onDuplicate={duplicateSelection}
              onDelete={removeSelection}
            />
          ) : null}
          {showBar && barStyle && selEdges.length && !selNodes.length ? (
            <EdgeBar
              style={barStyle}
              lineStyle={same(selEdges.map((x) => x.style))}
              arrow={same(selEdges.map((x) => x.arrow))}
              onStyle={(s) => commit(updateEdges(docRef.current, sel.edges, (x) => ({ ...x, style: s })))}
              onArrow={(a) => commit(updateEdges(docRef.current, sel.edges, (x) => ({ ...x, arrow: a })))}
              onLabel={selEdges.length === 1 ? () => startEdit("edge", selEdges[0]!.id) : null}
              onDelete={removeSelection}
            />
          ) : null}
          {aiOpen ? <FlowchartAi hasChart={nodeCount > 0} current={() => serializeFlowchart(docRef.current)} onApply={applyDraft} onClose={() => setAiOpen(false)} /> : null}
          {tooLarge ? (
            <p className="fc-warning" role="alert">
              This flowchart is too large to save. Remove some shapes or text.
            </p>
          ) : null}
        </div>
        <div
          className="fb-wb-resize"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Flowchart height"
          aria-valuemin={LIMITS.minFlowchartHeight}
          aria-valuemax={LIMITS.maxFlowchartHeight}
          aria-valuenow={height}
          tabIndex={0}
          title="Drag to resize (or use the arrow keys)"
          onKeyDown={(e) => {
            const delta = e.key === "ArrowDown" ? HEIGHT_STEP : e.key === "ArrowUp" ? -HEIGHT_STEP : 0;
            if (!delta) return;
            e.preventDefault();
            commitHeight(clampH(height + delta));
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            resizing.current = { startY: e.clientY, startH: height };
          }}
          onPointerMove={(e) => {
            const r = resizing.current;
            if (!r) return;
            setLiveHeight(clampH(r.startH + (e.clientY - r.startY)));
          }}
          onPointerUp={() => {
            if (!resizing.current) return;
            resizing.current = null;
            commitHeight(height);
          }}
          onPointerCancel={() => {
            resizing.current = null;
            setLiveHeight(null);
          }}
        >
          <span aria-hidden />
        </div>
      </div>
    </NodeViewWrapper>
  );
}
