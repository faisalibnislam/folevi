"use client";

import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";

export function AuthHeading({ title, lede }: { title: string; lede?: ReactNode }) {
  return (
    <header className="mb-6">
      <h1 className="ui-display text-[34px] leading-[1.08]">{title}</h1>
      {lede ? <p className="mt-2 text-[15px] leading-relaxed text-muted">{lede}</p> : null}
    </header>
  );
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode; error?: string | null };

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field({ label, hint, error, id, className, ...rest }, ref) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-sm font-medium text-ink">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined}
        className={`ui-input h-11 w-full rounded-[6px] px-4 text-[15px] text-ink placeholder:text-[var(--color-ink-faint)] ${error ? "shadow-[0_0_0_1.5px_var(--color-destructive)]" : ""} ${className ?? ""}`}
        {...rest}
      />
      {hint ? (
        <p id={hintId} className="px-1 text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="px-1 text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
});

export function PasswordField(props: Omit<FieldProps, "type">) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Field {...props} type={shown ? "text" : "password"} className="pr-12" />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        className="absolute right-1.5 top-[calc(1.5rem+6px)] grid h-8 w-8 place-items-center rounded-[6px] text-muted transition-colors hover:bg-accent-soft hover:text-heading"
      >
        {shown ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
      </button>
    </div>
  );
}

export function SubmitButton({ busy, children, disabled }: { busy: boolean; children: ReactNode; disabled?: boolean }) {
  return (
    <button type="submit" disabled={busy || disabled} aria-busy={busy} className="ui-btn ui-btn-primary h-11 w-full text-[15px]">
      {busy ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function Alert({ tone = "error", children }: { tone?: "error" | "success" | "info"; children: ReactNode }) {
  const cls =
    tone === "error"
      ? "bg-danger-soft text-ink shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-destructive)_25%,transparent)]"
      : tone === "success"
        ? "bg-success-soft text-ink shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-success)_25%,transparent)]"
        : "bg-accent-soft text-ink";
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-[6px] px-4 py-3 text-sm leading-relaxed ${cls}`}>
      {children}
    </div>
  );
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="font-medium text-accent underline decoration-[color-mix(in_oklab,var(--color-accent)_35%,transparent)] underline-offset-2 hover:decoration-current">
      {children}
    </a>
  );
}

export { safeReturnTo } from "@/lib/auth/returnTo";
