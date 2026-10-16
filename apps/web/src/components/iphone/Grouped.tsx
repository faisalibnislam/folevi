"use client";

import type { ReactNode } from "react";
import { Check, ChevronRight } from "lucide-react";
import { AppLink } from "@/lib/app/router";

/** A section of an inset grouped list (Settings, the account sheet): a small heading, rounded rows, a note under it. */
export function GroupedSection({ title, footer, children, className = "" }: { title?: ReactNode; footer?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`px-4 ${className}`}>
      {title ? <h2 className="px-4 pb-1.5 text-[13px] leading-[18px] text-muted">{title}</h2> : null}
      <div className="ui-grouped">{children}</div>
      {footer ? <p className="px-4 pt-1.5 text-[13px] leading-snug text-muted">{footer}</p> : null}
    </section>
  );
}

/** An icon on a small rounded tile, at the start of a row. */
export function RowIcon({ children, tone }: { children: ReactNode; tone?: string }) {
  return (
    <span
      aria-hidden
      className="grid h-[30px] w-[30px] flex-none place-items-center rounded-small text-heading [&_svg]:h-[17px] [&_svg]:w-[17px]"
      style={{ background: tone ?? "color-mix(in oklab, var(--color-ink) 7%, transparent)" }}
    >
      {children}
    </span>
  );
}

/**
 * A row: an icon, a label (and a quieter second line), something at the end (a count, a value, a switch),
 * then a chevron when it opens another screen. A link with `href`, a button with `onClick`.
 */
export function GroupedRow({
  icon,
  label,
  description,
  detail,
  trailing,
  href,
  onClick,
  chevron,
  checked,
  danger,
  disabled,
  ariaLabel,
}: {
  icon?: ReactNode;
  label: ReactNode;
  description?: ReactNode;
  detail?: ReactNode;
  trailing?: ReactNode;
  href?: string;
  onClick?: () => void;
  chevron?: boolean;
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const body = (
    <>
      {icon}
      <span className="min-w-0 flex-1 py-[11px]">
        <span className={`block truncate text-[17px] leading-[22px] ${danger ? "text-danger" : "text-ink"}`}>{label}</span>
        {description ? <span className="mt-0.5 block truncate text-[13px] leading-[17px] text-muted">{description}</span> : null}
      </span>
      {detail !== undefined && detail !== null ? <span className="flex-none text-[17px] tabular-nums text-muted">{detail}</span> : null}
      {trailing}
      {checked ? <Check size={20} strokeWidth={2.4} aria-hidden className="flex-none text-heading" /> : null}
      {chevron ?? Boolean(href) ? <ChevronRight size={18} strokeWidth={2.2} aria-hidden className="-mr-1 flex-none text-faint" /> : null}
    </>
  );
  const cls = `flex min-h-11 w-full items-center gap-3 px-4 text-left outline-none transition-colors active:bg-[var(--liquid-press)] focus-visible:bg-[var(--liquid-active)] disabled:opacity-40`;
  // The hairline above the row starts past its icon.
  const style = { ["--sep-inset" as string]: icon ? "58px" : "16px" } as React.CSSProperties;
  if (href)
    return (
      <AppLink href={href} onClick={onClick} aria-label={ariaLabel} className={cls} style={style}>
        {body}
      </AppLink>
    );
  if (onClick)
    return (
      <button type="button" onClick={onClick} disabled={disabled} aria-label={ariaLabel} aria-pressed={checked} className={cls} style={style}>
        {body}
      </button>
    );
  return (
    <div className={cls} style={style}>
      {body}
    </div>
  );
}
