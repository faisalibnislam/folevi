import type { ReactNode } from "react";
import { Icon } from "./icons";
import { cx } from "./ui";

/*
 * Small pieces of the app's chrome and blocks for the demos: the sync status and a task's date chip.
 * Presentational only, so safe to use from server and client components.
 */

export type SyncStatus = "Saved" | "Saving" | "Offline" | "Syncing" | "Conflict" | "Error";

const statusTone: Record<SyncStatus, string> = {
  Saved: "bg-moss",
  Saving: "bg-(--color-ink-faint)",
  Offline: "bg-(--color-ink-faint)",
  Syncing: "bg-(--color-ink-faint)",
  Conflict: "bg-coral",
  Error: "bg-coral",
};

export function StatusPill({ status, detail }: { status: SyncStatus; detail?: string }) {
  return (
    <span className="mk-mini-sunken inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-chip px-2 text-[11.5px] font-medium text-muted">
      <span aria-hidden="true" className={cx("inline-block size-1.5 rounded-tiny", statusTone[status])} />
      <span>
        {status === "Saving" || status === "Syncing" ? `${status}…` : status}
        {detail ? <span className="text-faint"> · {detail}</span> : null}
      </span>
    </span>
  );
}

export type ChipTone = "neutral" | "accent" | "coral" | "moss" | "marigold" | "ember";

const chipTone: Record<ChipTone, string> = {
  neutral: "bg-sunken text-muted",
  ember: "bg-(--color-ember-soft) text-(--color-ember-ink)",
  accent: "bg-sunken text-(--color-heading)",
  coral: "bg-coral-soft text-coral-ink",
  moss: "bg-moss-soft text-moss-ink",
  marigold: "bg-marigold-soft text-marigold-ink",
};

export function DateChip({ children, tone = "neutral" }: { children: ReactNode; tone?: ChipTone }) {
  return (
    <span className={cx("inline-flex h-[20px] shrink-0 items-center gap-1 rounded-tiny px-1.5 text-[11px] font-medium", chipTone[tone])}>
      <Icon name="calendar" size={11} />
      {children}
    </span>
  );
}
