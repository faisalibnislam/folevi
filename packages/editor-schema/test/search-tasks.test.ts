import { describe, expect, it } from "vitest";
import { addDays, highlightRanges, localDate, normalizeForSearch, projectTask, searchSnippet, taskViews, documentSearchText, sanitizeHref, normalizeInline, wordCount } from "../src";

describe("search normalization", () => {
  it("folds case and diacritics", () => {
    expect(normalizeForSearch("  Crème  BRÛLÉE ")).toBe("creme brulee");
  });
  it("highlights terms in original text positions", () => {
    const text = "Café au lait at the café";
    expect(highlightRanges(text, "cafe").map((r) => text.slice(r.start, r.end))).toEqual(["Café", "café"]);
    expect(searchSnippet("a".repeat(200) + " needle " + "b".repeat(200), "needle", 10)).toBe("…aaaaaaaaa needle bbbbbbbbb…");
  });
  it("bounds document search text", () => {
    const blocks = Array.from({ length: 100 }, () => ({ type: "paragraph", text: [{ type: "text" as const, text: "x".repeat(1000) }], props: {} }));
    expect(documentSearchText("T", blocks, 5000).length).toBeLessThanOrEqual(5000);
  });
});

describe("tasks", () => {
  const block = (props: Record<string, unknown>) => ({ id: "t", type: "todo", parentId: null, rank: "V", schemaVersion: 1, text: [{ type: "text" as const, text: "Call" }], props });
  it("projects todo blocks and ignores others", () => {
    expect(projectTask({ ...block({ checked: false }), type: "paragraph" }, "d")).toBeNull();
    expect(projectTask(block({ checked: true, completedAt: 5 }), "d")).toMatchObject({ status: "done", completedAt: 5, allDay: true, title: "Call" });
    expect(projectTask(block({ checked: false, dueDate: "2026-09-25", dueTime: "08:00" }), "d")).toMatchObject({ allDay: false, dueTime: "08:00" });
  });
  it("buckets into views", () => {
    const today = "2026-09-25";
    expect(taskViews({ status: "open", dueDate: null, assigneeId: null }, today, "me")).toEqual(["all", "inbox"]);
    expect(taskViews({ status: "open", dueDate: "2026-09-20", assigneeId: "me" }, today, "me")).toEqual(["all", "today", "mine"]);
    expect(taskViews({ status: "open", dueDate: "2026-09-26", assigneeId: "you" }, today, "me")).toEqual(["all", "upcoming"]);
    expect(taskViews({ status: "done", dueDate: null, assigneeId: null }, today, "me")).toEqual(["completed"]);
  });
  it("computes local dates across time zones", () => {
    const t = Date.UTC(2026, 8, 25, 23, 30);
    expect(localDate(t, "UTC")).toBe("2026-09-25");
    expect(localDate(t, "Asia/Tokyo")).toBe("2026-09-26");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("rich text helpers", () => {
  it("sanitizes hrefs", () => {
    expect(sanitizeHref("javascript:alert(1)")).toBeNull();
    expect(sanitizeHref("java\tscript:alert(1)")).toBeNull();
    expect(sanitizeHref("JAVASCRIPT:alert(1)")).toBeNull();
    expect(sanitizeHref("data:text/html,x")).toBeNull();
    expect(sanitizeHref("//evil.example")).toBeNull();
    expect(sanitizeHref("example.com")).toBe("https://example.com");
    expect(sanitizeHref("mailto:a@example.com")).toBe("mailto:a@example.com");
    expect(sanitizeHref("/d/123")).toBe("/d/123");
  });
  it("normalizes inline runs", () => {
    expect(
      normalizeInline([
        { type: "text", text: "a", marks: [{ type: "italic" }, { type: "bold" }] },
        { type: "text", text: "b", marks: [{ type: "bold" }, { type: "italic" }] },
        { type: "text", text: "" },
        { type: "text", text: "c" },
      ]),
    ).toEqual([
      { type: "text", text: "ab", marks: [{ type: "bold" }, { type: "italic" }] },
      { type: "text", text: "c" },
    ]);
  });
  it("counts words", () => {
    expect(wordCount("It's a quiet-morning, isn’t it? 42")).toBe(6);
  });
});
