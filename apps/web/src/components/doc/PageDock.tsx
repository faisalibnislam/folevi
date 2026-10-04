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
 * The page tools, docked at the bottom of the note: AI, Insert, Format and Style (Info is in the "…" menu). Each opens its panel
 * floating just above the dock, centred on it (pressing it again, Escape or × closes it), so the note
 * keeps the full width. ⌘⌥I toggles the last panel.
 */
export function PageDock({ tab, open, onPick, buttonRef, extra, ai = true }: { tab: InspectorTab; open: boolean; onPick: (t: InspectorTab) => void; buttonRef: (t: InspectorTab, el: HTMLButtonElement | null) => void; /** The page's own actions (comments, share, more), after a divider. */ extra?: React.ReactNode; /** Show the AI tool (off when the person turned the assistant off). */ ai?: boolean }) {
  return (
    <div
      role="toolbar"
      aria-label="Page tools"
      className="ui-pop absolute bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-[14px] p-1.5"
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
            className={`inline-flex h-10 items-center gap-2 rounded-[6px] px-3 text-[13.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus sm:px-4 ${on ? "bg-heading text-canvas" : "text-ink hover:bg-accent-soft hover:text-heading"}`}
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
