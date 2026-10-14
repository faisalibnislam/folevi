// The calendar week view's layout: weeks from Monday, times on the hour grid, drops snapped to 30
// minutes, and overlapping items sharing a day's width.
import { describe, expect, test } from "vitest";
import { HOUR_PX, layoutOverlaps, minutesToPx, minutesToTime, monthGrid, shiftMonth, slotAt, startOfWeek, timeToMinutes, visibleDays, weekdayIndex } from "@/components/views/calendarLayout";
import { rowsByDate } from "@/components/views/collectionView";

describe("weeks", () => {
  test("start on Monday", () => {
    expect(weekdayIndex("2026-10-12")).toBe(0); // a Monday
    expect(weekdayIndex("2026-10-18")).toBe(6); // a Sunday
    expect(startOfWeek("2026-10-14")).toBe("2026-10-12");
    expect(startOfWeek("2026-10-18")).toBe("2026-10-12");
    expect(startOfWeek("2026-11-01")).toBe("2026-10-26");
  });

  test("seven days from Monday, or three from the anchor on narrow screens", () => {
    expect(visibleDays("2026-10-14", 7)).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]);
    expect(visibleDays("2026-12-31", 3)).toEqual(["2026-12-31", "2027-01-01", "2027-01-02"]);
  });
});

describe("month grid", () => {
  test("six weeks from the Monday on or before the 1st", () => {
    const days = monthGrid("2026-10");
    expect(days).toHaveLength(42);
    expect(days[0]).toBe("2026-09-28");
    expect(days[3]).toBe("2026-10-01");
    expect(days[41]).toBe("2026-11-08");
    expect(monthGrid("2026-06")[0]).toBe("2026-06-01"); // the 1st is a Monday
  });

  test("moves by months across years", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-10", 0)).toBe("2026-10");
  });

  test("collection rows by a date property, with the undated ones apart", () => {
    const rows = [
      { title: "A", values: { d: "2026-10-14" } },
      { title: "B", values: {} },
      { title: "C", values: { d: "2026-10-14" } },
      { title: "D", values: { d: "soon" } },
      { title: "E", values: { d: "2026-10-15" } },
    ];
    const { byDate, undated } = rowsByDate(rows, "d");
    expect(byDate.get("2026-10-14")!.map((r) => r.title)).toEqual(["A", "C"]);
    expect(byDate.get("2026-10-15")!.map((r) => r.title)).toEqual(["E"]);
    expect(undated.map((r) => r.title)).toEqual(["B", "D"]);
  });
});

describe("time to row", () => {
  test("reads and writes HH:MM", () => {
    expect(timeToMinutes("09:30")).toBe(570);
    expect(timeToMinutes("00:00")).toBe(0);
    expect(timeToMinutes("23:59")).toBe(1439);
    expect(timeToMinutes("24:00")).toBeNull();
    expect(timeToMinutes("9am")).toBeNull();
    expect(timeToMinutes(null)).toBeNull();
    expect(minutesToTime(570)).toBe("09:30");
    expect(minutesToTime(0)).toBe("00:00");
    expect(minutesToTime(5000)).toBe("23:59");
  });

  test("places a time on the grid and snaps a drop to the 30-minute slot it lands in", () => {
    expect(minutesToPx(90)).toBe(1.5 * HOUR_PX);
    expect(slotAt(0)).toBe(0);
    expect(slotAt(17 * HOUR_PX + 5)).toBe(17 * 60);
    expect(slotAt(17 * HOUR_PX + HOUR_PX / 2 + 1)).toBe(17 * 60 + 30);
    expect(slotAt(17 * HOUR_PX + HOUR_PX / 2 - 1)).toBe(17 * 60);
    expect(slotAt(-20)).toBe(0);
    expect(slotAt(30 * HOUR_PX)).toBe(23 * 60 + 30);
  });
});

describe("overlap columns", () => {
  const span = (id: string, start: string, end: string) => ({ id, start: timeToMinutes(start)!, end: timeToMinutes(end)! });
  const byId = (items: ReturnType<typeof layoutOverlaps>) => Object.fromEntries(items.map((p) => [p.id, { col: p.col, cols: p.cols }]));

  test("items on their own take the full width", () => {
    expect(byId(layoutOverlaps([span("a", "09:00", "09:30"), span("b", "11:00", "11:30")]))).toEqual({ a: { col: 0, cols: 1 }, b: { col: 0, cols: 1 } });
  });

  test("items that only touch don't overlap", () => {
    expect(byId(layoutOverlaps([span("a", "09:00", "09:30"), span("b", "09:30", "10:00")]))).toEqual({ a: { col: 0, cols: 1 }, b: { col: 0, cols: 1 } });
  });

  test("two at the same time split the width", () => {
    expect(byId(layoutOverlaps([span("a", "09:00", "09:30"), span("b", "09:00", "09:30")]))).toEqual({ a: { col: 0, cols: 2 }, b: { col: 1, cols: 2 } });
  });

  test("a chain of overlaps shares one set of columns, reusing a column once it's free", () => {
    const out = byId(layoutOverlaps([span("long", "09:00", "11:00"), span("x", "09:15", "09:45"), span("y", "10:00", "10:30"), span("later", "12:00", "12:30")]));
    expect(out.long).toEqual({ col: 0, cols: 2 });
    expect(out.x).toEqual({ col: 1, cols: 2 });
    expect(out.y).toEqual({ col: 1, cols: 2 });
    expect(out.later).toEqual({ col: 0, cols: 1 });
  });

  test("three at once need three columns, whatever order they come in", () => {
    const out = layoutOverlaps([span("c", "09:20", "09:50"), span("a", "09:00", "09:30"), span("b", "09:10", "09:40")]);
    expect(out.map((p) => p.cols)).toEqual([3, 3, 3]);
    expect(new Set(out.map((p) => p.col))).toEqual(new Set([0, 1, 2]));
  });
});
