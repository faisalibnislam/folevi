// Localized, non-concatenated date formatting helpers (English only for now; Intl handles grammar).
const rtf = typeof Intl !== "undefined" ? new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }) : null;

export function formatRelative(ts: number, now = Date.now()): string {
  const diff = ts - now;
  const abs = Math.abs(diff);
  if (!rtf) return new Date(ts).toLocaleString();
  if (abs < 45_000) return rtf.format(0, "second");
  if (abs < 45 * 60_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 22 * 3_600_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
  if (abs < 6 * 86_400_000) return rtf.format(Math.round(diff / 86_400_000), "day");
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: new Date(ts).getFullYear() === new Date(now).getFullYear() ? undefined : "numeric" });
}

export function formatDate(date: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { ...opts, timeZone: "UTC" });
}

export function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
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
