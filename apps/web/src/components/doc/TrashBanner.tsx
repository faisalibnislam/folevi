"use client";

import { Trash2, Undo2 } from "lucide-react";

/**
 * A note in Trash says so at the top of the page for as long as it's there, not only in the Undo toast that
 * fades: why it can't be edited, and Restore (QA audit F22). Restore needs edit access (the server's rule).
 */
export function TrashBanner({ canRestore, onRestore }: { canRestore: boolean; onRestore: () => void }) {
  return (
    <section
      aria-labelledby="note-in-trash"
      data-note-status="trash"
      className="mx-5 mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-chip bg-sunken px-4 py-3 shadow-[inset_0_0_0_1px_var(--color-line)] sm:mx-16"
    >
      <Trash2 size={16} aria-hidden className="flex-none text-muted" />
      <div className="min-w-0 flex-1">
        <h2 id="note-in-trash" className="text-subheadline font-semibold text-heading">
          In Trash
        </h2>
        <p className="text-subheadline text-muted">{canRestore ? "This note is in Trash, so it can't be edited. Restore it to edit it again." : "This note is in Trash, so it can't be edited."}</p>
      </div>
      {canRestore ? (
        <button
          type="button"
          onClick={onRestore}
          className="inline-flex h-8 flex-none items-center gap-1.5 rounded-control bg-[var(--color-accent-strong)] px-3 text-subheadline font-medium text-[var(--color-accent-ink)] outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-focus pointer-coarse:h-11"
        >
          <Undo2 size={14} aria-hidden />
          Restore
        </button>
      ) : null}
    </section>
  );
}
