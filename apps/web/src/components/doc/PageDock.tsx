"use client";

import { Paintbrush, Plus, Type } from "lucide-react";
import { AiIcon } from "@/components/ai/AiIcon";
import type { InspectorTab } from "./Inspector";

const DOCK: { id: InspectorTab; label: string; icon: React.ReactNode }[] = [
  { id: "ai", label: "AI", icon: <AiIcon size={16} /> },
  { id: "insert", label: "Insert", icon: <Plus size={17} /> },
  { id: "format", label: "Format", icon: <Type size={16} /> },
  { id: "style", label: "Style", icon: <Paintbrush size={16} /> },
];

/**
 * The floating bar at the bottom of the note: AI (the assistant on this note), Insert, Format and Style, then the
 * note's own actions. A tool opens in the right sidebar (a sheet above the bar on a phone); pressing it again,
 * Escape or × closes it. ⌘⌥I toggles the last tool.
 */
export function PageDock({ tab, open, onPick, buttonRef, extra, ai = true }: { tab: InspectorTab; open: boolean; onPick: (t: InspectorTab) => void; buttonRef: (t: InspectorTab, el: HTMLButtonElement | null) => void; /** The page's own actions (comments, share, more), after a divider. */ extra?: React.ReactNode; /** Show the AI tool (off when the person turned the assistant off). */ ai?: boolean }) {
  return (
    <div
      role="toolbar"
      aria-label="Page tools"
      // Lifted above the on-screen keyboard (--kb-inset, set by useKeyboardInset).
      className="ui-pop absolute bottom-[calc(1.25rem+var(--kb-inset,0px))] left-1/2 z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-[14px] p-1.5"
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
            className={`inline-flex h-10 items-center pointer-coarse:h-11 gap-2 rounded-[6px] px-3 text-[13.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus sm:px-4 ${on ? "bg-heading text-canvas" : "text-ink hover:bg-accent-soft hover:text-heading"}`}
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
