// Blocks in a note (docs/EDITOR_AUDIT_2026-11-12.md, section 6): where a dragged block may land, find and
// replace in every kind of text, jumping to a block, inserting a block at the caret, measuring during a
// drag, and code left as typed.
import { afterEach, describe, expect, test, vi } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import { NodeSelection } from "@tiptap/pm/state";
import { ALL_MARKS, ALL_NODES } from "@/components/editor/extensions";
import { BlockIdentity, BlockKeymap, MarkdownShortcuts } from "@/components/editor/plugins";
import { dropTarget, insertBlockAfterCurrent, moveSubtreeTo } from "@/components/editor/commands";
import { FindReplace, findMatches, findState, focusBlockById, replaceAll, replaceCurrent, setFind } from "@/components/editor/findReplace";
import { beginPointerDrag } from "@/components/editor/blockDrag";

const line = (type: string, id: string, text: string, depth = 0, attrs: Record<string, unknown> = {}): JSONContent => ({ type, attrs: { id, depth, ...attrs }, content: text ? [{ type: "text", text }] : [] });
const p = (id: string, text: string, depth = 0) => line("paragraph", id, text, depth);
const make = (content: JSONContent[]) => new Editor({ extensions: [...ALL_NODES, ...ALL_MARKS, UndoRedo, BlockIdentity, BlockKeymap, MarkdownShortcuts, FindReplace], content: { type: "doc", content } });
const texts = (e: Editor) => {
  const out: string[] = [];
  e.state.doc.forEach((n) => out.push(`${n.type.name}:${n.textContent}@${n.attrs.depth}`));
  return out;
};
const cell = (text: string) => (text ? [{ type: "text", text }] : []);

describe("dropping a block", () => {
  // A parent (0) with two children (1), then a line at the page's edge.
  const boxes = [
    { top: 0, bottom: 20, depth: 0 },
    { top: 20, bottom: 40, depth: 1 },
    { top: 40, bottom: 60, depth: 1 },
    { top: 60, bottom: 80, depth: 0 },
  ];

  test("between a parent and its first child, the shallowest place is beside the child", () => {
    expect(dropTarget(boxes, 22, 0, null)).toMatchObject({ index: 1, depth: 1 });
    expect(dropTarget(boxes, 22, 5, null)).toMatchObject({ index: 1, depth: 1 });
  });

  test("between two children it stays among them or goes deeper, never out past them", () => {
    expect(dropTarget(boxes, 42, 0, null)).toMatchObject({ index: 2, depth: 1 });
    expect(dropTarget(boxes, 42, 2, null)).toMatchObject({ index: 2, depth: 2 });
  });

  test("after the last child every level is open: out, beside the child, or under it", () => {
    expect(dropTarget(boxes, 62, 0, null)).toMatchObject({ index: 3, depth: 0 });
    expect(dropTarget(boxes, 62, 1, null)).toMatchObject({ index: 3, depth: 1 });
    expect(dropTarget(boxes, 62, 2, null)).toMatchObject({ index: 3, depth: 2 });
  });

  test("the dragged blocks themselves don't count as what is below", () => {
    // The first child is being dragged: just under the parent, the block below is the second child.
    expect(dropTarget(boxes, 22, 0, { from: 1, count: 1 })).toMatchObject({ index: 2, depth: 1 });
    // The parent with both children: at the top, what is below is the last line.
    expect(dropTarget(boxes, 2, 3, { from: 0, count: 3 })).toMatchObject({ index: 3, depth: 0 });
  });

  test("a block moved between a parent and its child becomes a child: the children keep their parent", () => {
    const e = make([p("a", "parent"), p("b", "child", 1), p("c", "other"), p("d", "dragged")]);
    e.view.dispatch(moveSubtreeTo(e.state, 3, 1, 0)!.tr);
    expect(texts(e)).toEqual(["paragraph:parent@0", "paragraph:dragged@1", "paragraph:child@1", "paragraph:other@0"]);
    e.destroy();
  });

  test("dragged left in place, a block with a line after it at its own level stays at that level", () => {
    const e = make([p("a", "parent"), p("b", "one", 1), p("c", "two", 1)]);
    expect(moveSubtreeTo(e.state, 1, 1, 0)).toBeNull();
    // The last one can come out: nothing follows it.
    e.view.dispatch(moveSubtreeTo(e.state, 2, 2, 0)!.tr);
    expect(texts(e)).toEqual(["paragraph:parent@0", "paragraph:one@1", "paragraph:two@0"]);
    e.destroy();
  });
});

describe("find and replace", () => {
  test("Replace all replaces every match, past the first thousand", () => {
    const e = make(Array.from({ length: 30 }, (_v, i) => p(`p${i}`, "cat ".repeat(50).trim())));
    setFind(e, { query: "cat" }, false);
    expect(findState(e).matches).toHaveLength(1000);
    expect(replaceAll(e, "dog")).toBe(1500);
    expect(e.state.doc.textContent.includes("cat")).toBe(false);
    expect(e.state.doc.textContent.match(/dog/g)).toHaveLength(1500);
    // One undo step.
    e.commands.undo();
    expect(e.state.doc.textContent.includes("dog")).toBe(false);
    e.destroy();
  });

  const withFields = () =>
    make([
      p("a", "A cat here"),
      { type: "image", attrs: { id: "img", depth: 0, url: "https://example.com/a.png", alt: "", caption: "The cat, a Cat" } },
      { type: "table", attrs: { id: "tbl", depth: 0, headerRow: true, rows: [[cell("Animal"), cell("cat")], [cell("concatenate"), cell("")]] } },
      p("z", "end"),
    ]);

  test("matches in an image's caption and in a table's cells are counted, in order", () => {
    const e = withFields();
    setFind(e, { query: "cat" }, false);
    const matches = findState(e).matches;
    expect(matches.map((m) => m.inside?.field ?? "text")).toEqual(["text", "caption", "caption", "cell", "cell"]);
    // A match in a block's fields stands for the whole block.
    expect(e.state.doc.nodeAt(matches[1]!.from)?.type.name).toBe("image");
    expect(e.state.doc.nodeAt(matches[3]!.from)?.type.name).toBe("table");
    setFind(e, { caseSensitive: true }, false);
    expect(findState(e).matches).toHaveLength(4);
    e.destroy();
  });

  test("the block holding the current match is marked", () => {
    const e = withFields();
    setFind(e, { query: "cat", index: 1 }, false);
    const marked = e.view.dom.querySelectorAll(".fb-find-block");
    expect(marked).toHaveLength(2);
    expect(e.view.dom.querySelectorAll(".fb-find-block.fb-find-current")).toHaveLength(1);
    e.destroy();
  });

  test("replacing one, then all, changes captions and cells too", () => {
    const e = withFields();
    setFind(e, { query: "cat", index: 1 }, false);
    expect(replaceCurrent(e, "dog")).toBe(true);
    expect(e.state.doc.child(1).attrs.caption).toBe("The dog, a Cat");
    expect(replaceAll(e, "dog")).toBe(4);
    expect(e.state.doc.child(0).textContent).toBe("A dog here");
    expect(e.state.doc.child(1).attrs.caption).toBe("The dog, a dog");
    const rows = e.state.doc.child(2).attrs.rows as { text: string }[][][];
    expect(rows[0]![1]![0]!.text).toBe("dog");
    expect(rows[1]![0]![0]!.text).toBe("condogenate");
    expect(findState(e).matches).toHaveLength(0);
    e.commands.undo();
    expect(e.state.doc.child(1).attrs.caption).toBe("The dog, a Cat");
    e.destroy();
  });

  test("a cell emptied by a replacement holds no empty run of text", () => {
    const e = withFields();
    setFind(e, { query: "cat", caseSensitive: true }, false);
    replaceAll(e, "");
    const rows = e.state.doc.child(2).attrs.rows as unknown[][][];
    expect(rows[0]![1]).toEqual([]);
    e.destroy();
  });

  test("matches follow an edit of a caption, and agree with a full search", () => {
    const e = withFields();
    setFind(e, { query: "cat" }, false);
    const img = e.state.doc.child(1);
    e.view.dispatch(e.state.tr.setNodeMarkup(e.state.doc.child(0).nodeSize, undefined, { ...img.attrs, caption: "no match now" }));
    expect(findState(e).matches).toEqual(findMatches(e.state.doc, "cat", false));
    expect(findState(e).matches).toHaveLength(3);
    e.destroy();
  });
});

describe("jumping to a block", () => {
  test("a block folded away in collapsed toggles is shown, with the caret in it", () => {
    const e = make([line("toggle", "t1", "Outer", 0, { collapsed: true }), line("toggle", "t2", "Inner", 1, { collapsed: true }), p("x", "hidden", 2), p("y", "after")]);
    expect(focusBlockById(e, "x")).toBe(true);
    expect(e.state.doc.child(0).attrs.collapsed).toBe(false);
    expect(e.state.doc.child(1).attrs.collapsed).toBe(false);
    expect(e.state.selection.$from.parent.textContent).toBe("hidden");
    expect(e.view.dom.querySelectorAll(".fb-hidden")).toHaveLength(0);
    e.destroy();
  });

  test("a block without text is selected, not the line after it", () => {
    const e = make([p("a", "text"), { type: "divider", attrs: { id: "d", depth: 0 } }, p("b", "after")]);
    expect(focusBlockById(e, "d")).toBe(true);
    expect(e.state.selection).toBeInstanceOf(NodeSelection);
    expect((e.state.selection as NodeSelection).node.type.name).toBe("divider");
    expect(focusBlockById(e, "nope")).toBe(false);
    e.destroy();
  });
});

describe("inserting a block at the caret", () => {
  const divider = (e: Editor) => insertBlockAfterCurrent(e, "divider");
  const selected = (e: Editor) => (e.state.selection instanceof NodeSelection ? `[${e.state.selection.node.type.name}]` : `${e.state.selection.$from.parent.type.name}:${e.state.selection.$from.parent.textContent}`);

  test("after a line with text, the caret goes to the line right after the block", () => {
    const e = make([p("a", "text"), p("b", "next"), p("c", "last")]);
    e.commands.setTextSelection(3);
    divider(e);
    expect(texts(e)).toEqual(["paragraph:text@0", "divider:@0", "paragraph:next@0", "paragraph:last@0"]);
    expect(selected(e)).toBe("paragraph:next");
    expect(e.state.selection.$from.parentOffset).toBe(0);
    e.destroy();
  });

  test("when no line of text follows it, the block itself is selected: the caret never lands further down", () => {
    const e = make([p("a", "text"), { type: "divider", attrs: { id: "d", depth: 0 } }, p("b", "far")]);
    e.commands.setTextSelection(3);
    insertBlockAfterCurrent(e, "pageBreak");
    expect(texts(e)).toEqual(["paragraph:text@0", "pageBreak:@0", "divider:@0", "paragraph:far@0"]);
    expect(selected(e)).toBe("[pageBreak]");
    e.destroy();
  });

  test("at the end of the note a line is added for the caret", () => {
    const e = make([p("a", "text")]);
    e.commands.setTextSelection(3);
    divider(e);
    expect(texts(e)).toEqual(["paragraph:text@0", "divider:@0", "paragraph:@0"]);
    expect(selected(e)).toBe("paragraph:");
    e.destroy();
  });

  test("an empty line is replaced; a line with nested blocks keeps them and the block goes after them", () => {
    const e = make([p("a", ""), p("b", "next")]);
    e.commands.setTextSelection(1);
    divider(e);
    expect(texts(e)).toEqual(["divider:@0", "paragraph:next@0"]);
    const f = make([p("a", "parent"), p("b", "child", 1), p("c", "next")]);
    f.commands.setTextSelection(3);
    divider(f);
    expect(texts(f)).toEqual(["paragraph:parent@0", "paragraph:child@1", "divider:@0", "paragraph:next@0"]);
    expect(selected(f)).toBe("paragraph:next");
    e.destroy();
    f.destroy();
  });

  test("a block of text put in at an empty line with nested blocks takes the line's place", () => {
    const e = make([p("a", ""), p("b", "child", 1)]);
    e.commands.setTextSelection(1);
    insertBlockAfterCurrent(e, "heading", { level: 2 });
    expect(texts(e)).toEqual(["heading:@0", "paragraph:child@1"]);
    expect(selected(e)).toBe("heading:");
    e.destroy();
  });
});

describe("dragging a block", () => {
  afterEach(() => vi.restoreAllMocks());

  test("the blocks are measured once, not on every frame", () => {
    const e = make(Array.from({ length: 40 }, (_v, i) => p(`p${i}`, `line ${i}`)));
    document.body.appendChild(e.view.dom);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
    if (!("CSS" in globalThis)) vi.stubGlobal("CSS", { escape: (s: string) => s });
    const frame = () => frames.splice(0).forEach((cb) => cb(0));
    const measured = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
    const blocks = () => measured.mock.contexts.filter((el) => (el as HTMLElement).parentElement === e.view.dom).length;

    const onEnd = vi.fn();
    beginPointerDrag({ editor: e, payload: { kind: "block", index: 0 }, event: { button: 0, pointerType: "mouse", clientX: 10, clientY: 10 } as PointerEvent, onDrop: () => null, onEnd, liftAt: { x: 10, y: 10 } });
    frame();
    const first = blocks();
    expect(first).toBeGreaterThanOrEqual(40);
    // Frames with the pointer still: nothing is measured again.
    for (let i = 0; i < 10; i++) frame();
    expect(blocks()).toBe(first);
    // The pointer moves: the target is worked out again from the boxes already measured.
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 12, clientY: 30 }));
    frame();
    expect(blocks()).toBe(first);
    // The page scrolls: they are measured again, once.
    window.dispatchEvent(new Event("scroll"));
    frame();
    frame();
    expect(blocks() - first).toBe(40);
    frame();
    expect(blocks() - first).toBe(40);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onEnd).toHaveBeenCalledWith(false);
    vi.unstubAllGlobals();
    e.view.dom.remove();
    e.destroy();
  });
});

describe("code is left as typed", () => {
  test("a code block's element and inline code turn spelling and autocorrect off", () => {
    const e = make([{ type: "codeBlock", attrs: { id: "c", depth: 0, language: "plaintext" }, content: [{ type: "text", text: "teh quick" }] }, { type: "paragraph", attrs: { id: "p", depth: 0 }, content: [{ type: "text", text: "run " }, { type: "text", text: "npm i", marks: [{ type: "code" }] }] }]);
    const pre = e.view.dom.querySelector("pre")!;
    const inline = e.view.dom.querySelector("p code")!;
    for (const el of [pre, inline]) {
      expect(el.getAttribute("spellcheck")).toBe("false");
      expect(el.getAttribute("autocorrect")).toBe("off");
      expect(el.getAttribute("autocapitalize")).toBe("off");
    }
    // The same when the block is written out as HTML.
    expect(e.getHTML()).toMatch(/<pre[^>]*spellcheck="false"[^>]*autocorrect="off"/);
    e.destroy();
  });
});
