"use client";

import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eraser, Highlighter, PenLine, Trash2, Undo2 } from "lucide-react";
import {
  LIMITS,
  WHITEBOARD_WIDTH,
  parseWhiteboard,
  serializeWhiteboard,
  strokeHit,
  strokePath,
  type WhiteboardStroke,
} from "@folevi/editor-schema";
import { StrokePaths, WB_COLOR_NAMES, clampHeight, strokeColor } from "./RichBlocks";
import { useEditable } from "./useEditable";

type Tool = "pen" | "highlighter" | "eraser";
const PEN_COLORS = ["ink", "blue", "red", "green", "orange", "purple"] as const;
const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "red"] as const;
const PEN_SIZES = [
  { width: 2.5, label: "Fine" },
  { width: 5, label: "Medium" },
  { width: 10, label: "Thick" },
] as const;
const SAVE_DELAY = 400;
const HEIGHT_STEP = 40;

/**
 * A change to the drawing: strokes taken away (by content, since strokes carry no id) and strokes added.
 * Edits apply to whatever the block holds when they're written, so strokes a collaborator drew meanwhile
 * are kept.
 */
type Edit = { add: WhiteboardStroke[]; remove: string[] };

/** A stroke's identity: two freehand strokes with the same points, colour and width are the same stroke. */
function strokeKey(s: WhiteboardStroke): string {
  return JSON.stringify([s.color, s.width, s.opacity ?? 1, s.points ?? s.d ?? null]);
}

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

/**
 * Whiteboard block: freehand drawing on an SVG canvas with pen, highlighter and a stroke eraser.
 * Strokes are kept in a fixed logical space (WHITEBOARD_WIDTH wide) so the drawing scales with the
 * page. Changes are saved (debounced) through the node's attributes, which the editor syncs like any
 * other block edit.
 */
export function WhiteboardView({ node, selected, updateAttributes, editor, getPos }: ReactNodeViewProps) {
  const data = String(node.attrs.data ?? "");
  const savedHeight = clampHeight(node.attrs.height);
  const editable = useEditable(editor);
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
  const [liveHeight, setLiveHeight] = useState<number | null>(null);
  const height = liveHeight ?? savedHeight;

  const [tool, setTool] = useState<Tool>("pen");
  const [penColor, setPenColor] = useState<string>("ink");
  const [markColor, setMarkColor] = useState<string>("yellow");
  const [penWidth, setPenWidth] = useState<number>(PEN_SIZES[0].width);
  // Each entry undoes one of this person's own changes (removes the stroke they drew, brings back what they
  // erased), so undo never touches what someone else drew.
  const undoStack = useRef<Edit[]>([]);
  const [canUndo, setCanUndo] = useState(false);

  const svgRef = useRef<SVGSVGElement>(null);
  const drawing = useRef<{ pointerId: number; points: [number, number][]; erased: WhiteboardStroke[] } | null>(null);
  const [draft, setDraft] = useState<WhiteboardStroke | null>(null);
  const saveTimer = useRef<number | null>(null);
  const latest = useRef<WhiteboardStroke[]>(strokes);
  latest.current = strokes;
  const committedRef = useRef(committed);
  committedRef.current = committed;

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
  useEffect(() => () => flushRef.current(), []);

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

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!editable || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toPoint(e);
    drawing.current = { pointerId: e.pointerId, points: [p], erased: [] };
    // Save what's waiting (an erase, the last stroke) now, so a quick next touch can't drop it.
    flushRef.current();
    if (tool === "eraser") eraseAt(p);
    else setDraft({ points: [p], ...currentStyle() });
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
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
  };

  // Height: drag the bottom edge, or focus it and use the arrow keys.
  const resizing = useRef<{ startY: number; startH: number; scale: number } | null>(null);
  const commitHeight = (h: number) => {
    setLiveHeight(null);
    if (h !== savedHeight && editor.isEditable) updateAttributes({ height: h });
  };
  const clampH = (h: number) => Math.round(Math.max(LIMITS.minWhiteboardHeight, Math.min(LIMITS.maxWhiteboardHeight, h)));

  const colors = tool === "highlighter" ? HIGHLIGHT_COLORS : PEN_COLORS;
  const activeColor = tool === "highlighter" ? markColor : penColor;
  const btn = "fb-wb-btn";

  // The whole block can be selected (to move, copy or delete it): click the toolbar's empty space, or press
  // Escape while drawing tools have focus.
  const selectBlock = () => {
    const pos = typeof getPos === "function" ? getPos() : undefined;
    if (typeof pos !== "number") return;
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
    editor.view.focus();
  };

  return (
    <NodeViewWrapper className={`fb-atom fb-whiteboard ${selected ? "fb-atom-selected" : ""}`} aria-label="Whiteboard">
      <div
        contentEditable={false}
        className="fb-whiteboard-box"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            selectBlock();
          }
        }}
      >
        {editable ? (
          <div
            className="fb-wb-toolbar"
            role="toolbar"
            aria-label="Whiteboard tools"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget || (e.target instanceof Element && e.target.classList.contains("fb-wb-spacer"))) {
                e.preventDefault();
                selectBlock();
              }
            }}
          >
            <button type="button" className={btn} aria-pressed={tool === "pen"} aria-label="Pen" title="Pen" onClick={() => setTool("pen")}>
              <PenLine size={15} aria-hidden />
            </button>
            <button type="button" className={btn} aria-pressed={tool === "highlighter"} aria-label="Highlighter" title="Highlighter" onClick={() => setTool("highlighter")}>
              <Highlighter size={15} aria-hidden />
            </button>
            <button type="button" className={btn} aria-pressed={tool === "eraser"} aria-label="Eraser (removes whole strokes)" title="Eraser" onClick={() => setTool("eraser")}>
              <Eraser size={15} aria-hidden />
            </button>
            <span className="fb-wb-sep" aria-hidden />
            {tool !== "eraser" ? (
              <span role="group" aria-label={tool === "highlighter" ? "Highlighter colour" : "Pen colour"} className="fb-wb-group">
                {colors.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="fb-wb-swatch"
                    aria-pressed={activeColor === c}
                    aria-label={WB_COLOR_NAMES[c] ?? c}
                    title={WB_COLOR_NAMES[c] ?? c}
                    style={{ ["--swatch" as string]: strokeColor(c) }}
                    onClick={() => (tool === "highlighter" ? setMarkColor(c) : setPenColor(c))}
                  />
                ))}
              </span>
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
            <span className="fb-wb-spacer" />
            <button type="button" className={btn} aria-label="Undo" title="Undo" disabled={!canUndo} onClick={undo}>
              <Undo2 size={15} aria-hidden />
            </button>
            <button type="button" className={btn} aria-label="Clear whiteboard" title="Clear" disabled={!strokes.length} onClick={clear}>
              <Trash2 size={15} aria-hidden />
            </button>
          </div>
        ) : null}
        <svg
          ref={svgRef}
          className="fb-whiteboard-canvas"
          data-tool={editable ? tool : undefined}
          viewBox={`0 0 ${WHITEBOARD_WIDTH} ${height}`}
          style={{ aspectRatio: `${WHITEBOARD_WIDTH} / ${height}` }}
          role="img"
          aria-label={strokes.length ? `Whiteboard drawing with ${strokes.length} stroke${strokes.length === 1 ? "" : "s"}` : editable ? "Empty whiteboard. Draw with a mouse, pen or finger" : "Empty whiteboard"}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <StrokePaths strokes={strokes} />
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
      </div>
    </NodeViewWrapper>
  );
}
