// Foli DNA's time-lapse bar (components/views/DnaTimeline.tsx; GraphScreen.swift's DnaTimelineMath does the same):
// where the ticks go for the span shown, how far an arrow key steps, and how many notes exist at a moment.
import type { DnaNode } from "./analysis";

export type TickUnit = "day" | "week" | "month" | "year";
const DAY = 86_400_000;

/** The tick size for a span: months up to about two years, years past that, weeks or days for a short one. */
export function tickUnit(start: number, end: number): TickUnit {
  const days = (end - start) / DAY;
  if (days > 730) return "year";
  if (days > 62) return "month";
  if (days > 14) return "week";
  return "day";
}

/** The first moment of the next unit after `t` (local time; weeks start on Monday). */
export function nextBoundary(t: number, unit: TickUnit): number {
  const d = new Date(t);
  if (unit === "year") return new Date(d.getFullYear() + 1, 0, 1).getTime();
  if (unit === "month") return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  if (unit === "day") return day.getTime();
  const toMonday = (8 - day.getDay()) % 7;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + toMonday).getTime();
}

export interface Tick {
  at: number;
  /** Where on the track, 0 to 1. */
  pos: number;
  /** Starts a new year (months, years) or a new month (weeks, days): drawn taller. */
  major: boolean;
}

/** Ticks strictly inside the span; past `max` of them, the major ones and every n-th stay. */
export function timelineTicks(start: number, end: number, max = 36): { unit: TickUnit; ticks: Tick[] } {
  const unit = tickUnit(start, end);
  if (!(end > start)) return { unit, ticks: [] };
  const all: Tick[] = [];
  for (let t = nextBoundary(start, unit); t < end && all.length < 2000; t = nextBoundary(t, unit)) {
    const d = new Date(t);
    const major = unit === "year" ? true : unit === "month" ? d.getMonth() === 0 : d.getDate() === 1;
    all.push({ at: t, pos: (t - start) / (end - start), major });
  }
  if (all.length <= max) return { unit, ticks: all };
  const every = Math.ceil(all.length / max);
  return { unit, ticks: all.filter((x, i) => (unit !== "year" && x.major) || i % every === 0) };
}

/** One arrow key's step: a tick's unit, or a fiftieth of the span when that is bigger; never past the ends. */
export function timelineStep(start: number, end: number, at: number, dir: 1 | -1): number {
  const unit = tickUnit(start, end);
  const size = { day: DAY, week: 7 * DAY, month: 30.44 * DAY, year: 365.25 * DAY }[unit];
  const step = Math.max(size, (end - start) / 50);
  return Math.min(end, Math.max(start, at + dir * step));
}

/** How many notes existed at `at`, of the notes on the map that have a date. */
export function notesSoFar(nodes: readonly DnaNode[], at: number): { shown: number; total: number } {
  const dated = nodes.filter((n) => n.kind === "note" && n.createdAt);
  return { shown: dated.filter((n) => n.createdAt! <= at).length, total: dated.length };
}

/** How long a whole play takes, from the first note to the last. */
export const PLAY_MS = 8000;
