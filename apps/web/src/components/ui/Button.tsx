import { forwardRef, type ButtonHTMLAttributes } from "react";

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
  sm: "h-8 px-3.5 text-[13px] pointer-coarse:h-11",
  md: "h-9 px-4 text-sm pointer-coarse:h-11",
  icon: "h-8 w-8 text-sm pointer-coarse:h-11 pointer-coarse:w-11",
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
    <kbd className="ui-kbd">
      {children}
    </kbd>
  );
}
