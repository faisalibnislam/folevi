import { describe, expect, it } from "vitest";
import { parseRoute } from "@/lib/app/router";
import {
  clampColumn,
  COLUMN_MAX,
  COLUMN_MIN,
  columnsHref,
  columnsListOf,
  dateGroup,
  groupNotes,
  isColumnsList,
  lastNoteKey,
  listFromSearch,
  listPath,
  noteAfterLeaving,
  pickNote,
  rememberNote,
  stepNote,
} from "@/lib/app/noteColumns";

// Saturday 28 November 2026, 15:00 local time.
const NOW = new Date(2026, 10, 28, 15, 0).getTime();
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).getTime();

describe("columns layout: the address", () => {
  it("names every note list by its own path, and only those", () => {
    expect(["/notes", "/drafts", "/unsorted", "/starred", "/archive", "/trash", "/folders/abc", "/tags/t1"].map((p) => isColumnsList(parseRoute(p)))).toEqual(Array(8).fill(true));
    expect(["/documents", "/templates", "/folders", "/tags", "/d/x", "/settings", "/tasks"].map((p) => isColumnsList(parseRoute(p)))).toEqual(Array(7).fill(false));
    expect(listPath({ name: "unsorted" })).toBe("/drafts");
    expect(listPath({ name: "folder", id: "a b" })).toBe("/folders/a%20b");
  });

  it("round-trips a note in a list through its address", () => {
    const href = columnsHref("n1", "/folders/abc");
    expect(href).toBe("/d/n1?list=%2Ffolders%2Fabc");
    const url = new URL(href, "http://x");
    const col = columnsListOf(parseRoute(url.pathname), url.searchParams);
    expect(col).toEqual({ path: "/folders/abc", route: { name: "folder", id: "abc" }, noteId: "n1" });
    expect(columnsHref("n1", "/drafts", { fresh: true })).toBe("/d/n1?new=1&list=%2Fdrafts");
  });

  it("reads a list's own page as the list with no note", () => {
    expect(columnsListOf(parseRoute("/trash"), "")).toEqual({ path: "/trash", route: { name: "trash" }, noteId: null });
    // Drafts' old address keeps working, and is written the new way.
    expect(columnsListOf(parseRoute("/unsorted"), "")?.path).toBe("/drafts");
  });

  it("ignores a list= that is not a note list, or points off the app", () => {
    expect(listFromSearch("list=%2Fsettings")).toBeNull();
    expect(listFromSearch("list=%2Ftemplates")).toBeNull();
    expect(listFromSearch("list=https%3A%2F%2Fevil.example%2Ffolders%2Fx")).toBeNull();
    expect(listFromSearch("list=%2F%2Fevil.example%2Ffolders%2Fx")).toBeNull();
    expect(listFromSearch("")).toBeNull();
    // A plain note is the note page, not a column.
    expect(columnsListOf(parseRoute("/d/n1"), "")).toBeNull();
    // Other pages never are, whatever their query says.
    expect(columnsListOf(parseRoute("/settings"), "list=%2Fnotes")).toBeNull();
  });
});

describe("columns layout: date groups", () => {
  it("puts times in Today, Yesterday, Previous 7 days, Previous 30 days, then months", () => {
    expect(dateGroup(at(2026, 10, 28, 9), NOW).label).toBe("Today");
    expect(dateGroup(at(2026, 10, 28, 23), NOW).label).toBe("Today"); // later today (another device's clock)
    expect(dateGroup(at(2026, 10, 27, 23), NOW).label).toBe("Yesterday");
    expect(dateGroup(at(2026, 10, 26), NOW).label).toBe("Previous 7 days");
    expect(dateGroup(at(2026, 10, 22), NOW).label).toBe("Previous 7 days");
    expect(dateGroup(at(2026, 10, 21), NOW).label).toBe("Previous 30 days");
    expect(dateGroup(at(2026, 9, 30), NOW).label).toBe("Previous 30 days");
    const october = dateGroup(at(2026, 9, 20), NOW);
    expect(october.key).toBe("m:2026-9");
    expect(october.label).toMatch(/October/);
    expect(october.label).not.toMatch(/2026/);
    expect(dateGroup(at(2025, 11, 31), NOW).label).toMatch(/December.*2025|2025.*December/);
  });

  const notes = [
    { id: "a", updatedAt: at(2026, 10, 28, 10) },
    { id: "b", updatedAt: at(2026, 10, 28, 8), starred: true },
    { id: "c", updatedAt: at(2026, 10, 27) },
    { id: "d", updatedAt: at(2026, 10, 25) },
    { id: "e", updatedAt: at(2026, 9, 2) },
    { id: "f", updatedAt: at(2026, 8, 30), starred: true },
    { id: "g", updatedAt: at(2026, 8, 3) },
  ];

  it("leads with the list's bookmarked notes under Pinned, then the rest by date, in the list's order", () => {
    const groups = groupNotes(notes, { now: NOW, sort: "updated", pinned: true });
    expect(groups.map((g) => [g.key, g.notes.map((n) => n.id).join("")])).toEqual([
      ["pinned", "bf"],
      ["today", "a"],
      ["yesterday", "c"],
      ["week", "d"],
      ["m:2026-9", "e"],
      ["m:2026-8", "g"],
    ]);
  });

  it("has no Pinned group on Bookmarks itself", () => {
    const groups = groupNotes(notes, { now: NOW, sort: "updated", pinned: false });
    expect(groups[0]!.key).toBe("today");
    expect(groups.flatMap((g) => g.notes).length).toBe(notes.length);
  });

  it("groups by the creation time when sorted by it, and by the time a row shows when asked (Trash)", () => {
    const made = [{ id: "x", updatedAt: NOW, createdAt: at(2026, 9, 1) }];
    expect(groupNotes(made, { now: NOW, sort: "created", pinned: true })[0]!.key).toBe("m:2026-9");
    const trashed = [{ id: "y", updatedAt: at(2026, 9, 1), deletedAt: NOW }];
    expect(groupNotes(trashed, { now: NOW, sort: "updated", pinned: true, dateOf: (n) => n.deletedAt ?? n.updatedAt })[0]!.key).toBe("today");
  });

  it("has no date groups when sorted by title or by hand", () => {
    expect(groupNotes(notes, { now: NOW, sort: "title", pinned: true }).map((g) => [g.label, g.notes.length])).toEqual([
      ["Pinned", 2],
      ["Notes", 5],
    ]);
    const plain = groupNotes(notes.filter((n) => !n.starred), { now: NOW, sort: "manual", pinned: true });
    expect(plain).toEqual([{ key: "notes", label: "", notes: notes.filter((n) => !n.starred) }]);
    expect(groupNotes([], { now: NOW, sort: "updated", pinned: true })).toEqual([]);
  });
});

describe("columns layout: which note a list opens on", () => {
  const list = [
    { id: "a", updatedAt: 3 },
    { id: "b", updatedAt: 9 },
    { id: "c", updatedAt: 5 },
  ];

  it("opens on the note it had last while it's still there, else the most recently edited", () => {
    expect(pickNote(list, "c")?.id).toBe("c");
    expect(pickNote(list, "gone")?.id).toBe("b");
    expect(pickNote(list, undefined)?.id).toBe("b");
    expect(pickNote([], "a")).toBeNull();
  });

  it("remembers one note per list and place, keeping the newest 200 lists", () => {
    const k = lastNoteKey("personal", "/folders/abc");
    expect(k).toBe("personal|/folders/abc");
    let last = rememberNote({}, k, "n1");
    expect(last).toEqual({ [k]: "n1" });
    expect(rememberNote(last, k, "n1")).toBe(last);
    last = rememberNote(last, lastNoteKey("ws1", "/folders/abc"), "n2");
    expect(last[k]).toBe("n1");
    for (let i = 0; i < 250; i++) last = rememberNote(last, `s|/tags/${i}`, `n${i}`);
    expect(Object.keys(last)).toHaveLength(200);
    expect(last["s|/tags/249"]).toBe("n249");
    expect(last[k]).toBeUndefined();
    // Remembering a list again moves it to the newest.
    last = rememberNote(last, "s|/tags/60", "again");
    expect(Object.keys(last).at(-1)).toBe("s|/tags/60");
  });

  it("opens the note that took the open one's place when it leaves the list", () => {
    expect(noteAfterLeaving(["a", "b", "c"], ["a", "c"], "b")).toBe("c");
    expect(noteAfterLeaving(["a", "b", "c"], ["a", "b"], "c")).toBe("b");
    expect(noteAfterLeaving(["a", "b", "c"], ["a"], "b")).toBe("a");
    expect(noteAfterLeaving(["a"], [], "a")).toBeNull();
    expect(noteAfterLeaving(["a", "b"], ["z"], "b")).toBe("z");
  });

  it("steps through the rows with the arrow keys and stops at either end", () => {
    const order = ["a", "b", "c"];
    expect(stepNote(order, "a", 1)).toBe("b");
    expect(stepNote(order, "c", 1)).toBeNull();
    expect(stepNote(order, "a", -1)).toBeNull();
    expect(stepNote(order, null, 1)).toBe("a");
    expect(stepNote(order, "gone", -1)).toBe("c");
    expect(stepNote([], "a", 1)).toBeNull();
  });

  it("keeps the column between its narrowest and widest", () => {
    expect(clampColumn(10)).toBe(COLUMN_MIN);
    expect(clampColumn(10_000)).toBe(COLUMN_MAX);
    expect(clampColumn(301.4)).toBe(301);
  });
});
