"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { haptic } from "@/lib/nativeApp";
import { keyLabel, useMacKeys } from "@/lib/shortcuts";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "quiet";
/**
 * The control scale (docs/DESIGN_SYSTEM.md, Controls): "md" is every button in a row (36, 44 on touch), "compact" a
 * button inside a menu, popover, card or dense chrome (28, 36 on touch); "icon" and "icon-compact" are the same
 * heights, square.
 */
type Size = "md" | "compact" | "icon" | "icon-compact";

const base = "ui-btn";
const variants: Record<Variant, string> = {
  primary: "ui-btn-primary",
  secondary: "ui-btn-secondary",
  ghost: "ui-btn-ghost",
  quiet: "ui-btn-quiet",
  danger: "ui-btn-danger",
};
const sizes: Record<Size, string> = {
  md: "h-control px-3 text-callout",
  compact: "h-control-sm px-2.5 text-callout",
  icon: "size-control text-callout",
  "icon-compact": "size-control-sm text-callout",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", className, type = "button", onClick, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`${base} ${variants[variant]} ${sizes[size]} ${className ?? ""}`}
      // Confirming something destructive is felt in the iOS app (a warning tap; nothing elsewhere).
      onClick={variant === "danger" ? (e) => (haptic("warning"), onClick?.(e)) : onClick}
      {...rest}
    />
  );
});

/** Icon-only button: requires a label for assistive tech (also shown as a tooltip). */
export const IconButton = forwardRef<HTMLButtonElement, ButtonProps & { label: string; shortcut?: string }>(function IconButton(
  { label, shortcut, variant = "quiet", ...rest },
  ref,
) {
  // The shortcut as this system writes it (Ctrl+Alt+N off Apple's), in the tooltip and for assistive tech.
  const mac = useMacKeys();
  return <Button ref={ref} variant={variant} size="icon" aria-label={label} title={shortcut ? `${label} (${keyLabel(shortcut, mac)})` : label} aria-keyshortcuts={shortcut ? ariaShortcut(shortcut, mac) : undefined} {...rest} />;
});

const ARIA_MODS: Record<string, string> = { "⌘": "Meta", "⌃": "Control", "⌥": "Alt", "⇧": "Shift" };
/**
 * "⌘⇧K" as ARIA writes shortcuts ("Meta+Shift+K"), so assistive tech can announce it (docs/MAC_POLISH_PLAN.md
 * §3.15). Off Apple's systems ⌘ is Ctrl ("Control+Shift+K").
 */
export function ariaShortcut(shortcut: string, mac = true): string {
  const chars = [...shortcut];
  const mods: string[] = [];
  while (chars.length > 1 && ARIA_MODS[chars[0]!]) {
    const mod = ARIA_MODS[chars.shift()!]!;
    const named = !mac && mod === "Meta" ? "Control" : mod;
    if (!mods.includes(named)) mods.push(named);
  }
  return [...mods, chars.join("")].join("+");
}

/** A key cap. A shortcut given as text ("⌘K") is written as this system writes it ("Ctrl+K" off Apple's). */
export function Kbd({ children }: { children: React.ReactNode }) {
  const mac = useMacKeys();
  return (
    <kbd className="ui-kbd">
      {typeof children === "string" ? keyLabel(children, mac) : children}
    </kbd>
  );
}
