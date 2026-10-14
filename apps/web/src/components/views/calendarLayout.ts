// Pure helpers for the calendar's week view: where a time sits on the hour grid, which 30-minute slot a
// drop lands in, and how overlapping items share a day's width. Weeks start on Monday, like the month grid.
import { addDays } from "@folevi/editor-schema";

/** Height of one hour on the grid, in pixels. */
export const HOUR_PX = 44;
/** Drops snap to this many minutes. */
export const SLOT_MINUTES = 30;
/** A task with a time shows as a block this long. */
export const TASK_MINUTES = 30;
/** The hour the grid scrolls to when it opens (the rest is a scroll away). */
export const FIRST_VISIBLE_HOUR = 6;

/** Day of the week with Monday = 0. */
export function weekdayIndex(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** The Monday on or before `date`. */
export function startOfWeek(date: string): string {
  return addDays(date, -weekdayIndex(date));
}

/** The days a week view shows: seven from Monday, or `count` from `anchor` on narrow screens. */
export function visibleDays(anchor: string, count: 7 | 3): string[] {
  const first = count === 7 ? startOfWeek(anchor) : anchor;
  return Array.from({ length: count }, (_, i) => addDays(first, i));
}

/** "HH:MM" as minutes after midnight, or null when it isn't a time. */
export function timeToMinutes(time: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Minutes after midnight as "HH:MM" (kept within the day). */
export function minutesToTime(minutes: number): string {
  const clamped = Math.min(Math.max(0, Math.round(minutes)), 24 * 60 - 1);
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

/** Distance from the top of the grid (midnight) for a time, in pixels. */
export function minutesToPx(minutes: number, hourPx = HOUR_PX): number {
  return (minutes / 60) * hourPx;
}

/** The slot a point lands in, `offsetPx` from midnight: snapped down to 30 minutes, never past 23:30. */
export function slotAt(offsetPx: number, hourPx = HOUR_PX): number {
  const minutes = (offsetPx / hourPx) * 60;
  const snapped = Math.floor(minutes / SLOT_MINUTES) * SLOT_MINUTES;
  return Math.min(Math.max(0, snapped), 24 * 60 - SLOT_MINUTES);
}

export interface Span {
  id: string;
  /** Minutes after midnight. */
  start: number;
  /** Minutes after midnight (after `start`). */
  end: number;
}

export interface Placed extends Span {
  /** Column within its overlap group, from 0. */
  col: number;
  /** Columns in its overlap group: the item takes 1/cols of the day's width. */
  cols: number;
}

/**
 * Side by side for items that overlap: each group of items that overlap one another (directly or through
 * a chain) is split into as many columns as it needs at its busiest, and each item takes the first column
 * free at its start. Items that only touch (one ends as the next starts) don't overlap.
 */
export function layoutOverlaps(items: Span[]): Placed[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end || (a.id < b.id ? -1 : 1));
  const out: Placed[] = [];
  let group: Placed[] = [];
  let columnsEnd: number[] = [];
  let groupEnd = -1;
  const close = () => {
    for (const p of group) p.cols = columnsEnd.length;
    out.push(...group);
    group = [];
    columnsEnd = [];
  };
  for (const item of sorted) {
    const end = Math.max(item.end, item.start + 1);
    if (group.length && item.start >= groupEnd) close();
    let col = columnsEnd.findIndex((e) => e <= item.start);
    if (col === -1) {
      col = columnsEnd.length;
      columnsEnd.push(end);
    } else columnsEnd[col] = end;
    group.push({ ...item, col, cols: 1 });
    groupEnd = group.length === 1 ? end : Math.max(groupEnd, end);
  }
  if (group.length) close();
  return out;
}

/** The 42 days (six weeks from Monday) a month grid shows for `month` (YYYY-MM). */
export function monthGrid(month: string): string[] {
  const first = startOfWeek(`${month}-01`);
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

/** The month `delta` months from `month` (YYYY-MM). */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

const partsFormat = new Map<string, Intl.DateTimeFormat>();

/** An instant's wall-clock day (YYYY-MM-DD) and minutes after midnight in a time zone. */
export function zonedParts(ms: number, timeZone: string): { date: string; minutes: number } {
  let fmt = partsFormat.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    partsFormat.set(timeZone, fmt);
  }
  const parts = fmt.formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")) };
}

export interface EventTime {
  /** UTC ms (all-day: UTC midnight of the first day). */
  start: number;
  /** UTC ms (all-day: UTC midnight after the last day). */
  end: number;
  allDay: boolean;
}

export interface Segment {
  date: string;
  /** Shown in the all-day row (all-day events, and timed ones a day long or more). */
  allDay: boolean;
  /** Minutes after midnight on `date` (0 and 1440 for all-day segments). */
  start: number;
  end: number;
  /** The event's first day (where its start time is shown). */
  first: boolean;
}

/**
 * The days an event shows on, in a time zone: all-day events on each of their days, timed ones split at
 * midnight. Timed events of a day or longer go in the all-day row. At most 62 days.
 */
export function eventSegments(e: EventTime, timeZone: string): Segment[] {
  const out: Segment[] = [];
  const allDayRun = (from: string, to: string) => {
    for (let d = from, i = 0; d <= to && i < 62; d = addDays(d, 1), i++) out.push({ date: d, allDay: true, start: 0, end: 24 * 60, first: i === 0 });
    return out;
  };
  if (e.allDay) {
    const from = new Date(e.start).toISOString().slice(0, 10);
    const last = new Date(Math.max(e.start, e.end - 86_400_000)).toISOString().slice(0, 10);
    return allDayRun(from, last);
  }
  const s = zonedParts(e.start, timeZone);
  if (e.end - e.start >= 86_400_000) return allDayRun(s.date, zonedParts(e.end - 1, timeZone).date);
  const end = Math.max(e.end, e.start);
  const t = zonedParts(end, timeZone);
  if (t.date === s.date || (t.minutes === 0 && addDays(s.date, 1) === t.date)) {
    return [{ date: s.date, allDay: false, start: s.minutes, end: t.date === s.date ? t.minutes : 24 * 60, first: true }];
  }
  out.push({ date: s.date, allDay: false, start: s.minutes, end: 24 * 60, first: true });
  if (t.minutes > 0) out.push({ date: t.date, allDay: false, start: 0, end: t.minutes, first: false });
  return out;
}
