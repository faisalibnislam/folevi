import * as chrono from "chrono-node";
import { dueLabel } from "./format";

/*
 * Dates written in plain words, for Quick Add and the @ menu: "call Sam tomorrow 3pm", "report by Friday",
 * "dentist on 12 Nov at 9:30". Only phrases that name a day or a time count: a bare month ("Ask May…")
 * or "now" never does. English only, like the rest of the app. Dates come out in the person's own
 * calendar (YYYY-MM-DD) and times as HH:MM, the to-do block's dueDate and dueTime.
 */

export interface ParsedDate {
  /** YYYY-MM-DD in the person's calendar. */
  date: string;
  /** HH:MM, when a time was written. */
  time?: string;
  /** The words that said it, as written, and where they are. */
  text: string;
  index: number;
  /** The rest of the sentence without them ("call Sam"). */
  rest: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Words that only lead into a date ("by Friday", "at 3pm", "due tomorrow"), dropped with it. */
const LEAD = /\s*\b(?:on|at|by|due|for|before|until|from)\s*$/i;
const NOT_A_DATE = new Set(["now", "today's", "second", "a second", "sec", "min"]);

/**
 * The first day or time named in `text`, or null. `now` is when it's read: "Friday" is the next one
 * from now (never one in the past), "3pm" is today unless that has gone, then tomorrow.
 */
export function parseNaturalDate(text: string, now: Date = new Date()): ParsedDate | null {
  if (!text.trim()) return null;
  const results = chrono.casual.parse(text, now, { forwardDate: true });
  for (const r of results) {
    const said = r.text.trim();
    if (NOT_A_DATE.has(said.toLowerCase())) continue;
    const s = r.start;
    const day = s.isCertain("day") || s.isCertain("weekday");
    const hour = s.isCertain("hour");
    if (!day && !hour) continue;
    // A lone number ("buy 3 apples") or a lone time-ish word inside another word isn't a date.
    if (/^\d+$/.test(said)) continue;
    let at = s.date();
    // Only a time: today, or tomorrow once it has passed.
    if (!day && hour && at.getTime() < now.getTime()) at = new Date(at.getTime() + 86_400_000);
    const before = text.slice(0, r.index).replace(LEAD, "");
    const after = text.slice(r.index + r.text.length);
    const rest = `${before} ${after}`.replace(/\s{2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim().replace(/[,;:]$/, "").trim();
    return {
      date: ymd(at),
      time: hour ? `${pad(at.getHours())}:${pad(at.getMinutes())}` : undefined,
      text: r.text,
      index: r.index,
      rest,
    };
  }
  return null;
}

/** "Tomorrow, 15:00", "Friday", "12 Nov": how a parsed date reads in a chip. */
export function naturalDateLabel(p: Pick<ParsedDate, "date" | "time">, today: string): string {
  const day = dueLabel(p.date, today);
  return p.time ? `${day}, ${p.time}` : day;
}
