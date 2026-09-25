import type { ReactNode } from "react";
import { Icon } from "./icons";
import { cx } from "./ui";

/*
 * Miniature renderings of the product's real block types (paragraph, heading, bulleted, todo with
 * due date and priority, callout, page card) and chrome (sync status). Presentational only — safe
 * to use from server and client components.
 */

export type SyncStatus = "Saved" | "Saving" | "Offline" | "Syncing" | "Conflict" | "Error";

const statusTone: Record<SyncStatus, string> = {
  Saved: "text-success",
  Saving: "text-muted",
  Offline: "text-warning",
  Syncing: "text-accent",
  Conflict: "text-warning",
  Error: "text-danger",
};

export function StatusPill({ status, detail }: { status: SyncStatus; detail?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-muted">
      <span aria-hidden="true" className={cx("inline-block size-1.5 rounded-full bg-current", statusTone[status])} />
      <span>
        {status === "Saving" || status === "Syncing" ? `${status}…` : status}
        {detail ? <span className="text-faint"> · {detail}</span> : null}
      </span>
    </span>
  );
}

export function MiniCheck({ checked, className }: { checked: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-flex size-[15px] shrink-0 items-center justify-center rounded-[4px] border",
        checked ? "border-accent bg-accent text-accent-ink" : "border-line-strong bg-raised",
        className,
      )}
    >
      {checked ? <Icon name="check" size={11} strokeWidth={2.2} /> : null}
    </span>
  );
}

export type ChipTone = "neutral" | "accent" | "coral" | "moss" | "marigold";

const chipTone: Record<ChipTone, string> = {
  neutral: "bg-sunken text-muted",
  accent: "bg-accent-soft text-accent-soft-ink",
  coral: "bg-coral-soft text-coral-ink",
  moss: "bg-moss-soft text-moss-ink",
  marigold: "bg-marigold-soft text-marigold-ink",
};

export function DateChip({ children, tone = "neutral" }: { children: ReactNode; tone?: ChipTone }) {
  return (
    <span className={cx("inline-flex h-[19px] shrink-0 items-center gap-1 rounded-[5px] px-1.5 text-[11px] font-medium", chipTone[tone])}>
      <Icon name="calendar" size={11} />
      {children}
    </span>
  );
}

export function MiniTodo({
  text,
  checked = false,
  date,
  tone,
  high,
}: {
  text: string;
  checked?: boolean;
  date?: string;
  tone?: ChipTone;
  high?: boolean;
}) {
  return (
    <div className="flex min-h-[26px] items-center gap-2.5">
      <MiniCheck checked={checked} />
      <span className={cx("min-w-0 flex-1 truncate text-[13px]", checked ? "text-faint line-through decoration-line-strong" : "text-ink")}>{text}</span>
      {high ? (
        <span className="inline-flex items-center text-coral-ink" title="High priority">
          <Icon name="flag" size={12} />
          <span className="sr-only">High priority</span>
        </span>
      ) : null}
      {date ? <DateChip tone={tone ?? "neutral"}>{date}</DateChip> : null}
    </div>
  );
}

export function MiniCallout({ icon, children, tone = "accent" }: { icon: string; children: ReactNode; tone?: "accent" | "moss" | "marigold" }) {
  const toneClass = tone === "moss" ? "bg-moss-soft text-moss-ink" : tone === "marigold" ? "bg-marigold-soft text-marigold-ink" : "bg-accent-soft text-accent-soft-ink";
  return (
    <div className={cx("flex items-start gap-2 rounded-[8px] px-3 py-2 text-[12.5px] leading-snug", toneClass)}>
      <span aria-hidden="true">{icon}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function MiniPageCard({ icon, title, meta, accent = "moss" }: { icon: string; title: string; meta: string; accent?: "moss" | "plum" | "marigold" | "accent" }) {
  const bar = accent === "plum" ? "bg-plum" : accent === "marigold" ? "bg-marigold" : accent === "accent" ? "bg-accent" : "bg-moss";
  return (
    <div className="relative flex items-center gap-3 overflow-hidden rounded-[9px] border mk-hair bg-surface px-3 py-2.5">
      <span aria-hidden="true" className={cx("absolute inset-y-0 left-0 w-[3px]", bar)} />
      <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-[7px] bg-sunken text-[15px]">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">{title}</span>
        <span className="block truncate text-[11.5px] text-muted">{meta}</span>
      </span>
      <Icon name="chevron-right" size={14} className="text-faint" />
    </div>
  );
}

export function MiniBullet({ children, depth = 0 }: { children: ReactNode; depth?: number }) {
  return (
    <div className="flex items-start gap-2.5 text-[13px] leading-[1.55] text-ink" style={{ paddingLeft: depth * 18 }}>
      <span aria-hidden="true" className="mt-[8px] inline-block size-[5px] shrink-0 rounded-full bg-current opacity-70" />
      <span className="min-w-0">{children}</span>
    </div>
  );
}
