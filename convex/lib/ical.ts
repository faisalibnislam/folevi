// iCalendar (RFC 5545) for the tasks feed (convex/calendarFeeds.ts): dated to-dos as events a calendar
// app can subscribe to. All-day for a date, 30 minutes for a date and time (converted from the person's
// time zone to UTC). Text is escaped and lines folded at 75 octets, with CRLF line ends.

export interface FeedTask {
  uid: string;
  title: string;
  /** YYYY-MM-DD in the person's calendar. */
  dueDate: string;
  /** HH:MM, when the task has a time. */
  dueTime?: string;
  url: string;
  note: string;
  updatedAt: number;
}

/** TEXT values: backslash, semicolon, comma and newlines escaped. */
export function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Folds a content line at 75 octets (continuation lines start with a space), never inside a UTF-8 character. */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74;
    if (size + n > limit) {
      out.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += n;
  }
  out.push(current);
  return out.map((part, i) => (i === 0 ? part : ` ${part}`)).join("\r\n");
}

const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
};
const dateValue = (date: string) => date.replace(/-/g, "");
const nextDay = (date: string) => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

/** The UTC instant of a wall-clock date and time in an IANA time zone. */
export function zonedToUtc(date: string, time: string, timeZone: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [h, min] = time.split(":").map(Number) as [number, number];
  const wall = Date.UTC(y, m - 1, d, h, min);
  // The zone's offset at that moment (twice, for the hour around a DST change).
  const offsetAt = (instant: number) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(instant));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second")) - instant;
  };
  let guess = wall - offsetAt(wall);
  guess = wall - offsetAt(guess);
  return guess;
}

/** The feed: a VCALENDAR with one VEVENT per task. */
export function buildCalendar(tasks: FeedTask[], opts: { name: string; timeZone: string; now?: number }): string {
  const now = opts.now ?? Date.now();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Folevi//Tasks//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(opts.name)}`,
    `X-WR-TIMEZONE:${opts.timeZone}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const t of tasks) {
    lines.push("BEGIN:VEVENT", `UID:${t.uid}`, `DTSTAMP:${stamp(now)}`, `LAST-MODIFIED:${stamp(t.updatedAt)}`);
    if (t.dueTime) {
      const start = zonedToUtc(t.dueDate, t.dueTime, opts.timeZone);
      lines.push(`DTSTART:${stamp(start)}`, `DTEND:${stamp(start + 30 * 60_000)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${dateValue(t.dueDate)}`, `DTEND;VALUE=DATE:${dateValue(nextDay(t.dueDate))}`);
    }
    lines.push(`SUMMARY:${escapeText(t.title)}`, `DESCRIPTION:${escapeText(`In ${t.note}`)}`, `URL:${t.url}`, "TRANSP:TRANSPARENT", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}
