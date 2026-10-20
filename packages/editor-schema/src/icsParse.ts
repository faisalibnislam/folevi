// Reading iCalendar (RFC 5545) for read-only calendar subscriptions (convex/externalCalendars.ts, and the
// local backend): the events of a VCALENDAR as instances within a window, with repeats expanded.
//
// What's read: folded lines, VEVENT with DTSTART and DTEND or DURATION (a DATE, a UTC DATE-TIME, or a
// DATE-TIME with a TZID that Intl knows, or a common Windows zone name), SUMMARY, LOCATION, DESCRIPTION
// (text escapes undone, kept as plain text), STATUS:CANCELLED, EXDATE and RECURRENCE-ID overrides.
// Repeats: RRULE with FREQ=DAILY, WEEKLY, MONTHLY or YEARLY, INTERVAL, COUNT, UNTIL, BYDAY for weekly rules
// (and a single "nth weekday" for monthly ones, like 2TU or -1FR), and BYMONTHDAY / BYMONTH when they only
// repeat what DTSTART says. Anything else in a rule (BYSETPOS, BYHOUR, several BYMONTHDAY values...) isn't
// guessed at: the event shows once, at DTSTART. VTIMEZONE blocks aren't read; a TZID Intl doesn't know
// falls back to the calendar's X-WR-TIMEZONE, then UTC. Times without a zone ("floating") use that too.
import { zonedToUtc } from "./ics";

export interface IcsEvent {
  /** UID, plus the instance start for repeats (unique within one calendar). */
  key: string;
  uid: string;
  /** UTC milliseconds. For all-day events, UTC midnight of the first day. */
  start: number;
  /** UTC milliseconds, after `start` or equal. For all-day events, UTC midnight of the day after the last. */
  end: number;
  allDay: boolean;
  title: string;
  location: string;
  description: string;
}

export interface ParseOptions {
  /** Instances ending at or before this (UTC ms) are left out. */
  from: number;
  /** Instances starting at or after this (UTC ms) are left out. */
  to: number;
  /** At most this many instances (the earliest ones). */
  maxEvents?: number;
}

export interface ParseResult {
  events: IcsEvent[];
  /** X-WR-CALNAME, when the calendar names itself. */
  name: string | null;
  /** More instances fell in the window than `maxEvents`. */
  truncated: boolean;
}

const MAX_TITLE = 300;
const MAX_LOCATION = 300;
const MAX_DESCRIPTION = 2000;
/** Repeat steps tried per event before giving up (a rule that never lands in the window). */
const MAX_STEPS = 5000;
const DAY_MS = 86_400_000;

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

interface Component {
  type: string;
  props: Prop[];
  children: Component[];
}

/** Lines unfolded: a line starting with a space or a tab continues the one before. */
export function unfold(text: string): string[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length) out[out.length - 1] += line.slice(1);
    else if (line.trim()) out.push(line);
  }
  return out;
}

/** One content line: NAME;PARAM=value;PARAM="quoted:value":VALUE. Null when it isn't one. */
export function parseLine(line: string): Prop | null {
  let i = 0;
  let quoted = false;
  // The value starts at the first colon outside quotes.
  for (; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === ":" && !quoted) break;
  }
  if (i >= line.length) return null;
  const head = line.slice(0, i);
  const value = line.slice(i + 1);
  const parts: string[] = [];
  let current = "";
  quoted = false;
  for (const ch of head) {
    if (ch === '"') quoted = !quoted;
    if (ch === ";" && !quoted) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  const name = parts[0]!.trim().toUpperCase();
  if (!name) return null;
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf("=");
    if (eq < 0) continue;
    params[p.slice(0, eq).trim().toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name, params, value };
}

/** A TEXT value with its escapes undone (\n, \, \; \\). */
export function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

function tree(lines: string[]): Component {
  const root: Component = { type: "ROOT", props: [], children: [] };
  const stack: Component[] = [root];
  for (const line of lines) {
    const prop = parseLine(line);
    if (!prop) continue;
    const top = stack[stack.length - 1]!;
    if (prop.name === "BEGIN") {
      const child: Component = { type: prop.value.trim().toUpperCase(), props: [], children: [] };
      top.children.push(child);
      stack.push(child);
    } else if (prop.name === "END") {
      if (stack.length > 1) stack.pop();
    } else top.props.push(prop);
  }
  return root;
}

const WINDOWS_ZONES: Record<string, string> = {
  "Pacific Standard Time": "America/Los_Angeles",
  "Mountain Standard Time": "America/Denver",
  "Central Standard Time": "America/Chicago",
  "Eastern Standard Time": "America/New_York",
  "Atlantic Standard Time": "America/Halifax",
  "Alaskan Standard Time": "America/Anchorage",
  "Hawaiian Standard Time": "Pacific/Honolulu",
  "E. South America Standard Time": "America/Sao_Paulo",
  "GMT Standard Time": "Europe/London",
  "Greenwich Standard Time": "Atlantic/Reykjavik",
  "W. Europe Standard Time": "Europe/Berlin",
  "Romance Standard Time": "Europe/Paris",
  "Central Europe Standard Time": "Europe/Budapest",
  "Central European Standard Time": "Europe/Warsaw",
  "E. Europe Standard Time": "Europe/Chisinau",
  "FLE Standard Time": "Europe/Kiev",
  "GTB Standard Time": "Europe/Bucharest",
  "Russian Standard Time": "Europe/Moscow",
  "Arabian Standard Time": "Asia/Dubai",
  "Pakistan Standard Time": "Asia/Karachi",
  "India Standard Time": "Asia/Kolkata",
  "Bangladesh Standard Time": "Asia/Dhaka",
  "SE Asia Standard Time": "Asia/Bangkok",
  "Singapore Standard Time": "Asia/Singapore",
  "China Standard Time": "Asia/Shanghai",
  "Tokyo Standard Time": "Asia/Tokyo",
  "Korea Standard Time": "Asia/Seoul",
  "AUS Eastern Standard Time": "Australia/Sydney",
  "New Zealand Standard Time": "Pacific/Auckland",
  "UTC": "UTC",
};

const knownZones = new Map<string, boolean>();
function isZone(tz: string): boolean {
  let ok = knownZones.get(tz);
  if (ok === undefined) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      ok = true;
    } catch {
      ok = false;
    }
    knownZones.set(tz, ok);
  }
  return ok;
}

/** An IANA zone for a TZID: as it is, a known Windows name, or the tail of a prefixed one (/mozilla.org/.../Europe/Paris). */
export function resolveZone(tzid: string | undefined, fallback: string): string {
  if (!tzid) return fallback;
  const id = tzid.trim();
  if (WINDOWS_ZONES[id]) return WINDOWS_ZONES[id]!;
  if (isZone(id)) return id;
  const tail = id.split("/").filter(Boolean);
  for (let n = Math.min(3, tail.length); n >= 1; n--) {
    const candidate = tail.slice(-n).join("/");
    if (candidate.includes("/") && isZone(candidate)) return candidate;
  }
  return fallback;
}

/** A DTSTART-like moment: a day, and for timed values the wall-clock time and its zone. */
interface Moment {
  date: string;
  /** Seconds after midnight, or null for a DATE. */
  seconds: number | null;
  zone: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

function parseMoment(prop: Prop | undefined, fallbackZone: string): Moment | null {
  if (!prop) return null;
  const raw = prop.value.trim().split(",")[0]!;
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/i.exec(raw);
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (!validDate(date)) return null;
  if (m[4] === undefined || prop.params.VALUE?.toUpperCase() === "DATE") return { date, seconds: null, zone: "UTC" };
  const seconds = Number(m[4]) * 3600 + Number(m[5]) * 60 + Number(m[6] ?? 0);
  if (seconds > 86_400) return null;
  return { date, seconds, zone: m[7] ? "UTC" : resolveZone(prop.params.TZID, fallbackZone) };
}

function validDate(date: string): boolean {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** The UTC instant of a moment (UTC midnight for a day). */
function instant(m: Moment): number {
  const [y, mo, d] = m.date.split("-").map(Number) as [number, number, number];
  if (m.seconds === null) return Date.UTC(y, mo - 1, d);
  if (m.zone === "UTC") return Date.UTC(y, mo - 1, d) + m.seconds * 1000;
  const h = Math.floor(m.seconds / 3600);
  const min = Math.floor((m.seconds % 3600) / 60);
  return zonedToUtc(m.date, `${pad(h)}:${pad(min)}`, m.zone) + (m.seconds % 60) * 1000;
}

/** A DURATION (P1W, P2DT3H, -PT15M...) in milliseconds, or null. */
export function parseDuration(value: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(value.trim());
  if (!m || value.trim().toUpperCase() === "P" || /T$/i.test(value.trim())) return null;
  const ms = (Number(m[2] ?? 0) * 7 + Number(m[3] ?? 0)) * DAY_MS + (Number(m[4] ?? 0) * 3600 + Number(m[5] ?? 0) * 60 + Number(m[6] ?? 0)) * 1000;
  return m[1] === "-" ? -ms : ms;
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Day of the week, Sunday = 0. */
function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

interface Rule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count: number | null;
  /** The last instant an instance may start at. */
  until: number | null;
  /** Weekly: the days (Sunday = 0). */
  byDay: number[] | null;
  /** Monthly: the nth (1..5, or -1..-5 from the end) weekday of the month. */
  nthDay: { n: number; day: number } | null;
  /** WKST, Sunday = 0 (Monday by default). */
  weekStart: number;
}

/** An RRULE this reader can expand, or null (then only the first instance is shown). */
export function parseRule(value: string, start: Moment, fallbackZone: string): Rule | null {
  const parts = new Map<string, string>();
  for (const p of value.split(";")) {
    const eq = p.indexOf("=");
    if (eq > 0) parts.set(p.slice(0, eq).trim().toUpperCase(), p.slice(eq + 1).trim().toUpperCase());
  }
  const freq = parts.get("FREQ");
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") return null;
  const [, month, day] = start.date.split("-").map(Number) as [number, number, number];
  const supported = new Set(["FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "WKST", "BYMONTHDAY", "BYMONTH"]);
  for (const key of parts.keys()) if (!supported.has(key)) return null;
  // BYMONTHDAY and BYMONTH only when they say what DTSTART already does.
  const byMonthDay = parts.get("BYMONTHDAY");
  if (byMonthDay !== undefined && (freq === "DAILY" || freq === "WEEKLY" || byMonthDay !== String(day))) return null;
  const byMonth = parts.get("BYMONTH");
  if (byMonth !== undefined && (freq !== "YEARLY" || byMonth !== String(month))) return null;
  const interval = parts.has("INTERVAL") ? Number(parts.get("INTERVAL")) : 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 1000) return null;
  const count = parts.has("COUNT") ? Number(parts.get("COUNT")) : null;
  if (count !== null && (!Number.isInteger(count) || count < 1)) return null;
  let until: number | null = null;
  if (parts.has("UNTIL")) {
    const raw = parts.get("UNTIL")!;
    const u = parseMoment({ name: "UNTIL", params: {}, value: raw }, fallbackZone);
    if (!u) return null;
    // A date UNTIL includes that whole day; a floating one is read in the event's zone.
    if (u.seconds === null) until = start.seconds === null ? instant(u) : instant({ date: u.date, seconds: 86_399, zone: start.zone });
    else until = raw.endsWith("Z") ? instant(u) : instant({ ...u, zone: start.zone });
  }
  const weekStart = parts.has("WKST") ? DAY_CODES.indexOf(parts.get("WKST")!) : 1;
  if (weekStart < 0) return null;
  let byDay: number[] | null = null;
  let nthDay: Rule["nthDay"] = null;
  const byDayRaw = parts.get("BYDAY");
  if (byDayRaw !== undefined) {
    if (freq === "WEEKLY") {
      const days = byDayRaw.split(",").map((d) => DAY_CODES.indexOf(d.trim()));
      if (!days.length || days.some((d) => d < 0)) return null;
      byDay = [...new Set(days)];
    } else if (freq === "MONTHLY") {
      const m = /^([+-]?[1-5])(SU|MO|TU|WE|TH|FR|SA)$/.exec(byDayRaw);
      if (!m) return null;
      nthDay = { n: Number(m[1]), day: DAY_CODES.indexOf(m[2]!) };
    } else return null;
  }
  return { freq, interval, count, until, byDay, nthDay, weekStart };
}

/** The date of the nth weekday (n from 1, or from -1 counting back from the end) of a month, or null. */
function nthWeekday(year: number, month: number, n: number, day: number): string | null {
  if (n > 0) {
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const date = 1 + ((day - first + 7) % 7) + (n - 1) * 7;
    const dt = new Date(Date.UTC(year, month - 1, date));
    return dt.getUTCMonth() === month - 1 ? dt.toISOString().slice(0, 10) : null;
  }
  const lastDate = new Date(Date.UTC(year, month, 0));
  const last = lastDate.getUTCDay();
  const date = lastDate.getUTCDate() - ((last - day + 7) % 7) + (n + 1) * 7;
  return date >= 1 ? new Date(Date.UTC(year, month - 1, date)).toISOString().slice(0, 10) : null;
}

/**
 * The days a rule repeats on, from DTSTART's day, in order (the caller stops). DTSTART's day always comes
 * first. Dates that don't exist (the 31st of a short month, 29 February) are skipped, as RFC 5545 says.
 * `firstStep` skips whole periods (days, weeks, months or years) that end before the window.
 */
function* ruleDates(rule: Rule, startDate: string, firstStep = 1): Generator<string> {
  if (firstStep <= 1) yield startDate;
  const [y0, m0, d0] = startDate.split("-").map(Number) as [number, number, number];
  for (let step = Math.max(1, firstStep); step < Math.max(1, firstStep) + MAX_STEPS; step++) {
    if (rule.freq === "DAILY") yield addDays(startDate, step * rule.interval);
    else if (rule.freq === "WEEKLY") {
      if (!rule.byDay) {
        yield addDays(startDate, step * 7 * rule.interval);
        continue;
      }
      // Week by week from the week DTSTART is in (weeks start on WKST); each week's chosen days in order.
      const weekFirst = addDays(startDate, -((weekday(startDate) - rule.weekStart + 7) % 7));
      const week = addDays(weekFirst, (step - 1) * 7 * rule.interval);
      const days = rule.byDay.map((d) => addDays(week, (d - rule.weekStart + 7) % 7)).sort();
      for (const d of days) if (d > startDate) yield d;
    } else if (rule.freq === "MONTHLY") {
      const total = m0 - 1 + step * rule.interval;
      const year = y0 + Math.floor(total / 12);
      const month = (total % 12) + 1;
      if (rule.nthDay) {
        const d = nthWeekday(year, month, rule.nthDay.n, rule.nthDay.day);
        if (d && d > startDate) yield d;
      } else {
        const d = `${year}-${pad(month)}-${pad(d0)}`;
        if (validDate(d)) yield d;
      }
    } else {
      const d = `${y0 + step * rule.interval}-${pad(m0)}-${pad(d0)}`;
      if (validDate(d)) yield d;
    }
  }
}

/**
 * The first period worth generating for a rule without COUNT (with one, every instance from DTSTART
 * counts): a period or two before `fromDate`, so a daily event from years ago still reaches the window.
 */
function firstStepFor(rule: Rule, startDate: string, fromDate: string): number {
  if (rule.count !== null || fromDate <= startDate) return 1;
  const days = Math.floor((Date.parse(`${fromDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / DAY_MS);
  const [y0, m0] = startDate.split("-").map(Number) as [number, number];
  const [y1, m1] = fromDate.split("-").map(Number) as [number, number];
  const periods =
    rule.freq === "DAILY" ? days / rule.interval : rule.freq === "WEEKLY" ? days / (7 * rule.interval) : rule.freq === "MONTHLY" ? (y1 * 12 + m1 - (y0 * 12 + m0)) / rule.interval : (y1 - y0) / rule.interval;
  return Math.max(1, Math.floor(periods) - 1);
}

interface Raw {
  uid: string;
  start: Moment;
  /** Length in ms (for all-day events, whole days). */
  length: number;
  title: string;
  location: string;
  description: string;
  cancelled: boolean;
  rule: string | null;
  exdates: Moment[];
  recurrenceId: Moment | null;
}

function text(c: Component, name: string, max: number): string {
  const p = c.props.find((x) => x.name === name);
  return p ? unescapeText(p.value).replace(/\u0000/g, "").trim().slice(0, max) : "";
}

function readEvent(c: Component, index: number, fallbackZone: string): Raw | null {
  const get = (name: string) => c.props.find((p) => p.name === name);
  const start = parseMoment(get("DTSTART"), fallbackZone);
  if (!start) return null;
  const startMs = instant(start);
  let length: number;
  const end = parseMoment(get("DTEND"), fallbackZone);
  const duration = get("DURATION") ? parseDuration(get("DURATION")!.value) : null;
  if (end) length = instant(end) - startMs;
  else if (duration !== null) length = duration;
  else length = start.seconds === null ? DAY_MS : 0;
  if (start.seconds === null) length = Math.max(DAY_MS, Math.round(length / DAY_MS) * DAY_MS);
  length = Math.max(0, length);
  const exdates: Moment[] = [];
  for (const p of c.props.filter((x) => x.name === "EXDATE")) {
    for (const v of p.value.split(",")) {
      const m = parseMoment({ ...p, value: v }, fallbackZone);
      if (m) exdates.push(m);
    }
  }
  return {
    uid: text(c, "UID", 500) || `event-${index}`,
    start,
    length,
    title: text(c, "SUMMARY", MAX_TITLE),
    location: text(c, "LOCATION", MAX_LOCATION),
    description: text(c, "DESCRIPTION", MAX_DESCRIPTION),
    cancelled: text(c, "STATUS", 40).toUpperCase() === "CANCELLED",
    rule: get("RRULE")?.value ?? null,
    exdates,
    recurrenceId: parseMoment(get("RECURRENCE-ID"), fallbackZone),
  };
}

/** How instances are matched to EXDATE and RECURRENCE-ID: the day for all-day events, else the instant. */
function matchKey(m: Moment, allDay: boolean): string {
  return allDay ? m.date : String(instant(m));
}

function instance(e: Raw, start: number, key: string): IcsEvent {
  return { key, uid: e.uid, start, end: start + e.length, allDay: e.start.seconds === null, title: e.title, location: e.location, description: e.description };
}

/** The events of an iCalendar text, as instances overlapping the window. Never throws on bad input. */
export function parseIcs(input: string, opts: ParseOptions): ParseResult {
  const max = opts.maxEvents ?? 1500;
  const root = tree(unfold(input));
  const cal = root.children.find((c) => c.type === "VCALENDAR") ?? root;
  const wrTz = cal.props.find((p) => p.name === "X-WR-TIMEZONE")?.value.trim();
  const fallbackZone = wrTz && isZone(wrTz) ? wrTz : "UTC";
  const name = text(cal, "X-WR-CALNAME", 80) || null;
  const raws = cal.children
    .filter((c) => c.type === "VEVENT")
    .map((c, i) => readEvent(c, i, fallbackZone))
    .filter((e): e is Raw => e !== null);

  // Overrides of one instance of a repeat, by UID and the instance they replace.
  const overrides = new Map<string, Map<string, Raw>>();
  const masters: Raw[] = [];
  for (const e of raws) {
    if (e.recurrenceId) {
      const byKey = overrides.get(e.uid) ?? new Map<string, Raw>();
      byKey.set(matchKey(e.recurrenceId, e.recurrenceId.seconds === null), e);
      overrides.set(e.uid, byKey);
    } else masters.push(e);
  }

  const out: IcsEvent[] = [];
  const inWindow = (start: number, end: number) => start < opts.to && Math.max(end, start + 1) > opts.from;
  const push = (ev: IcsEvent) => {
    if (inWindow(ev.start, ev.end)) out.push(ev);
  };
  for (const e of masters) {
    if (e.cancelled) continue;
    const allDay = e.start.seconds === null;
    const mine = overrides.get(e.uid);
    const rule = e.rule ? parseRule(e.rule, e.start, fallbackZone) : null;
    if (!rule) {
      push(instance(e, instant(e.start), `${e.uid}#${matchKey(e.start, allDay)}`));
      continue;
    }
    const excluded = new Set(e.exdates.map((x) => matchKey(x, allDay)));
    // A DATE in EXDATE takes out that day's instance of a timed event too.
    const excludedDays = new Set(e.exdates.filter((x) => x.seconds === null).map((x) => x.date));
    const fromDate = new Date(opts.from - e.length - 2 * DAY_MS).toISOString().slice(0, 10);
    let n = 0;
    for (const date of ruleDates(rule, e.start.date, firstStepFor(rule, e.start.date, fromDate))) {
      const at: Moment = { ...e.start, date };
      const start = instant(at);
      if (rule.until !== null && start > rule.until) break;
      if (rule.count !== null && n >= rule.count) break;
      if (start >= opts.to) break;
      n++;
      const key = matchKey(at, allDay);
      if (excluded.has(key) || excludedDays.has(date)) continue;
      const override = mine?.get(key);
      if (override) {
        mine!.delete(key);
        if (!override.cancelled) push(instance(override, instant(override.start), `${e.uid}#${key}`));
        continue;
      }
      if (start + Math.max(e.length, 1) <= opts.from) continue;
      push(instance(e, start, `${e.uid}#${key}`));
    }
  }
  // Overrides whose instance the rule didn't make (or whose master isn't here) still happen.
  for (const [uid, byKey] of overrides) {
    for (const [key, o] of byKey) if (!o.cancelled) push(instance(o, instant(o.start), `${uid}#${key}`));
  }

  out.sort((a, b) => a.start - b.start || (a.key < b.key ? -1 : 1));
  const seen = new Set<string>();
  const unique = out.filter((e) => (seen.has(e.key) ? false : (seen.add(e.key), true)));
  return { events: unique.slice(0, max), name, truncated: unique.length > max };
}
