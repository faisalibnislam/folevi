"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "convex/react";
import { FileText, Search } from "lucide-react";
import { MiniPage } from "./TabPreview";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { MAX_PANES, tabHolds, tabPage, useTabs, type DocTab } from "@/lib/app/tabs";
import { PaneContext } from "@/lib/app/panes";
import { useLocalSearch } from "@/lib/hooks/useLocalNotes";
import { ShellContext, useShell } from "./Shell";

/** The narrowest a pane is dragged to. */
const MIN_PANE = 360;
/**
 * The narrowest a joined note gets before the next one folds into a spine (folding is the last resort: notes shrink
 * first, their page tools down to icons below 600, globals.css).
 */
const COMFORT = MIN_PANE;
/** A folded note: a spine with its icon and title, standing in its place. */
const SPINE = 44;
/** The gap between panes (it holds the Unjoin button and is where they're resized). */
const GAP = 16;
/** How close (px) the gap must come to a snap point to land on it. */
const SNAP = 14;

const noop = () => undefined;

/**
 * The join glyph: two brackets facing each other, with + (join) or × (unjoin) between them, drawn at 85% of its
 * grid. Its line is the same weight on screen as the app's 14 px icons (Lucide's 2 on a 24 grid: about 1.17 px).
 */
function JoinGlyph({ kind }: { kind: "join" | "unjoin" }) {
  return (
    <svg width="10.2" height="25.5" viewBox="0 0 12 30" fill="none" stroke="currentColor" strokeWidth="1.17" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 1.5v5.5h8V1.5" />
      {kind === "join" ? <path d="M6 11.5v7M2.5 15h7" /> : <path d="M3.5 12.5l5 5M8.5 12.5l-5 5" />}
      <path d="M2 28.5V23h8v5.5" />
    </svg>
  );
}

/** A slim upright pill (the Join and Unjoin buttons), drawn like the tab strip's controls: the raised surface, a
 * fine outline and a soft shadow, the glyph quiet until it's pointed at. */
const PILL =
  "pointer-events-auto grid h-16 w-[18px] place-items-center rounded-full bg-[var(--color-surface-raised)] text-muted shadow-[0_1px_3px_rgb(0_0_0/0.1),inset_0_0_0_1px_color-mix(in_oklab,var(--color-heading)_14%,transparent)] outline-none backdrop-blur transition-[opacity,color,box-shadow] duration-150 hover:text-heading hover:shadow-[0_2px_8px_rgb(0_0_0/0.14),inset_0_0_0_1.5px_color-mix(in_oklab,var(--color-heading)_28%,transparent)] focus-visible:ring-2 focus-visible:ring-focus";

interface Snap {
  /** Where the gap lands, as a share of the width from the left edge. */
  at: number;
  label: string;
}

/**
 * Where a gap can snap while it's dragged: the place that makes every pane equal, and for two panes the
 * thirds, for three panes the place that halves the two panes beside the gap.
 */
function snapsFor(sizes: number[], gap: number): Snap[] {
  const n = sizes.length;
  const before = sizes.slice(0, gap).reduce((a, b) => a + b, 0);
  const pair = sizes[gap]! + sizes[gap + 1]!;
  const out: Snap[] = [];
  const equalHere = (gap + 1) / n;
  // "Equal" only snaps when the rest already allows it (the panes outside this pair are at an equal share).
  const othersEqual = sizes.every((s, i) => i === gap || i === gap + 1 || Math.abs(s - 1 / n) < 0.01);
  if (othersEqual) out.push({ at: equalHere, label: "Equal" });
  if (n === 2) {
    out.push({ at: 1 / 3, label: "⅓ · ⅔" }, { at: 2 / 3, label: "⅔ · ⅓" });
  } else {
    const half = before + pair / 2;
    if (!out.some((s) => Math.abs(s.at - half) < 0.005)) out.push({ at: half, label: "Halves" });
  }
  return out;
}

const equal = (n: number) => Array.from({ length: n }, () => 1 / n);

/**
 * The note page, or notes joined side by side (two or three): each in its own pane, the one with focus owning
 * the page sidebar and the shortcuts. Between panes: a gap that resizes them (snapping to equal, thirds and
 * halves; ⌥ to drag freely, a double-click to make them equal again) with Unjoin in it. At the right edge:
 * Join, which adds a note beside the last one.
 */
export function NotePanes({ documentId, render }: { documentId: string; render: (id: string) => ReactNode }) {
  const shell = useShell();
  const { tabs, setSizes, join, unjoin, movePane, detachPane } = useTabs();
  const { navigate } = useAppRouter();
  const tab = tabs.find((t) => !t.view && tabHolds(t, documentId)) ?? null;
  const tabPanes = tab?.panes;
  const panes = useMemo(() => tabPanes ?? [documentId], [tabPanes, documentId]);
  const n = panes.length;
  const stored = tab?.sizes && tab.sizes.length === n ? tab.sizes : null;
  const [dragSizes, setDragSizes] = useState<number[] | null>(null);
  const sizes = dragSizes ?? stored ?? equal(n);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  // Too narrow for every note at a comfortable width: the note you're in stays open, then the ones you were in
  // most recently while they fit; the rest fold into spines in their places (open again by a click, or by
  // themselves as the window widens).
  const [recent, setRecent] = useState<string[]>([documentId]);
  useEffect(() => setRecent((cur) => (cur[0] === documentId ? cur : [documentId, ...cur.filter((x) => x !== documentId)])), [documentId]);
  const folded = useMemo(() => {
    if (n < 2 || !width) return new Set<string>();
    const byRecent = [documentId, ...recent.filter((x) => x !== documentId && panes.includes(x)), ...panes.filter((x) => x !== documentId && !recent.includes(x))];
    for (let open = n; open >= 1; open--) {
      if (open * COMFORT + (n - open) * SPINE + GAP * (n - 1) <= width || open === 1) return new Set(byRecent.slice(open));
    }
    return new Set<string>();
  }, [n, width, documentId, recent, panes]);
  const allOpen = folded.size === 0;
  // The width the open notes share, split by their sizes (a folded note's share goes to the others meanwhile).
  const room = Math.max(0, width - GAP * (n - 1) - folded.size * SPINE);
  const openShare = panes.reduce((sum, id, i) => (folded.has(id) ? sum : sum + sizes[i]!), 0) || 1;
  const titles = useQuery(api.documents.titles, n > 1 ? { documentIds: panes } : "skip");
  // Each open note's width from its size, but never under the minimum (what it lacks comes from the wider ones).
  const widths = useMemo(() => {
    const open = panes.map((id, i) => (folded.has(id) ? 0 : (sizes[i]! / openShare) * room));
    const floor = Math.min(MIN_PANE, room / Math.max(1, n - folded.size));
    let short = 0;
    for (const w of open) if (w && w < floor) short += floor - w;
    const spare = open.reduce((sum, w) => (w > floor ? sum + (w - floor) : sum), 0);
    return open.map((w) => (!w ? 0 : w < floor ? floor : spare ? Math.round(w - ((w - floor) / spare) * short) : Math.round(w)));
  }, [panes, folded, sizes, openShare, room, n]);

  const [guide, setGuide] = useState<Snap | null>(null);
  const drag = useRef<{ gap: number; startX: number; start: number[]; pointer: number } | null>(null);
  const lastSizes = useRef<number[] | null>(null);
  const onGapDown = (e: ReactPointerEvent<HTMLDivElement>, gap: number) => {
    // (Sizes are set while every note is open: a gap beside a spine has nothing to resize.)
    if (e.button !== 0 || !allOpen || (e.target as Element).closest("button")) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { gap, startX: e.clientX, start: [...sizes], pointer: e.pointerId };
  };
  const onGapMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / room;
    const pair = d.start[d.gap]! + d.start[d.gap + 1]!;
    const min = MIN_PANE / room;
    let left = Math.min(Math.max(d.start[d.gap]! + dx, Math.min(min, pair / 2)), pair - Math.min(min, pair / 2));
    // Snap: the gap is drawn to the nearest snap point within reach (⌥ drags freely).
    let hit: Snap | null = null;
    if (!e.altKey) {
      const before = d.start.slice(0, d.gap).reduce((a, b) => a + b, 0);
      const at = before + left;
      for (const s of snapsFor(d.start, d.gap)) {
        if (Math.abs(s.at - at) * room <= SNAP && (!hit || Math.abs(s.at - at) < Math.abs(hit.at - at))) hit = s;
      }
      if (hit) left = hit.at - before;
    }
    setGuide(hit);
    const next = [...d.start];
    next[d.gap] = left;
    next[d.gap + 1] = pair - left;
    lastSizes.current = next;
    setDragSizes(next);
  };
  const onGapUp = () => {
    const d = drag.current;
    drag.current = null;
    setGuide(null);
    const last = lastSizes.current;
    lastSizes.current = null;
    setDragSizes(null);
    if (!d || !tab || !last) return;
    const isEqual = last.every((s) => Math.abs(s - 1 / n) < 0.002);
    setSizes(tab.id, isEqual ? undefined : last);
  };
  const nudge = (gap: number, by: number) => {
    if (!tab) return;
    const next = [...sizes];
    const pair = next[gap]! + next[gap + 1]!;
    const min = Math.min(MIN_PANE / room, pair / 2);
    next[gap] = Math.min(Math.max(next[gap]! + by, min), pair - min);
    next[gap + 1] = pair - next[gap]!;
    setSizes(tab.id, next);
  };

  // A pane takes focus when it's clicked or tabbed into: it becomes the page on screen (and in the address).
  const focusPane = (id: string) => {
    if (id !== documentId) navigate(`/d/${id}`, { replace: true });
  };

  // Rearranging: a pane dragged by its bar follows the pointer, the others slide aside to show where it lands,
  // and it drops into that place.
  const [paneDrag, setPaneDrag] = useState<{ from: number; dx: number; to: number; width: number } | null>(null);
  const justDraggedPane = useRef(false);
  const paneDragRef = useRef<{ from: number; startX: number; to: number; mids: number[]; widths: number[]; moved: boolean } | null>(null);
  const startPaneDrag = (e: ReactPointerEvent<HTMLElement>, from: number) => {
    const target = e.target as Element;
    // (A spine is dragged by itself; a bar, by anywhere but its links and buttons.)
    if (e.button !== 0 || e.pointerType === "touch" || n < 2 || (!target.closest("[data-pane-spine]") && target.closest("a,button,input,[role=menuitem]"))) return;
    const els = panes.map((id) => box.current?.querySelector<HTMLElement>(`[data-pane="${CSS.escape(id)}"]`));
    if (els.some((el) => !el)) return;
    const rects = els.map((el) => el!.getBoundingClientRect());
    paneDragRef.current = { from, startX: e.clientX, to: from, mids: rects.map((r) => r.left + r.width / 2), widths: rects.map((r) => r.width), moved: false };
    const move = (ev: PointerEvent) => {
      const d = paneDragRef.current;
      if (!d) return;
      const dx = ev.clientX - d.startX;
      if (!d.moved && Math.abs(dx) < 5) return;
      d.moved = true;
      // The place it lands: once its leading edge passes a neighbour's middle, it takes that neighbour's slot.
      const half = d.widths[d.from]! / 2;
      const left = d.mids[d.from]! + dx - half;
      const right = d.mids[d.from]! + dx + half;
      let to = d.from;
      for (let j = 0; j < d.mids.length; j++) {
        if (j < d.from && left < d.mids[j]!) to = Math.min(to, j);
        if (j > d.from && right > d.mids[j]!) to = Math.max(to, j);
      }
      d.to = to;
      setPaneDrag({ from: d.from, dx, to, width: d.widths[d.from]! });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      const d = paneDragRef.current;
      paneDragRef.current = null;
      setPaneDrag(null);
      if (d?.moved) {
        // The click that ends a drag doesn't open the spine it was.
        justDraggedPane.current = true;
        window.setTimeout(() => (justDraggedPane.current = false), 0);
      }
      if (d?.moved && tab && d.to !== d.from) movePane(tab.id, d.from, d.to);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  /** Where each pane is drawn during a drag: the dragged one under the pointer, the ones it passed slid aside. */
  const dragShift = (i: number): number => {
    if (!paneDrag) return 0;
    if (i === paneDrag.from) return paneDrag.dx;
    const w = paneDrag.width + GAP;
    if (paneDrag.to > paneDrag.from && i > paneDrag.from && i <= paneDrag.to) return -w;
    if (paneDrag.to < paneDrag.from && i < paneDrag.from && i >= paneDrag.to) return w;
    return 0;
  };

  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  // Unjoin asks first (a pill in the gap is easy to hit by accident): the gap it's for, and where to show it.
  const [confirm, setConfirm] = useState<{ gap: number; x: number; y: number } | null>(null);
  // (Not while notes are folded for room: there's none for another, and it would cover the last spine.)
  const canJoin = Boolean(tab) && n < MAX_PANES && allOpen;
  // Join sits on the last note's own right edge: with its tools panel open (Style, Format…), beside the note,
  // not over the panel.
  const [joinInset, setJoinInset] = useState(0);
  const lastPane = panes[n - 1]!;
  useEffect(() => {
    const el = box.current;
    if (!el || !canJoin) return;
    const pane = el.querySelector<HTMLElement>(`[data-pane="${CSS.escape(lastPane)}"]`);
    if (!pane) return;
    const measure = () => {
      const note = pane.querySelector<HTMLElement>("[data-note-panel]");
      if (!note) return setJoinInset(0);
      const inset = Math.max(0, Math.round(pane.getBoundingClientRect().right - note.getBoundingClientRect().right));
      setJoinInset((cur) => (cur === inset ? cur : inset));
    };
    measure();
    // The note narrows when its panel opens: follow its size, and the page arriving (it loads after the pane).
    const ro = new ResizeObserver(measure);
    ro.observe(pane);
    // (Once a frame at most: typing changes the page's nodes too.)
    let frame = 0;
    const mo = new MutationObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const note = pane.querySelector<HTMLElement>("[data-note-panel]");
        if (note) ro.observe(note);
        measure();
      });
    });
    mo.observe(pane, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      mo.disconnect();
    };
  }, [canJoin, lastPane]);

  return (
    <div ref={box} className={`relative flex min-h-0 flex-1 ${n > 1 ? "overflow-hidden" : ""}`}>
      {panes.map((id, i) => {
        const primary = id === documentId;
        const isFolded = folded.has(id);
        const style: CSSProperties = n < 2 ? { flex: "1 1 0%" } : isFolded ? { flex: `0 0 ${SPINE}px` } : { flex: `0 0 ${widths[i]}px` };
        const content = (
          <PaneContext.Provider
            value={{
              primary,
              joined:
                n > 1 && tab
                  ? {
                      index: i,
                      count: n,
                      move: (to: number) => movePane(tab.id, i, to),
                      remove: () => detachPane(tab.id, id),
                      dragStart: (e: ReactPointerEvent<HTMLElement>) => startPaneDrag(e, i),
                      dragging: paneDrag?.from === i,
                    }
                  : undefined,
            }}
          >
            {primary ? (
              render(id)
            ) : (
              // A note without focus opens its tools panel by taking focus first (one click does both).
              <ShellContext.Provider
                value={{
                  ...shell,
                  sidebarSlot: null,
                  setNoteAi: noop,
                  inspectorOpen: false,
                  setInspectorOpen: (open: boolean) => {
                    focusPane(id);
                    shell.setInspectorOpen(open);
                  },
                }}
              >
                {render(id)}
              </ShellContext.Provider>
            )}
          </PaneContext.Provider>
        );
        return (
          <div key={id} className="contents">
            {i > 0 ? (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize notes"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(sizes.slice(0, i).reduce((a, b) => a + b, 0) * 100)}
                tabIndex={0}
                onPointerDown={(e) => onGapDown(e, i - 1)}
                onPointerMove={onGapMove}
                onPointerUp={onGapUp}
                onPointerCancel={onGapUp}
                onLostPointerCapture={onGapUp}
                onDoubleClick={() => tab && setSizes(tab.id, undefined)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowLeft") nudge(i - 1, -0.02);
                  else if (e.key === "ArrowRight") nudge(i - 1, 0.02);
                  else if (e.key === "=" && tab) setSizes(tab.id, undefined);
                  else return;
                  e.preventDefault();
                }}
                title="Drag to resize · double-click to make equal · ⌥ to drag freely"
                className={`group/gap relative z-10 flex flex-none items-center justify-center outline-none ${allOpen ? "cursor-col-resize" : ""}`}
                style={{ width: GAP, paddingTop: 56 }}
              >
                <span aria-hidden className="absolute inset-y-[64px] left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover/gap:bg-[var(--color-line)] group-focus-visible/gap:bg-[var(--color-focus)]" />
                <button
                  type="button"
                  aria-label="Unjoin these notes"
                  title="Unjoin notes"
                  aria-haspopup="dialog"
                  aria-expanded={confirm?.gap === i - 1}
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setConfirm({ gap: i - 1, x: r.left + r.width / 2, y: r.bottom + 8 });
                  }}
                  className={`${PILL} relative ${confirm?.gap === i - 1 ? "opacity-100" : "opacity-0"} group-hover/gap:opacity-100 group-focus-within/gap:opacity-100 focus-visible:opacity-100`}
                >
                  <JoinGlyph kind="unjoin" />
                </button>
              </div>
            ) : null}
            {isFolded ? (
              <Spine
                key={id}
                id={id}
                title={titles?.[id]?.title || "Untitled"}
                shift={paneDrag ? dragShift(i) : null}
                lifted={paneDrag?.from === i}
                onDragStart={(e) => startPaneDrag(e, i)}
                onOpen={() => {
                  if (!justDraggedPane.current) navigate(`/d/${id}`, { replace: true });
                }}
              />
            ) : (
            <div
              data-pane={id}
              data-pane-focus={n > 1 && primary ? "" : undefined}
              // Only the note you're in shows its page tools (Foli AI, Insert, Format…): globals.css hides the others'.
              data-pane-rest={n > 1 && !primary ? "" : undefined}
              className={`relative flex min-h-0 min-w-0 flex-col ${paneDrag ? (paneDrag.from === i ? "z-30 opacity-95 [filter:drop-shadow(0_12px_28px_rgb(0_0_0/0.18))]" : "transition-transform duration-200 ease-out") : ""}`}
              style={{ ...style, transform: paneDrag ? `translateX(${dragShift(i)}px)` : undefined }}
              onPointerDownCapture={() => focusPane(id)}
              // Tabbing into a pane counts; focus a page puts back by itself (a closing popover, a restored caret) doesn't.
              onFocusCapture={(e) => {
                if ((e.target as Element).matches?.(":focus-visible") && !(e.target as Element).closest(".ProseMirror")) focusPane(id);
              }}
            >
              {content}
            </div>
            )}
          </div>
        );
      })}
      {/* Join: on the right edge, where the pointer finds it. */}
      {canJoin ? (
        <div className="group/join pointer-events-none absolute inset-y-0 z-20 flex w-10 items-center justify-center" style={{ paddingTop: 56, right: joinInset > 24 ? joinInset - 20 : 0 }}>
          <span aria-hidden className="pointer-events-auto absolute inset-y-[56px] right-0 w-10" />
          <button
            type="button"
            aria-label="Join a note beside this one"
            title="Join a note"
            aria-haspopup="dialog"
            aria-expanded={Boolean(picker)}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setPicker({ x: r.left - 8, y: r.top + r.height / 2 });
            }}
            className={`${PILL} relative group-hover/join:opacity-100 focus-visible:opacity-100 ${picker ? "opacity-100" : "opacity-0"}`}
          >
            <JoinGlyph kind="join" />
          </button>
        </div>
      ) : null}
      {guide && width ? (
        <div aria-hidden className="pointer-events-none absolute inset-y-[56px] z-30" style={{ left: Math.round(guide.at * room + GAP * (guide.at * n - 0.5)) }}>
          <span className="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-[var(--color-focus)]" />
          <span className="absolute top-3 -translate-x-1/2 whitespace-nowrap rounded-chip bg-[var(--color-heading)] px-2 py-0.5 text-caption font-semibold text-[var(--color-canvas)] shadow">{guide.label}</span>
        </div>
      ) : null}
      {confirm && tab ? (
        <UnjoinConfirm
          at={confirm}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            unjoin(tab.id, confirm.gap);
          }}
        />
      ) : null}
      {picker && tab ? (
        <JoinPicker
          at={picker}
          exclude={panes}
          onClose={() => setPicker(null)}
          onPick={(id) => {
            setPicker(null);
            join(tab.id, id);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * A joined note folded for room: its icon and title upright, in its place. A click opens it (it becomes the note
 * you're in); resting on it shows a picture of its page beside it, as a tab does.
 */
function Spine({ id, title, shift, lifted, onDragStart, onOpen }: { id: string; title: string; /** Where it's drawn while notes are dragged (null: not dragging). */ shift: number | null; lifted: boolean; onDragStart: (e: ReactPointerEvent<HTMLElement>) => void; onOpen: () => void }) {
  const [peek, setPeek] = useState<{ left: number; top: number; side: "left" | "right" } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <div
      data-pane={id}
      data-pane-spine=""
      className={`relative flex min-h-0 flex-none flex-col ${lifted ? "z-30 [filter:drop-shadow(0_12px_28px_rgb(0_0_0/0.18))]" : shift !== null ? "transition-transform duration-200 ease-out" : ""}`}
      style={{ flex: `0 0 ${SPINE}px`, paddingTop: 56, transform: shift !== null ? `translateX(${shift}px)` : undefined }}
    >
      <button
        type="button"
        aria-label={`Open ${title}`}
        onPointerDown={(e) => {
          if (timer.current) clearTimeout(timer.current);
          setPeek(null);
          onDragStart(e);
        }}
        onClick={onOpen}
        onPointerEnter={(e) => {
          if (e.pointerType !== "mouse") return;
          const r = e.currentTarget.getBoundingClientRect();
          const side = r.left > window.innerWidth / 2 ? "left" : "right";
          timer.current = setTimeout(() => setPeek({ left: side === "left" ? r.left - 308 : r.right + 8, top: Math.max(8, r.top + 40), side }), 300);
        }}
        onPointerLeave={() => {
          if (timer.current) clearTimeout(timer.current);
          setPeek(null);
        }}
        className={`mb-1 flex min-h-0 flex-1 flex-col items-center gap-2 rounded-panel bg-[var(--glass-hover)] px-0 py-3 text-muted outline-none ${lifted ? "cursor-grabbing" : "cursor-pointer"} transition-colors hover:bg-[color-mix(in_oklab,var(--glass-active)_70%,transparent)] hover:text-heading focus-visible:ring-2 focus-visible:ring-focus`}
      >
        <FileText size={14} aria-hidden className="flex-none opacity-70" />
        <span className="min-h-0 truncate text-subheadline font-medium [writing-mode:vertical-rl]">{title}</span>
      </button>
      {peek
        ? createPortal(
            <div aria-hidden className="pointer-events-none fixed z-[60] w-[300px] overflow-hidden rounded-container border border-line bg-[var(--color-surface-raised)] shadow-[0_12px_36px_rgb(0_0_0/0.18)]" style={{ left: peek.left, top: peek.top }}>
              <MiniPage documentId={id} title={title} className="aspect-[16/10] w-full" />
              <div className="truncate border-t border-line px-3 py-2 text-subheadline font-semibold text-heading">{title}</div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/** "Unjoin these notes?" under the Unjoin button: Unjoin or Cancel (Esc, or a click elsewhere, cancels). */
function UnjoinConfirm({ at, onConfirm, onCancel }: { at: { x: number; y: number }; onConfirm: () => void; onCancel: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node)) onCancel();
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [onCancel]);
  const W = 232;
  return createPortal(
    <div
      ref={panel}
      role="alertdialog"
      aria-label="Unjoin these notes?"
      className="ui-pop fixed z-[80] p-3"
      style={{ left: Math.min(Math.max(12, at.x - W / 2), window.innerWidth - W - 12), top: at.y, width: W }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <p className="text-subheadline font-semibold text-heading">Unjoin these notes?</p>
      <p className="mt-0.5 text-footnote text-muted">Each side goes back to its own tab. Nothing in the notes changes.</p>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="h-8 rounded-control px-3 text-subheadline text-heading hover:bg-[var(--glass-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
          No
        </button>
        <button type="button" autoFocus onClick={onConfirm} className="h-8 rounded-control bg-[var(--color-heading)] px-3 text-subheadline font-semibold text-[var(--color-canvas)] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
          Yes, unjoin
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** Picks the note to join: the open tabs first, then a search across every note. */
function JoinPicker({ at, exclude, onClose, onPick }: { at: { x: number; y: number }; exclude: string[]; onClose: () => void; onPick: (id: string) => void }) {
  const { scope } = useAppState();
  const { tabs } = useTabs();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 120);
    return () => clearTimeout(t);
  }, [query]);
  const recent = useQuery(api.documents.recent, { scope, limit: 12 });
  const found = useQuery(api.search.documents, debounced ? { scope, query: debounced, limit: 20 } : "skip");
  const onDevice = useLocalSearch(debounced);
  const openNotes = tabs.filter((t) => !t.view && !t.panes);
  const titles = useQuery(api.documents.titles, openNotes.length ? { documentIds: openNotes.map(tabPage) } : "skip");
  const skip = new Set(exclude);
  const q = debounced.toLowerCase();
  const open = openNotes
    .map((t) => ({ id: tabPage(t), title: titles?.[tabPage(t)]?.title || t.title || "Untitled" }))
    .filter((t) => !skip.has(t.id) && (!q || t.title.toLowerCase().includes(q)));
  const openIds = new Set(open.map((o) => o.id));
  const others = useMemo(() => {
    const list: { id: string; title: string }[] = debounced
      ? [...onDevice.map((h) => ({ id: h.id, title: h.title })), ...(found ?? []).map((r) => ({ id: r.id, title: r.title }))]
      : (recent ?? []).map((r) => ({ id: r.id, title: r.title }));
    const seen = new Set<string>();
    return list.filter((d) => !skip.has(d.id) && !openIds.has(d.id) && !seen.has(d.id) && (seen.add(d.id), true));
  }, [debounced, onDevice, found, recent]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = [...open.map((o) => ({ ...o, group: "Open tabs" })), ...others.map((o) => ({ ...o, group: debounced ? "Notes" : "Recent notes" }))];
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [debounced]);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [onClose]);
  const W = 320;
  const left = Math.max(12, at.x - W);
  const top = Math.min(Math.max(12, at.y - 180), window.innerHeight - 380);
  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label="Join a note"
      className="ui-pop fixed z-[80] flex max-h-[360px] flex-col overflow-hidden"
      style={{ left, top, width: W }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        else if (e.key === "ArrowDown") setActive((a) => Math.min(items.length - 1, a + 1));
        else if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
        else if (e.key === "Enter" && items[active]) onPick(items[active]!.id);
        else return;
        e.preventDefault();
      }}
    >
      <div className="px-3 pb-1.5 pt-3 text-footnote font-semibold text-heading">Join with…</div>
      <label className="mx-3 mb-2 flex h-9 items-center gap-2 rounded-control border border-line bg-[var(--color-canvas)] px-2.5 text-subheadline focus-within:ring-2 focus-within:ring-focus">
        <Search size={14} aria-hidden className="text-faint" />
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search notes" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-faint" aria-label="Search notes to join" />
      </label>
      <div role="listbox" aria-label="Notes" className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {items.length === 0 ? <p className="px-2 py-3 text-subheadline text-muted">{debounced ? `No notes match “${debounced}”.` : "No other notes yet."}</p> : null}
        {items.map((it, i) => (
          <div key={it.id}>
            {i === 0 || items[i - 1]!.group !== it.group ? <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-faint">{it.group}</div> : null}
            <button
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => onPick(it.id)}
              className={`flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-subheadline ${i === active ? "bg-[var(--glass-hover)] text-heading" : "text-ink"}`}
            >
              <FileText size={14} aria-hidden className="flex-none opacity-60" />
              <span className="truncate">{it.title || "Untitled"}</span>
            </button>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}

/** Whether a doc tab is joined (two or more notes side by side). */
export const isJoined = (t: DocTab | null | undefined) => Boolean(t?.panes && t.panes.length > 1);
