"use client";

// Home's stats strip (the owner, 28 November 2026): what this Personal or workspace holds, at a glance. Notes (and how
// many are new this week), words (and the reading time they make), images, folders, tasks done (and open), and a
// small bar chart of the notes made on each of the last 7 days. One quiet row of figures under the greeting; each
// figure is read-only. convex/homeStats.ts counts them.
import { useMemo } from "react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useOfflineQuery } from "@/lib/sync/queryCache";

/** Words read a minute, for "≈ 2 h of reading". */
const READ_WPM = 238;

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
/** 980 as is; 12,400 as "12.4K". */
export const statNumber = (n: number) => (n < 10_000 ? n.toLocaleString() : compact.format(n));

/** "≈ 52 min of reading", "≈ 3 h of reading", "under a minute of reading". */
export function readingTime(words: number): string {
  const min = Math.round(words / READ_WPM);
  if (min < 1) return "under a minute of reading";
  if (min < 60) return `≈ ${min} min of reading`;
  const h = Math.round(min / 6) / 10;
  return `≈ ${h % 1 ? h.toFixed(1) : h} h of reading`;
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex min-w-0 flex-col justify-center gap-1 bg-surface px-4 py-3">
      <dt className="text-caption-1 font-medium text-muted">{label}</dt>
      <dd className="font-serif text-title-1 font-medium leading-none tabular-nums tracking-[-0.01em] text-heading">{value}</dd>
      <dd className="truncate text-caption-1 text-faint">{note ?? "\u00a0"}</dd>
    </div>
  );
}

/** The notes made on each of the last 7 days, today last and darker. */
function WeekBars({ week }: { week: number[] }) {
  const max = Math.max(1, ...week);
  const days = useMemo(() => {
    const out: string[] = [];
    for (let back = 6; back >= 0; back--) {
      const d = new Date();
      d.setDate(d.getDate() - back);
      out.push(d.toLocaleDateString(undefined, { weekday: "narrow" }));
    }
    return out;
  }, []);
  const total = week.reduce((a, b) => a + b, 0);
  const said = week.map((n, i) => `${days[i]} ${n}`).join(", ");
  return (
    <div className="flex min-w-0 flex-col justify-center gap-1 bg-surface px-4 py-3">
      <dt className="text-caption-1 font-medium text-muted">This week</dt>
      <dd role="img" aria-label={`New notes on each of the last 7 days: ${said}`} className="flex h-6 items-end gap-1">
        {week.map((n, i) => (
          <span
            key={i}
            className={`flex-1 rounded-tiny ${i === 6 ? "bg-heading" : "bg-[color-mix(in_oklab,var(--color-ink)_22%,transparent)]"}`}
            style={{ height: `${n ? Math.max(16, (n / max) * 100) : 8}%` }}
          />
        ))}
      </dd>
      <dd className="truncate text-caption-1 text-faint">{total ? `${plural(total, "new note", "new notes")}` : "No new notes yet"}</dd>
    </div>
  );
}

export function HomeStats() {
  const { scope } = useAppState();
  // Local midnight, so "today" in the bars is this person's day (fixed for the visit: it's only a chart).
  const todayStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);
  const s = useOfflineQuery(api.homeStats.get, { scope, todayStart });
  return (
    <section aria-label="Your workspace in numbers" className="flex h-72 flex-col overflow-hidden rounded-container border border-[var(--color-line)] bg-[var(--color-line)]">
      {s === undefined ? (
        <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-2 gap-px @[640px]:grid-cols-3" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex flex-col gap-2 bg-surface px-4 py-5">
              <span className="h-3 w-12 animate-pulse rounded-tiny bg-[var(--glass-hover)] motion-reduce:animate-none" />
              <span className="h-6 w-16 animate-pulse rounded-tiny bg-[var(--glass-hover)] motion-reduce:animate-none" />
            </div>
          ))}
        </div>
      ) : (
        <dl className="m-0 grid min-h-0 flex-1 auto-rows-fr grid-cols-2 gap-px @[640px]:grid-cols-3">
          <Stat label="Notes" value={statNumber(s.notes)} note={s.week[6] ? `${s.week[6]} today` : undefined} />
          <Stat label="Words" value={statNumber(s.words)} note={s.words ? readingTime(s.words) : undefined} />
          <Stat label="Images" value={statNumber(s.images)} note={s.notes && s.images ? `in your ${s.notes === 1 ? "note" : "notes"}` : undefined} />
          <Stat label="Folders" value={statNumber(s.folders)} />
          <Stat label="Tasks done" value={statNumber(s.tasksDone)} note={s.tasksOpen ? `${s.tasksOpen.toLocaleString()} still open` : "Nothing open"} />
          <WeekBars week={s.week} />
        </dl>
      )}
      {s?.capped ? <p className="bg-surface px-4 pb-2 text-caption-2 text-faint">Counted up to 5,000 of each.</p> : null}
    </section>
  );
}
