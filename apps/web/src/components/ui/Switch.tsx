"use client";

/** An on/off switch in the app's neutral chrome (dark when on). */
export function Switch({ checked, onChange, label, describedBy, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; describedBy?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-10 flex-none items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50 ${
        checked ? "bg-heading" : "bg-[color-mix(in_oklab,var(--color-ink)_22%,transparent)]"
      }`}
    >
      <span aria-hidden className={`inline-block h-5 w-5 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.25)] transition-transform duration-150 ${checked ? "translate-x-[18px]" : "translate-x-[2px]"}`} />
    </button>
  );
}
