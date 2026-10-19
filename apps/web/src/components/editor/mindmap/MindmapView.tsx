"use client";

// Mind map block: ideas branching out from a central one (after Whimsical and Miro), always laid out tidily
// by the shared layout (packages/editor-schema mindmapLayout.ts). The content lives in the block's `data`
// (mindmap.ts); this view keeps its own copy and history (useMindDoc) and writes back as edits settle.
//
//   Keyboard  Tab add an idea inside · ⇧Enter add one after · ⇧Tab move up a level · arrows move between
//             ideas · ⌥↑/⌥↓ reorder · typing replaces the selected idea's text · Enter or F2 edits ·
//             while writing, Enter adds the next idea (Enter on an empty one stops) and Tab one inside ·
//             Space folds a branch · ⌫ deletes (with what's inside) · ⌘Z / ⇧⌘Z undo and redo ·
//             +/− zoom · ⇧1 fit · ⌘C / ⌘V copy and paste branches as lists · ⇧⌘F full canvas · Esc back
//   Pointer   click select · double-click edit · drag an idea onto another to move it there (its top or
//             bottom edge: next to it) · the + beside the selected idea adds one inside · drag the
//             background, scroll or pinch to pan and zoom · right-click or a long press for the idea's menu
//
// The card, its toolbar, Full canvas, Export (./svg.ts) and the height handle are canvas/CanvasCard.tsx.
// While the block has focus it owns ⌘Z; outside it the note's undo reverts whole mind map edits.
import type { ReactNodeViewProps } from "@tiptap/react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Waypoints, X } from "lucide-react";
import {
  LIMITS,
  MINDMAP_DEFAULT_HEIGHT,
  MINDMAP_LIMITS,
  layoutMindmap,
  mindOuterPoint,
  mindmapChildren,
  mindmapFromMarkdown,
  mindmapRoot,
  outlineFromMarkdown,
  mindmapToTree,
  parseMindmap,
  serializeMindmap,
  type MindBox,
  type MindmapData,
  type MindmapSide,
  type MindTreeNode,
} from "@folevi/editor-schema";
import { useAiEnabled } from "@/components/ai/useAi";
import { useToast } from "@/components/ui/Toast";
import { ContextMenu } from "@/components/ui/Menu";
import { haptic } from "@/lib/nativeApp";
import { aiProblem } from "@/components/ai/AiCredits";
import { CanvasCard } from "../canvas/CanvasCard";
import { MindBadge, MindIdea, MindLinkPath, MindmapStatic, ideaLabel } from "./render";
import { badgeOf, rootSide } from "./geometry";
import { IdeaBar, MindmapTools, ZoomBar, ideaMenu, moreItems, type IdeaActions } from "./MindmapChrome";
import { MindmapOutline } from "./MindmapOutline";
import { MindmapAi, useMindmapAi, type AiStart } from "./MindmapAi";
import { insertAfterMindmap, mindmapToList, takePendingAi, tasksMarkdown } from "./noteConvert";
import { addChild, addIdeas, addSibling, branchIds, byId, depthOf, moveIdea, outdent, removeIdeas, reorder, setAllCollapsed, setCollapsed, setColor, setLayout, setText, startMap, tidy } from "./ops";
import { useMindDoc } from "./useMindDoc";

const MIN_K = 0.2;
const MAX_K = 2.5;
const TOP = 56; // room for the card's toolbar
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const LONG_PRESS_MS = 450;

interface View {
  x: number;
  y: number;
  k: number;
}
interface Pt {
  x: number;
  y: number;
}
type Drop = { kind: "child" | "before" | "after"; id: string } | { kind: "side"; side: MindmapSide };
type Drag =
  | { kind: "pan"; pointer: number; sx: number; sy: number; view: View; moved: boolean }
  | { kind: "idea"; pointer: number; id: string; sx: number; sy: number; moved: boolean; touch: boolean; held: boolean }
  | { kind: "pinch"; dist: number; view: View; mid: Pt };
/** Text being written in an idea. `before` is the map to undo to; `fresh` when the idea was just added. */
type Editing = { id: string; before: MindmapData; typed?: boolean; fresh?: boolean; from?: string; selectAll?: boolean };

export function MindmapView(props: ReactNodeViewProps) {
  return props.editor.isEditable ? <MindmapEditor {...props} /> : <MindmapReadOnly {...props} />;
}

/** In a read-only note: the drawing with zoom and pan, in the same card. */
function MindmapReadOnly(props: ReactNodeViewProps) {
  const data = String(props.node.attrs.data ?? "");
  const empty = !parseMindmap(data).nodes.length;
  return (
    <CanvasCard view={props} type="mindmap" name="Mind map" icon={<Waypoints size={14} />} minHeight={LIMITS.minMindmapHeight} maxHeight={LIMITS.maxMindmapHeight} defaultHeight={MINDMAP_DEFAULT_HEIGHT} empty={empty} hint="This mind map is empty.">
      {(_full, height) =>
        empty ? null : (
          <div className="fb-vc-content mm-readonly">
            <MindmapStatic data={data} height={height - 60} />
          </div>
        )
      }
    </CanvasCard>
  );
}

function MindmapEditor(props: ReactNodeViewProps) {
  const { node, editor, getPos, updateAttributes } = props;
  const data = String(node.attrs.data ?? "");
  const write = useCallback((s: string) => updateAttributes({ data: s }), [updateAttributes]);
  const { doc: map, docRef, setLive, commit, undo, redo, flush, canUndo, canRedo, tooLarge } = useMindDoc(data, write);
  const aiOn = useAiEnabled();
  const ai = useMindmapAi();
  const toast = useToast();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");

  const [focus, setFocus] = useState<string | null>(null);
  const focusId = focus && map.nodes.some((n) => n.id === focus) ? focus : null;
  const layout = useMemo(() => layoutMindmap(map, { focus: focusId }), [map, focusId]);
  const side = rootSide(layout);
  const root = mindmapRoot(map);

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const viewRef = useRef(view);
  const [sel, setSel] = useState<string | null>(null);
  const selected = sel && layout.byId.has(sel) ? sel : null;
  const selRef = useRef(selected);
  const [editing, setEditing] = useState<Editing | null>(null);
  const editingRef = useRef(editing);
  const [hover, setHover] = useState<string | null>(null);
  const [outline, setOutline] = useState(false);
  const [aiStart, setAiStart] = useState<AiStart | null>(null);
  const [menu, setMenu] = useState<{ at: Pt; id: string } | null>(null);
  const [ghost, setGhost] = useState<{ id: string; at: Pt; drop: Drop | null } | null>(null);
  const [busyIdea, setBusyIdea] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const [active, setActive] = useState(false);
  const activeRef = useRef(active);
  const drag = useRef<Drag | null>(null);
  const pointers = useRef(new Map<number, Pt & { type: string }>());
  const pressTimer = useRef<number | null>(null);
  const lastTap = useRef<{ id: string; at: number } | null>(null);
  const reveal = useRef(false);
  useLayoutEffect(() => {
    viewRef.current = view;
    selRef.current = selected;
    editingRef.current = editing;
    activeRef.current = active;
  });
  const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

  // ------------------------------------------------------------------------------ viewport

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [outline]);

  const fitView = useCallback(
    (l = layout, w = wrapRef.current?.clientWidth ?? size.w, h = wrapRef.current?.clientHeight ?? size.h) => {
      if (!w || !h) return;
      const b = l.bounds;
      if (!b) {
        setView({ x: w / 2, y: TOP + (h - TOP) / 2, k: 1 });
        return;
      }
      const pad = 36;
      const k = clamp(Math.min((w - pad * 2) / Math.max(1, b.w), (h - TOP - pad * 1.6) / Math.max(1, b.h), 1), MIN_K, MAX_K);
      setView({ k, x: w / 2 - (b.x + b.w / 2) * k, y: TOP + (h - TOP) / 2 - (b.y + b.h / 2) * k });
    },
    [layout, size],
  );

  // Fit once, when the canvas first has a size.
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || !size.w || !size.h) return;
    fitted.current = true;
    fitView();
  }, [size, fitView]);

  /** Keeps an idea on screen (after the keyboard moved to it, or it grew). */
  const keepInView = useCallback(
    (id: string) => {
      const b = layout.byId.get(id);
      const { w, h } = { w: wrapRef.current?.clientWidth ?? 0, h: wrapRef.current?.clientHeight ?? 0 };
      if (!b || !w) return;
      const v = viewRef.current;
      const m = 40;
      const left = b.x * v.k + v.x;
      const right = (b.x + b.w) * v.k + v.x;
      const top = b.y * v.k + v.y;
      const bottom = (b.y + b.h) * v.k + v.y;
      let dx = 0;
      let dy = 0;
      if (left < m) dx = m - left;
      else if (right > w - m) dx = Math.max(m - left, w - m - right);
      if (top < TOP + 8) dy = TOP + 8 - top;
      else if (bottom > h - 64) dy = Math.max(TOP + 8 - top, h - 64 - bottom);
      if (dx || dy) setView({ ...v, x: v.x + dx, y: v.y + dy });
    },
    [layout],
  );
  useEffect(() => {
    if (!reveal.current) return;
    reveal.current = false;
    const id = editing?.id ?? selected;
    if (id) keepInView(id);
  }, [layout, selected, editing, keepInView]);

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
  const zoomBy = (f: number) => zoomAt(viewRef.current.k * f, size.w / 2, size.h / 2);

  // ⌘/ctrl-scroll (and a trackpad pinch) zooms; plain scrolling pans once the block is active, and scrolls
  // the note otherwise.
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
  }, [zoomAt, outline]);

  // ------------------------------------------------------------------------------ edits

  const focusCanvas = () => {
    const a = document.activeElement;
    if (!wrapRef.current?.contains(a) || a instanceof HTMLTextAreaElement || a instanceof HTMLInputElement) wrapRef.current?.focus({ preventScroll: true });
  };

  const select = useCallback((id: string | null, show = true) => {
    setSel(id);
    if (show) reveal.current = true;
  }, []);

  /** Starts writing in an idea (`replaceWith`: the key typed on it, which replaces its text). */
  const startEdit = useCallback(
    (id: string, replaceWith?: string, selectAll = false) => {
      const before = docRef.current;
      if (replaceWith !== undefined) setLive(setText(before, id, replaceWith));
      setEditing({ id, before, typed: replaceWith !== undefined, selectAll });
      select(id);
    },
    [docRef, setLive, select],
  );

  /** Adds an idea (inside, after or before `from`) and starts writing in it; one undo step with its text. */
  const addAndEdit = useCallback(
    (kind: "child" | "after" | "before", from: string, base = docRef.current) => {
      const r = kind === "child" ? addChild(base, from) : addSibling(base, from, kind === "before");
      if (!r) {
        toast.show(base.nodes.length >= MINDMAP_LIMITS.maxNodes ? "This mind map has as many ideas as it can hold." : "That's as deep as a mind map goes.");
        return;
      }
      setLive(r.map);
      setEditing({ id: r.id, before: base, fresh: true, from });
      select(r.id);
      if (coarse) haptic("light");
    },
    [docRef, setLive, select, toast, coarse],
  );

  /**
   * Ends writing (recorded as one change). An idea just added and left empty goes away again. `then`
   * carries on the way an outliner does: the next idea, one inside, or this one a level up.
   */
  const finishEdit = useCallback(
    (opts: { refocus?: boolean; then?: "next" | "inside" | "outdent" } = {}) => {
      const ed = editingRef.current;
      if (!ed) return;
      editingRef.current = null;
      setEditing(null);
      const cur = docRef.current;
      const n = byId(cur, ed.id);
      if (ed.fresh && n && !n.text.trim()) {
        setLive(ed.before);
        // Back on the idea it was added from.
        select(ed.from ?? n.parent);
        if (opts.refocus !== false) wrapRef.current?.focus({ preventScroll: true });
        return;
      }
      if (cur !== ed.before) commit(cur, { before: ed.before });
      // Carrying on writing keeps the keyboard in the next idea's text box (it mounts with the focus).
      if (opts.refocus !== false && !opts.then) wrapRef.current?.focus({ preventScroll: true });
      if (!n) return;
      if (opts.then === "next") {
        if (n.parent === null) addAndEdit("child", n.id);
        else addAndEdit("after", n.id);
      } else if (opts.then === "inside") addAndEdit("child", n.id);
      else if (opts.then === "outdent") {
        const next = outdent(docRef.current, n.id);
        if (next !== docRef.current) commit(next);
        startEdit(n.id);
      }
    },
    [commit, docRef, setLive, select, addAndEdit, startEdit],
  );

  const removeSelected = () => {
    const id = selRef.current;
    if (!id || id === root?.id) return;
    const r = removeIdeas(docRef.current, [id]);
    commit(r.map);
    select(r.select);
    if (coarse) haptic("warning");
  };

  const toggle = (id: string) => {
    const n = byId(docRef.current, id);
    if (!n || n.parent === null) return;
    commit(setCollapsed(docRef.current, id, !n.collapsed));
  };

  const doTidy = () => {
    const next = tidy(docRef.current);
    if (next !== docRef.current) commit(next);
    requestAnimationFrame(() => fitView(layoutMindmap(next, { focus: focusId })));
  };

  const start = (text = "") => {
    const before = docRef.current;
    const r = startMap(text, before.layout);
    setLive(r.map);
    setEditing({ id: r.id, before, typed: Boolean(text) });
    select(r.id);
    requestAnimationFrame(() => fitView(layoutMindmap(r.map)));
  };

  const exitToList = () => {
    const pos = typeof getPos === "function" ? getPos() : null;
    if (typeof pos !== "number") return;
    // Saved first, so the list is made from what's on screen (and nothing is left to save into a block that's gone).
    flush();
    mindmapToList(editor, pos);
  };

  const insertInNote = (markdown: string) => {
    const pos = typeof getPos === "function" ? getPos() : null;
    if (typeof pos === "number") insertAfterMindmap(editor, pos, markdown);
  };

  const applyMap = (data: string, why: "new" | "tidy") => {
    const next = parseMindmap(data);
    if (!next.nodes.length) return;
    commit(why === "new" ? { ...next, layout: docRef.current.nodes.length ? docRef.current.layout : next.layout } : next);
    setFocus(null);
    select(mindmapRoot(next)?.id ?? null, false);
    requestAnimationFrame(() => fitView(layoutMindmap(next)));
  };

  const applyIdeas = (parent: string, ideas: { text: string; children?: { text: string }[] }[]) => {
    const r = addIdeas(docRef.current, parent, ideas);
    if (r.ids.length) {
      commit(r.map);
      reveal.current = true;
    }
  };

  const expandWithAi = async (id: string) => {
    if (busyIdea) return;
    setBusyIdea(id);
    try {
      const r = await ai.expand(serializeMindmap(docRef.current), id);
      applyIdeas(id, r.ideas);
      toast.show(`Foli AI added ${r.ideas.length} idea${r.ideas.length === 1 ? "" : "s"}. Undo with ⌘Z.`);
    } catch (e) {
      toast.show(aiProblem(e).message, { tone: "error" });
    } finally {
      setBusyIdea(null);
    }
  };

  const tasksWithAi = async (id: string) => {
    if (busyIdea) return;
    setBusyIdea(id);
    try {
      const r = await ai.tasks(serializeMindmap(docRef.current), id === root?.id ? [] : [id]);
      insertInNote(tasksMarkdown(r.tasks));
      toast.show(`Added ${r.tasks.length} task${r.tasks.length === 1 ? "" : "s"} to the note, below the map.`);
    } catch (e) {
      toast.show(aiProblem(e).message, { tone: "error" });
    } finally {
      setBusyIdea(null);
    }
  };

  // Made from the note ("Mind map with Foli AI" in the block menu): open Foli AI on that text, once.
  useEffect(() => {
    const p = takePendingAi(String(node.attrs.id ?? ""));
    if (p && aiOn) setAiStart({ tab: "new", source: "text", text: p.text, auto: true });
    // Only when the block first appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------------------ clipboard

  const onCopy = (e: React.ClipboardEvent) => {
    const id = selRef.current;
    if (!id || editingRef.current || outline || isField(e.target)) return;
    const tree = mindmapToTree(docRef.current, id);
    if (!tree) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", treeToMarkdown(tree));
  };
  const onPaste = (e: React.ClipboardEvent) => {
    if (editingRef.current || outline || isField(e.target)) return;
    const text = e.clipboardData.getData("text/plain");
    if (!text.trim()) return;
    e.preventDefault();
    if (!docRef.current.nodes.length) {
      const pasted = mindmapFromMarkdown(text);
      commit({ ...pasted, layout: docRef.current.layout });
      requestAnimationFrame(() => fitView(layoutMindmap(pasted)));
      return;
    }
    // Lines or a nested list go inside the selected idea (or the centre), nested as pasted.
    const parent = selRef.current ?? root?.id;
    if (!parent) return;
    let next = docRef.current;
    const stack: string[] = [parent];
    for (const item of outlineFromMarkdown(text).items) {
      const under = stack[Math.min(item.depth, stack.length - 1)]!;
      const r = addChild(next, under, item.text);
      if (!r) break;
      next = r.map;
      stack.length = Math.min(item.depth, stack.length - 1) + 1;
      stack.push(r.id);
    }
    if (next !== docRef.current) commit(next);
  };

  // ------------------------------------------------------------------------------ pointer input

  const clearPress = () => {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  const dropAt = (p: Pt, dragId: string): Drop | null => {
    const m = docRef.current;
    const branch = branchIds(m, dragId);
    let hit: MindBox | null = null;
    for (const b of layout.boxes) if (!branch.has(b.id) && p.x >= b.x - 8 && p.x <= b.x + b.w + 8 && p.y >= b.y - 8 && p.y <= b.y + b.h + 8) hit = b;
    if (hit) {
      if (hit.depth === 0) return { kind: "child", id: hit.id };
      const t = hit.side === "down" ? (p.x - hit.x) / hit.w : (p.y - hit.y) / hit.h;
      return t < 0.28 ? { kind: "before", id: hit.id } : t > 0.72 ? { kind: "after", id: hit.id } : { kind: "child", id: hit.id };
    }
    // A main branch dragged across the centre (both sides) changes sides.
    const n = byId(m, dragId);
    const centre = layout.rootId ? layout.byId.get(layout.rootId) : null;
    if (m.layout === "both" && !focusId && centre && n?.parent === centre.id) {
      const s: MindmapSide = p.x < centre.x + centre.w / 2 ? "left" : "right";
      if (s !== layout.byId.get(dragId)?.side) return { kind: "side", side: s };
    }
    return null;
  };

  const applyDrop = (id: string, d: Drop) => {
    const m = docRef.current;
    let next: MindmapData;
    if (d.kind === "child") next = moveIdea(m, id, d.id);
    else if (d.kind === "side") next = root ? moveIdea(m, id, root.id, null, d.side) : m;
    else {
      const t = byId(m, d.id);
      if (!t?.parent) return;
      const sibs = (mindmapChildren(m).get(t.parent) ?? []).filter((s) => s.id !== id);
      const i = sibs.findIndex((s) => s.id === d.id);
      const before = d.kind === "before" ? d.id : (sibs[i + 1]?.id ?? null);
      const sideOf = t.parent === root?.id ? (layout.byId.get(d.id)?.side as MindmapSide | undefined) : undefined;
      next = moveIdea(m, id, t.parent, before, sideOf === "left" || sideOf === "right" ? sideOf : undefined);
    }
    if (next !== m) {
      commit(next);
      if (coarse) haptic("light");
    }
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (editingRef.current) finishEdit({ refocus: false });
    focusCanvas();
    const pts = pointers.current;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    // Two fingers: pinch to zoom (and pan), whatever the first one was doing.
    if (pts.size === 2 && e.pointerType === "touch") {
      clearPress();
      setGhost(null);
      const [a, b] = [...pts.values()].slice(0, 2) as Pt[] as [Pt, Pt];
      const r = svgRef.current!.getBoundingClientRect();
      drag.current = { kind: "pinch", dist: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), view: viewRef.current, mid: { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top } };
      return;
    }
    if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 1) return;
    const target = e.target as Element;
    const add = target.closest("[data-mm-add]");
    if (add) {
      e.preventDefault();
      addAndEdit("child", add.getAttribute("data-mm-add")!);
      return;
    }
    const tog = target.closest("[data-mm-toggle]");
    if (tog) {
      e.preventDefault();
      toggle(tog.getAttribute("data-mm-toggle")!);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    const idea = target.closest("[data-mm-node]");
    if (idea && e.button === 0) {
      const id = idea.getAttribute("data-mm-node")!;
      select(id, false);
      const touch = e.pointerType !== "mouse";
      drag.current = { kind: "idea", pointer: e.pointerId, id, sx: e.clientX, sy: e.clientY, moved: false, touch, held: false };
      if (touch) {
        // As on iOS: hold for the idea's menu; keep holding and move to lift the idea and carry it.
        const at = { x: e.clientX, y: e.clientY };
        pressTimer.current = window.setTimeout(() => {
          pressTimer.current = null;
          const d = drag.current;
          if (d?.kind !== "idea" || d.moved) return;
          d.held = true;
          haptic("medium");
          setMenu({ at, id });
        }, LONG_PRESS_MS);
      }
      return;
    }
    // The background: pan.
    drag.current = { kind: "pan", pointer: e.pointerId, sx: e.clientX, sy: e.clientY, view: viewRef.current, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const pts = pointers.current;
    if (!drag.current && e.pointerType === "mouse") {
      const el = (e.target as Element).closest("[data-mm-node]");
      const next = el?.getAttribute("data-mm-node") ?? null;
      if (next !== hover) setHover(next);
    }
    if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    const d = drag.current;
    if (!d) return;
    if (d.kind === "pinch") {
      if (pts.size < 2) return;
      const [a, b] = [...pts.values()].slice(0, 2) as Pt[] as [Pt, Pt];
      const r = svgRef.current!.getBoundingClientRect();
      const mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
      const k = clamp(d.view.k * (Math.hypot(a.x - b.x, a.y - b.y) / d.dist), MIN_K, MAX_K);
      const wx = (d.mid.x - d.view.x) / d.view.k;
      const wy = (d.mid.y - d.view.y) / d.view.k;
      setView({ k, x: mid.x - wx * k, y: mid.y - wy * k });
      return;
    }
    if (d.pointer !== e.pointerId) return;
    const dist = Math.hypot(e.clientX - d.sx, e.clientY - d.sy);
    if (d.kind === "pan") {
      if (!d.moved && dist < 3) return;
      d.moved = true;
      setPanning(true);
      setView({ ...d.view, x: d.view.x + (e.clientX - d.sx), y: d.view.y + (e.clientY - d.sy) });
      return;
    }
    if (!d.moved && dist < (d.touch ? 10 : 5)) return;
    if (!d.moved) {
      clearPress();
      // A finger that moves before the hold pans, as it would anywhere; the centre can't move, so it pans too.
      if ((d.touch && !d.held) || d.id === layout.rootId) {
        drag.current = { kind: "pan", pointer: d.pointer, sx: d.sx, sy: d.sy, view: viewRef.current, moved: true };
        return;
      }
      if (d.held) {
        setMenu(null);
        haptic("light");
      }
      d.moved = true;
    }
    const at = toWorld(e.clientX, e.clientY);
    setGhost({ id: d.id, at, drop: dropAt(at, d.id) });
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    clearPress();
    const d = drag.current;
    if (d?.kind === "pinch") {
      if (pointers.current.size < 2) drag.current = null;
      return;
    }
    if (!d || d.pointer !== e.pointerId) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setPanning(false);
    const g = ghost;
    setGhost(null);
    if (e.type === "pointercancel") return;
    if (d.kind === "pan") {
      if (!d.moved) select(null, false);
      return;
    }
    if (d.moved) {
      const drop = g?.drop ?? dropAt(toWorld(e.clientX, e.clientY), d.id);
      if (drop) applyDrop(d.id, drop);
      return;
    }
    // Held for the menu and let go: the menu stays.
    if (d.held) return;
    // A tap: a second tap on the same idea edits it (touch has no double-click).
    if (d.touch) {
      const now = Date.now();
      if (lastTap.current && lastTap.current.id === d.id && now - lastTap.current.at < 350) {
        lastTap.current = null;
        startEdit(d.id);
      } else lastTap.current = { id: d.id, at: now };
    }
  };

  const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const idea = (e.target as Element).closest("[data-mm-node]");
    if (idea) startEdit(idea.getAttribute("data-mm-node")!, undefined, true);
    else if (!docRef.current.nodes.length) start();
  };

  const onContextMenu = (e: React.MouseEvent<SVGSVGElement>) => {
    const idea = (e.target as Element).closest("[data-mm-node]");
    if (!idea) return;
    e.preventDefault();
    const id = idea.getAttribute("data-mm-node")!;
    select(id, false);
    setMenu({ at: { x: e.clientX, y: e.clientY }, id });
  };

  // ------------------------------------------------------------------------------ keyboard

  /** The idea an arrow key leads to: children, parent, siblings, else the nearest idea that way. */
  const neighbour = (id: string, key: string): string | null => {
    const b = layout.byId.get(id);
    if (!b) return null;
    const out = b.depth === 0 ? (key === "ArrowLeft" ? "left" : key === "ArrowRight" ? "right" : key === "ArrowDown" && b.side === "down" ? "down" : null) : b.side;
    const grow = out === "left" ? "ArrowLeft" : out === "right" ? "ArrowRight" : out === "down" ? "ArrowDown" : null;
    const back = b.side === "down" ? "ArrowUp" : b.side === "left" ? "ArrowRight" : "ArrowLeft";
    const cy = b.y + b.h / 2;
    const cx = b.x + b.w / 2;
    if (key === grow) {
      const kids = b.children.map((c) => layout.byId.get(c)!).filter((c) => c && (b.depth > 0 || c.side === out));
      if (kids.length) return kids.reduce((best, c) => (Math.abs(c.y + c.h / 2 - cy) + Math.abs(c.x + c.w / 2 - cx) * (out === "down" ? 1 : 0) < Math.abs(best.y + best.h / 2 - cy) + Math.abs(best.x + best.w / 2 - cx) * (out === "down" ? 1 : 0) ? c : best)).id;
      if (b.hidden) {
        toggle(id);
        return null;
      }
    }
    if (b.depth > 0 && key === back) return b.parent;
    // Siblings along the column (or row), then the nearest idea in that direction.
    const dir = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[key as "ArrowUp"];
    if (!dir) return null;
    let best: string | null = null;
    let score = Infinity;
    for (const c of layout.boxes) {
      if (c.id === id) continue;
      const dx = c.x + c.w / 2 - cx;
      const dy = c.y + c.h / 2 - cy;
      const along = dx * dir[0]! + dy * dir[1]!;
      if (along <= 4) continue;
      const across = Math.abs(dx * dir[1]! - dy * dir[0]!);
      const sibling = c.parent === b.parent ? 0.5 : 1;
      const s = (along + across * 2.5) * sibling;
      if (s < score) {
        score = s;
        best = c.id;
      }
    }
    return best;
  };

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>): boolean => {
    const t = e.target as HTMLElement;
    if (t.closest(".mm-ai, .mm-bar, .mm-outline, [role='menu']")) return false;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    const done = () => {
      e.preventDefault();
      e.stopPropagation();
      return true;
    };
    if (mod && key === "z") {
      if (e.shiftKey) redo();
      else undo();
      return done();
    }
    if (mod && key === "y") {
      redo();
      return done();
    }
    if (e.key === "Escape") {
      if (aiStart) return (setAiStart(null), done());
      if (focusId) return (setFocus(null), requestAnimationFrame(() => fitView(layoutMindmap(docRef.current))), done());
      return false;
    }
    if (mod || outline) return false;
    const m = docRef.current;
    if (!m.nodes.length) {
      if (e.key === "Enter" || e.key === "Tab" || e.key === "F2") return (start(), done());
      if (e.key.length === 1 && !e.altKey && e.key !== " ") return (start(e.key), done());
      return false;
    }
    const id = selRef.current;
    if (!id) {
      if (e.key.startsWith("Arrow") || e.key === "Enter" || e.key === "Tab" || e.key === "F2" || e.key === " ") return (select(layout.rootId), done());
      return false;
    }
    const n = byId(m, id);
    if (!n) return false;
    switch (e.key) {
      case "Tab":
        if (e.shiftKey) {
          const next = outdent(m, id);
          if (next !== m) commit(next);
        } else addAndEdit("child", id);
        return done();
      case "Enter":
        if (e.shiftKey) addAndEdit(n.parent === null ? "child" : "after", id);
        else startEdit(id);
        return done();
      case "F2":
        startEdit(id);
        return done();
      case " ":
        toggle(id);
        return done();
      case "Delete":
      case "Backspace":
        removeSelected();
        return done();
      case "ArrowUp":
      case "ArrowDown":
      case "ArrowLeft":
      case "ArrowRight": {
        if (e.altKey) {
          // ⌥↑ / ⌥↓ reorder ideas in a column; ⌥← / ⌥→ in a top-down tree's row.
          const down = layout.byId.get(id)?.side === "down";
          const vertical = e.key === "ArrowUp" || e.key === "ArrowDown";
          if (vertical !== down) {
            const next = reorder(m, id, e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 1);
            if (next !== m) commit(next);
          }
          return done();
        }
        const to = neighbour(id, e.key);
        if (to) select(to);
        return done();
      }
    }
    if (e.key === "+" || e.key === "=") return (zoomBy(1.2), done());
    if (e.key === "-" || e.key === "_") return (zoomBy(1 / 1.2), done());
    if (e.shiftKey && (e.key === "!" || e.code === "Digit1")) return (fitView(), done());
    // Typing on a selected idea replaces its text.
    if (e.key.length === 1 && !e.altKey) return (startEdit(id, e.key), done());
    return false;
  };

  // ------------------------------------------------------------------------------ writing in an idea

  const editBox = editing ? layout.byId.get(editing.id) : undefined;
  useEffect(() => {
    // The idea being written in went away (another device, undo) or out of view (folded): stop.
    if (editing && !editBox) setEditing(null);
  }, [editing, editBox]);

  const onEditText = (value: string) => {
    const ed = editingRef.current;
    if (!ed) return;
    setLive(setText(docRef.current, ed.id, value.replace(/\n{2,}/g, "\n")));
    reveal.current = true;
  };

  let textEditor: React.ReactNode = null;
  if (editing && editBox) {
    const k = view.k;
    const n = byId(map, editing.id);
    textEditor = (
      <textarea
        key={editing.id}
        className="mm-text-input"
        data-depth={Math.min(editBox.depth, 2)}
        data-color={editBox.color}
        autoFocus
        rows={1}
        value={n?.text ?? ""}
        placeholder={editBox.depth === 0 ? "Central idea" : "New idea"}
        maxLength={MINDMAP_LIMITS.maxText}
        aria-label={editBox.depth === 0 ? "Central idea" : "Idea"}
        enterKeyHint="next"
        style={{
          left: editBox.x * k + view.x,
          top: editBox.y * k + view.y,
          width: editBox.w * k,
          height: editBox.h * k,
          fontSize: editBox.font * k,
          fontWeight: editBox.weight,
          lineHeight: `${editBox.lineHeight * k}px`,
          padding: `${(editBox.h - editBox.lines.length * editBox.lineHeight) / 2 * k}px ${4 * k}px`,
        }}
        onChange={(e) => onEditText(e.target.value)}
        onFocus={(e) => {
          const el = e.currentTarget;
          // Double-click selects the text to replace it; Enter, F2 and typing put the caret at the end.
          if (editing.selectAll) el.select();
          else el.setSelectionRange(el.value.length, el.value.length);
        }}
        onBlur={() => finishEdit({ refocus: false })}
        onKeyDown={(e) => {
          e.stopPropagation();
          const mod = e.metaKey || e.ctrlKey;
          const key = e.key.toLowerCase();
          if (mod && (key === "z" || key === "y")) {
            e.preventDefault();
            finishEdit();
            if (key === "y" || e.shiftKey) redo();
            else undo();
            return;
          }
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            // Enter on an empty new idea just stops; otherwise the next idea follows.
            const empty = !e.currentTarget.value.trim();
            finishEdit({ then: empty || mod ? undefined : "next" });
          } else if (e.key === "Tab") {
            e.preventDefault();
            finishEdit({ then: e.shiftKey ? "outdent" : "inside" });
          } else if (e.key === "Escape") {
            e.preventDefault();
            finishEdit();
          }
        }}
      />
    );
  }

  // ------------------------------------------------------------------------------ overlays

  const k = view.k;
  const selBox = selected ? layout.byId.get(selected) : undefined;
  const showControls = selBox && !editing && !ghost && !outline;
  const hitR = (coarse ? 22 : 13) / k;
  const dotR = 10 / k;
  /**
   * Where an idea's fold toggle and add button sit: the toggle just outside it where its branch grows; the
   * add button there too for a leaf (or past the count of a folded idea), and under it (beside it, top
   * down) when its children already fill that side.
   */
  const outerControls = (b: MindBox) => {
    const toggleOn = b.hasChildren && b.depth > 0;
    const togglePt = toggleOn && !b.hidden ? mindOuterPoint(b, 6 / k + dotR * 0.8, side) : null;
    if (b.children.length) {
      const gapPx = 8 / k + dotR;
      const addPt = b.side === "down" ? { x: b.x + b.w + gapPx, y: b.y + b.h / 2 } : { x: b.x + b.w / 2, y: b.y + b.h + gapPx };
      return { togglePt, addPt };
    }
    const off = b.hidden ? 6 + badgeOf(b.hidden).w + 8 / k + dotR : 8 / k + dotR;
    return { togglePt, addPt: mindOuterPoint(b, off, side) };
  };

  const ideaActions = (id: string): IdeaActions | null => {
    const n = byId(map, id);
    const b = layout.byId.get(id);
    if (!n || !b) return null;
    return {
      isRoot: n.parent === null,
      hasChildren: b.hasChildren,
      collapsed: Boolean(n.collapsed),
      focused: focusId === id,
      canOutdent: depthOf(map, id) >= 2,
      color: n.color,
      shown: b.color,
      aiOn,
      onAddChild: () => addAndEdit("child", id),
      onAddSibling: () => addAndEdit(n.parent === null ? "child" : "after", id),
      onEdit: () => startEdit(id),
      onToggle: () => toggle(id),
      onFocus: () => {
        const next = focusId === id ? null : id;
        setFocus(next);
        requestAnimationFrame(() => fitView(layoutMindmap(docRef.current, { focus: next })));
      },
      onOutdent: () => {
        const next = outdent(docRef.current, id);
        if (next !== docRef.current) commit(next);
      },
      onColor: (c) => commit(setColor(docRef.current, [id], c)),
      onExpandAi: () => void expandWithAi(id),
      onTasksAi: () => void tasksWithAi(id),
      onDelete: () => {
        const r = removeIdeas(docRef.current, [id]);
        commit(r.map);
        select(r.select, false);
        haptic("warning");
      },
    };
  };
  const selActions = selected ? ideaActions(selected) : null;
  const barStyle: React.CSSProperties | undefined = selBox
    ? (() => {
        const top = selBox.y * k + view.y;
        const bottom = (selBox.y + selBox.h) * k + view.y;
        const half = coarse ? 150 : 110;
        const cx = clamp((selBox.x + selBox.w / 2) * k + view.x, half + 8, Math.max(half + 8, size.w - half - 8));
        const barH = coarse ? 52 : 40;
        const above = top - barH - 8 > TOP;
        return { left: cx, top: above ? top - barH - 8 : Math.min(size.h - barH - 8, bottom + 10) };
      })()
    : undefined;

  const empty = !map.nodes.length;
  const count = map.nodes.length;
  const selLabel = selBox ? ideaLabel(selBox) : "";
  const tools = (
    <MindmapTools
      layout={map.layout}
      onLayout={(l) => {
        const next = setLayout(docRef.current, l);
        commit(next);
        requestAnimationFrame(() => fitView(layoutMindmap(next, { focus: focusId })));
      }}
      onTidy={doTidy}
      canTidy={count > 1}
      outline={outline}
      onOutline={() => {
        if (editingRef.current) finishEdit({ refocus: false });
        setOutline((o) => !o);
      }}
      onAi={aiOn ? () => setAiStart((s) => (s ? null : { tab: count ? "map" : "new" })) : null}
      aiOpen={Boolean(aiStart)}
      onUndo={undo}
      onRedo={redo}
      canUndo={canUndo}
      canRedo={canRedo}
      more={moreItems({
        hasMap: count > 0,
        onExpandAll: () => commit(setAllCollapsed(docRef.current, false)),
        onCollapseAll: () => commit(setAllCollapsed(docRef.current, true, 1)),
        onFit: () => fitView(),
        onToList: exitToList,
      })}
    />
  );

  const hint = (
    <>
      Start with the central idea, then branch out from it.
      <span className="mm-start">
        <button type="button" className="mm-start-btn" onClick={() => start()}>
          Add the central idea
        </button>
        {aiOn ? (
          <button type="button" className="mm-start-btn" onClick={() => setAiStart({ tab: "new" })}>
            Make one with Foli AI
          </button>
        ) : null}
      </span>
    </>
  );

  return (
    <CanvasCard
      view={props}
      type="mindmap"
      name="Mind map"
      icon={<Waypoints size={14} />}
      minHeight={LIMITS.minMindmapHeight}
      maxHeight={LIMITS.maxMindmapHeight}
      defaultHeight={MINDMAP_DEFAULT_HEIGHT}
      empty={empty && !editing && !aiStart}
      hint={hint}
      tools={tools}
      onKey={onKey}
      onRefit={() => fitView()}
    >
      <div
        ref={wrapRef}
        className="mm-canvas"
        tabIndex={-1}
        role="application"
        aria-roledescription="mind map editor"
        aria-label={`Mind map, ${count} idea${count === 1 ? "" : "s"}`}
        aria-describedby={`${uid}-help`}
        data-active={active || undefined}
        data-panning={panning || undefined}
        data-outline={outline || undefined}
        // The block has its own menus (an idea's on right-click or a long press), not the note's.
        data-native-menu=""
        onFocus={() => setActive(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setActive(false);
            setHover(null);
            // Leaving the block saves what's pending, so the note's own commands see the map as shown.
            flush();
          }
        }}
        onCopy={onCopy}
        onPaste={onPaste}
      >
        <p id={`${uid}-help`} className="sr-only">
          Arrow keys move between ideas. Tab adds an idea inside, Shift Enter adds one after, Enter or F2 edits, typing replaces the text, Space folds a branch, Delete removes it. Command Z undoes. Escape returns to the note.
        </p>
        <p className="sr-only" aria-live="polite">
          {selLabel}
        </p>
        {outline ? (
          <div className="mm-outline-wrap">
            {empty ? null : (
              <MindmapOutline
                map={map}
                commit={commit}
                undo={undo}
                redo={redo}
                selected={selected}
                onSelect={(id) => setSel(id)}
                onExit={() => wrapRef.current?.closest<HTMLElement>(".fb-canvas-body")?.focus({ preventScroll: true })}
              />
            )}
          </div>
        ) : (
          <svg
            ref={svgRef}
            className="mm-root mm-svg"
            width={size.w}
            height={size.h}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={onDoubleClick}
            onContextMenu={onContextMenu}
            onMouseDown={(e) => e.preventDefault()}
            onPointerLeave={() => !drag.current && setHover(null)}
          >
            <g transform={`translate(${view.x} ${view.y}) scale(${k})`}>
              <g aria-hidden>
                {layout.links.map((l) => (
                  <MindLinkPath key={l.to} link={l} />
                ))}
              </g>
              <g aria-hidden>
                {layout.boxes.map((b) => (
                  <g
                    key={b.id}
                    className="mm-node"
                    data-mm-node={b.id}
                    data-color={b.color}
                    data-depth={Math.min(b.depth, 2)}
                    data-empty={b.empty || undefined}
                    data-selected={selected === b.id || undefined}
                    data-dragging={ghost?.id === b.id || undefined}
                    data-busy={busyIdea === b.id || undefined}
                  >
                    <MindIdea box={b} hideText={editing?.id === b.id} />
                  </g>
                ))}
              </g>
              <g aria-hidden>
                {layout.boxes.map((b) => (b.hidden ? <MindBadge key={b.id} box={b} side={side} interactive /> : null))}
              </g>
              <g aria-hidden className="mm-overlay">
                {selBox ? <rect className="mm-sel-box" x={selBox.x - 3 / k} y={selBox.y - 3 / k} width={selBox.w + 6 / k} height={selBox.h + 6 / k} rx={8 + 3 / k} /> : null}
                {(showControls ? [selBox!] : [])
                  .concat(hover && hover !== selected && !editing && !ghost ? [layout.byId.get(hover)].filter((x): x is MindBox => Boolean(x)) : [])
                  .map((b) => {
                    const { togglePt, addPt } = outerControls(b);
                    const isSel = b.id === selected;
                    return (
                      <g key={`c-${b.id}`}>
                        {togglePt ? (
                          <g className="mm-ctl mm-fold" data-mm-toggle={b.id} data-color={b.color}>
                            <circle className="mm-hit" cx={togglePt.x} cy={togglePt.y} r={hitR} />
                            <circle className="mm-ctl-dot" cx={togglePt.x} cy={togglePt.y} r={dotR * 0.8} />
                            <path className="mm-ctl-glyph" d={`M${togglePt.x - dotR * 0.4} ${togglePt.y}h${dotR * 0.8}`} />
                          </g>
                        ) : null}
                        {isSel ? (
                          <g className="mm-ctl mm-add" data-mm-add={b.id}>
                            <circle className="mm-hit" cx={addPt.x} cy={addPt.y} r={hitR} />
                            <circle className="mm-ctl-dot" cx={addPt.x} cy={addPt.y} r={dotR} />
                            <path className="mm-ctl-glyph" d={`M${addPt.x - dotR * 0.5} ${addPt.y}h${dotR}M${addPt.x} ${addPt.y - dotR * 0.5}v${dotR}`} />
                          </g>
                        ) : null}
                      </g>
                    );
                  })}
                {ghost?.drop && ghost.drop.kind !== "side" ? (() => {
                  const t = layout.byId.get(ghost.drop.id);
                  if (!t) return null;
                  if (ghost.drop.kind === "child") return <rect className="mm-drop" x={t.x - 5 / k} y={t.y - 5 / k} width={t.w + 10 / k} height={t.h + 10 / k} rx={10} />;
                  const down = t.side === "down";
                  const before = ghost.drop.kind === "before";
                  return down ? (
                    <path className="mm-drop-line" d={`M${before ? t.x - 8 : t.x + t.w + 8} ${t.y - 4}v${t.h + 8}`} />
                  ) : (
                    <path className="mm-drop-line" d={`M${t.x - 4} ${before ? t.y - 7 : t.y + t.h + 7}h${t.w + 8}`} />
                  );
                })() : null}
                {ghost ? (() => {
                  const b = layout.byId.get(ghost.id);
                  if (!b) return null;
                  return (
                    <g className="mm-node mm-ghost" data-color={b.color} data-depth={Math.min(b.depth, 2)} transform={`translate(${ghost.at.x - b.x - b.w / 2} ${ghost.at.y - b.y - b.h / 2})`}>
                      <MindIdea box={b} />
                    </g>
                  );
                })() : null}
              </g>
            </g>
          </svg>
        )}
        {textEditor}
        {focusId && !outline ? (
          <div className="mm-bar mm-focus-chip" onPointerDown={(e) => e.stopPropagation()}>
            <span>One branch</span>
            <button
              type="button"
              className="fb-vc-btn mm-text-btn"
              onClick={() => {
                setFocus(null);
                requestAnimationFrame(() => fitView(layoutMindmap(docRef.current)));
              }}
            >
              <X size={13} aria-hidden /> Show whole map
            </button>
          </div>
        ) : null}
        {!outline && !empty ? <ZoomBar zoom={k} onZoomIn={() => zoomBy(1.2)} onZoomOut={() => zoomBy(1 / 1.2)} onFit={() => fitView()} /> : null}
        {showControls && selActions && barStyle ? <IdeaBar style={barStyle} a={selActions} onMore={(at) => setMenu({ at, id: selected! })} /> : null}
        {aiStart ? (
          <MindmapAi
            hasMap={count > 0}
            selected={selected ? { id: selected, text: byId(map, selected)?.text ?? "", isRoot: selected === root?.id } : null}
            layout={map.layout}
            start={aiStart}
            current={() => serializeMindmap(docRef.current)}
            onMap={applyMap}
            onIdeas={applyIdeas}
            onInsert={(md) => insertInNote(md)}
            onClose={() => {
              setAiStart(null);
              wrapRef.current?.focus({ preventScroll: true });
            }}
          />
        ) : null}
        {tooLarge ? (
          <p className="mm-warning" role="alert">
            This mind map is too large to save. Remove some ideas.
          </p>
        ) : null}
      </div>
      {menu ? (() => {
        const a = ideaActions(menu.id);
        return a ? <ContextMenu at={menu.at} label="Idea" items={ideaMenu(a)} onClose={() => setMenu(null)} /> : null;
      })() : null}
    </CanvasCard>
  );
}

const isField = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;

/** A branch as a nested Markdown list (for the clipboard). */
function treeToMarkdown(tree: MindTreeNode, depth = 0): string {
  const line = `${"  ".repeat(depth)}- ${tree.text.replace(/\s*\n+\s*/g, " ").trim() || "Idea"}`;
  return [line, ...(tree.children ?? []).map((c) => treeToMarkdown(c, depth + 1))].join("\n");
}
