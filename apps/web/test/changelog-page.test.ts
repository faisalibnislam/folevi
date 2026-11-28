import { describe, expect, test } from "vitest";
import { LATEST_RELEASE_DATE, RELEASES } from "@/components/marketing/content/changelog";

// The public changelog (/changelog): newest first, versions shown as MAJOR.MINOR.PATCH only, never a build number.
const parts = (version: string) => [...version.split(".").map(Number), 0, 0].slice(0, 3);
const newer = (a: string, b: string) => {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! > y[i]!;
  return false;
};

describe("changelog page entries", () => {
  test("the newest entry is 1.9.80 and its date is the page's latest", () => {
    expect(RELEASES[0]!.version).toBe("1.9.80");
    expect(LATEST_RELEASE_DATE).toBe(RELEASES[0]!.date);
  });

  test("versions are MAJOR.MINOR.PATCH, unique and newest first, with dates that never go forward", () => {
    // The early previews (0.1 to 0.4) stay as they were published; every release from 1.0 on is MAJOR.MINOR.PATCH.
    for (const r of RELEASES) expect(r.version).toMatch(r.version.startsWith("0.") ? /^0\.\d{1,3}$/ : /^\d{1,3}\.\d{1,3}\.\d{1,3}$/);
    expect(new Set(RELEASES.map((r) => r.version)).size).toBe(RELEASES.length);
    for (let i = 1; i < RELEASES.length; i++) {
      expect(newer(RELEASES[i - 1]!.version, RELEASES[i]!.version), `${RELEASES[i - 1]!.version} before ${RELEASES[i]!.version}`).toBe(true);
      expect(RELEASES[i - 1]!.date >= RELEASES[i]!.date).toBe(true);
    }
  });

  test("dates match their labels, and no text has a build number or an em dash", () => {
    for (const r of RELEASES) {
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const label = new Date(`${r.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
      expect(r.label).toBe(label);
      const text = [r.name, r.intro, ...r.groups.flatMap((g) => [g.title, ...g.items])].join("\n");
      expect(text).not.toMatch(/\bbuild \d+|\(\d+\)|—/i);
      expect(r.groups.length).toBeGreaterThan(0);
    }
  });
});
