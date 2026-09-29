"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";

export interface SelectionAction {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  danger?: boolean;
}

/**
 * The floating bar shown while notes are selected: how many, the actions for them, "Select all" and a
 * way out (× or Escape). A toolbar: Tab reaches it, arrow keys aren't needed with so few buttons.
 */
export function SelectionBar({ count, total, actions, onSelectAll, onClear }: { count: number; total: number; actions: SelectionAction[]; onSelectAll: () => void; onClear: () => void }) {
  const btn =
    "inline-flex h-9 items-center gap-1.5 rounded-[6px] px-2.5 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus";
  return (
    <div
      role="toolbar"
      aria-label="Selected notes"
      data-no-marquee=""
      className="ui-pop absolute bottom-5 left-1/2 z-30 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded-[14px] p-1.5 animate-[folio-rise_160ms_var(--ease-folio)] motion-reduce:animate-none [scrollbar-width:none]"
    >
      <p role="status" aria-live="polite" className="flex-none whitespace-nowrap px-2.5 text-[13px] font-semibold text-heading">
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
