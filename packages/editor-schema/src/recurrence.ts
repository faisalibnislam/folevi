// Repeating to-dos. A to-do's `repeat` (daily, weekdays, weekly, monthly, yearly), `repeatEvery` (every N,
// default 1) and `repeatDays` (weekly only: ISO weekdays "1,3,5", Monday = 1) say when it comes back.
// Checking one off moves it to its next date instead of leaving a done copy behind (convex/tasks.ts
// repeatTask): a daily habit stays one line, not a line a day. Dates are calendar dates (YYYY-MM-DD) with
// no time zone, like a to-do's dueDate.
import type { TaskRepeat } from "./generated/schema";

export interface RepeatRule {
  repeat: TaskRepeat;
  every?: number;
  /** ISO weekdays (1 = Monday … 7 = Sunday), for weekly. */
  days?: number[];
}

export const MAX_REPEAT_EVERY = 99;

/** A rule from a to-do's props, or null when it doesn't repeat (or the props don't make sense). */
export function repeatRule(props: Record<string, unknown>): RepeatRule | null {
  const repeat = props.repeat;
  if (repeat !== "daily" && repeat !== "weekdays" && repeat !== "weekly" && repeat !== "monthly" && repeat !== "yearly") return null;
  const every = typeof props.repeatEvery === "number" && Number.isInteger(props.repeatEvery) ? Math.min(Math.max(props.repeatEvery, 1), MAX_REPEAT_EVERY) : 1;
  const days = repeat === "weekly" && typeof props.repeatDays === "string" ? parseDays(props.repeatDays) : [];
  return { repeat, ...(every > 1 ? { every } : {}), ...(days.length ? { days } : {}) };
}

/** The props that store a rule (null clears them), to merge into a to-do's props. */
export function repeatProps(rule: RepeatRule | null): { repeat: TaskRepeat | null; repeatEvery: number | null; repeatDays: string | null } {
  if (!rule) return { repeat: null, repeatEvery: null, repeatDays: null };
  return { repeat: rule.repeat, repeatEvery: rule.every && rule.every > 1 ? rule.every : null, repeatDays: rule.repeat === "weekly" && rule.days?.length ? rule.days.join(",") : null };
}

function parseDays(value: string): number[] {
  const out = new Set<number>();
  for (const part of value.split(",")) {
    const n = Number(part.trim());
    if (Number.isInteger(n) && n >= 1 && n <= 7) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

// ---------------------------------------------------------------- dates

const toUtc = (date: string) => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
};
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const plusDays = (date: string, n: number) => fromUtc(toUtc(date) + n * 86_400_000);
/** ISO weekday: Monday 1 … Sunday 7. */
const isoDay = (date: string) => ((new Date(toUtc(date)).getUTCDay() + 6) % 7) + 1;

function plusMonths(date: string, n: number, dayOfMonth: number): string {
  const [y, m] = date.split("-").map(Number) as [number, number];
  const total = y * 12 + (m - 1) + n;
  const year = Math.floor(total / 12);
  const month = total % 12;
  // The 31st in a 30-day month (or February) is that month's last day.
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return fromUtc(Date.UTC(year, month, Math.min(dayOfMonth, last)));
}

/** The date after `from` this rule lands on (one step; see nextOccurrence for skipping past dates). */
export function stepOccurrence(rule: RepeatRule, from: string, anchorDay?: number): string {
  const every = rule.every ?? 1;
  switch (rule.repeat) {
    case "daily":
      return plusDays(from, every);
    case "weekdays": {
      let d = plusDays(from, 1);
      while (isoDay(d) > 5) d = plusDays(d, 1);
      return d;
    }
    case "weekly": {
      if (!rule.days?.length) return plusDays(from, 7 * every);
      const today = isoDay(from);
      const later = rule.days.find((x) => x > today);
      // Another listed day later this week; else the first listed day, `every` weeks on.
      if (later !== undefined) return plusDays(from, later - today);
      return plusDays(from, 7 * (every - 1) + (7 - today) + rule.days[0]!);
    }
    case "monthly":
      return plusMonths(from, every, anchorDay ?? Number(from.slice(8, 10)));
    case "yearly":
      return plusMonths(from, 12 * every, anchorDay ?? Number(from.slice(8, 10)));
  }
}

/**
 * When a repeating to-do checked off on `today` comes back: the step after its due date (or after today
 * when it had none), skipping dates already gone so a late check-off doesn't leave it overdue again.
 */
export function nextOccurrence(rule: RepeatRule, due: string | null, today: string): string {
  const anchorDay = Number((due ?? today).slice(8, 10));
  let next = stepOccurrence(rule, due ?? today, anchorDay);
  for (let i = 0; next <= today && i < 1000; i++) next = stepOccurrence(rule, next, anchorDay);
  return next;
}

// ---------------------------------------------------------------- words

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** "Every day", "Every 2 weeks on Monday and Thursday", "Every month". */
export function describeRepeat(rule: RepeatRule): string {
  const every = rule.every ?? 1;
  const unit = (one: string, many: string) => (every === 1 ? `Every ${one}` : `Every ${every} ${many}`);
  switch (rule.repeat) {
    case "daily":
      return unit("day", "days");
    case "weekdays":
      return "Every weekday";
    case "weekly": {
      const base = unit("week", "weeks");
      if (!rule.days?.length) return base;
      const names = rule.days.map((d) => DAY_NAMES[d - 1]!);
      const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
      return every === 1 ? `Every ${list}` : `${base} on ${list}`;
    }
    case "monthly":
      return unit("month", "months");
    case "yearly":
      return unit("year", "years");
  }
}

const WEEKDAY_WORDS: Record<string, number> = {
  mon: 1, monday: 1, mondays: 1,
  tue: 2, tues: 2, tuesday: 2, tuesdays: 2,
  wed: 3, wednesday: 3, wednesdays: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, thursdays: 4,
  fri: 5, friday: 5, fridays: 5,
  sat: 6, saturday: 6, saturdays: 6,
  sun: 7, sunday: 7, sundays: 7,
};
const UNIT: Record<string, TaskRepeat> = { day: "daily", days: "daily", week: "weekly", weeks: "weekly", month: "monthly", months: "monthly", year: "yearly", years: "yearly" };
const SHORTHAND: Record<string, TaskRepeat> = { daily: "daily", weekly: "weekly", monthly: "monthly", yearly: "yearly", annually: "yearly" };

/**
 * A repeat written in plain words, and the text without it: "water plants every monday",
 * "standup every weekday", "rent every month", "every 2 weeks", "daily". Null when there's none.
 */
export function parseRepeatPhrase(text: string): { rule: RepeatRule; text: string; rest: string } | null {
  const patterns: { re: RegExp; build: (m: RegExpExecArray) => RepeatRule | null }[] = [
    { re: /\bevery\s+(weekday|weekdays|work\s?day|work\s?days)\b/i, build: () => ({ repeat: "weekdays" }) },
    {
      re: /\bevery\s+((?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*(?:\s*(?:,|and|&)\s*(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*)*)\b/i,
      build: (m) => {
        const days = [...new Set(m[1]!.split(/\s*(?:,|and|&)\s*/i).map((w) => WEEKDAY_WORDS[w.toLowerCase()]).filter((d): d is number => d !== undefined))].sort((a, b) => a - b);
        return days.length ? { repeat: "weekly", days } : null;
      },
    },
    {
      re: /\bevery\s+(?:(\d{1,2}|other)\s+)?(day|days|week|weeks|month|months|year|years)\b/i,
      build: (m) => {
        const every = m[1] === undefined ? 1 : m[1].toLowerCase() === "other" ? 2 : Number(m[1]);
        if (!every || every > MAX_REPEAT_EVERY) return null;
        return { repeat: UNIT[m[2]!.toLowerCase()]!, ...(every > 1 ? { every } : {}) };
      },
    },
    { re: /\b(daily|weekly|monthly|yearly|annually)\b/i, build: (m) => ({ repeat: SHORTHAND[m[1]!.toLowerCase()]! }) },
  ];
  for (const { re, build } of patterns) {
    const m = re.exec(text);
    if (!m) continue;
    const rule = build(m);
    if (!rule) continue;
    const rest = `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}`.replace(/\s{2,}/g, " ").trim();
    return { rule, text: m[0], rest };
  }
  return null;
}
