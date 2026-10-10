"use client";

import { Globe } from "lucide-react";

/**
 * The composer's Web switch: off by default; on, the next answers search the web as well as your notes.
 * A pressed button (not a checkbox), so it looks the same everywhere. The server checks the setting again.
 */
export function WebToggle({ on, onChange, disabled }: { on: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      title={on ? "Answers use your notes and the web" : "Also search the web"}
      className={`inline-flex h-7 items-center gap-1.5 rounded-chip px-2.5 text-[12.5px] transition-colors disabled:opacity-40 ${
        on ? "bg-heading text-canvas" : "bg-[var(--glass-hover)] text-muted shadow-[inset_0_0_0_1px_var(--glass-border)] hover:bg-[var(--glass-active)] hover:text-heading"
      }`}
    >
      <Globe size={13} aria-hidden />
      Web
    </button>
  );
}
