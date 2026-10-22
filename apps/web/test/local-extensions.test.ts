// The iOS app's widgets, Shortcuts and Spotlight in local mode: what the page hands the app
// (components/app/LocalExtensions.tsx), in the REST API's shapes the app already reads.
import { describe, expect, it } from "vitest";
import { dayAfter, spotlightItems, widgetNote, widgetTasks } from "@/components/app/LocalExtensions";

const task = (over: Partial<Parameters<typeof widgetTasks>[0][number]> = {}) => ({
  blockId: "01JAAAAAAAAAAAAAAAAAAAAAAA",
  documentId: "01JBBBBBBBBBBBBBBBBBBBBBBB",
  documentTitle: "Inbox",
  title: "Call Sam",
  status: "open",
  dueDate: "2026-10-22",
  dueTime: null,
  priority: "none",
  ...over,
});

describe("local mode's widgets, Shortcuts and Spotlight", () => {
  it("counts days across months and years", () => {
    expect(dayAfter("2026-10-22")).toBe("2026-10-23");
    expect(dayAfter("2026-10-31")).toBe("2026-11-01");
    expect(dayAfter("2026-12-31")).toBe("2027-01-01");
    expect(dayAfter("2028-02-28")).toBe("2028-02-29");
  });

  it("gives the widgets open tasks due by tomorrow, as the REST API does", () => {
    const out = widgetTasks(
      [
        task(),
        task({ blockId: "b", dueDate: "2026-10-23", priority: "high", dueTime: "09:30" }),
        task({ blockId: "c", dueDate: "2026-10-24" }),
        task({ blockId: "d", dueDate: null }),
        task({ blockId: "e", status: "done" }),
        task({ blockId: "f", dueDate: "2026-10-01", documentTitle: "", title: "" }),
      ],
      "2026-10-23",
    );
    expect(out.map((t) => t.id)).toEqual(["01JAAAAAAAAAAAAAAAAAAAAAAA", "b", "f"]);
    expect(out[0]).toEqual({ id: "01JAAAAAAAAAAAAAAAAAAAAAAA", text: "Call Sam", status: "open", dueDate: "2026-10-22", dueTime: null, priority: null, note: { id: "01JBBBBBBBBBBBBBBBBBBBBBBB", title: "Inbox" } });
    expect(out[1]).toMatchObject({ priority: "high", dueTime: "09:30" });
    expect(out[2]).toMatchObject({ text: "Task", note: { title: "Untitled" } });
  });

  it("names a note's place by its folder, else the library", () => {
    expect(widgetNote({ id: "n", title: "", updatedAt: Date.UTC(2026, 9, 22), homeFolder: null })).toEqual({ id: "n", title: "Untitled", place: { id: null, name: "Notes" }, updatedAt: "2026-10-22T00:00:00.000Z" });
    expect(widgetNote({ id: "n", title: "Plan", updatedAt: 0, homeFolder: { name: "Work" } }).place.name).toBe("Work");
  });

  it("puts each recent and starred note in Spotlight once, starred ones marked", () => {
    const items = spotlightItems(
      [
        { id: "a", title: "A", excerpt: "x".repeat(400), updatedAt: 2 },
        { id: "b", title: "B", updatedAt: 1, starred: true },
      ],
      [
        { id: "a", title: "A", updatedAt: 2, starred: true },
        { id: "c", title: "C", updatedAt: 0, starred: true, homeFolder: { name: "Ideas" } },
      ],
    );
    expect(items.map((i) => [i.id, i.starred, i.location])).toEqual([
      ["a", true, "Notes"],
      ["b", true, "Notes"],
      ["c", true, "Ideas"],
    ]);
    expect(items.find((i) => i.id === "a")?.excerpt).toHaveLength(300);
    expect(items.find((i) => i.id === "c")?.excerpt).toBe("");
  });
});
