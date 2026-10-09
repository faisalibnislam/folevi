// AI digests (convex/aiDigest.ts has the schedule and the job): when the next one is due in the person's
// time zone, what it reads, and the request it makes. Pure, so the timing is tested without a clock.
import type { PlannedCall } from "../credits";
import type { GenerateRequest } from "./provider";
import { untrusted, UNTRUSTED_RULE } from "./tools/untrusted";

export type DigestFrequency = "daily" | "weekly";

export interface DigestSchedule {
  frequency: DigestFrequency;
  /** Hour of the day, 0 to 23, in the person's time zone. */
  hour: number;
  /** Weekly: day of the week, 0 Sunday to 6 Saturday. */
  weekday: number;
}

export const DEFAULT_SCHEDULE: DigestSchedule = { frequency: "daily", hour: 8, weekday: 1 };

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

/** The period a digest covers. */
export const periodMs = (f: DigestFrequency) => (f === "weekly" ? 7 * DAY_MS : DAY_MS);

/** A valid hour and weekday (anything else falls back to the default). */
export function cleanSchedule(s: Partial<DigestSchedule>, base: DigestSchedule = DEFAULT_SCHEDULE): DigestSchedule {
  const hour = Number.isInteger(s.hour) && s.hour! >= 0 && s.hour! <= 23 ? s.hour! : base.hour;
  const weekday = Number.isInteger(s.weekday) && s.weekday! >= 0 && s.weekday! <= 6 ? s.weekday! : base.weekday;
  return { frequency: s.frequency === "weekly" || s.frequency === "daily" ? s.frequency : base.frequency, hour, weekday };
}

/** A time zone we can use (UTC when it isn't one). */
export function safeZone(timeZone: string | undefined): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timeZone || "UTC" });
    return timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** The wall clock in `timeZone` at `at`. */
export function localParts(at: number, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: safeZone(timeZone), hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" }).formatToParts(new Date(at));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")), hour: Number(get("hour")) % 24, minute: Number(get("minute")), weekday };
}

/** How far `timeZone` is ahead of UTC at `at` (ms; negative west of Greenwich). */
export function zoneOffset(at: number, timeZone: string): number {
  const p = localParts(at, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(at / 60_000) * 60_000;
}

/** The instant a wall-clock time in `timeZone` happens (a time skipped by a clock change moves an hour on). */
export function zonedInstant(year: number, month: number, day: number, hour: number, timeZone: string): number {
  const guess = Date.UTC(year, month - 1, day, hour);
  let at = guess - zoneOffset(guess, timeZone);
  // Near a clock change the offset at the answer can differ from the guess's: settle it once more.
  at = guess - zoneOffset(at, timeZone);
  return at;
}

/** The person's date (YYYY-MM-DD) at `at`, `addDays` later. */
export function localDay(at: number, timeZone: string, addDays = 0): string {
  const p = localParts(at, timeZone);
  return new Date(Date.UTC(p.year, p.month - 1, p.day + addDays)).toISOString().slice(0, 10);
}

/**
 * When a digest is next due after `now`: the next time the person's clock shows `hour`:00 (on `weekday`
 * for a weekly one), in their time zone, clock changes included.
 */
export function nextDigestAt(now: number, schedule: DigestSchedule, timeZone: string): number {
  const zone = safeZone(timeZone);
  const today = localParts(now, zone);
  for (let add = 0; add <= 8; add++) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + add));
    if (schedule.frequency === "weekly" && date.getUTCDay() !== schedule.weekday) continue;
    const at = zonedInstant(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), schedule.hour, zone);
    if (at > now) return at;
  }
  // Unreachable for a real schedule; a day on keeps the job from spinning.
  return now + DAY_MS;
}

/** The digest note's title: "Daily digest, 10 Oct" or "Weekly digest, 4 to 10 Oct". */
export function digestTitle(frequency: DigestFrequency, since: number, until: number, timeZone: string, locale = "en-GB"): string {
  const fmt = (t: number) => {
    try {
      return new Date(t).toLocaleDateString(locale || "en-GB", { day: "numeric", month: "short", timeZone: safeZone(timeZone) });
    } catch {
      return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
    }
  };
  return frequency === "weekly" ? `Weekly digest, ${fmt(since + HOUR_MS)} to ${fmt(until - 1)}` : `Daily digest, ${fmt(until - 1)}`;
}

// ---------------------------------------------------------------------------------------------------
// What a digest reads, and the request
// ---------------------------------------------------------------------------------------------------

/** Most of each kind a digest reads (it stays small and cheap whatever happened). */
export const DIGEST_LIMITS = { notes: 12, noteChars: 900, newTasks: 15, dueTasks: 15, comments: 12, commentChars: 240 } as const;

export interface DigestMaterial {
  today: string;
  notes: { id: string; title: string; text: string; isNew: boolean }[];
  newTasks: { title: string; due: string | null; note: string }[];
  dueTasks: { title: string; due: string; note: string; overdue: boolean }[];
  comments: { note: string; author: string; text: string }[];
}

/** Nothing changed (tasks that are merely due don't make a digest on their own). */
export const digestEmpty = (m: DigestMaterial) => !m.notes.length && !m.newTasks.length && !m.comments.length;

export const DIGEST_SYSTEM = [
  "You write a short digest of what changed in someone's notes, for a calm note-taking app. Write to them as 'you'.",
  "Be concrete and brief. Only say what the material below says; never invent tasks, dates or people.",
  "Format with simple Markdown: '##' section headings, '-' bullets, **bold** note titles. No tables, no HTML, no greeting or sign-off.",
  UNTRUSTED_RULE,
].join(" ");

const MAX_OUTPUT = 1_200;

/** The credits held for a digest: one call reading everything at its largest. */
export const DIGEST_PLAN: PlannedCall[] = [
  {
    fast: false,
    inputChars: DIGEST_SYSTEM.length + 1_200 + DIGEST_LIMITS.notes * (DIGEST_LIMITS.noteChars + 120) + (DIGEST_LIMITS.newTasks + DIGEST_LIMITS.dueTasks) * 260 + DIGEST_LIMITS.comments * (DIGEST_LIMITS.commentChars + 140),
    maxOutputTokens: MAX_OUTPUT,
  },
];

/** The request for a digest of `material` covering a day or a week. */
export function digestRequest(frequency: DigestFrequency, material: DigestMaterial): GenerateRequest {
  const notes = material.notes.map((n) => untrusted("note", { title: n.title, change: n.isNew ? "new" : "edited" }, n.text)).join("\n\n");
  const task = (t: { title: string; due: string | null; note: string }) => `- ${t.title.replace(/\s+/g, " ")}${t.due ? ` (due ${t.due})` : ""}, in "${t.note}"`;
  const comments = material.comments.map((c) => untrusted("note", { note: c.note, comment_by: c.author }, c.text)).join("\n");
  const period = frequency === "weekly" ? "the past week" : "the past day";
  return {
    system: DIGEST_SYSTEM,
    prompt: [
      `Today is ${material.today}. This digest covers ${period}.`,
      `<changed_notes>\n${notes || "(none)"}\n</changed_notes>`,
      `<new_tasks>\n${material.newTasks.map(task).join("\n") || "(none)"}\n</new_tasks>`,
      `<due_tasks>\n${material.dueTasks.map((t) => `${task(t)}${t.overdue ? " (overdue)" : ""}`).join("\n") || "(none)"}\n</due_tasks>`,
      `<new_comments>\n${comments || "(none)"}\n</new_comments>`,
      "Write the digest: '## Highlights' with 2 to 5 bullets on what changed (name the notes), then '## Tasks' with what's overdue or due soon and what's new (skip it when there are none), then '## Comments' with what people said (skip it when there are none). Under 220 words.",
    ].join("\n\n"),
    temperature: 0.3,
    maxOutputTokens: MAX_OUTPUT,
  };
}
