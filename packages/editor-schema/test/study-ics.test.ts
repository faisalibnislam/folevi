import { describe, expect, it } from "vitest";
import { NEW_PER_DAY, SCHEMA_VERSION, buildCalendar, cardText, intervals, newPerDay, nextSchedule, parseIcs, studyCardBlocks, studyKindOf, zonedToUtc, type InlineNode, type WireBlock } from "../src";
import { escapeText, foldLine } from "../src/ics";
import { parseDuration, unfold } from "../src/icsParse";

const text = (t: string): InlineNode[] => [{ type: "text", text: t }];
const block = (id: string, type: string, parentId: string | null, rank: string, t = "", props: Record<string, unknown> = {}): WireBlock => ({ id, type, parentId, rank, schemaVersion: SCHEMA_VERSION, text: text(t), props });

describe("study cards", () => {
  it("knows a live marked toggle", () => {
    expect(studyKindOf({ type: "toggle", props: { study: "card" } })).toBe("card");
    expect(studyKindOf({ type: "toggle", props: { study: "quiz" } })).toBe("quiz");
    expect(studyKindOf({ type: "toggle", props: { study: "card" }, deletedAt: 1 })).toBeNull();
    expect(studyKindOf({ type: "paragraph", props: { study: "card" } })).toBeNull();
    expect(studyKindOf({ type: "toggle", props: {} })).toBeNull();
  });

  it("reads the question from the toggle and the answer from inside it, in order", () => {
    const blocks = [
      block("q", "toggle", null, "a0", "What is FSRS?", { collapsed: true, study: "card" }),
      block("a2", "paragraph", "q", "a2", "Second"),
      block("a1", "paragraph", "q", "a1", "First"),
      block("n", "bulleted", "a1", "a0", "Nested"),
      block("e", "paragraph", "q", "a3", "  "),
      block("other", "paragraph", null, "a1", "Not in the card"),
    ];
    const card = studyCardBlocks(blocks, "q")!;
    expect(card.map((b) => b.id)).toEqual(["q", "a1", "n", "a2", "e"]);
    expect(cardText(card)).toEqual({ front: "What is FSRS?", back: "First\nNested\nSecond" });
    expect(studyCardBlocks(blocks, "missing")).toBeNull();
  });

  it("uses the person's pick of new cards a day, or the default", () => {
    expect(newPerDay({})).toBe(NEW_PER_DAY);
    expect(newPerDay({ studyNewPerDay: 50 })).toBe(50);
    expect(newPerDay({ studyNewPerDay: 7 })).toBe(NEW_PER_DAY);
  });

  it("schedules without fuzz, from the time it's given", () => {
    const now = Date.UTC(2026, 9, 20, 9);
    const first = nextSchedule(null, "good", now);
    expect(first).toEqual(nextSchedule(null, "good", now));
    expect(first.reps).toBe(1);
    expect(first.lastReview).toBe(now);
    const shown = intervals(null, now);
    expect(shown.again).toBeLessThan(shown.hard);
    expect(shown.good).toBe(first.due - now);
    const later = nextSchedule(first, "easy", first.due);
    expect(later.reps).toBe(2);
    expect(later.due).toBeGreaterThan(first.due);
  });
});

describe("iCalendar", () => {
  it("writes a feed the reader reads back", () => {
    const now = Date.UTC(2026, 9, 20, 8);
    const feed = buildCalendar(
      [
        { uid: "t1@folevi", title: "Book ferry, early", dueDate: "2026-10-22", url: "https://app.folevi.com/d/x", note: "Trip", updatedAt: now },
        { uid: "t2@folevi", title: "Call", dueDate: "2026-10-23", dueTime: "15:30", url: "https://app.folevi.com/d/y", note: "Work", updatedAt: now },
      ],
      { name: "Folevi tasks", timeZone: "Europe/London", now },
    );
    expect(feed).toContain("DTSTAMP:20261020T080000Z");
    const read = parseIcs(feed, { from: Date.UTC(2026, 9, 1), to: Date.UTC(2026, 10, 1) });
    expect(read.name).toBe("Folevi tasks");
    expect(read.events.map((e) => [e.title, e.allDay, e.start])).toEqual([
      ["Book ferry, early", true, Date.UTC(2026, 9, 22)],
      ["Call", false, zonedToUtc("2026-10-23", "15:30", "Europe/London")],
    ]);
    expect(read.events[1]!.end - read.events[1]!.start).toBe(30 * 60_000);
  });

  it("escapes, folds and unfolds lines", () => {
    expect(escapeText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
    const long = `SUMMARY:${"x".repeat(100)}`;
    expect(unfold(foldLine(long))).toEqual([long]);
    expect(parseDuration("PT1H30M")).toBe(90 * 60_000);
  });
});
