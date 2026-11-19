// @vitest-environment jsdom
// Keeping a note's undo history when the note is left (components/editor/historyKeep.ts), for a note with a
// large drawing changed many times (the 2026-11-19 canvas audit, V20): a history too large to keep is given
// up on the way back, before any of it is redone and written out. This runs every time a note is left.
import { beforeEach, describe, expect, test, vi } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";

const redone = vi.fn();
vi.mock("@tiptap/pm/history", async (original) => {
  const actual = await original<typeof import("@tiptap/pm/history")>();
  return {
    ...actual,
    redo: (...args: Parameters<typeof actual.redo>) => {
      redone();
      return actual.redo(...args);
    },
  };
});

const { ALL_MARKS, ALL_NODES } = await import("@/components/editor/extensions");
const { BlockIdentity } = await import("@/components/editor/plugins");
const { NoteHistory } = await import("@/components/editor/noteHistory");
const { setBlockAttrs } = await import("@/components/editor/canvas/leaveFlush");
const { forgetNoteHistories, keepNoteHistory, restoreNoteHistory } = await import("@/components/editor/historyKeep");

const p = (id: string, text: string): JSONContent => ({ type: "paragraph", attrs: { id, depth: 0 }, content: text ? [{ type: "text", text }] : [] });
const board = (id: string, data: string): JSONContent => ({ type: "whiteboard", attrs: { id, depth: 0, data, height: 240 } });
const make = (content: JSONContent[]) => new Editor({ extensions: [...ALL_NODES, ...ALL_MARKS, NoteHistory.configure({ newGroupDelay: 600 }), BlockIdentity], content: { type: "doc", content } });

describe("a history too large to keep", () => {
  beforeEach(() => {
    forgetNoteHistories();
    redone.mockClear();
  });

  test("is given up before it is redone and written out", () => {
    const e = make([p("a", "one"), board("w", "d0")]);
    // Thirty changes to a 180,000 character drawing: 5.4 MB of steps, over the 4 MB that is kept.
    for (let i = 0; i < 30; i++) setBlockAttrs(e, false, "w", { data: `${i}:${"x".repeat(180_000)}` }, "step");
    keepNoteHistory("me:note", e.state);
    expect(redone).not.toHaveBeenCalled();
    const content = e.getJSON().content!;
    e.destroy();
    const next = make(content);
    expect(restoreNoteHistory("me:note", next)).toBe(false);
    next.destroy();
  });

  test("one that fits is kept as before, drawing steps included", () => {
    const e = make([p("a", "one"), board("w", "d0")]);
    e.commands.insertContentAt(4, "!");
    for (let i = 0; i < 3; i++) setBlockAttrs(e, false, "w", { data: `${i}:${"x".repeat(180_000)}` }, "step");
    keepNoteHistory("me:note", e.state);
    expect(redone).toHaveBeenCalledTimes(4);
    const content = e.getJSON().content!;
    e.destroy();
    const next = make(content);
    expect(restoreNoteHistory("me:note", next)).toBe(true);
    next.commands.undo();
    next.commands.undo();
    next.commands.undo();
    let data = "";
    next.state.doc.forEach((n) => {
      if (n.attrs.id === "w") data = String(n.attrs.data);
    });
    expect(data).toBe("d0");
    next.destroy();
  });
});
