"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

/**
 * The iPhone app's floating controls: a round glass button (Back, close) and a glass pill holding a few
 * icon buttons (Share and More on a note, notifications and More on Home). 44pt targets throughout; all
 * Liquid Glass (globals.css), swelling a little when pressed.
 */
export const GlassCircle = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode; size?: number }>(function GlassCircle(
  { label, children, size = 44, className = "", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      {...rest}
      style={{ width: size, height: size, ...rest.style }}
      className={`ui-liquid ui-glass-press grid flex-none place-items-center rounded-capsule text-heading outline-none focus-visible:ring-2 focus-visible:ring-focus ${className}`}
    >
      {children}
    </button>
  );
});

/** A row of glass-backed buttons sharing one capsule. */
export function GlassPill({ children, label, className = "" }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <div role={label ? "group" : undefined} aria-label={label} className={`ui-liquid flex h-11 flex-none items-center rounded-capsule px-0.5 ${className}`}>
      {children}
    </div>
  );
}

/** An icon button inside a GlassPill (or any glass bar). */
export const PillButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode; pressed?: boolean }>(function PillButton(
  { label, children, pressed, className = "", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      {...rest}
      className={`relative grid h-11 min-w-11 flex-none place-items-center rounded-capsule px-2.5 text-heading outline-none ui-glass-press active:bg-[var(--liquid-press)] focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-40 ${pressed ? "bg-[var(--liquid-active)]" : ""} ${className}`}
    >
      {children}
    </button>
  );
});

/** A text button in a glass capsule ("Select", "Done"), like the iOS bar's text buttons. */
export const GlassTextButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode; strong?: boolean }>(function GlassTextButton(
  { children, strong, className = "", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      className={`grid h-11 flex-none place-items-center rounded-capsule px-4 text-headline outline-none ui-glass-press focus-visible:ring-2 focus-visible:ring-focus ${strong ? "bg-heading font-semibold text-canvas shadow-[var(--liquid-shadow)]" : "ui-liquid font-medium text-heading"} ${className}`}
    >
      {children}
    </button>
  );
});
