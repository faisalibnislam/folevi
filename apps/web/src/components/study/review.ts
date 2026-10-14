// The review queue on the web (convex/study.ts): the person's day, the interval on each rating button and
// what each key does. The schedule itself (FSRS) is worked out on the server.
import { useEffect, useMemo, useState } from "react";

export type Rating = "again" | "hard" | "good" | "easy";

/** The four answers, in order, with the key that gives each (1 to 4). */
export const RATINGS: readonly { id: Rating; label: string; key: string }[] = [
  { id: "again", label: "Again", key: "1" },
  { id: "hard", label: "Hard", key: "2" },
  { id: "good", label: "Good", key: "3" },
  { id: "easy", label: "Easy", key: "4" },
];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How long until a card comes back, short, for a button: "1m", "10m", "3h", "4d", "2mo", "1.5y". */
export function intervalLabel(ms: number): string {
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MINUTE))}m`;
  if (ms < DAY) return `${Math.round(ms / HOUR)}h`;
  const days = Math.round(ms / DAY);
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${Math.round((days / 365) * 10) / 10}y`;
}

/** The same in words, for screen readers: "10 minutes", "4 days". */
export function intervalWords(ms: number): string {
  const label = intervalLabel(ms);
  const n = Number.parseFloat(label);
  const unit = label.slice(String(n).length);
  const word = { m: "minute", h: "hour", d: "day", mo: "month", y: "year" }[unit] ?? unit;
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export type ReviewKeyAction = { kind: "reveal" } | { kind: "rate"; rating: Rating } | null;

/**
 * What a key does while reviewing: Space or Enter shows the answer; once it shows, 1 to 4 rate the card
 * (Again, Hard, Good, Easy). Anything with a modifier is left alone.
 */
export function reviewKey(e: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean }, revealed: boolean): ReviewKeyAction {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  if (!revealed) return e.key === " " || e.key === "Enter" ? { kind: "reveal" } : null;
  const rating = RATINGS.find((r) => r.key === e.key);
  return rating ? { kind: "rate", rating: rating.id } : null;
}

/** The person's day by this device's clock: now (rounded down to `step`), and local midnight to midnight. */
export function reviewWindow(at: number, step = MINUTE): { now: number; dayStart: number; dayEnd: number } {
  const start = new Date(at);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { now: at - (at % step), dayStart: start.getTime(), dayEnd: end.getTime() };
}

/**
 * reviewWindow, moving on every `step` so cards that fall due while the page is open turn up (a query
 * argument that changes re-runs the queue).
 */
export function useReviewWindow(step = MINUTE) {
  const [at, setAt] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setAt(Date.now()), Math.min(step, 30_000));
    return () => window.clearInterval(id);
  }, [step]);
  const { now, dayStart, dayEnd } = reviewWindow(at, step);
  // The same object between ticks within one step.
  return useMemo(() => ({ now, dayStart, dayEnd }), [now, dayStart, dayEnd]);
}

/** "12 cards", "1 card". */
export const cardCount = (n: number) => `${n} card${n === 1 ? "" : "s"}`;
