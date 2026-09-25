import { forwardRef, type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "quiet";
type Size = "sm" | "md" | "icon";

const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-[background-color,color,border-color,box-shadow] duration-150 ease-[var(--ease-folio)] disabled:opacity-50 disabled:cursor-not-allowed select-none";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:brightness-[1.06] active:brightness-95 shadow-[inset_0_-1px_0_rgba(0,0,0,0.12)]",
  secondary: "bg-raised text-ink border border-line hover:border-line-strong hover:bg-surface",
  ghost: "text-ink hover:bg-[color-mix(in_oklab,var(--color-ink)_7%,transparent)]",
  quiet: "text-muted hover:text-ink hover:bg-[color-mix(in_oklab,var(--color-ink)_6%,transparent)]",
  danger: "bg-danger text-white hover:brightness-110",
};
const sizes: Record<Size, string> = {
  sm: "h-8 rounded-[6px] px-2.5 text-[13px]",
  md: "h-9 rounded-[7px] px-3.5 text-sm",
  icon: "h-8 w-8 rounded-[6px] text-sm pointer-coarse:h-11 pointer-coarse:w-11",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", className, type = "button", ...rest },
  ref,
) {
  return <button ref={ref} type={type} className={`${base} ${variants[variant]} ${sizes[size]} ${className ?? ""}`} {...rest} />;
});

/** Icon-only button: requires a label for assistive tech (also shown as a tooltip). */
export const IconButton = forwardRef<HTMLButtonElement, ButtonProps & { label: string; shortcut?: string }>(function IconButton(
  { label, shortcut, variant = "quiet", ...rest },
  ref,
) {
  return <Button ref={ref} variant={variant} size="icon" aria-label={label} title={shortcut ? `${label} (${shortcut})` : label} {...rest} />;
});

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-5 items-center justify-center rounded-[4px] border border-line bg-sunken px-1 font-sans text-[11px] leading-5 text-muted">
      {children}
    </kbd>
  );
}
