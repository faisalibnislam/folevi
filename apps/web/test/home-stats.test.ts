// Home's stats strip: how figures and reading time read (components/views/HomeStats.tsx), and the week's buckets.
import { describe, expect, test } from "vitest";
import { readingTime, statNumber } from "@/components/views/HomeStats";

describe("Home stats", () => {
  test("figures stay whole under 10,000, then go compact", () => {
    expect(statNumber(980)).toBe((980).toLocaleString());
    expect(statNumber(9061)).toBe((9061).toLocaleString());
    expect(statNumber(12_400)).toMatch(/12\.4/);
  });
  test("reading time", () => {
    expect(readingTime(100)).toBe("under a minute of reading");
    expect(readingTime(9061)).toBe("≈ 38 min of reading");
    expect(readingTime(238 * 150)).toBe("≈ 2.5 h of reading");
    expect(readingTime(238 * 120)).toBe("≈ 2 h of reading");
  });
});
