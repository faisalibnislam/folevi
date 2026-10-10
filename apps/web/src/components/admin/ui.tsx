"use client";

import { useEffect, useId, type ReactNode } from "react";
import { useAdminTitle } from "./title";
import { AlertTriangle, ChevronLeft, ChevronRight, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Switch as AppSwitch } from "@/components/ui/Switch";
import { errorMessage } from "@/components/ui/Toast";
import { formatDateTime, formatRelative } from "@/lib/format";

// ---------------------------------------------------------------- badges

/**
 * Pills in the app's neutral chrome (the same recipe as Settings → Plan & billing): a quiet grey fill by
 * default, solid ink for emphasis, and colour only where it means something (success, warning, danger).
 */
export type Tone = "neutral" | "success" | "danger" | "warning" | "strong" | "outline";

const TONES: Record<Tone, string> = {
  neutral: "bg-[var(--glass-hover)] text-muted",
  success: "bg-success-soft text-success",
  danger: "bg-danger-soft text-danger",
  warning: "bg-warning-soft text-warning",
  strong: "bg-heading text-canvas",
  outline: "text-heading shadow-[inset_0_0_0_1px_var(--color-line-strong)]",
};

export function Badge({ tone = "neutral", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-[6px] px-2 py-px text-[11.5px] font-semibold leading-[18px] ${TONES[tone]} ${className ?? ""}`}>
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  active: "success",
  accepted: "success",
  completed: "success",
  suspended: "danger",
  failed: "danger",
  pending_deletion: "warning",
  deleting: "warning",
  scheduled: "warning",
  past_due: "warning",
  cancel_scheduled: "warning",
  paid: "success",
  running: "outline",
  queued: "outline",
  pending: "outline",
  skipped: "neutral",
  deleted: "neutral",
  canceled: "neutral",
  revoked: "neutral",
  expired: "neutral",
};

export function humanize(value: string): string {
  const s = value.replace(/[_:.-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{humanize(status)}</Badge>;
}

// ---------------------------------------------------------------- page structure

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="mb-6">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          {eyebrow ? <div className="mb-2 flex flex-wrap items-center gap-1.5">{eyebrow}</div> : null}
          <h1 className="break-words ui-display text-[32px] leading-tight">{title}</h1>
          {description ? <div className="mt-1 max-w-3xl text-sm text-muted">{description}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

/** The browser tab's title, and the name of the open record in the console's tab strip. */
export function DocTitle({ children }: { children: string }) {
  const setTitle = useAdminTitle();
  useEffect(() => {
    setTitle(children);
    return () => setTitle(null);
  }, [children, setTitle]);
  return <title>{`${children} · Folevi Admin`}</title>;
}

export function Panel({ title, description, actions, children, className, flush }: { title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={`min-w-0 overflow-hidden ui-card ${className ?? ""}`}>
      <div className="flex flex-wrap items-start gap-3 px-5 pb-3 pt-4">
        <div className="min-w-0 flex-1">
          <h2 id={id} className="ui-display text-[17px] leading-snug">
            {title}
          </h2>
          {description ? <div className="mt-0.5 text-[12.5px] text-muted">{description}</div> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      <div className={flush ? "border-t border-line" : "px-5 pb-5"}>{children}</div>
    </section>
  );
}

export function Callout({ tone = "neutral", title, children, icon }: { tone?: "neutral" | "warning" | "danger"; title?: string; children: ReactNode; icon?: ReactNode }) {
  const cls = tone === "warning" ? "bg-warning-soft" : tone === "danger" ? "bg-danger-soft" : "bg-[var(--glass-hover)]";
  return (
    <div className={`flex gap-3 rounded-[10px] px-4 py-3 text-[13px] leading-relaxed text-ink ${cls}`}>
      {icon ?? (tone === "warning" || tone === "danger" ? <AlertTriangle size={16} aria-hidden className={`mt-0.5 flex-none ${tone === "danger" ? "text-danger" : "text-warning"}`} /> : null)}
      <div className="min-w-0">
        {title ? <p className="font-semibold text-heading">{title}</p> : null}
        <div className={title ? "mt-0.5" : ""}>{children}</div>
      </div>
    </div>
  );
}

/** A table or list in its own card (the page's main list: users, workspaces, emails…). */
export const tableCard = "overflow-hidden ui-card";

// ---------------------------------------------------------------- tables

export const th = "whitespace-nowrap border-b border-line bg-surface px-3 py-2 text-left text-[12px] font-semibold text-muted first:pl-5 last:pr-5";
export const td = "border-b border-line px-3 py-2.5 align-top first:pl-5 last:pr-5";
export const tdNum = `${td} text-right tabular-nums`;
export const tdMid = "border-b border-line px-3 py-2.5 align-middle first:pl-5 last:pr-5";
/** A table row that highlights under the pointer, like the app's lists. */
export const trHover = "transition-colors hover:bg-[var(--glass-hover)]";
/** A link to a record inside a table (a person, a workspace). */
export const recordLink = "font-semibold text-heading underline decoration-line-strong underline-offset-2 hover:decoration-heading";
export const thNum = `${th} text-right`;

export function DataTable({ caption, captionVisible, children, minWidth = 640 }: { caption: string; captionVisible?: boolean; children: ReactNode; minWidth?: number }) {
  return (
    // `relative` keeps visually hidden text in the rows (absolutely positioned) inside the scrolling region.
    <div className="relative overflow-x-auto focus-visible:outline-offset-[-2px]" tabIndex={0} role="region" aria-label={caption}>
      <table className="w-full border-collapse text-[13px] [&_tbody_tr:last-child>*]:border-b-0" style={{ minWidth }}>
        <caption className={captionVisible ? "px-3 pb-2 pt-3 text-left text-[13px] font-semibold" : "sr-only"}>{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-5 py-8 text-center text-[13px] text-muted">
        {children}
      </td>
    </tr>
  );
}

export function LoadingRows({ colSpan, rows = 4 }: { colSpan: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <tr key={i} aria-hidden>
          <td colSpan={colSpan} className="border-b border-line px-5 py-3">
            <div className="h-3 animate-pulse rounded bg-sunken" style={{ width: `${60 + ((i * 17) % 35)}%` }} />
          </td>
        </tr>
      ))}
      <tr className="sr-only">
        <td colSpan={colSpan}>Loading…</td>
      </tr>
    </>
  );
}

export function Pager({ page, hasPrev, hasNext, onPrev, onNext, busy }: { page: number; hasPrev: boolean; hasNext: boolean; onPrev: () => void; onNext: () => void; busy?: boolean }) {
  return (
    <nav aria-label="Pagination" className="flex items-center justify-end gap-2 px-5 py-2.5 text-[13px] text-muted">
      <span aria-live="polite">Page {page}</span>
      <Button size="sm" onClick={onPrev} disabled={!hasPrev || busy}>
        <ChevronLeft size={14} aria-hidden /> Previous
      </Button>
      <Button size="sm" onClick={onNext} disabled={!hasNext || busy}>
        Next <ChevronRight size={14} aria-hidden />
      </Button>
    </nav>
  );
}

// ---------------------------------------------------------------- small values

export function Mono({ children, title, wrap }: { children: ReactNode; title?: string; wrap?: boolean }) {
  return (
    <code title={title} className={`rounded-[4px] bg-[var(--glass-hover)] px-1 py-px font-mono text-[12px] text-ink ${wrap ? "break-all" : "whitespace-nowrap"}`}>
      {children}
    </code>
  );
}

/** Long opaque identifiers: shows the start and end, full value on hover and to screen readers. */
export function ShortId({ value, head = 6, tail = 6 }: { value: string; head?: number; tail?: number }) {
  if (value.length <= head + tail + 1) return <Mono>{value}</Mono>;
  return (
    <code title={value} className="whitespace-nowrap rounded-[4px] bg-[var(--glass-hover)] px-1 py-px font-mono text-[12px] text-ink">
      <span aria-hidden>
        {value.slice(0, head)}…{value.slice(-tail)}
      </span>
      <span className="sr-only">{value}</span>
    </code>
  );
}

export function Time({ ts }: { ts: number | null | undefined }) {
  if (!ts) return <span className="text-muted">-</span>;
  return (
    <time dateTime={new Date(ts).toISOString()} title={formatDateTime(ts)} className="whitespace-nowrap">
      {formatRelative(ts)}
    </time>
  );
}

export function KeyValues({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-[minmax(120px,max-content)_1fr] gap-x-4 gap-y-2 text-[13px]">
      {items.map((it) => (
        <div key={it.label} className="contents">
          <dt className="text-muted">{it.label}</dt>
          <dd className="min-w-0 break-words">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[10px] bg-danger-soft px-4 py-3 text-[13px]">
      <AlertTriangle size={16} aria-hidden className="flex-none text-danger" />
      <span className="flex-1">{errorMessage(error)}</span>
      {onRetry ? (
        <Button size="sm" onClick={onRetry}>
          <RotateCw size={13} aria-hidden /> Retry
        </Button>
      ) : null}
    </div>
  );
}

export function StatTile({ label, value, hint, footnote }: { label: string; value: ReactNode; hint?: ReactNode; footnote?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col ui-card px-4 py-3.5">
      <dt className="text-[12.5px] font-medium text-muted">{label}</dt>
      <dd className="mt-1.5 ui-display text-[28px] leading-none tabular-nums">{value}</dd>
      {hint ? <dd className="mt-1.5 text-[12px] text-muted">{hint}</dd> : null}
      {footnote ? <dd className="mt-1.5 text-[12px] text-muted">{footnote}</dd> : null}
    </div>
  );
}

// ---------------------------------------------------------------- form controls

export const inputCls = "ui-input h-9 w-full rounded-[6px] px-3 text-[13.5px] text-ink placeholder:text-faint aria-[invalid=true]:shadow-[0_0_0_1.5px_var(--color-destructive)]";
export const selectCls = `${inputCls} pr-2.5`;

/** The app's on/off switch (dark when on). */
export const Switch = AppSwitch;

export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const tone = pct >= 90 ? "bg-danger" : pct >= 75 ? "bg-warning" : "bg-heading";
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-valuetext={`${pct.toFixed(0)}%`} className="h-2 w-full overflow-hidden rounded-[4px] bg-[color-mix(in_oklab,var(--color-ink)_12%,transparent)]">
      <div className={`h-full rounded-[6px] ${tone}`} style={{ width: `${Math.max(pct, value > 0 ? 1.5 : 0)}%` }} />
    </div>
  );
}
