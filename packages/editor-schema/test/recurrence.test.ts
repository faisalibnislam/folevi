import { describe, expect, it } from "vitest";
import { describeRepeat, nextOccurrence, parseRepeatPhrase, repeatProps, repeatRule, stepOccurrence } from "../src/recurrence";

// 2026-10-14 is a Wednesday.
describe("next occurrence", () => {
  it("steps by days, weekdays, weeks, months and years", () => {
    expect(stepOccurrence({ repeat: "daily" }, "2026-10-14")).toBe("2026-10-15");
    expect(stepOccurrence({ repeat: "daily", every: 3 }, "2026-10-14")).toBe("2026-10-17");
    expect(stepOccurrence({ repeat: "weekdays" }, "2026-10-16")).toBe("2026-10-19"); // Friday → Monday
    expect(stepOccurrence({ repeat: "weekly" }, "2026-10-14")).toBe("2026-10-21");
    expect(stepOccurrence({ repeat: "weekly", every: 2 }, "2026-10-14")).toBe("2026-10-28");
    expect(stepOccurrence({ repeat: "monthly" }, "2026-10-14")).toBe("2026-11-14");
    expect(stepOccurrence({ repeat: "yearly" }, "2026-10-14")).toBe("2027-10-14");
  });

  it("weekly on chosen days: the next listed day, then the first one a week (or N weeks) on", () => {
    const monThu = { repeat: "weekly" as const, days: [1, 4] };
    expect(stepOccurrence(monThu, "2026-10-14")).toBe("2026-10-15"); // Wed → Thu
    expect(stepOccurrence(monThu, "2026-10-15")).toBe("2026-10-19"); // Thu → Mon
    expect(stepOccurrence({ ...monThu, every: 2 }, "2026-10-15")).toBe("2026-10-26"); // Thu → Mon after next
  });

  it("the 31st stays the last day in shorter months, and comes back to the 31st", () => {
    const rule = { repeat: "monthly" as const };
    expect(nextOccurrence(rule, "2026-01-31", "2026-01-31")).toBe("2026-02-28");
    expect(stepOccurrence(rule, "2026-02-28", 31)).toBe("2026-03-31");
  });

  it("a late check-off skips dates already gone; no due date counts from today", () => {
    expect(nextOccurrence({ repeat: "daily" }, "2026-10-01", "2026-10-14")).toBe("2026-10-15");
    expect(nextOccurrence({ repeat: "weekly" }, "2026-09-30", "2026-10-14")).toBe("2026-10-21");
    expect(nextOccurrence({ repeat: "monthly" }, null, "2026-10-14")).toBe("2026-11-14");
    // Checked off early: the next one after the due date, not after today.
    expect(nextOccurrence({ repeat: "weekly" }, "2026-10-20", "2026-10-14")).toBe("2026-10-27");
  });
});

describe("rules in props", () => {
  it("reads and writes the three props, ignoring nonsense", () => {
    expect(repeatRule({ repeat: "weekly", repeatEvery: 2, repeatDays: "4,1,9" })).toEqual({ repeat: "weekly", every: 2, days: [1, 4] });
    expect(repeatRule({ repeat: "hourly" })).toBeNull();
    expect(repeatRule({})).toBeNull();
    expect(repeatProps({ repeat: "weekly", days: [1, 4] })).toEqual({ repeat: "weekly", repeatEvery: null, repeatDays: "1,4" });
    expect(repeatProps(null)).toEqual({ repeat: null, repeatEvery: null, repeatDays: null });
  });

  it("describes them", () => {
    expect(describeRepeat({ repeat: "daily" })).toBe("Every day");
    expect(describeRepeat({ repeat: "weekly", days: [1, 4] })).toBe("Every Monday and Thursday");
    expect(describeRepeat({ repeat: "weekly", every: 2, days: [5] })).toBe("Every 2 weeks on Friday");
    expect(describeRepeat({ repeat: "monthly", every: 3 })).toBe("Every 3 months");
  });
});

describe("repeat phrases", () => {
  it("reads common ways of saying it", () => {
    expect(parseRepeatPhrase("water plants every monday")).toMatchObject({ rule: { repeat: "weekly", days: [1] }, rest: "water plants" });
    expect(parseRepeatPhrase("gym every mon, wed and fri")).toMatchObject({ rule: { repeat: "weekly", days: [1, 3, 5] }, rest: "gym" });
    expect(parseRepeatPhrase("standup every weekday 9am")).toMatchObject({ rule: { repeat: "weekdays" }, rest: "standup 9am" });
    expect(parseRepeatPhrase("pay rent every month")).toMatchObject({ rule: { repeat: "monthly" }, rest: "pay rent" });
    expect(parseRepeatPhrase("review every 2 weeks")).toMatchObject({ rule: { repeat: "weekly", every: 2 } });
    expect(parseRepeatPhrase("clean every other day")).toMatchObject({ rule: { repeat: "daily", every: 2 } });
    expect(parseRepeatPhrase("backup daily")).toMatchObject({ rule: { repeat: "daily" }, rest: "backup" });
  });

  it("leaves text without a repeat alone", () => {
    expect(parseRepeatPhrase("call Sam tomorrow")).toBeNull();
    expect(parseRepeatPhrase("every person counts")).toBeNull();
  });
});
