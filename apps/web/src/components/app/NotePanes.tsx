"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "convex/react";
import { FileText, Search } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { MAX_PANES, tabHolds, tabPage, useTabs, type DocTab } from "@/lib/app/tabs";
import { PaneContext } from "@/lib/app/panes";
import { useLocalSearch } from "@/lib/hooks/useLocalNotes";
import { ShellContext, useShell } from "./Shell";

/** The narrowest a pane gets; below that the panes scroll sideways. */
const MIN_PANE = 360;
/** The gap between panes (it holds the Unjoin button and is where they're resized). */
const GAP = 16;
/** How close (px) the gap must come to a snap point to land on it. */
const SNAP = 14;

const noop = () => undefined;

/**
 * The join glyph: two brackets facing each other, with + (join) or × (unjoin) between them. Its line is the same
 * weight on screen as the app's 14 px icons (Lucide's 2 on a 24 grid: about 1.17 px).
 */
function JoinGlyph({ kind }: { kind: "join" | "unjoin" }) {
  return (
    <svg width="12" height="30" viewBox="0 0 12 30" fill="none" stroke="currentColor" strokeWidth="1.17" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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
  const { tabs, setSizes, join, unjoin } = useTabs();
  const { navigate } = useAppRouter();
  const tab = tabs.find((t) => !t.view && tabHolds(t, documentId)) ?? null;
  const panes = tab?.panes ?? [documentId];
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
  // The width the panes share (at least each one's minimum: below that the row scrolls sideways).
  const room = Math.max(width - GAP * (n - 1), MIN_PANE * n);

  const [guide, setGuide] = useState<Snap | null>(null);
  const drag = useRef<{ gap: number; startX: number; start: number[]; pointer: number } | null>(null);
  const lastSizes = useRef<number[] | null>(null);
  const onGapDown = (e: ReactPointerEvent<HTMLDivElement>, gap: number) => {
    if (e.button !== 0 || (e.target as Element).closest("button")) return;
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

  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const canJoin = Boolean(tab) && n < MAX_PANES;
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
    <div ref={box} className={`relative flex min-h-0 flex-1 ${n > 1 ? "overflow-x-auto overflow-y-hidden" : ""}`}>
      {panes.map((id, i) => {
        const primary = id === documentId;
        const style: CSSProperties = n > 1 ? { flex: `0 0 ${Math.round(sizes[i]! * room)}px`, minWidth: MIN_PANE } : { flex: "1 1 0%" };
        const content = (
          <PaneContext.Provider value={{ primary }}>
            {primary ? render(id) : <ShellContext.Provider value={{ ...shell, sidebarSlot: null, setNoteAi: noop, inspectorOpen: false, setInspectorOpen: noop }}>{render(id)}</ShellContext.Provider>}
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
                className="group/gap relative z-10 flex flex-none cursor-col-resize items-center justify-center outline-none"
                style={{ width: GAP, paddingTop: 56 }}
              >
                <span aria-hidden className="absolute inset-y-[64px] left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover/gap:bg-[var(--color-line)] group-focus-visible/gap:bg-[var(--color-focus)]" />
                <button
                  type="button"
                  aria-label="Unjoin these notes"
                  title="Unjoin"
                  onClick={() => tab && unjoin(tab.id, i - 1)}
                  className={`${PILL} relative opacity-0 group-hover/gap:opacity-100 group-focus-within/gap:opacity-100 focus-visible:opacity-100`}
                >
                  <JoinGlyph kind="unjoin" />
                </button>
              </div>
            ) : null}
            <div
              data-pane={id}
              data-pane-focus={n > 1 && primary ? "" : undefined}
              className="relative flex min-h-0 min-w-0 flex-col"
              style={style}
              onPointerDownCapture={() => focusPane(id)}
              // Tabbing into a pane counts; focus a page puts back by itself (a closing popover, a restored caret) doesn't.
              onFocusCapture={(e) => {
                if ((e.target as Element).matches?.(":focus-visible") && !(e.target as Element).closest(".ProseMirror")) focusPane(id);
              }}
            >
              {content}
              {/* Joined notes: a faint line marks the pane with focus. */}
              {n > 1 ? <span aria-hidden className={`pointer-events-none absolute inset-x-6 top-[50px] z-20 h-0.5 rounded-full transition-opacity ${primary ? "bg-[var(--color-heading)] opacity-25" : "opacity-0"}`} /> : null}
            </div>
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
            aria-haspopup="dialog"
            aria-expanded={Boolean(picker)}
            title="Join a note beside this one"
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
