import { describe, expect, it } from "vitest";
import { naturalDateLabel, parseNaturalDate } from "../src/lib/nlDate";

// Wednesday 14 October 2026, 10:00 local time.
const NOW = new Date(2026, 9, 14, 10, 0, 0);

describe("parseNaturalDate", () => {
  it("reads a day and a time and leaves the task", () => {
    const p = parseNaturalDate("call Sam tomorrow 3pm", NOW);
    expect(p).toMatchObject({ date: "2026-10-15", time: "15:00", rest: "call Sam" });
  });

  it("drops the word that leads into the date", () => {
    expect(parseNaturalDate("Submit report by Friday", NOW)).toMatchObject({ date: "2026-10-16", rest: "Submit report" });
    expect(parseNaturalDate("Lunch with Ines at 1pm", NOW)).toMatchObject({ date: "2026-10-14", time: "13:00", rest: "Lunch with Ines" });
  });

  it("never picks a weekday in the past", () => {
    // Monday has gone this week: next Monday.
    expect(parseNaturalDate("plan sprint monday", NOW)?.date).toBe("2026-10-19");
  });

  it("moves a time that has already passed to tomorrow", () => {
    expect(parseNaturalDate("stand-up 9am", NOW)).toMatchObject({ date: "2026-10-15", time: "09:00" });
  });

  it("reads explicit dates", () => {
    expect(parseNaturalDate("dentist on 12 Nov at 9:30", NOW)).toMatchObject({ date: "2026-11-12", time: "09:30", rest: "dentist" });
    expect(parseNaturalDate("renew passport 2027-01-05", NOW)?.date).toBe("2027-01-05");
  });

  it("ignores things that only look like dates", () => {
    expect(parseNaturalDate("Ask May about the deck", NOW)).toBeNull();
    expect(parseNaturalDate("buy 3 apples", NOW)).toBeNull();
    expect(parseNaturalDate("do it now", NOW)).toBeNull();
    expect(parseNaturalDate("", NOW)).toBeNull();
  });
});

describe("naturalDateLabel", () => {
  it("names near days and adds the time", () => {
    expect(naturalDateLabel({ date: "2026-10-15", time: "15:00" }, "2026-10-14")).toBe("Tomorrow, 15:00");
    expect(naturalDateLabel({ date: "2026-10-14" }, "2026-10-14")).toBe("Today");
  });
});
