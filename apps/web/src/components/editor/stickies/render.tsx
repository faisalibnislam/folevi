"use client";

// The sticky notes board drawn without editing: read-only notes, public share pages, version history. The
// real board (Board.tsx), fitted to the space, with zoom and pan (drag, scroll with ⌘ or pinch, the + and −
// buttons, Fit), and the notes listed for screen readers by group.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import { LIMITS, STICKIES_DEFAULT_HEIGHT, parseStickies, stickiesByGroup, stickyVoteCount, type StickiesData } from "@folevi/editor-schema";
import { BoardLayer, type People, type View } from "./Board";
import { boardBounds } from "./ops";

const MIN_K = 0.15;
const MAX_K = 2.5;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const NO_PEOPLE: People = new Map();

/** The view that fits a board into a box (never zoomed in past 100%). */
export function fitBoard(board: StickiesData, w: number, h: number, top = 0, pad = 32): View {
  const b = boardBounds(board);
  if (!b || !w || !h) return { x: w / 2, y: (h + top) / 2, k: 1 };
  const k = clamp(Math.min((w - pad * 2) / Math.max(1, b.w), (h - top - pad * 2) / Math.max(1, b.h), 1), MIN_K, MAX_K);
  return { k, x: w / 2 - (b.x + b.w / 2) * k, y: top + (h - top) / 2 - (b.y + b.h / 2) * k };
}

/** What the board says, for screen readers: each group and its notes, with votes. */
export function BoardSummary({ board, id }: { board: StickiesData; id?: string }) {
  const groups = stickiesByGroup(board);
  return (
    <div id={id} className="sr-only">
      {groups.map(({ group, notes }, i) => (
        <section key={group?.id ?? `loose-${i}`} aria-label={group?.label || "Notes"}>
          {group?.label ? <h4>{group.label}</h4> : null}
          <ul>
            {notes.map((n) => {
              const votes = stickyVoteCount(n);
              return (
                <li key={n.id}>
                  {n.text.trim() || "Empty note"}
                  {n.tags.length ? ` (${n.tags.join(", ")})` : ""}
                  {votes ? `, ${votes} ${votes === 1 ? "vote" : "votes"}` : ""}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** A board to look at: fitted, with zoom and pan. */
export function StickiesViewer({ board, height, fill = false, people = NO_PEOPLE, me = null, top = 0 }: { board: StickiesData; height?: number; /** Fill the box it's in (a card) instead of taking `height`. */ fill?: boolean; people?: People; me?: string | null; top?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const fitted = useRef(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ sx: number; sy: number; view: View } | { dist: number; mid: { x: number; y: number }; view: View } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => setView(fitBoard(board, size.w, size.h, top)), [board, size, top]);
  useEffect(() => {
    if (!size.w || fitted.current) return;
    fitted.current = true;
    fit();
  }, [size, fit]);

  const zoomAt = useCallback((k: number, sx: number, sy: number) => {
    const v = viewRef.current;
    const nk = clamp(k, MIN_K, MAX_K);
    setView({ k: nk, x: sx - ((sx - v.x) / v.k) * nk, y: sy - ((sy - v.y) / v.k) * nk });
  }, []);

  // ⌘ or ctrl scroll (and a trackpad pinch) zooms; plain scrolling scrolls the page.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(viewRef.current.k * Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const summaryId = useMemo(() => `st-summary-${Math.random().toString(36).slice(2, 9)}`, []);
  const count = board.notes.length;
  return (
    <div
      ref={ref}
      className={`st-viewer${fill ? " st-viewer-fill" : ""}`}
      style={fill ? undefined : { height }}
      role="group"
      aria-label={`Sticky notes board, ${count} ${count === 1 ? "note" : "notes"}`}
      aria-describedby={summaryId}
      onPointerDown={(e) => {
        if ((e.target as Element).closest("button")) return;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        e.currentTarget.setPointerCapture(e.pointerId);
        const pts = [...pointers.current.values()];
        if (pts.length === 2) {
          const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
          const r = e.currentTarget.getBoundingClientRect();
          drag.current = { dist: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), mid: { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top }, view: viewRef.current };
        } else drag.current = { sx: e.clientX, sy: e.clientY, view: viewRef.current };
      }}
      onPointerMove={(e) => {
        if (!pointers.current.has(e.pointerId)) return;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const d = drag.current;
        if (!d) return;
        if ("dist" in d) {
          const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
          if (!a || !b) return;
          const r = e.currentTarget.getBoundingClientRect();
          const k = clamp(d.view.k * (Math.hypot(a.x - b.x, a.y - b.y) / d.dist), MIN_K, MAX_K);
          const mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
          setView({ k, x: mid.x - ((d.mid.x - d.view.x) / d.view.k) * k, y: mid.y - ((d.mid.y - d.view.y) / d.view.k) * k });
        } else setView({ ...d.view, x: d.view.x + e.clientX - d.sx, y: d.view.y + e.clientY - d.sy });
      }}
      onPointerUp={(e) => {
        pointers.current.delete(e.pointerId);
        drag.current = null;
      }}
      onPointerCancel={(e) => {
        pointers.current.delete(e.pointerId);
        drag.current = null;
      }}
    >
      <BoardSummary board={board} id={summaryId} />
      <div aria-hidden className="st-viewport">
        <BoardLayer board={board} view={view} people={people} me={me} />
      </div>
      <div className="st-bar st-bar-zoom" role="toolbar" aria-label="Zoom">
        <button type="button" className="st-btn" aria-label="Zoom out" onClick={() => zoomAt(view.k / 1.2, size.w / 2, size.h / 2)}>
          <Minus size={15} aria-hidden />
        </button>
        <span className="st-zoom" aria-live="off">
          {Math.round(view.k * 100)}%
        </span>
        <button type="button" className="st-btn" aria-label="Zoom in" onClick={() => zoomAt(view.k * 1.2, size.w / 2, size.h / 2)}>
          <Plus size={15} aria-hidden />
        </button>
        <button type="button" className="st-btn" aria-label="Fit the board" title="Fit the board" onClick={fit}>
          <Maximize size={14} aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** A clamped stored height for the read-only board. */
const clampHeight = (h: unknown) => {
  const n = Number(h);
  return Math.round(Math.max(LIMITS.minStickiesHeight, Math.min(LIMITS.maxStickiesHeight, Number.isFinite(n) && n > 0 ? n : STICKIES_DEFAULT_HEIGHT)));
};

export function StickiesStatic({ data, height }: { data: string; height?: number }) {
  const board = useMemo(() => parseStickies(data), [data]);
  if (!board.notes.length && !board.groups.length) return <p className="fb-vc-static-empty">Empty board</p>;
  return <StickiesViewer board={board} height={Math.min(clampHeight(height), 640)} />;
}
