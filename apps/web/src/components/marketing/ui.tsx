import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

export const container = "mx-auto w-full max-w-[1200px] px-5 sm:px-8";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function ButtonLink({
  href,
  children,
  variant = "primary",
  size = "md",
  icon,
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary";
  size?: "sm" | "md";
  icon?: IconName;
  className?: string;
}) {
  const classes = cx(
    "mk-btn",
    variant === "primary" ? "mk-btn-primary" : "mk-btn-secondary",
    size === "sm" ? "h-9 px-3.5 text-[14px]" : "h-11 px-5 text-[15px]",
    className,
  );
  const content = (
    <>
      {children}
      {icon ? <Icon name={icon} size={16} /> : null}
    </>
  );
  if (/^https?:/.test(href) || href.startsWith("mailto:")) {
    return (
      <a href={href} className={classes}>
        {content}
      </a>
    );
  }
  return (
    <Link href={href} className={classes}>
      {content}
    </Link>
  );
}

/** A tiny printer's registration mark: a crosshair inside a circle. */
export function RegMark({ className, size = 13 }: { className?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true" focusable="false" className={cx("mk-reg", className)}>
      <circle cx="7" cy="7" r="3.2" fill="none" stroke="currentColor" strokeWidth="0.9" />
      <path d="M7 0v14M0 7h14" stroke="currentColor" strokeWidth="0.9" />
    </svg>
  );
}

/** Four corner registration marks for a positioned container. */
export function CornerMarks({ inset = "-7px" }: { inset?: string }) {
  const s = { position: "absolute" as const };
  return (
    <>
      <span aria-hidden="true" className="pointer-events-none" style={{ ...s, top: inset, left: inset }}>
        <RegMark />
      </span>
      <span aria-hidden="true" className="pointer-events-none" style={{ ...s, top: inset, right: inset }}>
        <RegMark />
      </span>
      <span aria-hidden="true" className="pointer-events-none" style={{ ...s, bottom: inset, left: inset }}>
        <RegMark />
      </span>
      <span aria-hidden="true" className="pointer-events-none" style={{ ...s, bottom: inset, right: inset }}>
        <RegMark />
      </span>
    </>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cx("flex items-center gap-2.5 text-[12px] font-medium uppercase tracking-[0.14em] text-muted", className)}>
      <span aria-hidden="true" className="inline-block h-px w-6 bg-current opacity-60" />
      {children}
    </p>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="mk-kbd">{children}</kbd>;
}

export function PageHeader({
  eyebrow,
  title,
  lede,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="relative border-b mk-hair">
      <div aria-hidden="true" className="mk-rules pointer-events-none absolute inset-0" />
      <div className={cx(container, "relative pb-14 pt-16 sm:pb-20 sm:pt-24")}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="mt-5 max-w-[18ch] font-display text-[44px] leading-[1.02] tracking-[-0.015em] sm:text-[64px]">{title}</h1>
        {lede ? <div className="mt-6 max-w-[60ch] text-[18px] leading-relaxed text-muted">{lede}</div> : null}
        {children}
      </div>
    </header>
  );
}

export function DraftNotice({ updated }: { updated: string }) {
  return (
    <div role="note" className="mt-8 inline-flex max-w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-control border border-warning/40 bg-warning-soft px-3.5 py-2.5 text-[14px] text-ink">
      <strong className="font-semibold text-warning">Draft — pending legal review</strong>
      <span className="text-muted">Last updated {updated}. This plain-language draft is not yet final.</span>
    </div>
  );
}
