"use client";

import type { FunctionReturnType } from "convex/server";
import { X } from "lucide-react";
import type { api } from "@/lib/convex/api";
import { formatRelative } from "@/lib/format";
import { changeCounts, whoChanged } from "@/lib/history/changeWords";
import { Avatar } from "@/components/ui/Avatar";

export type Away = NonNullable<FunctionReturnType<typeof api.changes.away>>;

/** The lines others changed, as "Show editors" marks: each in its author's colour, washed, with who and when. */
export function awayMarks(away: Away): Map<string, { color: string; label: string; tint: boolean }> {
  const people = new Map(away.people.map((p) => [p.key, p]));
  const marks = new Map<string, { color: string; label: string; tint: boolean }>();
  for (const [blockId, key, at, kind] of away.lines) {
    const who = people.get(key);
    marks.set(blockId, { color: who?.color ?? "ink-muted", label: `${kind === "added" ? "Added" : "Changed"} by ${who?.name ?? "Someone"} · ${formatRelative(at)}`, tint: true });
  }
  return marks;
}


/**
 * "Since you were away": a slim line at the top of a note others changed since this person was last in it.
 * Show changes marks those lines in the note (in the colour of who changed them); Dismiss puts it away.
 */
export function AwayBanner({ away, showing, onToggle, onDismiss }: { away: Away; showing: boolean; onToggle: () => void; onDismiss: () => void }) {
  const names = away.people.map((p) => p.name);
  const added = away.lines.filter((l) => l[3] === "added").length;
  return (
    <div role="region" aria-label="Since you were last here" className="mx-5 mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-control bg-[color-mix(in_oklab,var(--color-ink)_5%,transparent)] px-3 py-2 text-xs text-muted sm:mx-16">
      <span className="inline-flex items-center -space-x-1" aria-hidden>
        {away.people.slice(0, 3).map((p) => (
          <Avatar key={p.key} name={p.name} url={p.avatarUrl} size={16} ring={`var(--color-${p.color})`} />
        ))}
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-ink">{whoChanged(names)}</span> changed this note since you were last here, {formatRelative(away.since)}.
        {showing ? <span> {changeCounts({ added, edited: away.lines.length - added, removed: away.removed, more: away.more })}.</span> : null}
      </span>
      <button type="button" aria-pressed={showing} onClick={onToggle} className={`rounded-chip px-2 py-0.5 font-medium text-heading outline-none hover:bg-accent-soft focus-visible:ring-2 focus-visible:ring-focus ${showing ? "bg-accent-soft" : ""}`}>
        Show changes
      </button>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" title="Dismiss" className="grid h-6 w-6 place-items-center rounded-chip text-muted outline-none hover:bg-accent-soft hover:text-heading focus-visible:ring-2 focus-visible:ring-focus">
        <X size={13} aria-hidden />
      </button>
    </div>
  );
}
