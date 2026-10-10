"use client";

import { Check } from "lucide-react";
import type { ReactNode } from "react";

/**
 * A checkbox in the app's neutral chrome (dark when checked), never the system's. A button with the
 * checkbox role: Space and Enter toggle it, and its label is part of the control (clicking the text works).
 */
export function Checkbox({ checked, onChange, children, disabled, describedBy, className }: { checked: boolean; onChange: (next: boolean) => void; children: ReactNode; disabled?: boolean; describedBy?: string; className?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`group/check flex min-w-0 items-start gap-2 rounded-chip text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50 ${className ?? ""}`}
    >
      <span
        aria-hidden
        className={`mt-[1px] grid h-4 w-4 flex-none place-items-center rounded-tiny transition-colors ${
          checked ? "bg-heading text-canvas" : "bg-transparent shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--color-ink)_35%,transparent)] group-hover/check:shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--color-ink)_55%,transparent)]"
        }`}
      >
        {checked ? <Check size={12} strokeWidth={3} /> : null}
      </span>
      <span className="min-w-0">{children}</span>
    </button>
  );
}
