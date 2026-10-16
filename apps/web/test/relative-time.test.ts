import { describe, expect, test } from "vitest";
import { ageText, formatRelative } from "@/lib/format";

const NOW = new Date(2026, 9, 16, 12, 0, 0).getTime();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const shortDate = (ts: number, year?: "numeric") => new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year });

describe("relative times: one wording, sentence case", () => {
  test("a moment ago reads just now", () => {
    expect(formatRelative(NOW, NOW)).toBe("just now");
    expect(formatRelative(NOW - 20_000, NOW)).toBe("just now");
    expect(ageText(NOW - 20_000, NOW)).toBe("Just now");
  });

  test("minutes, singular and plural", () => {
    expect(formatRelative(NOW - MIN, NOW)).toBe("1 min ago");
    expect(formatRelative(NOW - 23 * MIN, NOW)).toBe("23 mins ago");
    expect(ageText(NOW - 23 * MIN, NOW)).toBe("23 mins ago");
  });

  test("hours, singular and plural", () => {
    expect(formatRelative(NOW - 59.7 * MIN, NOW)).toBe("1 hour ago");
    expect(formatRelative(NOW - HOUR, NOW)).toBe("1 hour ago");
    expect(formatRelative(NOW - 10 * HOUR, NOW)).toBe("10 hours ago");
    expect(ageText(NOW - 10 * HOUR, NOW)).toBe("10 hours ago");
  });

  test("days, singular and plural, up to a week", () => {
    expect(formatRelative(NOW - DAY, NOW)).toBe("1 day ago");
    expect(formatRelative(NOW - 3 * DAY, NOW)).toBe("3 days ago");
    expect(ageText(NOW - 6 * DAY, NOW)).toBe("6 days ago");
  });

  test("older times show a short date, with the year only when it differs", () => {
    const lastWeek = NOW - 12 * DAY;
    expect(formatRelative(lastWeek, NOW)).toBe(shortDate(lastWeek));
    const lastYear = new Date(2025, 2, 4, 9).getTime();
    expect(formatRelative(lastYear, NOW)).toBe(shortDate(lastYear, "numeric"));
    expect(formatRelative(lastYear, NOW)).toMatch(/2025/);
  });

  test("times ahead read in so long", () => {
    expect(formatRelative(NOW + 10_000, NOW)).toBe("in 1 min");
    expect(formatRelative(NOW + 5 * MIN, NOW)).toBe("in 5 mins");
    expect(formatRelative(NOW + HOUR, NOW)).toBe("in 1 hour");
    expect(formatRelative(NOW + 3 * DAY, NOW)).toBe("in 3 days");
    expect(ageText(NOW + 3 * DAY, NOW)).toBe("In 3 days");
  });

  test("never Title Case: only the first letter of a label is capitalised", () => {
    for (const ts of [NOW - 10 * HOUR, NOW - 2 * DAY, NOW - 45 * MIN, NOW + 2 * HOUR]) {
      const label = ageText(ts, NOW);
      expect(label).not.toMatch(/ [A-Z]/);
      expect(label.slice(1)).toBe(formatRelative(ts, NOW).slice(1));
    }
    expect(ageText(NOW - 10 * HOUR, NOW)).not.toBe("10 Hours Ago");
  });
});
