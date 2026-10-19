"use client";

// Wireframe block: screens (phone, tablet, browser or plain) built from interface parts, with arrows
// between screens, on a canvas inside the note. The content lives in the block's `data`
// (packages/editor-schema/src/wireframe.ts); the drawing is ./draw.ts, the same for the editor, read-only
// views and export.
//
//   Pointer   click select · shift-click add · drag a part to move it (it snaps to its screen's edges,
//             centre and margins and to other parts; dropped on another screen it moves there) · drag a
//             screen by its name or frame · drag inside a screen or on empty canvas to select an area ·
//             handles resize · the arrow handle links a part or screen to another screen · space-drag,
//             middle-drag or scroll to pan · ⌘/ctrl-scroll or pinch to zoom · double-click to write in a
//             part or rename a screen
//   Touch     tap select · drag a part or a screen's name to move it · drag elsewhere to pan · pinch to
//             zoom · "Select several" makes taps add to the selection · the parts library adds by a tap
//   Keyboard  Tab through parts · Enter edits · arrows nudge (⇧ by 10) · ⌫ delete · ⌘D duplicate
//             ⌘A select all · ⌘Z / ⇧⌘Z undo and redo · +/− zoom · ⇧1 fit · ⇧⌘F full canvas · Esc back
//
// The card, Export (all screens; one screen from its own bar), Full canvas and the height handle come from
// canvas/CanvasCard.tsx. While the canvas has focus it owns ⌘Z (its own history, useWireDoc); outside it the
// editor's undo reverts whole wireframe edits, and the canvas follows.
import type { ReactNodeViewProps } from "@tiptap/react";
import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PanelsTopLeft } from "lucide-react";
import {
  LIMITS,
  WIREFRAME_COMPONENT_LABEL,
  WIREFRAME_DEFAULT_HEIGHT,
  WIREFRAME_FRAME_LABEL,
  WIREFRAME_LIMITS,
  parseWireframe,
  serializeWireframe,
  type WireItem,
  type WireScreen,
  type WireframeComponent,
  type WireframeData,
  type WireframeFrame,
  type WireframeStyle,
} from "@folevi/editor-schema";
import { useAiEnabled } from "@/components/ai/useAi";
import { useToast } from "@/components/ui/Toast";
import { haptic } from "@/lib/nativeApp";
import { CanvasCard } from "../canvas/CanvasCard";
import { copyImage, exportImage } from "../canvas/exportImage";
import type { ExportAction } from "../canvas/BlockExport";
import { useEditorEnvironment } from "../environment";
import { FRAME_INSET, NAME_ROOM, arrowBetween, drawFrameBack, drawFrameFront, drawItem, drawLink, frameBox, linkPaths, screenRadius, wireframeBounds, type Box, type Pt } from "./draw";
import { Library, SelectionBar, Tools, ZoomBar, type LibraryPick } from "./WireframeChrome";
import { WireframeAi, type AiMode } from "./WireframeAi";
import { WireframeViewer } from "./render";
import { wireframeScreenSvg } from "./svg";
import {
  NO_SELECTION,
  RESIZE_HANDLES,
  addLink,
  addPart,
  addScreen,
  align,
  boxOf,
  deleteSelection,
  distribute,
  duplicate,
  isEmpty,
  itemBox,
  itemSnapLines,
  moveItems,
  moveScreens,
  overlaps,
  placeScreens,
  removeLink,
  replaceScreen,
  resizeBox,
  resizeScreen,
  screenAt,
  screenData,
  screenLabel,
  screenOf,
  screenSnapLines,
  snapBox,
  updateItems,
  updateScreens,
  setFrame,
  fitInScreen,
  type Guide,
  type ResizeHandle,
  type Selection,
} from "./ops";
import { useWireDoc } from "./useWireDoc";

const MIN_K = 0.05;
const MAX_K = 4;
/** Room at the top of the canvas for the card's toolbar. */
const TOP = 56;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

interface View {
  x: number;
  y: number;
  k: number;
}

type Drag =
  | { kind: "pan"; pointer: number; sx: number; sy: number; view: View }
  | { kind: "items"; pointer: number; start: Pt; sx: number; sy: number; origin: Map<string, Pt>; before: WireframeData; box: Box; screen: string; moved: boolean; clicked: string; toggled: boolean }
  | { kind: "screens"; pointer: number; start: Pt; sx: number; sy: number; origin: Map<string, Pt>; before: WireframeData; box: Box; moved: boolean; clicked: string; toggled: boolean }
  | { kind: "marquee"; pointer: number; start: Pt; base: Selection; within: string | null; sx: number; sy: number; moved: boolean; tapScreen: string | null }
  | { kind: "resize"; pointer: number; start: Pt; target: "item" | "screen"; id: string; orig: Box; handle: ResizeHandle; before: WireframeData }
  | { kind: "link"; pointer: number; from: string; sx: number; sy: number }
  | { kind: "pinch"; dist: number; view: View; mid: Pt };

/** Text being written in a part, or a screen being renamed. */
type Editing = { kind: "item" | "screen"; id: string; before: WireframeData; typed?: boolean };

/** Parts whose text is a list (one label per line): Enter starts a new line, ⌘Enter finishes. */
const MULTILINE = new Set<WireframeComponent>(["text", "heading", "paragraph", "textarea", "tabs", "navBar", "sidebar", "menu", "breadcrumbs", "card", "table", "list", "modal", "alert"]);

const TEXT_HINT: Partial<Record<WireframeComponent, string>> = {
  tabs: "One tab per line",
  navBar: "Title, then one item per line",
  sidebar: "Title, then one item per line",
  menu: "One item per line",
  breadcrumbs: "One level per line",
  list: "One row per line",
  table: "One row per line, cells split by |. The first line is the header.",
  card: "Title, then the description",
  modal: "Title, then the message",
  icon: "An icon's name: search, menu, user, bell, heart, star…",
  avatar: "A name (its initials show)",
};

/** The wireframe block's node view: the editor, or a pannable picture in read-only notes. */
export function WireframeView(props: ReactNodeViewProps) {
  if (!props.editor.isEditable) return <WireframeReadOnly {...props} />;
  return <WireframeEditor {...props} />;
}

function WireframeReadOnly(props: ReactNodeViewProps) {
  const data = String(props.node.attrs.data ?? "");
  const wf = useMemo(() => parseWireframe(data), [data]);
  return (
    <CanvasCard view={props} type="wireframe" name="Wireframe" icon={<PanelsTopLeft size={14} />} minHeight={LIMITS.minWireframeHeight} maxHeight={LIMITS.maxWireframeHeight} defaultHeight={WIREFRAME_DEFAULT_HEIGHT} empty={!wf.screens.length} hint="This wireframe is empty.">
      {wf.screens.length ? <WireframeViewer wf={wf} fill top={TOP} /> : null}
    </CanvasCard>
  );
}

// ------------------------------------------------------------------------------------------ drawing

const ItemNode = memo(function ItemNode({ it, style, screen, onFocusItem, label }: { it: WireItem; style: WireframeStyle; screen: Pick<WireScreen, "w" | "h" | "frame">; onFocusItem: (id: string) => void; label: string }) {
  const html = useMemo(() => drawItem(it, style, screen), [it, style, screen]);
  return (
    <g className="wf-item" data-wf-item={it.id} transform={`translate(${it.x} ${it.y})`} tabIndex={0} role="button" aria-label={label} onFocus={() => onFocusItem(it.id)}>
      <rect className="wf-hit" width={it.w} height={it.h} />
      <g dangerouslySetInnerHTML={{ __html: html }} />
    </g>
  );
});

const ScreenNode = memo(function ScreenNode({ s, items, style, clipId, onFocusItem, onFocusScreen }: { s: WireScreen; items: WireItem[]; style: WireframeStyle; clipId: string; onFocusItem: (id: string) => void; onFocusScreen: (id: string) => void }) {
  const back = useMemo(() => drawFrameBack(s, style), [s, style]);
  const front = useMemo(() => drawFrameFront(s, style), [s, style]);
  const dims = useMemo(() => ({ w: s.w, h: s.h, frame: s.frame }), [s.w, s.h, s.frame]);
  const fb = frameBox(s);
  const name = screenLabel(s);
  return (
    <g className="wf-screen" data-wf-screen={s.id} transform={`translate(${s.x} ${s.y})`}>
      <g className="wf-name" data-wf-name={s.id} tabIndex={0} role="button" aria-label={`Screen: ${name}, ${WIREFRAME_FRAME_LABEL[s.frame].toLowerCase()}, ${items.length} part${items.length === 1 ? "" : "s"}`} onFocus={() => onFocusScreen(s.id)}>
        <rect className="wf-hit" x={fb.x - s.x} y={fb.y - s.y - NAME_ROOM} width={fb.w} height={NAME_ROOM - 2} />
        <text className="t-name" x={fb.x - s.x} y={-FRAME_INSET[s.frame].top - 14} fontSize={14} fontWeight={600} dominantBaseline="central">
          {s.name || "Untitled screen"}
        </text>
      </g>
      <g data-wf-frame={s.id} dangerouslySetInnerHTML={{ __html: back }} />
      <clipPath id={clipId}>
        <rect width={s.w} height={s.h} rx={screenRadius(s.frame)} />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>
        {items.map((it, i) => (
          <ItemNode key={it.id} it={it} style={style} screen={dims} onFocusItem={onFocusItem} label={`${WIREFRAME_COMPONENT_LABEL[it.kind]}${it.text.trim() ? `: ${it.text.trim().replace(/\s*\n\s*/g, ", ")}` : ""}, part ${i + 1} of ${items.length} on ${name}`} />
        ))}
      </g>
      {front ? <g aria-hidden dangerouslySetInnerHTML={{ __html: front }} /> : null}
    </g>
  );
});

// ------------------------------------------------------------------------------------------ the editor

function WireframeEditor(props: ReactNodeViewProps) {
  const { node, updateAttributes } = props;
  const data = String(node.attrs.data ?? "");
  const write = useCallback((s: string) => updateAttributes({ data: s }), [updateAttributes]);
  const { doc, docRef, setLive, commit, undo, redo, canUndo, canRedo, tooLarge } = useWireDoc(data, write);
  const demo = useEditorEnvironment().demo;
  const aiOn = useAiEnabled() && !demo;
  const toast = useToast();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");

  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [sel, setSelState] = useState<Selection>(NO_SELECTION);
  const selRef = useRef(sel);
  const setSel = useCallback((s: Selection) => {
    selRef.current = s;
    setSelState(s);
  }, []);
  const [editing, setEditing] = useState<Editing | null>(null);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [linkDrag, setLinkDrag] = useState<{ from: string; to: Pt; target: string | null } | null>(null);
  const [library, setLibrary] = useState(false);
  const [ai, setAi] = useState<AiMode | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [panning, setPanning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [coarse, setCoarse] = useState(false);
  const [multi, setMulti] = useState(false);
  const [ghost, setGhost] = useState<{ pick: LibraryPick; x: number; y: number } | null>(null);
  const drag = useRef<Drag | null>(null);
  const pointers = useRef(new Map<number, Pt>());
  const frame = useRef<number | null>(null);
  const lastMove = useRef<PointerEvent | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const read = () => setCoarse(mq.matches);
    read();
    mq.addEventListener("change", read);
    return () => mq.removeEventListener("change", read);
  }, []);

  // ---------------------------------------------------------------------------------- viewport

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitTo = useCallback((b: Box | null, w = stageRef.current?.clientWidth ?? 0, h = stageRef.current?.clientHeight ?? 0) => {
    if (!w || !h) return;
    if (!b) {
      setView({ x: w / 2, y: (h + TOP) / 2, k: 1 });
      return;
    }
    const pad = 32;
    const k = clamp(Math.min((w - pad * 2) / Math.max(1, b.w), (h - TOP - pad * 1.5) / Math.max(1, b.h), 1), MIN_K, MAX_K);
    setView({ k, x: w / 2 - (b.x + b.w / 2) * k, y: TOP + (h - TOP) / 2 - (b.y + b.h / 2) * k });
  }, []);
  const fitAll = useCallback((wf: WireframeData = docRef.current) => fitTo(wireframeBounds(wf)), [docRef, fitTo]);

  // Fit once, when the canvas first has a size.
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || !size.w || !size.h) return;
    fitted.current = true;
    fitAll();
  }, [size.w, size.h, fitAll]);

  const toWorld = useCallback((clientX: number, clientY: number): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - r.left - v.x) / v.k, y: (clientY - r.top - v.y) / v.k };
  }, []);

  const zoomAt = useCallback((k: number, sx: number, sy: number) => {
    const v = viewRef.current;
    const nk = clamp(k, MIN_K, MAX_K);
    setView({ k: nk, x: sx - ((sx - v.x) / v.k) * nk, y: sy - ((sy - v.y) / v.k) * nk });
  }, []);
  const zoomBy = (f: number) => zoomAt(viewRef.current.k * f, size.w / 2, size.h / 2);

  /** Whether the keyboard is in this block (plain scrolling then pans the canvas, not the note). */
  const active = () => Boolean(stageRef.current?.closest(".fb-canvas-card")?.contains(document.activeElement));

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const r = el.getBoundingClientRect();
        zoomAt(viewRef.current.k * Math.exp(-e.deltaY * unit * 0.0022), e.clientX - r.left, e.clientY - r.top);
      } else if (active()) {
        e.preventDefault();
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
        setView((v) => ({ ...v, x: v.x - dx * unit, y: v.y - dy * unit }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const focusCanvas = () => {
    const body = stageRef.current?.closest<HTMLElement>(".fb-canvas-body");
    const a = document.activeElement;
    // The keyboard comes back to the canvas from anywhere else (a toolbar button, a panel, the note).
    if (a !== body && !svgRef.current?.contains(a)) body?.focus({ preventScroll: true });
  };

  // ---------------------------------------------------------------------------------- edits

  const byScreen = useMemo(() => {
    const m = new Map<string, WireItem[]>(doc.screens.map((s) => [s.id, []]));
    for (const it of doc.items) m.get(it.screen)?.push(it);
    return m;
  }, [doc]);
  const paths = useMemo(() => linkPaths(doc), [doc]);

  /** The screen new parts go on: the selected one, the one holding the selection, the one in view, or the last. */
  const targetScreen = (wf: WireframeData): WireScreen | null => {
    const s = selRef.current;
    const picked = s.screens.map((id) => screenOf(wf, id)).find(Boolean) ?? s.items.map((id) => wf.items.find((i) => i.id === id)).map((it) => it && screenOf(wf, it.screen)).find(Boolean);
    if (picked) return picked;
    const v = viewRef.current;
    const centre = { x: (size.w / 2 - v.x) / v.k, y: ((size.h + TOP) / 2 - v.y) / v.k };
    return screenAt(wf, centre, 40) ?? wf.screens[wf.screens.length - 1] ?? null;
  };

  const reveal = (wf: WireframeData, b: Box | null) => {
    if (!b) return;
    const v = viewRef.current;
    const seen = { x: -v.x / v.k, y: (TOP - v.y) / v.k, w: size.w / v.k, h: (size.h - TOP) / v.k };
    const fully = b.x >= seen.x && b.y >= seen.y && b.x + b.w <= seen.x + seen.w && b.y + b.h <= seen.y + seen.h;
    if (!fully) fitTo(boxOf([b, ...(b.w < seen.w && b.h < seen.h ? [] : [])]) ?? wireframeBounds(wf));
  };

  const newScreen = (frameKind: WireframeFrame, at?: Pt) => {
    const res = addScreen(docRef.current, frameKind, at);
    if (!res) return toast.show(`A wireframe holds at most ${WIREFRAME_LIMITS.maxScreens} screens.`);
    commit(res.doc);
    setSel({ screens: [res.id], items: [], links: [] });
    haptic("light");
    const s = screenOf(res.doc, res.id)!;
    if (!at) fitTo(wireframeBounds(res.doc));
    else reveal(res.doc, frameBox(s));
    focusCanvas();
  };

  /** Adds a part: at `at` on `screenId`, or under the parts on the screen in use (making a phone screen when there's none). */
  const newPart = (kind: WireframeComponent, screenId?: string, at?: Pt) => {
    let wf = docRef.current;
    let target = screenId ? screenOf(wf, screenId) : targetScreen(wf);
    if (!target) {
      const made = addScreen(wf, "phone");
      if (!made) return;
      wf = made.doc;
      target = screenOf(wf, made.id)!;
    }
    const res = addPart(wf, target.id, kind, at);
    if (!res) return toast.show(`A wireframe holds at most ${WIREFRAME_LIMITS.maxItems} parts.`);
    commit(res.doc);
    setSel({ screens: [], items: [res.id], links: [] });
    haptic("light");
    const it = res.doc.items.find((i) => i.id === res.id)!;
    if (wf !== docRef.current || !screenId) reveal(res.doc, itemBox(res.doc, it));
    focusCanvas();
  };

  const removeSelection = () => {
    const s = selRef.current;
    if (isEmpty(s)) return;
    commit(deleteSelection(docRef.current, s));
    setSel(NO_SELECTION);
  };

  const duplicateSelection = () => {
    const s = selRef.current;
    if (!s.items.length && !s.screens.length) return;
    const res = duplicate(docRef.current, s);
    commit(res.doc);
    setSel(res.sel);
    if (res.sel.screens.length) fitAll(res.doc);
  };

  const patchItems = (patch: Partial<WireItem>) => {
    const ids = selRef.current.items;
    commit(updateItems(docRef.current, ids, (it) => ({ ...it, ...patch })));
  };

  const setStyle = (style: WireframeStyle) => {
    if (docRef.current.style === style) return;
    commit({ ...docRef.current, style });
  };

  const toggleLink = (from: string, to: string) => {
    const wf = docRef.current;
    if (wf.links.some((l) => l.from === from && l.to === to)) commit(removeLink(wf, from, to));
    else {
      const res = addLink(wf, from, to);
      if (res) commit(res.doc);
    }
  };

  const runExport = async (screenId: string, action: ExportAction) => {
    const svg = wireframeScreenSvg(serializeWireframe(docRef.current), screenId);
    if (!svg) return;
    const s = screenOf(docRef.current, screenId)!;
    try {
      if (action === "copy") {
        await copyImage(svg);
        toast.show("Image copied");
      } else await exportImage(svg, screenLabel(s), action);
    } catch (e) {
      toast.show(action === "copy" ? `Couldn't copy the image. ${(e as Error).message || ""}`.trim() : "Couldn't export the image. Try again.", { tone: "error" });
    }
  };

  const applyAi = (mode: AiMode, result: WireframeData) => {
    const wf = docRef.current;
    let next: WireframeData;
    let picked: Selection;
    const screenId = selRef.current.screens[0];
    if (mode === "refine" && screenId) {
      next = replaceScreen(wf, screenId, result);
      picked = { screens: [screenId], items: [], links: [] };
    } else {
      const right = wf.screens.length ? Math.max(...wf.screens.map((s) => frameBox(s).x + frameBox(s).w)) + 120 + FRAME_INSET.phone.left : 0;
      const top = (mode === "vary" && screenId ? screenOf(wf, screenId)?.y : wf.screens[0]?.y) ?? 0;
      const res = placeScreens(wf, result, { x: right, y: top });
      if (!res.ids.length) return toast.show("Foli AI's screens didn't fit in this wireframe.");
      next = res.doc;
      picked = { screens: res.ids, items: [], links: [] };
    }
    commit(next);
    setSel(picked);
    setAi(null);
    fitAll(next);
    focusCanvas();
  };

  // ---------------------------------------------------------------------------------- text editing

  const startEdit = useCallback(
    (kind: "item" | "screen", id: string, replaceWith?: string) => {
      const before = docRef.current;
      if (replaceWith !== undefined && kind === "item") setLive(updateItems(before, [id], (it) => ({ ...it, text: replaceWith })));
      setEditing({ kind, id, before, typed: replaceWith !== undefined });
      setSel(kind === "item" ? { screens: [], items: [id], links: [] } : { screens: [id], items: [], links: [] });
    },
    [docRef, setLive, setSel],
  );

  const finishEdit = useCallback(
    (refocus = true) => {
      const ed = editingRef.current;
      if (!ed) return;
      editingRef.current = null;
      setEditing(null);
      if (docRef.current !== ed.before) commit(docRef.current, { before: ed.before });
      if (refocus) focusCanvas();
    },
    [commit, docRef],
  );

  const onEditText = (value: string) => {
    const ed = editingRef.current;
    if (!ed) return;
    if (ed.kind === "item") setLive(updateItems(docRef.current, [ed.id], (it) => ({ ...it, text: value.slice(0, WIREFRAME_LIMITS.maxText) })));
    else setLive(updateScreens(docRef.current, [ed.id], (s) => ({ ...s, name: value.replace(/\n+/g, " ").slice(0, WIREFRAME_LIMITS.maxName) })));
  };

  // ⌘Z while typing: finish the edit as one step and use the wireframe's history (the browser's own undo
  // would reach the note).
  const historyKey = (e: React.KeyboardEvent) => {
    const key = e.key.toLowerCase();
    if (!(e.metaKey || e.ctrlKey) || (key !== "z" && key !== "y")) return false;
    e.preventDefault();
    finishEdit();
    if (key === "y" || e.shiftKey) redo();
    else undo();
    return true;
  };

  // ---------------------------------------------------------------------------------- pointer input

  const onFocusItem = useCallback(
    (id: string) => {
      if (drag.current) return;
      if (!selRef.current.items.includes(id)) setSel({ screens: [], items: [id], links: [] });
    },
    [setSel],
  );
  const onFocusScreen = useCallback(
    (id: string) => {
      if (drag.current) return;
      if (!selRef.current.screens.includes(id)) setSel({ screens: [id], items: [], links: [] });
    },
    [setSel],
  );

  const process = useCallback(
    (e: PointerEvent) => {
      const d = drag.current;
      if (!d || d.kind === "pinch") return;
      if (d.kind === "pan") {
        setView({ ...d.view, x: d.view.x + (e.clientX - d.sx), y: d.view.y + (e.clientY - d.sy) });
        return;
      }
      const p = toWorld(e.clientX, e.clientY);
      const k = viewRef.current.k;
      if (d.kind === "items" || d.kind === "screens") {
        if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
        if (!d.moved) setDragging(true);
        d.moved = true;
        const dx = p.x - d.start.x;
        const dy = p.y - d.start.y;
        const moving = { ...d.box, x: d.box.x + dx, y: d.box.y + dy };
        if (d.kind === "items") {
          // Snaps to the screen under the parts (their own, or the one they're over).
          const centre = { x: moving.x + moving.w / 2, y: moving.y + moving.h / 2 };
          const s = screenAt(d.before, centre) ?? screenOf(d.before, d.screen)!;
          const snapped = e.altKey ? { dx: 0, dy: 0, guides: [] } : snapBox(moving, itemSnapLines(d.before, s, new Set(d.origin.keys())), 6 / k, 1, { x: [s.x, s.x + s.w], y: [s.y, s.y + s.h] });
          setLive(moveItems(d.before, d.origin, dx + snapped.dx, dy + snapped.dy));
          setGuides(snapped.guides);
        } else {
          const b = wireframeBounds(d.before);
          const snapped = e.altKey ? { dx: 0, dy: 0, guides: [] } : snapBox(moving, screenSnapLines(d.before, new Set(d.origin.keys())), 8 / k, 8, { x: [Math.min(b?.x ?? 0, moving.x), Math.max((b?.x ?? 0) + (b?.w ?? 0), moving.x + moving.w)], y: [Math.min(b?.y ?? 0, moving.y), Math.max((b?.y ?? 0) + (b?.h ?? 0), moving.y + moving.h)] });
          setLive(moveScreens(d.before, d.origin, dx + snapped.dx, dy + snapped.dy));
          setGuides(snapped.guides);
        }
      } else if (d.kind === "marquee") {
        if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
        d.moved = true;
        const r = { x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y), w: Math.abs(p.x - d.start.x), h: Math.abs(p.y - d.start.y) };
        setMarquee(r);
        const wf = docRef.current;
        if (d.within) {
          const hits = wf.items.filter((it) => it.screen === d.within && overlaps(itemBox(wf, it), r)).map((it) => it.id);
          setSel({ screens: [], items: [...new Set([...d.base.items, ...hits])], links: [] });
        } else {
          const hits = wf.screens.filter((s) => overlaps(frameBox(s), r)).map((s) => s.id);
          setSel({ screens: [...new Set([...d.base.screens, ...hits])], items: [], links: [] });
        }
      } else if (d.kind === "resize") {
        const wf = d.before;
        if (d.target === "item") {
          const it = wf.items.find((i) => i.id === d.id);
          const s = it && screenOf(wf, it.screen);
          if (!it || !s) return;
          let box = resizeBox(d.orig, d.handle, p.x - d.start.x, p.y - d.start.y, WIREFRAME_LIMITS.minItem, Math.max(s.w, s.h), { x: s.x, y: s.y, w: s.w, h: s.h }, e.shiftKey);
          // The moving edges snap to the screen and the other parts.
          if (!e.altKey) {
            const lines = itemSnapLines(wf, s, new Set([it.id]));
            const near = (v: number, list: number[]) => list.reduce((best, t) => (Math.abs(t - v) < Math.abs(best - v) ? t : best), Infinity);
            const g: Guide[] = [];
            const th = 6 / k;
            if (d.handle.includes("e")) {
              const t = near(box.x + box.w, lines.x);
              if (Math.abs(t - (box.x + box.w)) <= th) {
                box = { ...box, w: t - box.x };
                g.push({ axis: "x", at: t, from: s.y, to: s.y + s.h });
              }
            }
            if (d.handle.includes("w")) {
              const t = near(box.x, lines.x);
              if (Math.abs(t - box.x) <= th) {
                box = { ...box, w: box.x + box.w - t, x: t };
                g.push({ axis: "x", at: t, from: s.y, to: s.y + s.h });
              }
            }
            if (d.handle.includes("s")) {
              const t = near(box.y + box.h, lines.y);
              if (Math.abs(t - (box.y + box.h)) <= th) {
                box = { ...box, h: t - box.y };
                g.push({ axis: "y", at: t, from: s.x, to: s.x + s.w });
              }
            }
            if (d.handle.includes("n")) {
              const t = near(box.y, lines.y);
              if (Math.abs(t - box.y) <= th) {
                box = { ...box, h: box.y + box.h - t, y: t };
                g.push({ axis: "y", at: t, from: s.x, to: s.x + s.w });
              }
            }
            setGuides(g);
          }
          setLive(updateItems(wf, [it.id], (x) => fitInScreen({ ...x, x: box.x - s.x, y: box.y - s.y, w: Math.max(WIREFRAME_LIMITS.minItem, box.w), h: Math.max(WIREFRAME_LIMITS.minItem, box.h) }, s)));
        } else {
          const box = resizeBox(d.orig, d.handle, p.x - d.start.x, p.y - d.start.y, WIREFRAME_LIMITS.minScreen, WIREFRAME_LIMITS.maxScreen, undefined, e.shiftKey);
          setLive(resizeScreen(wf, d.id, { ...box, w: Math.round(box.w / 2) * 2, h: Math.round(box.h / 2) * 2 }));
        }
      } else if (d.kind === "link") {
        const wf = docRef.current;
        const over = screenAt(wf, p, 20);
        const fromItem = wf.items.find((i) => i.id === d.from);
        const ok = over && over.id !== d.from && over.id !== fromItem?.screen;
        setLinkDrag({ from: d.from, to: p, target: ok ? over.id : null });
      }
    },
    [docRef, setLive, setSel, toWorld],
  );

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const pts = pointers.current;
    if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = drag.current;
    if (d?.kind === "pinch" && pts.size >= 2) {
      const [a, b] = [...pts.values()] as [Pt, Pt];
      const r = svgRef.current!.getBoundingClientRect();
      const mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
      const k = clamp(d.view.k * (Math.hypot(a.x - b.x, a.y - b.y) / d.dist), MIN_K, MAX_K);
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
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Two fingers: pinch to zoom (and pan), whatever the first finger was doing.
    if (pts.size === 2 && e.pointerType === "touch") {
      const cur = drag.current;
      if (cur && (cur.kind === "items" || cur.kind === "screens" || cur.kind === "resize")) setLive(cur.before);
      const [a, b] = [...pts.values()] as [Pt, Pt];
      const r = svgRef.current!.getBoundingClientRect();
      drag.current = { kind: "pinch", dist: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), view: viewRef.current, mid: { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top } };
      setMarquee(null);
      setLinkDrag(null);
      setGuides([]);
      setDragging(false);
      return;
    }
    if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 1) return;
    const target = e.target as Element;
    const p = toWorld(e.clientX, e.clientY);
    e.currentTarget.setPointerCapture(e.pointerId);
    const touch = e.pointerType === "touch";
    const adding = e.shiftKey || e.metaKey || (touch && multi);
    const wf = docRef.current;
    if (e.button === 1 || spaceDown) {
      e.preventDefault();
      drag.current = { kind: "pan", pointer: e.pointerId, sx: e.clientX, sy: e.clientY, view: viewRef.current };
      setPanning(true);
      return;
    }
    const handle = target.closest("[data-wf-handle]");
    if (handle) {
      const id = handle.getAttribute("data-id")!;
      const kind = handle.getAttribute("data-target") as "item" | "screen";
      const orig = kind === "item" ? itemBox(wf, wf.items.find((i) => i.id === id)!) : (() => {
        const s = screenOf(wf, id)!;
        return { x: s.x, y: s.y, w: s.w, h: s.h };
      })();
      drag.current = { kind: "resize", pointer: e.pointerId, start: p, target: kind, id, orig, handle: handle.getAttribute("data-wf-handle") as ResizeHandle, before: wf };
      return;
    }
    const linkHandle = target.closest("[data-wf-linkhandle]");
    if (linkHandle) {
      drag.current = { kind: "link", pointer: e.pointerId, from: linkHandle.getAttribute("data-wf-linkhandle")!, sx: e.clientX, sy: e.clientY };
      return;
    }
    const linkEl = target.closest("[data-wf-link]");
    if (linkEl) {
      const id = linkEl.getAttribute("data-wf-link")!;
      const s = selRef.current;
      setSel(adding ? { ...s, links: s.links.includes(id) ? s.links.filter((x) => x !== id) : [...s.links, id] } : { screens: [], items: [], links: [id] });
      return;
    }
    const itemEl = target.closest("[data-wf-item]");
    if (itemEl) {
      const id = itemEl.getAttribute("data-wf-item")!;
      const s = selRef.current;
      let items = s.items;
      let toggled = false;
      if (adding) {
        toggled = true;
        items = s.items.includes(id) ? s.items.filter((x) => x !== id) : [...s.items, id];
        setSel({ screens: [], items, links: [] });
      } else if (!s.items.includes(id)) {
        items = [id];
        setSel({ screens: [], items, links: [] });
      }
      const moving = wf.items.filter((it) => items.includes(it.id));
      if (!moving.length) return;
      drag.current = {
        kind: "items",
        pointer: e.pointerId,
        start: p,
        sx: e.clientX,
        sy: e.clientY,
        origin: new Map(moving.map((it) => [it.id, { x: it.x, y: it.y }])),
        before: wf,
        box: boxOf(moving.map((it) => itemBox(wf, it)))!,
        screen: wf.items.find((i) => i.id === id)!.screen,
        moved: false,
        clicked: id,
        toggled,
      };
      return;
    }
    const nameEl = target.closest("[data-wf-name]");
    const frameEl = target.closest("[data-wf-frame]");
    const inScreen = screenAt(wf, p);
    // A screen's name, or its frame outside the screen itself (the bezel, the browser's bar): move the screen.
    const grabbed = nameEl?.getAttribute("data-wf-name") ?? (frameEl && !inScreen ? frameEl.getAttribute("data-wf-frame") : null);
    if (grabbed) {
      const s = selRef.current;
      let screens = s.screens;
      let toggled = false;
      if (adding) {
        toggled = true;
        screens = s.screens.includes(grabbed) ? s.screens.filter((x) => x !== grabbed) : [...s.screens, grabbed];
        setSel({ screens, items: [], links: [] });
      } else if (!s.screens.includes(grabbed)) {
        screens = [grabbed];
        setSel({ screens, items: [], links: [] });
      }
      const moving = wf.screens.filter((x) => screens.includes(x.id));
      if (!moving.length) return;
      drag.current = {
        kind: "screens",
        pointer: e.pointerId,
        start: p,
        sx: e.clientX,
        sy: e.clientY,
        origin: new Map(moving.map((x) => [x.id, { x: x.x, y: x.y }])),
        before: wf,
        box: boxOf(moving.map((x) => ({ x: x.x, y: x.y, w: x.w, h: x.h })))!,
        moved: false,
        clicked: grabbed,
        toggled,
      };
      return;
    }
    // Touch on empty space pans (a tap inside a screen still selects it).
    if (touch && !multi) {
      e.preventDefault();
      drag.current = { kind: "pan", pointer: e.pointerId, sx: e.clientX, sy: e.clientY, view: viewRef.current };
      tapScreen.current = inScreen?.id ?? null;
      setPanning(true);
      return;
    }
    // Inside a screen: select its parts by area (a click selects the screen); on the canvas: screens.
    const base = adding ? selRef.current : NO_SELECTION;
    if (!adding) setSel(NO_SELECTION);
    drag.current = { kind: "marquee", pointer: e.pointerId, start: p, base, within: inScreen?.id ?? null, sx: e.clientX, sy: e.clientY, moved: false, tapScreen: inScreen?.id ?? null };
  };
  const tapScreen = useRef<string | null>(null);

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
    setDragging(false);
    setGuides([]);
    setMarquee(null);
    if (e.type === "pointercancel") {
      if (d.kind === "items" || d.kind === "screens" || d.kind === "resize") setLive(d.before);
      setLinkDrag(null);
      return;
    }
    if (d.kind === "pan") {
      // A tap (no pan) on a screen selects it.
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 6) {
        const id = tapScreen.current;
        setSel(id ? { screens: [id], items: [], links: [] } : NO_SELECTION);
      }
      tapScreen.current = null;
    } else if (d.kind === "items" || d.kind === "screens") {
      if (d.moved) {
        commit(docRef.current, { before: d.before });
        haptic("light");
      } else if (!d.toggled) {
        const s = selRef.current;
        if (d.kind === "items" && s.items.length > 1) setSel({ screens: [], items: [d.clicked], links: [] });
        if (d.kind === "screens" && s.screens.length > 1) setSel({ screens: [d.clicked], items: [], links: [] });
      }
    } else if (d.kind === "resize") {
      if (docRef.current !== d.before) commit(docRef.current, { before: d.before });
    } else if (d.kind === "marquee") {
      if (!d.moved && d.tapScreen) {
        const s = d.base;
        setSel(d.base === NO_SELECTION ? { screens: [d.tapScreen], items: [], links: [] } : { screens: s.screens.includes(d.tapScreen) ? s.screens.filter((x) => x !== d.tapScreen) : [...s.screens, d.tapScreen], items: [], links: [] });
      }
    } else if (d.kind === "link") {
      const target = linkDrag?.target;
      setLinkDrag(null);
      if (target) {
        const res = addLink(docRef.current, d.from, target);
        if (res && res.doc !== docRef.current) {
          commit(res.doc);
          setSel({ screens: [], items: [], links: [res.id] });
          haptic("light");
        }
      }
    }
  };

  const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const target = e.target as Element;
    const itemEl = target.closest("[data-wf-item]");
    if (itemEl) return startEdit("item", itemEl.getAttribute("data-wf-item")!);
    const nameEl = target.closest("[data-wf-name]");
    if (nameEl) return startEdit("screen", nameEl.getAttribute("data-wf-name")!);
    if (target.closest("[data-wf-handle],[data-wf-linkhandle],[data-wf-link]")) return;
    // Inside a screen: a text part there, ready to write in.
    const p = toWorld(e.clientX, e.clientY);
    const s = screenAt(docRef.current, p);
    if (!s) return;
    const res = addPart(docRef.current, s.id, "text", { x: p.x - s.x, y: p.y - s.y });
    if (!res) return;
    commit(res.doc);
    setEditing({ kind: "item", id: res.id, before: res.doc });
    setSel({ screens: [], items: [res.id], links: [] });
  };

  // ---------------------------------------------------------------------------------- the library

  /** A part (or screen) dragged out of the library: it follows the pointer and lands where it's let go. */
  const startLibraryDrag = (pick: LibraryPick, e: React.PointerEvent) => {
    const tile = e.currentTarget as HTMLElement;
    delete tile.dataset.dragged;
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    const stage = stageRef.current!.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 8) return;
      if (!moved) {
        moved = true;
        tile.dataset.dragged = "1";
        haptic("light");
      }
      ev.preventDefault();
      setGhost({ pick, x: ev.clientX - stage.left, y: ev.clientY - stage.top });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setGhost(null);
      if (!moved || ev.type === "pointercancel") return;
      // The click that follows a drag isn't a tap.
      setTimeout(() => delete tile.dataset.dragged, 0);
      const svg = svgRef.current?.getBoundingClientRect();
      const panel = tile.closest(".wf-library")?.getBoundingClientRect();
      const over = (r: DOMRect | undefined) => r && ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
      if (!over(svg) || over(panel)) return;
      const p = toWorld(ev.clientX, ev.clientY);
      if ("frame" in pick) {
        const inset = FRAME_INSET[pick.frame];
        newScreen(pick.frame, { x: Math.round(p.x - inset.left), y: Math.round(p.y - inset.top) });
        return;
      }
      const s = screenAt(docRef.current, p);
      if (!s) return toast.show("Drop parts on a screen.");
      newPart(pick.kind, s.id, { x: p.x - s.x, y: p.y - s.y });
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const pickFromLibrary = (pick: LibraryPick) => {
    if ("frame" in pick) newScreen(pick.frame);
    else newPart(pick.kind);
    // On a narrow card the library covers the canvas: it steps aside once something's added.
    if (size.w < 560) setLibrary(false);
  };

  // ---------------------------------------------------------------------------------- keyboard

  const nudge = (dx: number, dy: number) => {
    const s = selRef.current;
    const wf = docRef.current;
    if (s.items.length) {
      const origin = new Map(wf.items.filter((it) => s.items.includes(it.id)).map((it) => [it.id, { x: it.x, y: it.y }]));
      commit(moveItems(wf, origin, dx, dy), { key: "nudge" });
    } else if (s.screens.length) {
      const origin = new Map(wf.screens.filter((x) => s.screens.includes(x.id)).map((x) => [x.id, { x: x.x, y: x.y }]));
      commit(moveScreens(wf, origin, dx, dy), { key: "nudge" });
    } else setView((v) => ({ ...v, x: v.x - dx * 4, y: v.y - dy * 4 }));
  };

  /** The canvas's keys (CanvasCard calls this first; false hands a key back to the card). */
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>): boolean => {
    const t = e.target as HTMLElement;
    if (t.closest(".wf-panel, .wf-ai, .wf-bar")) return false;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    const s = selRef.current;
    const done = () => {
      e.preventDefault();
      e.stopPropagation();
      return true;
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
      const wf = docRef.current;
      const within = s.items.length ? wf.items.find((i) => i.id === s.items[0])?.screen : s.screens.length === 1 ? s.screens[0] : undefined;
      setSel(within ? { screens: [], items: wf.items.filter((i) => i.screen === within).map((i) => i.id), links: [] } : { screens: wf.screens.map((x) => x.id), items: [], links: [] });
      return done();
    }
    if (mod) return false;
    if (e.key === "Delete" || e.key === "Backspace") {
      removeSelection();
      return done();
    }
    if (e.key === "Escape") {
      if (ai) setAi(null);
      else if (library) setLibrary(false);
      else if (!isEmpty(s)) setSel(NO_SELECTION);
      else return false;
      return done();
    }
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const dir = arrows[e.key];
    if (dir) {
      const step = e.shiftKey ? 10 : 1;
      nudge(dir[0] * step, dir[1] * step);
      return done();
    }
    if (e.key === "Enter") {
      if (s.items.length === 1 && !s.screens.length) startEdit("item", s.items[0]!);
      else if (s.screens.length === 1 && !s.items.length) startEdit("screen", s.screens[0]!);
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
      fitAll();
      return done();
    }
    // Typing on a selected part replaces its text.
    if (e.key.length === 1 && !e.altKey && s.items.length === 1 && !s.screens.length) {
      startEdit("item", s.items[0]!, e.key);
      return done();
    }
    return false;
  };

  const onKeyUp = (e: React.KeyboardEvent) => {
    if (e.key === " ") setSpaceDown(false);
  };

  // ---------------------------------------------------------------------------------- overlays

  const k = view.k;
  const toScreen = (b: Box) => ({ x: b.x * k + view.x, y: b.y * k + view.y, w: b.w * k, h: b.h * k });
  const selItems = sel.items.map((id) => doc.items.find((i) => i.id === id)).filter((i): i is WireItem => Boolean(i));
  const selScreens = sel.screens.map((id) => screenOf(doc, id)).filter((s): s is WireScreen => Boolean(s));
  const selLinks = sel.links.filter((id) => doc.links.some((l) => l.id === id));
  const single = !editing && !dragging ? (selItems.length === 1 && !selScreens.length ? { kind: "item" as const, id: selItems[0]!.id, box: itemBox(doc, selItems[0]!) } : selScreens.length === 1 && !selItems.length ? { kind: "screen" as const, id: selScreens[0]!.id, box: { x: selScreens[0]!.x, y: selScreens[0]!.y, w: selScreens[0]!.w, h: selScreens[0]!.h } } : null) : null;
  const sBox = boxOf([...selItems.map((i) => itemBox(doc, i)), ...selScreens.map((s) => screenBoxOf(s)), ...paths.filter((p) => selLinks.includes(p.link.id)).map((p) => boxOf([{ ...p.start, w: 0, h: 0 }, { ...p.end, w: 0, h: 0 }])!)]);
  const showBar = sBox && !dragging && !editing && !linkDrag && (selItems.length || selScreens.length || selLinks.length);
  const barStyle: React.CSSProperties | undefined = sBox
    ? (() => {
        const r = toScreen(sBox);
        const cx = clamp(r.x + r.w / 2, Math.min(200, size.w / 2), Math.max(Math.min(200, size.w / 2), size.w - 200));
        const above = r.y - 52 > TOP;
        const below = r.y + r.h + 12 <= size.h - 56;
        return { left: cx, top: above ? r.y - 52 : below ? r.y + r.h + 12 : TOP + 4 };
      })()
    : undefined;
  const handle = (coarse ? 14 : 8) / k;
  const hit = (coarse ? 36 : 16) / k;
  const handlePos = (b: Box, h: ResizeHandle): Pt => ({
    x: h.includes("w") ? b.x : h.includes("e") ? b.x + b.w : b.x + b.w / 2,
    y: h.includes("n") ? b.y : h.includes("s") ? b.y + b.h : b.y + b.h / 2,
  });
  const linkFrom = linkDrag ? (screenOf(doc, linkDrag.from) ? frameBox(screenOf(doc, linkDrag.from)!) : (() => {
    const it = doc.items.find((i) => i.id === linkDrag.from);
    return it ? itemBox(doc, it) : null;
  })()) : null;
  const linkTarget = linkDrag?.target ? screenOf(doc, linkDrag.target) : null;
  const linkPreview = linkFrom && linkDrag ? arrowBetween(linkFrom, linkTarget ? frameBox(linkTarget) : { x: linkDrag.to.x, y: linkDrag.to.y, w: 0, h: 0 }) : null;
  const linkedFrom = single ? new Set(doc.links.filter((l) => l.from === single.id).map((l) => l.to)) : new Set<string>();

  const editItem = editing?.kind === "item" ? doc.items.find((i) => i.id === editing.id) : undefined;
  const editScreen = editing?.kind === "screen" ? screenOf(doc, editing.id) : undefined;
  useEffect(() => {
    // The part or screen being edited went away (remote change, undo): stop editing.
    if (editing && !editItem && !editScreen) setEditing(null);
  }, [editing, editItem, editScreen]);

  let textEditor: React.ReactNode = null;
  if (editItem) {
    const r = toScreen(itemBox(doc, editItem));
    const multiline = MULTILINE.has(editItem.kind);
    const w = Math.max(220, Math.min(420, r.w));
    const lines = Math.max(multiline ? 3 : 1, Math.min(8, editItem.text.split("\n").length));
    textEditor = (
      <div className="wf-text-edit ui-pop" style={{ left: clamp(r.x, 8, Math.max(8, size.w - w - 8)), top: clamp(r.y, TOP, Math.max(TOP, size.h - 40 - lines * 20)), width: w }} onPointerDown={(e) => e.stopPropagation()}>
        <textarea
          autoFocus
          rows={lines}
          value={editItem.text}
          placeholder={TEXT_HINT[editItem.kind] ?? (multiline ? "Text" : "Label")}
          aria-label={`Text for this ${WIREFRAME_COMPONENT_LABEL[editItem.kind].toLowerCase()}`}
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
            if (e.key === "Escape" || (e.key === "Enter" && (!multiline ? !e.shiftKey : e.metaKey || e.ctrlKey))) {
              e.preventDefault();
              finishEdit();
            }
          }}
        />
        <p className="wf-text-hint">{multiline ? "⌘Enter to finish" : "Enter to finish"}{TEXT_HINT[editItem.kind] && multiline ? ` · ${TEXT_HINT[editItem.kind]}` : ""}</p>
      </div>
    );
  } else if (editScreen) {
    const fb = toScreen(frameBox(editScreen));
    textEditor = (
      <input
        className="wf-name-edit"
        autoFocus
        value={editScreen.name}
        maxLength={WIREFRAME_LIMITS.maxName}
        placeholder="Screen name"
        aria-label="Screen name"
        style={{ left: fb.x, top: fb.y - 30, width: Math.max(180, fb.w) }}
        onPointerDown={(e) => e.stopPropagation()}
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

  const dot = 24 * k < 10 ? 48 * k : 24 * k;
  const nScreens = doc.screens.length;
  const selScreen = selScreens.length === 1 && !selItems.length ? selScreens[0]! : null;

  return (
    <CanvasCard
      view={props}
      type="wireframe"
      name="Wireframe"
      icon={<PanelsTopLeft size={14} />}
      minHeight={LIMITS.minWireframeHeight}
      maxHeight={LIMITS.maxWireframeHeight}
      defaultHeight={WIREFRAME_DEFAULT_HEIGHT}
      empty={false}
      hint={null}
      onKey={onKey}
      onRefit={() => {
        const el = stageRef.current;
        if (el) fitTo(wireframeBounds(docRef.current), el.clientWidth, el.clientHeight);
      }}
      tools={
        <Tools
          style={doc.style}
          onStyle={setStyle}
          onAddScreen={(f) => newScreen(f)}
          libraryOpen={library}
          onLibrary={() => {
            const opening = !library;
            setLibrary(opening);
            // A wide canvas keeps its screens clear of the library on the left.
            const b = wireframeBounds(docRef.current);
            if (opening && b && size.w >= 560) {
              const left = b.x * view.k + view.x;
              const room = 272;
              if (left < room) setView((v) => ({ ...v, x: v.x + room - left }));
            }
          }}
          onAi={aiOn ? () => setAi((m) => (m ? null : selScreen ? "refine" : "draw")) : null}
          aiOpen={Boolean(ai)}
          onUndo={undo}
          onRedo={redo}
          canUndo={canUndo}
          canRedo={canRedo}
          multi={coarse ? multi : null}
          onMulti={() => setMulti((m) => !m)}
        />
      }
    >
      <div
        ref={stageRef}
        className="wf-stage wf-scope"
        data-panning={panning || undefined}
        data-space={spaceDown || undefined}
        onKeyUp={onKeyUp}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSpaceDown(false);
        }}
      >
        <p id={`${uid}-help`} className="sr-only">
          Tab moves between screens and parts. Enter edits the selected part, arrow keys move it, Delete removes it, Command D duplicates. Command Z undoes. Escape returns to the note.
        </p>
        <svg
          ref={svgRef}
          className="wfd wf-svg"
          data-style={doc.style}
          width={size.w}
          height={size.h}
          role="application"
          aria-roledescription="wireframe editor"
          aria-label={`Wireframe, ${nScreens} screen${nScreens === 1 ? "" : "s"}, ${doc.items.length} part${doc.items.length === 1 ? "" : "s"}`}
          aria-describedby={`${uid}-help`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
          onMouseDown={(e) => e.preventDefault()}
        >
          <defs>
            <pattern id={`${uid}-dots`} width={dot} height={dot} patternUnits="userSpaceOnUse" x={view.x % dot} y={view.y % dot}>
              <circle cx={dot / 2} cy={dot / 2} r={1} className="wf-dot" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#${uid}-dots)`} />
          <g transform={`translate(${view.x} ${view.y}) scale(${k})`}>
            {doc.screens.map((s, i) => (
              <ScreenNode key={s.id} s={s} items={byScreen.get(s.id) ?? []} style={doc.style} clipId={`${uid}-clip${i}`} onFocusItem={onFocusItem} onFocusScreen={onFocusScreen} />
            ))}
            <g className="wf-links">
              {paths.map((p) => (
                <g key={p.link.id} className="wf-link" data-wf-link={p.link.id} data-selected={selLinks.includes(p.link.id) || undefined}>
                  <path className="wf-link-hit" d={p.d} />
                  <g dangerouslySetInnerHTML={{ __html: drawLink(p) }} />
                </g>
              ))}
            </g>
            <g aria-hidden className="wf-overlay">
              {selScreens.map((s) => (
                <rect key={s.id} className="wf-sel" x={s.x - 3 / k} y={s.y - 3 / k} width={s.w + 6 / k} height={s.h + 6 / k} rx={screenRadius(s.frame)} />
              ))}
              {selItems.map((it) => {
                const b = itemBox(doc, it);
                return <rect key={it.id} className="wf-sel" x={b.x - 2 / k} y={b.y - 2 / k} width={b.w + 4 / k} height={b.h + 4 / k} rx={3 / k} />;
              })}
              {guides.map((g, i) => (g.axis === "x" ? <line key={i} className="wf-guide" x1={g.at} x2={g.at} y1={g.from} y2={g.to} /> : <line key={i} className="wf-guide" y1={g.at} y2={g.at} x1={g.from} x2={g.to} />))}
              {marquee ? <rect className="wf-marquee" x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} /> : null}
              {linkPreview ? (
                <>
                  <path className="wf-link-preview" d={linkPreview.d} />
                  {linkTarget ? <rect className="wf-drop" x={frameBox(linkTarget).x} y={frameBox(linkTarget).y} width={frameBox(linkTarget).w} height={frameBox(linkTarget).h} rx={screenRadius(linkTarget.frame) + 8} /> : null}
                </>
              ) : null}
              {single
                ? RESIZE_HANDLES.map((h) => {
                    const p = handlePos(single.box, h);
                    return (
                      <g key={h} className="wf-handle" data-wf-handle={h} data-target={single.kind} data-id={single.id} data-dir={h}>
                        <rect className="wf-handle-hit" x={p.x - hit / 2} y={p.y - hit / 2} width={hit} height={hit} />
                        <rect className="wf-handle-dot" x={p.x - handle / 2} y={p.y - handle / 2} width={handle} height={handle} rx={2 / k} />
                      </g>
                    );
                  })
                : null}
              {single && nScreens > 1 && !linkDrag ? (
                <g className="wf-linkhandle" data-wf-linkhandle={single.id}>
                  <circle cx={single.box.x + single.box.w + (coarse ? 30 : 20) / k} cy={single.box.y + single.box.h / 2} r={(coarse ? 22 : 12) / k} className="wf-handle-hit" />
                  <circle cx={single.box.x + single.box.w + (coarse ? 30 : 20) / k} cy={single.box.y + single.box.h / 2} r={(coarse ? 11 : 8) / k} className="wf-linkhandle-dot" />
                  <path className="wf-linkhandle-arrow" d={`M${single.box.x + single.box.w + ((coarse ? 30 : 20) - 4) / k} ${single.box.y + single.box.h / 2}h${8 / k}m${-3 / k} ${-3 / k}l${3 / k} ${3 / k}l${-3 / k} ${3 / k}`} />
                </g>
              ) : null}
            </g>
          </g>
        </svg>
        {textEditor}
        {!nScreens ? (
          <div className="wf-empty">
            <p>Add a phone, tablet or browser screen, then drag interface parts onto it.</p>
            <div className="wf-empty-actions" onPointerDown={(e) => e.stopPropagation()}>
              <button type="button" className="wf-chip" onClick={() => newScreen("phone")}>
                Phone screen
              </button>
              <button type="button" className="wf-chip" onClick={() => newScreen("browser")}>
                Browser screen
              </button>
              {aiOn ? (
                <button type="button" className="wf-chip" onClick={() => setAi("draw")}>
                  Draw with Foli AI
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        <ZoomBar zoom={k} onZoomIn={() => zoomBy(1.2)} onZoomOut={() => zoomBy(1 / 1.2)} onFit={() => fitAll()} />
        {showBar && barStyle ? (
          <SelectionBar
            style={barStyle}
            items={selItems}
            screens={selScreens}
            links={selLinks.length}
            allScreens={doc.screens}
            linkedTo={linkedFrom}
            onEditText={selItems.length === 1 && !selScreens.length ? () => startEdit("item", selItems[0]!.id) : null}
            onRename={selScreen ? () => startEdit("screen", selScreen.id) : null}
            onPatch={patchItems}
            onFrame={(f) => commit(setFrame(docRef.current, sel.screens, f))}
            onToggleLink={single && !selLinks.length ? (to) => toggleLink(single.id, to) : null}
            onAlign={(a) => commit(a === "spaceX" ? distribute(docRef.current, sel.items, "x") : a === "spaceY" ? distribute(docRef.current, sel.items, "y") : align(docRef.current, sel.items, a))}
            onExport={selScreen ? (a) => void runExport(selScreen.id, a) : null}
            onAiVary={aiOn && selScreen ? () => setAi("vary") : null}
            onAiRefine={aiOn && selScreen ? () => setAi("refine") : null}
            onDuplicate={duplicateSelection}
            onDelete={removeSelection}
          />
        ) : null}
        {library ? <Library style={doc.style} compact={size.w < 560} onPick={pickFromLibrary} onDragStart={startLibraryDrag} onClose={() => {
              setLibrary(false);
              focusCanvas();
            }} /> : null}
        {ai ? (
          <WireframeAi
            key={ai}
            mode={ai}
            screen={selScreen ? () => JSON.stringify(screenData(docRef.current, selScreen.id)) : null}
            screenName={selScreen ? screenLabel(selScreen) : null}
            onResult={applyAi}
            onClose={() => {
              setAi(null);
              focusCanvas();
            }}
          />
        ) : null}
        {ghost ? (
          <div className="wf-ghost ui-pop" style={{ left: ghost.x, top: ghost.y }} aria-hidden>
            {"frame" in ghost.pick ? `${WIREFRAME_FRAME_LABEL[ghost.pick.frame]} screen` : WIREFRAME_COMPONENT_LABEL[ghost.pick.kind]}
          </div>
        ) : null}
        {tooLarge ? (
          <p className="wf-warning" role="alert">
            This wireframe is too large to save. Remove some screens or parts.
          </p>
        ) : null}
      </div>
    </CanvasCard>
  );
}

/** A screen's own area (no frame or name), for the selection bar's position. */
const screenBoxOf = (s: WireScreen): Box => ({ x: s.x, y: s.y, w: s.w, h: s.h });
