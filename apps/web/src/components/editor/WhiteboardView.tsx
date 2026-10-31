"use client";

import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Delete as DeleteIcon, Eraser, Expand, Highlighter, MousePointer2, PenLine, Shrink, Trash2, Undo2 } from "lucide-react";
import {
  LIMITS,
  WHITEBOARD_WIDTH,
  parseWhiteboard,
  serializeWhiteboard,
  strokeD,
  strokeHit,
  strokePath,
  type WhiteboardStroke,
} from "@folevi/editor-schema";
import { ContextMenu, type MenuItem } from "@/components/ui/Menu";
import { useToast } from "@/components/ui/Toast";
import { haptic } from "@/lib/nativeApp";
import { WB_COLOR_NAMES, clampHeight, strokeColor } from "./RichBlocks";
import { useEditable } from "./useEditable";
import { PhoneCanvasCover } from "./canvas/PhoneCanvasCover";
import { BlockExportMenu } from "./canvas/BlockExport";
import { useFullCanvas } from "./canvas/useFullCanvas";
import { targetUnder } from "./canvas/targetUnder";
import { clampMove, isHighlight, strokeAt, strokeInBox, strokeKey, strokesBounds, translateStroke, type Box, type Point } from "./whiteboard/ops";

type Tool = "pen" | "highlighter" | "eraser" | "select";
const PEN_COLORS = ["ink", "blue", "red", "green", "orange", "purple"] as const;
const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "red"] as const;
const PEN_SIZES = [
  { width: 2.5, label: "Fine" },
  { width: 5, label: "Medium" },
  { width: 10, label: "Thick" },
] as const;
const SAVE_DELAY = 400;
const HEIGHT_STEP = 40;
/** A held finger or pen on a stroke (with Select) opens its menu, as on iOS. */
const LONG_PRESS_MS = 450;
/** How far a copy lands from the strokes it was made from (sheet units). */
const DUPLICATE_OFFSET = 20;

/**
 * A change to the drawing: strokes taken away (by content, since strokes carry no id) and strokes added.
 * Edits apply to whatever the block holds when they're written, so strokes a collaborator drew meanwhile
 * are kept.
 */
type Edit = { add: WhiteboardStroke[]; remove: string[] };

function applyEdit(base: WhiteboardStroke[], edit: Edit): WhiteboardStroke[] {
  const gone = new Set(edit.remove);
  const kept = gone.size ? base.filter((s) => !gone.has(strokeKey(s))) : base;
  const have = new Set(kept.map(strokeKey));
  const added = edit.add.filter((s) => {
    const k = strokeKey(s);
    if (have.has(k)) return false;
    have.add(k);
    return true;
  });
  return added.length ? [...kept, ...added] : kept;
}

/** `first` then `then`, as one edit. */
function composeEdits(first: Edit | null, then: Edit): Edit {
  if (!first) return then;
  const removed = new Set(then.remove);
  const readded = new Set(then.add.map(strokeKey));
  return {
    add: [...first.add.filter((s) => !removed.has(strokeKey(s))), ...then.add],
    remove: [...first.remove.filter((k) => !readded.has(k)), ...then.remove],
  };
}

/** What the Select tool is doing with the pointer that's down. */
type Gesture =
  | { kind: "move"; pointerId: number; start: Point; sx: number; sy: number; moved: boolean }
  | { kind: "marquee"; pointerId: number; start: Point; base: string[] };

/**
 * Whiteboard block: freehand drawing on an SVG canvas with pen, highlighter, a stroke eraser and Select (pick
 * strokes to move, recolour, duplicate or delete; right-click or a long press for their menu). Strokes are kept
 * in a fixed logical space (WHITEBOARD_WIDTH wide) so the drawing scales with the page. Changes are saved
 * (debounced) through the node's attributes, which the editor syncs like any other block edit.
 *
 * Like the other visual blocks it has Export (canvas/BlockExport.tsx) and Full canvas (canvas/useFullCanvas.ts:
 * the toolbar's button or Shift+Cmd+F, Esc back), where the sheet fills the window at its own proportions.
 */
export function WhiteboardView({ node, selected, updateAttributes, editor, getPos }: ReactNodeViewProps) {
  const data = String(node.attrs.data ?? "");
  const savedHeight = clampHeight(node.attrs.height);
  const editable = useEditable(editor);
  const toast = useToast();
  const committed = useMemo(() => parseWhiteboard(data).strokes, [data]);
  // Local edits not yet written to the node (saved shortly after the pointer lifts), shown over what the
  // block holds, so a collaborator's strokes arriving meanwhile show up at once.
  const [pending, setPendingState] = useState<Edit | null>(null);
  const pendingRef = useRef<Edit | null>(null);
  const setPending = (edit: Edit | null) => {
    pendingRef.current = edit;
    setPendingState(edit);
  };
  const strokes = useMemo(() => (pending ? applyEdit(committed, pending) : committed), [committed, pending]);
  const keys = useMemo(() => strokes.map(strokeKey), [strokes]);
  const [liveHeight, setLiveHeight] = useState<number | null>(null);
  const height = liveHeight ?? savedHeight;

  const [tool, setToolState] = useState<Tool>("pen");
  const [penColor, setPenColor] = useState<string>("ink");
  const [markColor, setMarkColor] = useState<string>("yellow");
  const [penWidth, setPenWidth] = useState<number>(PEN_SIZES[0].width);
  // Each entry undoes one of this person's own changes (removes the stroke they drew, brings back what they
  // erased), so undo never touches what someone else drew.
  const undoStack = useRef<Edit[]>([]);
  const [canUndo, setCanUndo] = useState(false);

  const cardRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drawing = useRef<{ pointerId: number; points: [number, number][]; erased: WhiteboardStroke[] } | null>(null);
  const [draft, setDraft] = useState<WhiteboardStroke | null>(null);
  const saveTimer = useRef<number | null>(null);
  const latest = useRef<WhiteboardStroke[]>(strokes);
  latest.current = strokes;
  const committedRef = useRef(committed);
  committedRef.current = committed;

  // Picked strokes (by key): Select's choice, or the stroke a right-click landed on. Keys a collaborator's
  // change (or an undo) took away simply stop matching.
  const [pickedState, setPickedState] = useState<string[]>([]);
  const pickedRef = useRef<string[]>([]);
  const setPicked = (next: string[]) => {
    pickedRef.current = next;
    setPickedState(next);
  };
  const pickedSet = useMemo(() => {
    const have = new Set(keys);
    return new Set(pickedState.filter((k) => have.has(k)));
  }, [keys, pickedState]);
  const pickedStrokes = () => {
    const want = new Set(pickedRef.current);
    return latest.current.filter((s) => want.has(strokeKey(s)));
  };
  const gesture = useRef<Gesture | null>(null);
  const pressTimer = useRef<number | null>(null);
  const [moving, setMovingState] = useState<Point | null>(null);
  const movingRef = useRef<Point | null>(null);
  const setMoving = (p: Point | null) => {
    movingRef.current = p;
    setMovingState(p);
  };
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; host?: HTMLElement } | null>(null);

  const fullCanvas = useFullCanvas({ cardRef, focusRef: bodyRef });
  const { full, toggleFull, cardProps, handleKey: fullKey } = fullCanvas;

  const setTool = (t: Tool) => {
    setToolState(t);
    if (t !== "select") setPicked([]);
  };

  // Writes the waiting edit onto the block as it is now (the view re-renders a moment after each change, so
  // `committed` can be a step behind a collaborator's stroke).
  const write = () => {
    const edit = pendingRef.current;
    if (!edit) return;
    pendingRef.current = null;
    if (!editor.isEditable) return;
    let base = committedRef.current;
    try {
      const pos = typeof getPos === "function" ? getPos() : undefined;
      const live = typeof pos === "number" ? editor.state.doc.nodeAt(pos) : null;
      if (live?.type.name === "whiteboard") base = parseWhiteboard(String(live.attrs.data ?? "")).strokes;
    } catch {
      // The view is going away: what it last showed is the best guess.
    }
    const next = applyEdit(base, edit);
    updateAttributes({ data: next.length ? serializeWhiteboard({ strokes: next }) : "" });
  };
  const writeRef = useRef(write);
  writeRef.current = write;

  const save = useCallback((edit: Edit) => {
    const next = composeEdits(pendingRef.current, edit);
    pendingRef.current = next;
    setPendingState(next);
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      writeRef.current();
      setPendingState(null);
    }, SAVE_DELAY);
  }, []);

  // Flush a pending save when the view goes away (e.g. navigating off the page).
  const flushRef = useRef<() => void>(() => {});
  flushRef.current = () => {
    if (saveTimer.current === null) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
    write();
    setPending(null);
  };
  useEffect(
    () => () => {
      flushRef.current();
      if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    },
    [],
  );

  const pushUndo = (inverse: Edit) => {
    undoStack.current.push(inverse);
    if (undoStack.current.length > 100) undoStack.current.shift();
    setCanUndo(true);
  };

  const toPoint = (e: { clientX: number; clientY: number }): [number, number] => {
    const rect = svgRef.current!.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * WHITEBOARD_WIDTH;
    const y = ((e.clientY - rect.top) / rect.height) * height;
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  };

  /**
   * The stroke under the pointer (its index), or -1. The canvas captures the pointer on press, so the event's
   * own target can be the canvas: look at what is under the pointer (canvas/targetUnder.ts), then near it, as a
   * fine pen line is hard to land on exactly.
   */
  const strokeUnder = (e: { clientX: number; clientY: number; target: EventTarget; currentTarget: EventTarget; pointerType?: string }): number => {
    const el = targetUnder(e).closest("[data-wb-stroke]");
    const at = el ? Number(el.getAttribute("data-wb-stroke")) : -1;
    if (at >= 0 && at < latest.current.length) return at;
    const rect = svgRef.current!.getBoundingClientRect();
    const unit = WHITEBOARD_WIDTH / Math.max(1, rect.width);
    return strokeAt(latest.current, toPoint(e), (e.pointerType && e.pointerType !== "mouse" ? 14 : 8) * unit);
  };

  const eraseAt = (p: [number, number]) => {
    const radius = 8;
    const hit = latest.current.filter((s) => strokeHit(s, p, radius));
    if (!hit.length) return;
    drawing.current?.erased.push(...hit);
    latest.current = latest.current.filter((s) => !hit.includes(s));
    save({ add: [], remove: hit.map(strokeKey) });
  };

  const currentStyle = (): Pick<WhiteboardStroke, "color" | "width" | "opacity"> =>
    tool === "highlighter" ? { color: markColor, width: 18, opacity: 0.4 } : { color: penColor, width: penWidth };

  // ------------------------------------------------------------------------- changes to picked strokes

  /** Replaces strokes with changed copies as one undo step, and keeps the copies picked. */
  const replaceStrokes = (from: WhiteboardStroke[], to: WhiteboardStroke[]) => {
    const fromKeys = from.map(strokeKey);
    const toKeys = to.map(strokeKey);
    if (fromKeys.join("\n") === toKeys.join("\n")) return;
    save({ add: to, remove: fromKeys });
    pushUndo({ add: from, remove: toKeys });
    setPicked(toKeys);
  };

  const moveBy = (dx: number, dy: number) => {
    const from = pickedStrokes();
    if (!from.length) return;
    const [mx, my] = clampMove(strokesBounds(from), dx, dy, WHITEBOARD_WIDTH, height);
    if (!mx && !my) return;
    replaceStrokes(
      from,
      from.map((s) => translateStroke(s, mx, my)),
    );
  };

  const duplicatePicked = () => {
    const from = pickedStrokes();
    if (!from.length) return;
    const box = strokesBounds(from);
    let [dx, dy] = clampMove(box, DUPLICATE_OFFSET, DUPLICATE_OFFSET, WHITEBOARD_WIDTH, height);
    if (!dx && !dy) [dx, dy] = clampMove(box, -DUPLICATE_OFFSET, -DUPLICATE_OFFSET, WHITEBOARD_WIDTH, height);
    const copies = from.map((s) => translateStroke(s, dx, dy));
    if (serializeWhiteboard({ strokes: [...latest.current, ...copies] }).length > LIMITS.maxWhiteboardDataLength) {
      toast.show("This whiteboard is full. Erase something to make room.", { tone: "error" });
      return;
    }
    const copyKeys = copies.map(strokeKey);
    save({ add: copies, remove: [] });
    pushUndo({ add: [], remove: copyKeys });
    setPicked(copyKeys);
  };

  const removePicked = () => {
    const from = pickedStrokes();
    if (!from.length) return;
    pushUndo({ add: from, remove: [] });
    save({ add: [], remove: from.map(strokeKey) });
    setPicked([]);
  };

  const recolorPicked = (color: string) => {
    const from = pickedStrokes().filter((s) => s.color !== color);
    if (!from.length) return;
    const keep = pickedRef.current.filter((k) => !from.some((s) => strokeKey(s) === k));
    replaceStrokes(
      from,
      from.map((s) => ({ ...s, color })),
    );
    setPicked([...keep, ...pickedRef.current]);
  };

  // ------------------------------------------------------------------------------ pointer

  // Apple Pencil (or any pen): once one has drawn here, a finger or a resting palm doesn't draw, and a
  // finger scrolls the note instead, as in iPad drawing apps.
  const [penOnly, setPenOnly] = useState(false);

  const cancelPress = () => {
    if (pressTimer.current === null) return;
    window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  const openMenu = (at: { x: number; y: number }) => {
    // In full canvas the card is on the top layer: the menu goes inside it to show above it.
    setMenu({ at, host: full ? (cardRef.current ?? undefined) : undefined });
  };

  const onSelectDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = toPoint(e);
    const at = strokeUnder(e);
    const extend = e.shiftKey || e.metaKey;
    if (at < 0) {
      gesture.current = { kind: "marquee", pointerId: e.pointerId, start: p, base: extend ? pickedRef.current : [] };
      if (!extend) setPicked([]);
      return;
    }
    const key = keys[at] ?? strokeKey(latest.current[at]!);
    if (extend) {
      setPicked(pickedRef.current.includes(key) ? pickedRef.current.filter((k) => k !== key) : [...pickedRef.current, key]);
      return;
    }
    if (!pickedRef.current.includes(key)) setPicked([key]);
    gesture.current = { kind: "move", pointerId: e.pointerId, start: p, sx: e.clientX, sy: e.clientY, moved: false };
    if (e.pointerType !== "mouse") {
      const spot = { x: e.clientX, y: e.clientY };
      pressTimer.current = window.setTimeout(() => {
        pressTimer.current = null;
        const g = gesture.current;
        if (g?.kind !== "move" || g.moved) return;
        gesture.current = null;
        haptic("medium");
        openMenu(spot);
      }, LONG_PRESS_MS);
    }
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    // The right button (and Control-click on a Mac) opens the stroke's menu instead (onContextMenu).
    if (!editable || (e.pointerType === "mouse" && (e.button !== 0 || e.ctrlKey))) return;
    if (e.pointerType === "pen" && !penOnly) setPenOnly(true);
    if (tool !== "select" && penOnly && e.pointerType === "touch") return;
    e.preventDefault();
    // A press here is outside any open menu (Export, a stroke's), but the mousedown menus close on is held
    // back by the preventDefault above: send them one.
    if (document.querySelector('[role="menu"]:popover-open')) e.currentTarget.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    bodyRef.current?.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    // Save what's waiting (an erase, the last stroke) now, so a quick next touch can't drop it.
    flushRef.current();
    if (tool === "select") return onSelectDown(e);
    if (pickedRef.current.length) setPicked([]);
    const p = toPoint(e);
    drawing.current = { pointerId: e.pointerId, points: [p], erased: [] };
    if (tool === "eraser") eraseAt(p);
    else setDraft({ points: [p], ...currentStyle() });
  };

  const onSelectMove = (e: React.PointerEvent<SVGSVGElement>, g: Gesture) => {
    const p = toPoint(e);
    if (g.kind === "marquee") {
      const box: Box = { x: Math.min(g.start[0], p[0]), y: Math.min(g.start[1], p[1]), w: Math.abs(p[0] - g.start[0]), h: Math.abs(p[1] - g.start[1]) };
      setMarquee(box);
      const inside = latest.current.filter((s) => strokeInBox(s, box)).map(strokeKey);
      setPicked([...new Set([...g.base, ...inside])]);
      return;
    }
    if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 4) return;
    g.moved = true;
    cancelPress();
    setMoving(clampMove(strokesBounds(pickedStrokes()), p[0] - g.start[0], p[1] - g.start[1], WHITEBOARD_WIDTH, height));
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    if (g) {
      if (g.pointerId === e.pointerId) onSelectMove(e, g);
      return;
    }
    const d = drawing.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const events = typeof e.nativeEvent.getCoalescedEvents === "function" ? e.nativeEvent.getCoalescedEvents() : [];
    const samples = events.length ? events : [e.nativeEvent];
    for (const ev of samples) {
      const p = toPoint(ev);
      if (tool === "eraser") {
        eraseAt(p);
        continue;
      }
      const last = d.points[d.points.length - 1]!;
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 1.5) continue;
      if (d.points.length >= 3000) break;
      d.points.push(p);
    }
    if (tool !== "eraser") setDraft({ points: [...d.points], ...currentStyle() });
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    if (g && g.pointerId === e.pointerId) {
      gesture.current = null;
      cancelPress();
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      if (g.kind === "marquee") setMarquee(null);
      else if (g.moved && movingRef.current && e.type !== "pointercancel") moveBy(...movingRef.current);
      setMoving(null);
      return;
    }
    const d = drawing.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drawing.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (tool === "eraser") {
      // One undo step brings back everything this sweep erased.
      if (d.erased.length) pushUndo({ add: d.erased, remove: [] });
      return;
    }
    setDraft(null);
    if (e.type === "pointercancel" && d.points.length < 2) return;
    const stroke: WhiteboardStroke = { points: d.points, ...currentStyle() };
    pushUndo({ add: [], remove: [strokeKey(stroke)] });
    save({ add: [stroke], remove: [] });
  };

  const onContextMenu = (e: React.MouseEvent<SVGSVGElement>) => {
    // Never the note's block menu here (indent, move, insert below mean nothing inside a drawing).
    e.preventDefault();
    if (!editable) return;
    const at = strokeUnder(e);
    if (at < 0) return;
    const key = keys[at] ?? strokeKey(latest.current[at]!);
    if (!pickedRef.current.includes(key)) setPicked([key]);
    openMenu({ x: e.clientX, y: e.clientY });
  };

  const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    // With Select: a double-click picks just the stroke under the pointer (out of several), or none.
    if (!editable || tool !== "select") return;
    const at = strokeUnder(e);
    setPicked(at < 0 ? [] : [keys[at] ?? strokeKey(latest.current[at]!)]);
  };

  const undo = () => {
    const inverse = undoStack.current.pop();
    setCanUndo(undoStack.current.length > 0);
    if (inverse) save(inverse);
  };
  const clear = () => {
    const all = latest.current;
    if (!all.length) return;
    pushUndo({ add: all, remove: [] });
    save({ add: [], remove: all.map(strokeKey) });
    setPicked([]);
  };

  // Height: drag the bottom edge, or focus it and use the arrow keys.
  const resizing = useRef<{ startY: number; startH: number; scale: number } | null>(null);
  const commitHeight = (h: number) => {
    setLiveHeight(null);
    if (h !== savedHeight && editor.isEditable) updateAttributes({ height: h });
  };
  const clampH = (h: number) => Math.round(Math.max(LIMITS.minWhiteboardHeight, Math.min(LIMITS.maxWhiteboardHeight, h)));

  const picking = tool === "select" && pickedSet.size > 0;
  const pickedList = strokes.filter((_, i) => pickedSet.has(keys[i]!));
  const pickedHighlights = pickedList.length > 0 && pickedList.every(isHighlight);
  const colors = tool === "highlighter" || (picking && pickedHighlights) ? HIGHLIGHT_COLORS : PEN_COLORS;
  const pickedColor = pickedList.length && pickedList.every((s) => s.color === pickedList[0]!.color) ? pickedList[0]!.color : null;
  const activeColor = picking ? pickedColor : tool === "highlighter" ? markColor : penColor;
  const btn = "fb-wb-btn";

  // The whole block can be selected (to move, copy or delete it): click the toolbar's empty space, or press
  // Escape while the drawing has the keyboard.
  const selectBlock = () => {
    const pos = typeof getPos === "function" ? getPos() : undefined;
    if (typeof pos !== "number") return;
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
    editor.view.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // A toolbar menu that is open (Export) has the key first: Escape closes it, nothing else.
    if (e.defaultPrevented || (e.target as Element).closest?.('[aria-expanded="true"]')) return;
    if (fullKey(e, { escape: !pickedRef.current.length })) return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (pickedRef.current.length) setPicked([]);
      else selectBlock();
      return;
    }
    // The rest are the drawing's own keys, while it (not a toolbar control) has the keyboard.
    if (!editable || e.target !== bodyRef.current) return;
    const k = e.key.toLowerCase();
    const has = pickedRef.current.length > 0;
    const step = e.shiftKey ? 20 : 4;
    const arrows: Record<string, Point> = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] };
    let used = true;
    if (mod && k === "z" && !e.shiftKey) undo();
    else if (mod && k === "a") {
      setToolState("select");
      setPicked(latest.current.map(strokeKey));
    } else if (has && mod && k === "d") duplicatePicked();
    else if (has && (e.key === "Delete" || e.key === "Backspace")) removePicked();
    else if (has && !mod && arrows[k]) moveBy(...arrows[k]!);
    else used = false;
    if (used) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const menuItems = (): (MenuItem | "separator")[] => {
    const list = pickedStrokes();
    const highlights = list.length > 0 && list.every(isHighlight);
    const same = list.length && list.every((s) => s.color === list[0]!.color) ? list[0]!.color : null;
    const palette: MenuItem[] = (highlights ? HIGHLIGHT_COLORS : PEN_COLORS).map((c) => ({
      label: WB_COLOR_NAMES[c] ?? c,
      icon: <span className="fb-wb-menu-swatch" style={{ ["--swatch" as string]: strokeColor(c) }} aria-hidden />,
      checked: same === c,
      onSelect: () => recolorPicked(c),
    }));
    return [
      { label: "Duplicate", shortcut: "⌘D", icon: <Copy size={14} />, onSelect: duplicatePicked },
      "separator",
      ...palette,
      "separator",
      { label: "Delete", shortcut: "⌫", icon: <Trash2 size={14} />, danger: true, onSelect: removePicked },
    ];
  };

  const closeMenu = () => {
    setMenu(null);
    // Outside Select, a stroke is picked only while its menu is open (cleared once the chosen item has run:
    // the menu closes first).
    if (tool !== "select") queueMicrotask(() => setPicked([]));
  };

  const pickedBox = picking || menu ? strokesBounds(pickedList) : null;
  const shift = moving ? `translate(${moving[0]} ${moving[1]})` : undefined;
  const count = strokes.length;

  return (
    <NodeViewWrapper className={`fb-atom fb-whiteboard ${selected ? "fb-atom-selected" : ""}`} aria-label="Whiteboard">
      <div ref={cardRef} contentEditable={false} className="fb-whiteboard-box fb-canvas-card" data-blank={count ? undefined : true} {...cardProps} aria-label={full ? "Whiteboard, full canvas" : undefined} onKeyDown={onKeyDown}>
        {/* Full canvas in the Mac app: the window's buttons sit in this corner (canvas.css). */}
        <span aria-hidden className="ui-traffic-space fb-full-traffic" />
        <div
          className="fb-wb-toolbar"
          role="toolbar"
          aria-label="Whiteboard tools"
          onMouseDown={(e) => {
            if (full) return;
            if (e.target === e.currentTarget || (e.target instanceof Element && e.target.classList.contains("fb-wb-spacer"))) {
              e.preventDefault();
              selectBlock();
            }
          }}
        >
          {editable ? (
            <>
              <button type="button" className={btn} aria-pressed={tool === "pen"} aria-label="Pen" title="Pen" onClick={() => setTool("pen")}>
                <PenLine size={15} aria-hidden />
              </button>
              <button type="button" className={btn} aria-pressed={tool === "highlighter"} aria-label="Highlighter" title="Highlighter" onClick={() => setTool("highlighter")}>
                <Highlighter size={15} aria-hidden />
              </button>
              <button type="button" className={btn} aria-pressed={tool === "eraser"} aria-label="Eraser (removes whole strokes)" title="Eraser" onClick={() => setTool("eraser")}>
                <Eraser size={15} aria-hidden />
              </button>
              <button type="button" className={btn} aria-pressed={tool === "select"} aria-label="Select (move, recolour or delete strokes)" title="Select" onClick={() => setTool("select")}>
                <MousePointer2 size={15} aria-hidden />
              </button>
              {tool !== "eraser" && (tool !== "select" || picking) ? (
                <>
                  <span className="fb-wb-sep" aria-hidden />
                  <span role="group" aria-label={picking ? "Colour of the selected strokes" : tool === "highlighter" ? "Highlighter colour" : "Pen colour"} className="fb-wb-group">
                    {colors.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className="fb-wb-swatch"
                        aria-pressed={activeColor === c}
                        aria-label={WB_COLOR_NAMES[c] ?? c}
                        title={WB_COLOR_NAMES[c] ?? c}
                        style={{ ["--swatch" as string]: strokeColor(c) }}
                        onClick={() => (picking ? recolorPicked(c) : tool === "highlighter" ? setMarkColor(c) : setPenColor(c))}
                      />
                    ))}
                  </span>
                </>
              ) : null}
              {tool === "pen" ? (
                <span role="group" aria-label="Pen size" className="fb-wb-group">
                  {PEN_SIZES.map((s) => (
                    <button key={s.width} type="button" className={btn} aria-pressed={penWidth === s.width} aria-label={`${s.label} pen`} title={`${s.label} pen`} onClick={() => setPenWidth(s.width)}>
                      <span className="fb-wb-dot" style={{ width: 3 + s.width * 0.9, height: 3 + s.width * 0.9 }} aria-hidden />
                    </button>
                  ))}
                </span>
              ) : null}
              {picking ? (
                <span role="group" aria-label="Selected strokes" className="fb-wb-group">
                  <button type="button" className={btn} aria-label="Duplicate" title="Duplicate (⌘D)" onClick={duplicatePicked}>
                    <Copy size={15} aria-hidden />
                  </button>
                  <button type="button" className={btn} aria-label="Delete selected strokes" title="Delete (⌫)" onClick={removePicked}>
                    <DeleteIcon size={15} aria-hidden />
                  </button>
                </span>
              ) : null}
            </>
          ) : null}
          <span className="fb-wb-spacer" />
          {editable ? (
            <>
              <button type="button" className={btn} aria-label="Undo" title="Undo (⌘Z)" disabled={!canUndo} onClick={undo}>
                <Undo2 size={15} aria-hidden />
              </button>
              <button type="button" className={btn} aria-label="Clear whiteboard" title="Clear" disabled={!count} onClick={clear}>
                <Trash2 size={15} aria-hidden />
              </button>
              <span className="fb-wb-sep" aria-hidden />
            </>
          ) : null}
          <BlockExportMenu type="whiteboard" attrs={() => ({ data: count ? serializeWhiteboard({ strokes: latest.current }) : "", height })} empty={!count} triggerClassName={btn} />
          <button type="button" className={btn} aria-pressed={full} aria-label={full ? "Exit full canvas" : "Full canvas"} title={full ? "Exit full canvas (Esc)" : "Full canvas (⇧⌘F)"} onClick={() => toggleFull()}>
            {full ? <Shrink size={15} aria-hidden /> : <Expand size={15} aria-hidden />}
          </button>
        </div>
        <div
          ref={bodyRef}
          className="fb-wb-body fb-canvas-body"
          tabIndex={-1}
          // The drawing has its own right-click menu (a stroke's), never the note's.
          data-native-menu=""
        >
          <svg
            ref={svgRef}
            className="fb-whiteboard-canvas"
            data-tool={editable ? tool : undefined}
            data-pen-only={penOnly ? "" : undefined}
            viewBox={`0 0 ${WHITEBOARD_WIDTH} ${height}`}
            style={{ aspectRatio: `${WHITEBOARD_WIDTH} / ${height}`, ["--wb-ratio" as string]: WHITEBOARD_WIDTH / height }}
            role="img"
            aria-label={count ? `Whiteboard drawing with ${count} stroke${count === 1 ? "" : "s"}${pickedSet.size ? `, ${pickedSet.size} selected` : ""}` : editable ? "Empty whiteboard. Draw with a mouse, pen or finger" : "Empty whiteboard"}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onContextMenu={onContextMenu}
            onDoubleClick={onDoubleClick}
          >
            {strokes.map((s, i) => {
              const d = strokeD(s);
              const line = <path d={d} fill="none" stroke={strokeColor(s.color)} strokeWidth={s.width} strokeOpacity={s.opacity ?? 1} strokeLinecap="round" strokeLinejoin="round" />;
              if (!pickedSet.has(keys[i]!)) return <g key={i} data-wb-stroke={i}>{line}</g>;
              return (
                <g key={i} data-wb-stroke={i} data-picked="" transform={shift}>
                  <path className="fb-wb-halo" d={d} strokeWidth={s.width + 10} />
                  {line}
                </g>
              );
            })}
            {pickedBox ? <rect className="fb-wb-pick-box" x={pickedBox.x - 6} y={pickedBox.y - 6} width={pickedBox.w + 12} height={pickedBox.h + 12} transform={shift} /> : null}
            {marquee ? <rect className="fb-wb-marquee" x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} /> : null}
            {draft?.points ? (
              <path
                d={strokePath(draft.points)}
                fill="none"
                stroke={strokeColor(draft.color)}
                strokeWidth={draft.width}
                strokeOpacity={draft.opacity ?? 1}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
          </svg>
        </div>
        {editable ? (
          <div
            className="fb-wb-resize"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Whiteboard height"
            aria-valuemin={LIMITS.minWhiteboardHeight}
            aria-valuemax={LIMITS.maxWhiteboardHeight}
            aria-valuenow={height}
            tabIndex={0}
            title="Drag to resize (or use the arrow keys)"
            onKeyDown={(e) => {
              const delta = e.key === "ArrowDown" ? HEIGHT_STEP : e.key === "ArrowUp" ? -HEIGHT_STEP : 0;
              if (!delta) return;
              e.preventDefault();
              e.stopPropagation();
              commitHeight(clampH(height + delta));
            }}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              const rect = svgRef.current!.getBoundingClientRect();
              resizing.current = { startY: e.clientY, startH: height, scale: height / rect.height };
            }}
            onPointerMove={(e) => {
              const r = resizing.current;
              if (!r) return;
              setLiveHeight(clampH(r.startH + (e.clientY - r.startY) * r.scale));
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
        ) : null}
        {menu ? <ContextMenu at={menu.at} label="Stroke" host={menu.host} items={menuItems()} onClose={closeMenu} /> : null}
        <PhoneCanvasCover name="Whiteboard" icon={<PenLine size={15} />} empty={!count} full={full} onOpen={() => toggleFull(true)} onDone={() => toggleFull(false)} />
      </div>
    </NodeViewWrapper>
  );
}
