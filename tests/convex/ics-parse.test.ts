// Reading iCalendar for calendar subscriptions (convex/lib/icsParse.ts): folding, escapes, dates and
// zones, and repeats (weekly days, EXDATE, overrides, COUNT, UNTIL, monthly, and what falls back).
import { describe, expect, test } from "vitest";
import { parseDuration, parseIcs, parseLine, resolveZone, unescapeText, unfold } from "../../convex/lib/icsParse";

const utc = (s: string) => Date.parse(s);
const WINDOW = { from: utc("2026-01-01T00:00:00Z"), to: utc("2027-01-01T00:00:00Z") };

function cal(...events: string[][]): string {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Test//EN", ...events.flatMap((e) => ["BEGIN:VEVENT", ...e, "END:VEVENT"]), "END:VCALENDAR", ""].join("\r\n");
}

const iso = (ms: number) => new Date(ms).toISOString();

describe("content lines", () => {
  test("unfolds continuation lines (space or tab), with CRLF or LF", () => {
    expect(unfold("SUMMARY:Long\r\n  title\r\n\t continues\r\nUID:1\r\n")).toEqual(["SUMMARY:Long title continues", "UID:1"]);
    expect(unfold("A:1\n B\nC:2")).toEqual(["A:1B", "C:2"]);
  });

  test("reads parameters, quoted values with colons and semicolons included", () => {
    expect(parseLine('DTSTART;TZID="America/New_York";VALUE=DATE-TIME:20261014T090000')).toEqual({ name: "DTSTART", params: { TZID: "America/New_York", VALUE: "DATE-TIME" }, value: "20261014T090000" });
    expect(parseLine('ATTENDEE;CN="Doe; Jane: PhD":mailto:jane@example.com')).toEqual({ name: "ATTENDEE", params: { CN: "Doe; Jane: PhD" }, value: "mailto:jane@example.com" });
    expect(parseLine("no colon here")).toBeNull();
  });

  test("undoes text escapes", () => {
    expect(unescapeText("Line one\\nLine two\\, with comma\\; and \\\\ backslash\\N")).toBe("Line one\nLine two, with comma; and \\ backslash\n");
  });

  test("durations", () => {
    expect(parseDuration("PT1H30M")).toBe(90 * 60_000);
    expect(parseDuration("P1D")).toBe(86_400_000);
    expect(parseDuration("P2W")).toBe(14 * 86_400_000);
    expect(parseDuration("-PT15M")).toBe(-15 * 60_000);
    expect(parseDuration("P")).toBeNull();
    expect(parseDuration("soon")).toBeNull();
  });

  test("zones: IANA, Windows names, prefixed ids, and the fallback", () => {
    expect(resolveZone("Europe/Paris", "UTC")).toBe("Europe/Paris");
    expect(resolveZone("Pacific Standard Time", "UTC")).toBe("America/Los_Angeles");
    expect(resolveZone("/mozilla.org/20050126_1/Europe/Berlin", "UTC")).toBe("Europe/Berlin");
    expect(resolveZone("Nowhere/Special", "Asia/Tokyo")).toBe("Asia/Tokyo");
    expect(resolveZone(undefined, "UTC")).toBe("UTC");
  });
});

describe("events", () => {
  test("an all-day event over two days", () => {
    const { events } = parseIcs(cal(["UID:a", "DTSTART;VALUE=DATE:20261020", "DTEND;VALUE=DATE:20261022", "SUMMARY:Offsite"]), WINDOW);
    expect(events).toEqual([{ key: "a#2026-10-20", uid: "a", start: utc("2026-10-20T00:00:00Z"), end: utc("2026-10-22T00:00:00Z"), allDay: true, title: "Offsite", location: "", description: "" }]);
  });

  test("an all-day event without an end lasts the day", () => {
    const [e] = parseIcs(cal(["UID:b", "DTSTART;VALUE=DATE:20261020", "SUMMARY:Holiday"]), WINDOW).events;
    expect(e!.end - e!.start).toBe(86_400_000);
  });

  test("timed with a TZID, in UTC, floating, and with a DURATION", () => {
    const { events } = parseIcs(
      [
        "BEGIN:VCALENDAR",
        "X-WR-TIMEZONE:Asia/Tokyo",
        "BEGIN:VEVENT",
        "UID:ny",
        "DTSTART;TZID=America/New_York:20261014T090000",
        "DTEND;TZID=America/New_York:20261014T103000",
        "SUMMARY:New York",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:z",
        "DTSTART:20261015T120000Z",
        "DURATION:PT45M",
        "SUMMARY:UTC",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:float",
        "DTSTART:20261016T090000",
        "SUMMARY:Floating",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:win",
        "DTSTART;TZID=W. Europe Standard Time:20261017T090000",
        "DTEND;TZID=W. Europe Standard Time:20261017T100000",
        "SUMMARY:Windows zone",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
      WINDOW,
    );
    const by = Object.fromEntries(events.map((e) => [e.uid, e]));
    expect(iso(by.ny!.start)).toBe("2026-10-14T13:00:00.000Z");
    expect(iso(by.ny!.end)).toBe("2026-10-14T14:30:00.000Z");
    expect(by.ny!.allDay).toBe(false);
    expect(iso(by.z!.start)).toBe("2026-10-15T12:00:00.000Z");
    expect(by.z!.end - by.z!.start).toBe(45 * 60_000);
    // Floating time: the calendar's own zone (X-WR-TIMEZONE).
    expect(iso(by.float!.start)).toBe("2026-10-16T00:00:00.000Z");
    expect(by.float!.end).toBe(by.float!.start);
    expect(iso(by.win!.start)).toBe("2026-10-17T07:00:00.000Z");
  });

  test("folded, escaped text stays plain text (markup is never interpreted)", () => {
    const { events } = parseIcs(
      ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:t", "DTSTART:20261014T090000Z", "SUMMARY:Planning\\, round two", "LOCATION:Room 4\\; east wing", "DESCRIPTION:Agenda:\\n1. Budget <b>draft</b>\\n2. Hiring <a href=\"javascript:alert(1)\">li", " nk</a> \\\\ done", "END:VEVENT", "END:VCALENDAR"].join("\r\n"),
      WINDOW,
    );
    expect(events[0]).toMatchObject({ title: "Planning, round two", location: "Room 4; east wing", description: 'Agenda:\n1. Budget <b>draft</b>\n2. Hiring <a href="javascript:alert(1)">link</a> \\ done' });
  });

  test("cancelled events, events without a start, and garbage are left out without throwing", () => {
    expect(parseIcs(cal(["UID:c", "DTSTART:20261014T090000Z", "STATUS:CANCELLED"], ["UID:d", "SUMMARY:No start"], ["UID:e", "DTSTART:2026-10-14"]), WINDOW).events).toEqual([]);
    expect(parseIcs("<html>not a calendar</html>", WINDOW)).toEqual({ events: [], name: null, truncated: false });
    expect(parseIcs("", WINDOW).events).toEqual([]);
  });

  test("the window: only instances overlapping it, and at most maxEvents", () => {
    const ics = cal(["UID:old", "DTSTART:20251201T090000Z", "SUMMARY:Old"], ["UID:in", "DTSTART:20260601T090000Z", "SUMMARY:In"], ["UID:spans", "DTSTART;VALUE=DATE:20251231", "DTEND;VALUE=DATE:20260103", "SUMMARY:Spans"]);
    expect(parseIcs(ics, WINDOW).events.map((e) => e.uid)).toEqual(["spans", "in"]);
    const daily = cal(["UID:daily", "DTSTART:20260101T090000Z", "RRULE:FREQ=DAILY", "SUMMARY:Daily"]);
    const capped = parseIcs(daily, { ...WINDOW, maxEvents: 10 });
    expect(capped.events).toHaveLength(10);
    expect(capped.truncated).toBe(true);
  });

  test("the calendar's own name", () => {
    expect(parseIcs("BEGIN:VCALENDAR\r\nX-WR-CALNAME:Team holidays\r\nEND:VCALENDAR\r\n", WINDOW).name).toBe("Team holidays");
  });
});

describe("repeats", () => {
  test("weekly on Monday and Wednesday, with an EXDATE, a moved instance and a cancelled one", () => {
    const ics = cal(
      ["UID:standup", "DTSTART;TZID=Europe/London:20261005T093000", "DTEND;TZID=Europe/London:20261005T094500", "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=8", "EXDATE;TZID=Europe/London:20261007T093000", "SUMMARY:Standup"],
      ["UID:standup", "RECURRENCE-ID;TZID=Europe/London:20261012T093000", "DTSTART;TZID=Europe/London:20261012T110000", "DTEND;TZID=Europe/London:20261012T111500", "SUMMARY:Standup (moved)"],
      ["UID:standup", "RECURRENCE-ID;TZID=Europe/London:20261019T093000", "DTSTART;TZID=Europe/London:20261019T093000", "STATUS:CANCELLED", "SUMMARY:Standup"],
    );
    const events = parseIcs(ics, WINDOW).events;
    // COUNT=8 from Mon 5 Oct: 5, 7, 12, 14, 19, 21, 26, 28 October. 7th excluded, 12th moved, 19th cancelled.
    expect(events.map((e) => [iso(e.start), e.title])).toEqual([
      ["2026-10-05T08:30:00.000Z", "Standup"],
      ["2026-10-12T10:00:00.000Z", "Standup (moved)"],
      ["2026-10-14T08:30:00.000Z", "Standup"],
      ["2026-10-21T08:30:00.000Z", "Standup"],
      // British Summer Time ends on 25 October: still 9:30 in London.
      ["2026-10-26T09:30:00.000Z", "Standup"],
      ["2026-10-28T09:30:00.000Z", "Standup"],
    ]);
    expect(events.every((e) => e.end - e.start === 15 * 60_000)).toBe(true);
    expect(new Set(events.map((e) => e.key)).size).toBe(events.length);
  });

  test("every other week, until a date", () => {
    const events = parseIcs(cal(["UID:fort", "DTSTART;VALUE=DATE:20261001", "RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=20261112", "SUMMARY:Payday"]), WINDOW).events;
    expect(events.map((e) => iso(e.start).slice(0, 10))).toEqual(["2026-10-01", "2026-10-15", "2026-10-29", "2026-11-12"]);
  });

  test("daily with COUNT, and UNTIL as a UTC time", () => {
    expect(parseIcs(cal(["UID:d", "DTSTART:20261014T080000Z", "RRULE:FREQ=DAILY;COUNT=3"]), WINDOW).events.map((e) => iso(e.start))).toEqual([
      "2026-10-14T08:00:00.000Z",
      "2026-10-15T08:00:00.000Z",
      "2026-10-16T08:00:00.000Z",
    ]);
    expect(parseIcs(cal(["UID:u", "DTSTART:20261014T080000Z", "RRULE:FREQ=DAILY;UNTIL=20261016T080000Z"]), WINDOW).events).toHaveLength(3);
    expect(parseIcs(cal(["UID:u", "DTSTART:20261014T080000Z", "RRULE:FREQ=DAILY;UNTIL=20261016T075959Z"]), WINDOW).events).toHaveLength(2);
  });

  test("monthly on a day (short months skipped), on the nth weekday, and yearly", () => {
    const thirty = parseIcs(cal(["UID:m", "DTSTART;VALUE=DATE:20260131", "RRULE:FREQ=MONTHLY;COUNT=4"]), WINDOW).events;
    // COUNT counts the instances that exist: February, April and June have no 31st.
    expect(thirty.map((e) => iso(e.start).slice(0, 10))).toEqual(["2026-01-31", "2026-03-31", "2026-05-31", "2026-07-31"]);
    const second = parseIcs(cal(["UID:t", "DTSTART:20261013T170000Z", "RRULE:FREQ=MONTHLY;BYDAY=2TU;COUNT=3"]), WINDOW).events;
    expect(second.map((e) => iso(e.start).slice(0, 10))).toEqual(["2026-10-13", "2026-11-10", "2026-12-08"]);
    const last = parseIcs(cal(["UID:l", "DTSTART:20261030T170000Z", "RRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=3"]), WINDOW).events;
    expect(last.map((e) => iso(e.start).slice(0, 10))).toEqual(["2026-10-30", "2026-11-27", "2026-12-25"]);
    const birthday = parseIcs(cal(["UID:y", "DTSTART;VALUE=DATE:20200315", "RRULE:FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=15"]), WINDOW).events;
    expect(birthday.map((e) => iso(e.start).slice(0, 10))).toEqual(["2026-03-15"]);
  });

  test("a daily repeat from years ago still reaches the window", () => {
    const events = parseIcs(cal(["UID:old", "DTSTART:19950101T120000Z", "RRULE:FREQ=DAILY", "SUMMARY:Daily since 1995"]), { from: utc("2026-10-14T00:00:00Z"), to: utc("2026-10-17T00:00:00Z") }).events;
    expect(events.map((e) => iso(e.start))).toEqual(["2026-10-14T12:00:00.000Z", "2026-10-15T12:00:00.000Z", "2026-10-16T12:00:00.000Z"]);
  });

  test("a rule it can't expand shows its first instance only", () => {
    const events = parseIcs(cal(["UID:s", "DTSTART:20261001T090000Z", "RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1", "SUMMARY:Last workday"]), WINDOW).events;
    expect(events.map((e) => iso(e.start))).toEqual(["2026-10-01T09:00:00.000Z"]);
    expect(parseIcs(cal(["UID:h", "DTSTART:20261001T090000Z", "RRULE:FREQ=HOURLY"]), WINDOW).events).toHaveLength(1);
  });
});
