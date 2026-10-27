import { forwardRef, type ButtonHTMLAttributes } from "react";
import { haptic } from "@/lib/nativeApp";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "quiet";
type Size = "sm" | "md" | "icon";

const base = "ui-btn";
const variants: Record<Variant, string> = {
  primary: "ui-btn-primary",
  secondary: "ui-btn-secondary",
  ghost: "ui-btn-ghost",
  quiet: "ui-btn-quiet",
  danger: "ui-btn-danger",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-3.5 text-subheadline pointer-coarse:h-11",
  md: "h-9 px-4 text-subheadline pointer-coarse:h-11",
  icon: "h-8 w-8 text-subheadline pointer-coarse:h-11 pointer-coarse:w-11",
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
  return <Button ref={ref} variant={variant} size="icon" aria-label={label} title={shortcut ? `${label} (${shortcut})` : label} aria-keyshortcuts={shortcut ? ariaShortcut(shortcut) : undefined} {...rest} />;
});

const ARIA_MODS: Record<string, string> = { "⌘": "Meta", "⌃": "Control", "⌥": "Alt", "⇧": "Shift" };
/** "⌘⇧K" as ARIA writes shortcuts ("Meta+Shift+K"), so assistive tech can announce it (docs/MAC_POLISH_PLAN.md §3.15). */
export function ariaShortcut(shortcut: string): string {
  const chars = [...shortcut];
  const mods: string[] = [];
  while (chars.length > 1 && ARIA_MODS[chars[0]!]) mods.push(ARIA_MODS[chars.shift()!]!);
  return [...mods, chars.join("")].join("+");
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="ui-kbd">
      {children}
    </kbd>
  );
}
