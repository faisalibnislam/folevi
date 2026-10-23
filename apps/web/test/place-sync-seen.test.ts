// What the Mac app's runners have shown already (components/places/PlaceSync.tsx readSeen / writeSeen): each runner
// starts where the last one left off, never more than a day back, and never shows a notification twice.
import { beforeEach, describe, expect, it } from "vitest";
import { readSeen, writeSeen } from "@/components/places/PlaceSync";

describe("place sync: what was shown", () => {
  beforeEach(() => localStorage.clear());

  it("starts now when nothing was kept, or without an account", () => {
    expect(readSeen("u1", 1_000_000)).toEqual({ since: 1_000_000, told: [] });
    expect(readSeen(null, 5)).toEqual({ since: 5, told: [] });
  });

  it("starts where the last runner left off", () => {
    const now = 1_800_000_000_000;
    writeSeen("u1", { since: now - 60_000, told: ["n1", "n2"] });
    expect(readSeen("u1", now)).toEqual({ since: now - 60_000, told: ["n1", "n2"] });
    // Another account's is its own.
    expect(readSeen("u2", now).told).toEqual([]);
  });

  it("never reaches back more than a day, nor into the future", () => {
    const now = 1_800_000_000_000;
    writeSeen("u1", { since: now - 3 * 86_400_000, told: [] });
    expect(readSeen("u1", now).since).toBe(now - 86_400_000);
    writeSeen("u1", { since: now + 60_000, told: [] });
    expect(readSeen("u1", now).since).toBe(now);
  });

  it("keeps the last hundred ids and ignores anything malformed", () => {
    writeSeen("u1", { since: 1, told: Array.from({ length: 150 }, (_, i) => `n${i}`) });
    const told = readSeen("u1", 2).told;
    expect(told).toHaveLength(100);
    expect(told[0]).toBe("n50");
    localStorage.setItem("folevi:place-sync:seen:u1", "{not json");
    expect(readSeen("u1", 7)).toEqual({ since: 7, told: [] });
    localStorage.setItem("folevi:place-sync:seen:u1", JSON.stringify({ since: "x", told: [1, "a"] }));
    expect(readSeen("u1", 7)).toEqual({ since: 7, told: ["a"] });
  });
});
