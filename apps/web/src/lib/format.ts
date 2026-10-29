// Date formatting helpers (English only for now).

// One formatter per set of options: building an Intl.DateTimeFormat (which `toLocaleDateString(_, options)` does
// on every call) costs far more than formatting with one, and lists format a date per row.
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(opts);
  let f = formatters.get(key);
  if (!f) formatters.set(key, (f = new Intl.DateTimeFormat(undefined, opts)));
  return f;
}
/** `date.toLocaleDateString(undefined, opts)`, with a kept formatter (the same text: opts always name a date part). */
function localeDate(date: Date, opts: Intl.DateTimeFormatOptions): string {
  return opts.weekday || opts.year || opts.month || opts.day || opts.dateStyle ? formatter(opts).format(date) : date.toLocaleDateString(undefined, opts);
}

/**
 * The one wording for relative times, used everywhere in the app: "just now", "1 min ago", "5 mins ago",
 * "1 hour ago", "3 days ago", then from a week out a short date ("Sep 10", or "Sep 10, 2025" in another
 * year). Times ahead read "in 5 mins", "in 1 hour", "in 3 days". Lower case, for use inside a sentence or
 * after a separator ("Edited 5 mins ago", "Sam · 1 hour ago"); a label on its own uses ageText.
 */
export function formatRelative(ts: number, now = Date.now()): string {
  const ahead = ts > now;
  const unit = (n: number, u: string) => {
    const words = `${n} ${u}${n === 1 ? "" : "s"}`;
    return ahead ? `in ${words}` : `${words} ago`;
  };
  const exact = Math.abs(now - ts) / 60_000;
  const mins = ahead ? Math.max(1, Math.round(exact)) : Math.round(exact);
  if (mins < 1) return "just now";
  if (mins < 60) return unit(mins, "min");
  const hours = Math.round(mins / 60);
  if (hours < 24) return unit(hours, "hour");
  const days = Math.round(hours / 24);
  if (days < 7) return unit(days, "day");
  const sameYear = new Date(ts).getFullYear() === new Date(now).getFullYear();
  return localeDate(new Date(ts), sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

/**
 * The same words as formatRelative, in sentence case for a label that stands on its own (note cards,
 * folder covers, list columns): "Just now", "5 mins ago", "1 hour ago", "Sep 10". Only the first letter is
 * ever capitalised.
 */
export function ageText(ts: number, now = Date.now()): string {
  const out = formatRelative(ts, now);
  return out.charAt(0).toUpperCase() + out.slice(1);
}

export function formatDate(date: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return localeDate(new Date(Date.UTC(y, m - 1, d)), { ...opts, timeZone: "UTC" });
}

export function formatDateTime(ts: number): string {
  return formatter({ dateStyle: "medium", timeStyle: "short" }).format(new Date(ts));
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function dueLabel(dueDate: string, today: string): string {
  if (dueDate === today) return "Today";
  const t = Date.UTC(...(today.split("-").map(Number) as [number, number, number]).map((v, i) => (i === 1 ? v - 1 : v)) as [number, number, number]);
  const d = Date.UTC(...(dueDate.split("-").map(Number) as [number, number, number]).map((v, i) => (i === 1 ? v - 1 : v)) as [number, number, number]);
  const days = Math.round((d - t) / 86_400_000);
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days > 1 && days < 7) return formatDate(dueDate, { weekday: "long" });
  return formatDate(dueDate, { month: "short", day: "numeric" });
}
