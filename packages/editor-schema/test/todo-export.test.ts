import { describe, expect, test } from "vitest";
import { blocksToHtml, blocksToMarkdown, projectTask, readableDueDate, type WireBlock } from "../src";

const todo = (id: string, props: Record<string, unknown>, text = ""): WireBlock => ({ id, type: "todo", parentId: null, rank: id, schemaVersion: 1, text: text ? [{ type: "text", text }] : [], props });

describe("to-dos in the HTML export (QA F17)", () => {
  const blocks = [
    todo("a", { checked: false, dueDate: "2026-11-06" }, "Send the deck"),
    todo("b", { checked: false }, "Undated"),
    todo("c", { checked: true, dueDate: "2026-11-02", dueTime: "15:00" }, "Call Lina"),
  ];

  test("dated, undated and completed to-dos keep their box and a readable due date", () => {
    const html = blocksToHtml(blocks, { title: "Maple" });
    expect(html).toContain('<li><input type="checkbox" disabled> Send the deck <time class="due" datetime="2026-11-06">Due Nov 6, 2026</time>');
    expect(html).toContain('<li><input type="checkbox" disabled> Undated\n</li>');
    expect(html).toContain('<li class="done"><input type="checkbox" disabled checked> Call Lina <time class="due" datetime="2026-11-02T15:00">Due Nov 2, 2026, 15:00</time>');
  });

  test("the HTML matches the Markdown export's dates", () => {
    const md = blocksToMarkdown(blocks);
    expect(md).toContain("- [ ] Send the deck (due 2026-11-06)");
    expect(md).toContain("- [x] Call Lina (due 2026-11-02 15:00)");
  });

  test("readable dates", () => {
    expect(readableDueDate("2026-01-31")).toBe("Jan 31, 2026");
    expect(readableDueDate("2026-12-01", "08:30")).toBe("Dec 1, 2026, 08:30");
    expect(readableDueDate("2026-13-01")).toBeNull();
    expect(readableDueDate("tomorrow")).toBeNull();
    expect(readableDueDate(undefined)).toBeNull();
  });

  test("a malformed date is left out, not printed as is", () => {
    const html = blocksToHtml([todo("x", { checked: false, dueDate: '"><script>' }, "Odd")], { title: "T" });
    expect(html).toContain('<li><input type="checkbox" disabled> Odd\n</li>');
    expect(html).not.toContain("<script>");
  });
});

describe("empty to-dos are not tasks (QA F06)", () => {
  test("a box with no words is no task, whatever else it has", () => {
    expect(projectTask(todo("e", { checked: false }), "d")).toBeNull();
    expect(projectTask(todo("e", { checked: false }, "   "), "d")).toBeNull();
    expect(projectTask(todo("e", { checked: false, dueDate: "2026-11-06" }, "  \n"), "d")).toBeNull();
  });

  test("typing a title makes it one", () => {
    expect(projectTask(todo("e", { checked: false }, "Follow up with Sam"), "d")).toMatchObject({ blockId: "e", documentId: "d", title: "Follow up with Sam", status: "open" });
  });

  test("a mention or a date alone is words", () => {
    const block: WireBlock = { ...todo("m", { checked: false }), text: [{ type: "mention", profileId: "p1", label: "Sam" } as never] };
    expect(projectTask(block, "d")?.title).toBe("@Sam");
  });
});
