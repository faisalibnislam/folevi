"use client";

import { useEffect, useRef, useState } from "react";
import { Paintbrush, Plus, Type } from "lucide-react";
import { AiIcon } from "@/components/ai/AiIcon";
import { setDockClearance } from "@/components/editor/scrollEdges";
import type { InspectorTab } from "./Inspector";
import "./page-dock.css";

const DOCK: { id: InspectorTab; label: string; icon: React.ReactNode }[] = [
  { id: "ai", label: "Foli AI", icon: <AiIcon size={16} /> },
  { id: "insert", label: "Insert", icon: <Plus size={17} /> },
  { id: "format", label: "Format", icon: <Type size={16} /> },
  { id: "style", label: "Style", icon: <Paintbrush size={16} /> },
];

/** Below this width of the note it floats over, the bar shows icons only (each keeps its name as a tooltip). */
export const DOCK_COMPACT_BELOW = 600;

/** Whether the bar shows icons only over a note this wide (0: not measured yet, words shown). */
export function dockCompact(noteWidth: number): boolean {
  return noteWidth > 0 && noteWidth < DOCK_COMPACT_BELOW;
}

/**
 * Icons only when the note the bar floats over is narrower than its words: measured on the note itself, so a
 * tools panel open beside it counts (QA audit F03), not only the pane's or the window's width.
 */
function useDockCompact(ref: React.RefObject<HTMLDivElement | null>): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const note = ref.current?.parentElement;
    if (!note || typeof ResizeObserver === "undefined") return;
    const measure = () => setCompact(dockCompact(note.clientWidth));
    const ro = new ResizeObserver(measure);
    ro.observe(note);
    measure();
    return () => ro.disconnect();
  }, [ref]);
  return compact;
}

/** Space kept between the bar and the caret or field scrolled above it. */
const DOCK_GAP = 12;

/**
 * Keeps what's being edited clear of the bar: works out how far the bar reaches up into the note's scroller
 * (gap included) and gives that to the scroller (`--page-dock-clear`, its scroll padding, so a focused cell or
 * field scrolls above the bar), to the editor (setDockClearance, its caret scroll margin) and to the room
 * after the note (`--page-dock-room`, so its last line can scroll above the bar). page-dock.css uses them.
 */
function useDockClearance(ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const dock = ref.current;
    let scroll: HTMLElement | null = null;
    for (let a = dock?.parentElement ?? null, i = 0; a && !scroll && i < 4; a = a.parentElement, i++) scroll = a.querySelector<HTMLElement>(".fb-page");
    if (!dock || !scroll) return;
    const page = scroll;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const bar = dock.getBoundingClientRect();
      const bottom = page.getBoundingClientRect().bottom;
      const clear = bar.height && bottom > bar.top ? Math.ceil(bottom - bar.top + DOCK_GAP) : 0;
      const padding = parseFloat(getComputedStyle(page).paddingBottom) || 0;
      page.style.setProperty("--page-dock-clear", `${clear}px`);
      page.style.setProperty("--page-dock-room", `${Math.max(0, Math.ceil(clear - padding))}px`);
      setDockClearance(clear);
    };
    const later = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    page.setAttribute("data-page-dock", "");
    measure();
    const size = new ResizeObserver(later);
    size.observe(dock);
    size.observe(page);
    // The scroller's own padding changes with its classes (a drawer open below it, the phone layout).
    const classes = new MutationObserver(later);
    classes.observe(page, { attributes: true, attributeFilter: ["class"] });
    // The on-screen keyboard lifts the bar (--kb-inset) without resizing it.
    const viewport = window.visualViewport;
    window.addEventListener("resize", later);
    viewport?.addEventListener("resize", later);
    viewport?.addEventListener("scroll", later);
    return () => {
      cancelAnimationFrame(frame);
      size.disconnect();
      classes.disconnect();
      window.removeEventListener("resize", later);
      viewport?.removeEventListener("resize", later);
      viewport?.removeEventListener("scroll", later);
      page.removeAttribute("data-page-dock");
      page.style.removeProperty("--page-dock-clear");
      page.style.removeProperty("--page-dock-room");
      setDockClearance(0);
    };
  }, [ref]);
}

/**
 * The floating bar at the bottom of the note: AI (the assistant on this note), Insert, Format and Style, then the
 * note's own actions. A tool opens in the right sidebar (a sheet above the bar on a phone); pressing it again,
 * Escape or × closes it. ⌘⌥I toggles the last tool.
 */
export function PageDock({ tab, open, onPick, buttonRef, extra, ai = true }: { tab: InspectorTab; open: boolean; onPick: (t: InspectorTab) => void; buttonRef: (t: InspectorTab, el: HTMLButtonElement | null) => void; /** The page's own actions (comments, share, more), after a divider. */ extra?: React.ReactNode; /** Show the AI tool (off when the person turned the assistant off). */ ai?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useDockClearance(ref);
  const compact = useDockCompact(ref);
  return (
    <div
      ref={ref}
      data-compact={compact ? "" : undefined}
      role="toolbar"
      aria-label="Page tools"
      // Lifted above the on-screen keyboard (--kb-inset, set by useKeyboardInset).
      // Never wider than the note it floats over: icons only when the words don't fit (globals.css, Page tools),
      // and as a last resort it scrolls sideways, so its first and last actions stay in reach (QA audit F03).
      className="ui-pop absolute bottom-[calc(1.25rem+var(--kb-inset,0px))] left-1/2 z-30 flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded-panel p-1 [scrollbar-width:none]"
    >
      {DOCK.filter((d) => ai || d.id !== "ai").map((d) => {
        const on = open && tab === d.id;
        return (
          <button
            key={d.id}
            ref={(el) => buttonRef(d.id, el)}
            type="button"
            aria-pressed={on}
            aria-controls={on ? "document-inspector" : undefined}
            // Keep the editor's selection when opening Format or Insert.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(d.id)}
            title={d.id === "ai" ? `${d.label} (⌘J)` : d.label}
            className={`inline-flex h-10 flex-none items-center whitespace-nowrap pointer-coarse:h-11 gap-2 rounded-control px-3 text-body font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus sm:px-4 ${on ? "bg-heading text-canvas" : "text-ink hover:bg-accent-soft hover:text-heading"}`}
          >
            <span aria-hidden>{d.icon}</span>
            <span className="max-sm:sr-only">{d.label}</span>
          </button>
        );
      })}
      {extra ? (
        <>
          <span aria-hidden className="mx-1 h-6 w-px bg-line" />
          {extra}
        </>
      ) : null}
    </div>
  );
}
