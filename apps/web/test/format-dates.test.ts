import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatRelative } from "@/lib/format";

// lib/format keeps one Intl.DateTimeFormat per set of options (docs/WEB_PERFORMANCE.md): the text must stay what
// toLocaleDateString / toLocaleString wrote.
describe("date formatting with kept formatters", () => {
  const now = Date.UTC(2026, 9, 29, 12);
  it("writes what toLocaleDateString wrote, this year and another", () => {
    for (const ts of [Date.UTC(2026, 2, 3, 9), Date.UTC(2024, 11, 31, 23), Date.UTC(2026, 9, 1)]) {
      const sameYear = new Date(ts).getFullYear() === new Date(now).getFullYear();
      expect(formatRelative(ts, now)).toBe(new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: sameYear ? undefined : "numeric" }));
    }
  });
  it("keeps the relative words", () => {
    expect(formatRelative(now - 20_000, now)).toBe("just now");
    expect(formatRelative(now - 5 * 60_000, now)).toBe("5 mins ago");
    expect(formatRelative(now + 3 * 86_400_000, now)).toBe("in 3 days");
  });
  it("formatDate and formatDateTime match the locale methods for each option set", () => {
    const sets: Intl.DateTimeFormatOptions[] = [{ weekday: "short", month: "short", day: "numeric" }, { weekday: "long" }, { month: "long", year: "numeric" }, { dateStyle: "full" }, { day: "numeric" }];
    for (const opts of sets) {
      for (const date of ["2026-10-29", "2025-01-01", "2026-02-28"]) {
        const [y, m, d] = date.split("-").map(Number) as [number, number, number];
        expect(formatDate(date, opts)).toBe(new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { ...opts, timeZone: "UTC" }));
      }
    }
    expect(formatDateTime(now)).toBe(new Date(now).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }));
  });
});
