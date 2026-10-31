// Bridge revision 14: the note page's own sidebar drawn natively. What `note.tools` is built from (the note's
// blocks, its comment threads) and the editor commands the native sidebar sends (block.jump, task.toggle,
// thread.open, find, find.clear).
import { describe, expect, it } from "vitest";
import type { WireBlock } from "@folevi/editor-schema";
import { runEditorCommand, type NativeNoteOptions } from "@/lib/engine/editorCommands";
import { attachmentsOf, linksOf, outlineOf, tasksOf, threadOf } from "@/lib/engine/noteTools";
import { BridgeError } from "@/lib/engine/validate";

const block = (id: string, type: string, text: string, props: Record<string, unknown> = {}, marks?: unknown[]): WireBlock =>
  ({ id, type, props, text: text ? [{ type: "text", text, ...(marks ? { marks } : {}) }] : [] }) as unknown as WireBlock;

const blocks = [
  block("h1", "heading", "Temples", { level: 1 }),
  block("p1", "paragraph", "Temples to see"),
  block("h2", "heading", "", { level: 2 }),
  block("pg", "page", "", { documentId: "doc_2", titleCache: "Where to eat" }),
  block("t1", "todo", "Book the moss garden", { checked: false }),
  block("t2", "todo", "", { checked: true }),
  block("i1", "image", "", { caption: "Saiho-ji" }),
  block("f1", "file", "", { name: "map.pdf" }),
  block("b1", "bookmark", "", { url: "https://www.example.com/a", title: "" }),
  block("l1", "paragraph", "the market", {}, [{ type: "link", href: "https://nishiki.jp" }]),
];

describe("note.tools", () => {
  it("lists headings and nested pages in order", () => {
    expect(outlineOf(blocks)).toEqual([
      { kind: "heading", id: "h1", text: "Temples", level: 1, documentId: null },
      { kind: "heading", id: "h2", text: "", level: 2, documentId: null },
      { kind: "page", id: "pg", text: "Where to eat", level: 0, documentId: "doc_2" },
    ]);
  });

  it("lists tasks, attachments and links as the page sidebar does", () => {
    expect(tasksOf(blocks)).toEqual([
      { id: "t1", text: "Book the moss garden", checked: false },
      { id: "t2", text: "Untitled task", checked: true },
    ]);
    expect(attachmentsOf(blocks)).toEqual([
      { id: "i1", kind: "image", name: "Saiho-ji", uploading: false },
      { id: "f1", kind: "file", name: "map.pdf", uploading: true },
    ]);
    expect(linksOf(blocks)).toEqual([
      { key: "b1-bm", blockId: "b1", label: "example.com", href: "https://www.example.com/a", internal: false },
      { key: "l1-0", blockId: "l1", label: "the market", href: "https://nishiki.jp", internal: false },
    ]);
  });

  it("summarises a thread: its first comment, replies, and where it is", () => {
    const t = {
      id: "thr_1",
      blockId: "p1",
      blockExists: true,
      blockText: "Temples to see",
      status: "open",
      resolvedBy: null,
      unread: true,
      lastActivityAt: 5,
      comments: [
        { id: "c1", createdAt: 1, authorName: "Mira", authorAvatarUrl: null, deleted: false, body: [{ type: "text", text: "Ask " }, { type: "mention", label: "Sam" }] },
        { id: "c2", createdAt: 2, authorName: "Sam", authorAvatarUrl: null, deleted: false, body: [{ type: "text", text: "Done" }] },
      ],
      canResolve: true,
      canDelete: false,
    };
    expect(threadOf(t as never)).toEqual({ id: "thr_1", blockId: "p1", anchor: "“Temples to see”", author: "Mira", avatarUrl: null, text: "Ask @Sam", deleted: false, replies: 1, status: "open", resolvedBy: null, unread: true, lastActivityAt: 5, waiting: null,
      comments: [
        { id: "c1", author: "Mira", avatarUrl: null, text: "Ask @Sam", deleted: false, createdAt: 1 },
        { id: "c2", author: "Sam", avatarUrl: null, text: "Done", deleted: false, createdAt: 2 },
      ],
      canResolve: true,
      canDelete: false,
    });
    expect(threadOf({ ...t, blockExists: false } as never)).toMatchObject({ blockId: null, anchor: "On a deleted block" });
  });
});

/** A doc of text blocks, enough for find and task.toggle. */
function fakeEditor(texts: { id: string; text: string; checked?: boolean }[], log: string[]) {
  const nodes = texts.map((t) => ({ isTextblock: true, attrs: { id: t.id, ...(t.checked !== undefined ? { checked: t.checked } : {}) }, content: { size: t.text.length }, textBetween: () => t.text }));
  return {
    isDestroyed: false,
    state: {
      doc: {
        descendants: (fn: (n: unknown, pos: number) => boolean | void) => {
          let pos = 0;
          for (const n of nodes) {
            fn(n, pos);
            pos += n.content.size + 2;
          }
        },
      },
      tr: { setNodeMarkup: (pos: number, _t: unknown, attrs: { checked: boolean }) => ({ pos, attrs }) },
    },
    view: { dispatch: (tr: { pos: number; attrs: { checked: boolean } }) => log.push(`set:${tr.pos}:${tr.attrs.checked}`), domAtPos: () => { throw new Error("no DOM"); } },
  };
}

function options(over: Partial<NativeNoteOptions> = {}): NativeNoteOptions & { log: string[] } {
  const log: string[] = [];
  return { log, documentId: "doc_1", editor: null, readOnly: false, title: "Kyoto", ready: true, panel: null, openPanel: () => undefined, closePanel: () => undefined, menu: {}, scrollEl: null, ...over };
}

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof BridgeError ? e.code : "other";
  }
  return null;
};

describe("the native sidebar's editor commands", () => {
  it("block.jump goes to the block", () => {
    const o = options();
    o.editor = fakeEditor([], o.log) as never;
    o.jump = (id) => o.log.push(`jump:${id}`);
    expect(runEditorCommand(o, "block.jump", { blockId: "h2" })).toEqual({ ok: true });
    expect(o.log).toEqual(["jump:h2"]);
    expect(code(() => runEditorCommand(options(), "block.jump", { blockId: "h2" }))).toBe("no_note");
    expect(code(() => runEditorCommand(o, "block.jump", { blockId: "not an id" }))).toBe("invalid_args");
  });

  it("task.toggle checks a to-do, and refuses what isn't one", () => {
    const o = options();
    o.editor = fakeEditor([{ id: "p1", text: "Hello" }, { id: "t1", text: "Book", checked: false }], o.log) as never;
    expect(runEditorCommand(o, "task.toggle", { blockId: "t1" })).toEqual({ ok: true });
    expect(o.log).toEqual(["set:7:true"]);
    expect(code(() => runEditorCommand(o, "task.toggle", { blockId: "p1" }))).toBe("invalid_args");
    expect(code(() => runEditorCommand({ ...o, readOnly: true }, "task.toggle", { blockId: "t1" }))).toBe("read_only");
  });

  it("thread.open opens a known thread", () => {
    const o = options({ openThread: (id) => id === "thr_1" });
    expect(runEditorCommand(o, "thread.open", { threadId: "thr_1" })).toEqual({ ok: true });
    expect(code(() => runEditorCommand(o, "thread.open", { threadId: "thr_9" }))).toBe("invalid_args");
    expect(code(() => runEditorCommand(options(), "thread.open", { threadId: "thr_1" }))).toBe("unavailable");
  });

  it("find counts matches, wraps the index, and snippets them", () => {
    const o = options();
    o.editor = fakeEditor([{ id: "p1", text: "Temples to see, the moss garden" }, { id: "p2", text: "near the market" }], o.log) as never;
    expect(runEditorCommand(o, "find", { query: "THE" })).toEqual({
      query: "THE",
      count: 2,
      current: 0,
      truncated: false,
      matches: [
        { before: "Temples to see, ", hit: "the", after: " moss garden" },
        { before: "near ", hit: "the", after: " market" },
      ],
    });
    expect(runEditorCommand(o, "find", { query: "the", index: -1 })).toMatchObject({ current: 1 });
    expect(runEditorCommand(o, "find", { query: "the", index: 2 })).toMatchObject({ current: 0 });
    expect(runEditorCommand(o, "find", { query: "zebra" })).toEqual({ query: "zebra", count: 0, current: -1, truncated: false, matches: [] });
    expect(runEditorCommand(o, "find", { query: "" })).toMatchObject({ count: 0 });
    expect(runEditorCommand(o, "find.clear", {})).toEqual({ ok: true });
    expect(code(() => runEditorCommand(options(), "find", { query: "the" }))).toBe("no_note");
  });
});
