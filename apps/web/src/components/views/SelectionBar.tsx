"use client";

import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";

/** The selection rectangle being drawn (useCardSelection's `marquee`), in <body>: the glass panel's backdrop filter would otherwise offset a fixed element inside it. */
export function SelectionMarquee({ rect }: { rect: CSSProperties | null }) {
  if (!rect || typeof document === "undefined") return null;
  return createPortal(
    <div
      aria-hidden
      className="pointer-events-none fixed z-40 rounded-tiny"
      style={{ ...rect, background: "color-mix(in oklab, var(--color-heading) 7%, transparent)", boxShadow: "inset 0 0 0 1px color-mix(in oklab, var(--color-heading) 45%, transparent)" }}
    />,
    document.body,
  );
}

/** The check on a selected card's corner (the card also gets a ring, or a folder card a wash). */
export function SelectedCheck() {
  return (
    <span aria-hidden className="pointer-events-none absolute -left-2 -top-2 z-10 grid h-6 w-6 place-items-center rounded-chip bg-heading text-canvas shadow-[0_2px_6px_rgb(0_0_0/0.2)]">
      <Check size={14} strokeWidth={3} />
    </span>
  );
}

export interface SelectionAction {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  danger?: boolean;
}

/**
 * The floating bar shown while notes and folders are selected (Finder-style multi-select): how many, the actions for them, "Select all" and a
 * way out (× or Escape). A toolbar: Tab reaches it, arrow keys aren't needed with so few buttons.
 */
export function SelectionBar({ count, total, actions, onSelectAll, onClear, label = "Selected notes" }: { count: number; total: number; actions: SelectionAction[]; onSelectAll: () => void; onClear: () => void; label?: string }) {
  const btn =
    "inline-flex h-9 items-center gap-1.5 rounded-chip px-2.5 text-subheadline font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus";
  return (
    <div
      role="toolbar"
      aria-label={label}
      data-selection-bar=""
      data-no-marquee=""
      className="ui-pop absolute bottom-5 left-1/2 z-30 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded-panel p-1.5 animate-[folio-rise_160ms_var(--ease-folio)] motion-reduce:animate-none [scrollbar-width:none]"
    >
      <p role="status" aria-live="polite" className="flex-none whitespace-nowrap px-2.5 text-subheadline font-semibold text-heading">
        {count.toLocaleString()} selected
      </p>
      {count < total ? (
        <button type="button" onClick={onSelectAll} className={`${btn} flex-none text-muted hover:bg-accent-soft hover:text-heading`}>
          Select all
        </button>
      ) : null}
      <span aria-hidden className="mx-1 h-6 w-px flex-none bg-line" />
      {actions.map((a) => (
        <button
          key={a.label}
          type="button"
          onClick={a.onClick}
          className={`${btn} flex-none whitespace-nowrap ${a.danger ? "text-danger hover:bg-danger-soft" : "text-ink hover:bg-accent-soft hover:text-heading"}`}
        >
          <span aria-hidden>{a.icon}</span>
          <span className="max-sm:sr-only">{a.label}</span>
        </button>
      ))}
      <span aria-hidden className="mx-1 h-6 w-px flex-none bg-line" />
      <button type="button" onClick={onClear} aria-label="Clear selection" title="Clear selection (Esc)" className={`${btn} w-9 flex-none justify-center px-0 text-muted hover:bg-accent-soft hover:text-heading`}>
        <X size={15} aria-hidden />
      </button>
    </div>
  );
}
