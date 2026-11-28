// Home's blocks (lib/app/homeLayout.ts): one person's order and hidden blocks laid over the default, and Up next.
import { describe, expect, test } from "vitest";
import { arrangeHome, greetingFor, homeRows, moveHomeBlock, setHomeBlockHidden, upNext, upNextTag } from "@/lib/app/homeLayout";

const ids = (saved: Parameters<typeof arrangeHome>[0]) => arrangeHome(saved).map((r) => (r.hidden ? `(${r.block.id})` : r.block.id));

describe("Home layout", () => {
  test("no saved layout: the default order, the optional blocks off until added", () => {
    expect(ids(null)).toEqual(["recent", "bookmarks", "folders", "stats", "dna", "today", "tasks", "(shared)", "(pinned)", "(templates)"]);
  });

  test("a saved order is kept; unknown ids (the earlier designs' too) go; missing blocks take their default place", () => {
    expect(ids({ order: ["folders", "nope", "tasks", "folders", "scratch", "summary"], hidden: ["bookmarks"] })).toEqual(["recent", "(bookmarks)", "folders", "stats", "dna", "today", "tasks", "(shared)", "(pinned)", "(templates)"]);
  });

  test("moving a block skips hidden ones", () => {
    const moved = moveHomeBlock({ order: [], hidden: ["today"] }, "tasks", -1);
    // Today is hidden, so My tasks steps over it and lands before Foli DNA.
    expect(moved.order.indexOf("tasks")).toBeLessThan(moved.order.indexOf("today"));
    expect(moved.hidden).toEqual(expect.arrayContaining(["today", "shared", "pinned", "templates"]));
    expect(moveHomeBlock(null, "recent", -1).order[0]).toBe("recent");
  });

  test("hiding, and adding a block back puts it last", () => {
    const hidden = setHomeBlockHidden(null, "tasks", true);
    expect(hidden.hidden).toEqual(expect.arrayContaining(["tasks", "shared"]));
    const added = setHomeBlockHidden(null, "pinned", false);
    expect(ids(added).at(-1)).toBe("pinned");
  });

  test("two-column rows: At a glance beside Foli DNA, Today beside My tasks", () => {
    const rows = (saved: Parameters<typeof arrangeHome>[0]) =>
      homeRows(arrangeHome(saved).filter((r) => !r.hidden)).map((row) => (row.kind === "one" ? row.item.block.id : `${row.main.map((r) => r.block.id).join("+")} | ${row.side.map((r) => r.block.id).join("+")}`));
    expect(rows(null)).toEqual(["recent", "bookmarks", "folders", "stats | dna", "today | tasks"]);
    // Recent folders moved between the two rows: each pair keeps its row.
    expect(rows({ order: ["recent", "bookmarks", "stats", "dna", "folders", "today", "tasks"], hidden: [] })).toEqual(["recent", "bookmarks", "stats | dna", "folders", "today | tasks"]);
    // Foli DNA taken off Home: At a glance and Today stack on the left, My tasks on the right.
    expect(rows(setHomeBlockHidden(null, "dna", true))).toEqual(["recent", "bookmarks", "folders", "stats+today | tasks"]);
  });

  test("the Today card's Up next tag", () => {
    const now = new Date(2026, 10, 28, 9, 35).getTime();
    const at = (h: number, m = 0) => new Date(2026, 10, 28, h, m).getTime();
    expect(upNextTag({ at: at(10) }, now)).toBe("Up next · in 25 min");
    expect(upNextTag({ at: at(11, 45) }, now)).toBe("Up next · in 2 h 10 min");
    expect(upNextTag({ at: at(9), end: at(10) }, now)).toBe("Now");
    expect(upNextTag({ at: null }, now)).toBeNull();
  });

  test("greeting by the hour", () => {
    expect([3, 9, 14, 20].map(greetingFor)).toEqual(["Good evening", "Good morning", "Good afternoon", "Good evening"]);
  });
});

describe("Up next", () => {
  const day = new Date(2026, 10, 28, 9, 30).getTime();
  const at = (h: number, m = 0) => new Date(2026, 10, 28, h, m).getTime();
  const time = (ms: number) => new Date(ms).toTimeString().slice(0, 5);
  test("today's events still to come and tasks due, overdue first, then in time order", () => {
    const items = upNext(
      [
        { id: "a", title: "Stand-up", start: at(8), end: at(9), allDay: false, location: "", calendarName: "Work" },
        { id: "b", title: "Garden coordinators", start: at(10), end: at(10, 45), allDay: false, location: "Video call", calendarName: "Work" },
        { id: "c", title: "Lunch with Mira", start: at(13, 30), end: at(14, 30), allDay: false, location: "", calendarName: "Personal" },
      ],
      [
        { blockId: "1", title: "Send plot map draft", dueDate: "2026-11-28", dueTime: "12:00", documentTitle: "Project Atlas Brief" },
        { blockId: "2", title: "Confirm ferry", dueDate: "2026-11-28" },
        { blockId: "3", title: "Old thing", dueDate: "2026-11-20" },
        { blockId: "4", title: "Later", dueDate: "2026-11-30" },
      ],
      "2026-11-28",
      day,
      time,
    );
    expect(items.map((i) => `${i.time} ${i.title}`)).toEqual(["Overdue Old thing", "10:00 Garden coordinators", "12:00 Send plot map draft", "13:30 Lunch with Mira", "Today Confirm ferry"]);
    expect(items.find((i) => i.title === "Send plot map draft")?.meta).toBe("Task · Project Atlas Brief");
  });
});
