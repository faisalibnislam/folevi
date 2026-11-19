// Where a paste goes and how it undoes (paste.ts handleEditorPaste and insertPastedBlocks): over selected
// blocks, at the end of a line, as one undo step whatever the route, and blocks moved by cut and paste keeping
// their ids. Pastes arrive as real "paste" events on the editor, so ProseMirror's own paste runs too.
import { describe, expect, test, vi } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import { undoDepth } from "@tiptap/pm/history";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { ALL_MARKS, ALL_NODES, BlockFormat } from "@/components/editor/extensions";
import { BlockIdentity, BlockKeymap, MarkdownShortcuts } from "@/components/editor/plugins";
import { BlockSelectionExtension, blockSelectionRange, setBlockSelection } from "@/components/editor/blockSelection";
import { FOLEVI_BLOCKS_MIME, readBlockClip } from "@/components/editor/blockClipboard";
import { clipboardBlocks, handleEditorPaste, insertPastedBlocks, pastePlainText, prepareForPaste, someFileFits } from "@/components/editor/paste";
import { LIMITS, ulid } from "@folevi/editor-schema";
import { MAX_IMAGE_BYTES } from "@folevi/editor-schema/fileBytes";

const line = (type: string, text: string, attrs: Record<string, unknown> = {}): JSONContent => ({ type, attrs: { depth: 0, id: ulid(), ...attrs }, content: text ? [{ type: "text", text }] : [] });
const p = (text: string, attrs: Record<string, unknown> = {}) => line("paragraph", text, attrs);
const divider = (): JSONContent => ({ type: "divider", attrs: { depth: 0, id: ulid() } });

/** An editor in a note (`documentId` on its root, as Editor.tsx renders it), pasting as the app does. */
function make(content: JSONContent[], options: { insertFiles?: (files: File[]) => void; documentId?: string } = {}) {
  const root = document.createElement("div");
  if (options.documentId) root.setAttribute("data-fb-root", options.documentId);
  const element = root.appendChild(document.createElement("div"));
  document.body.appendChild(root);
  return new Editor({
    element,
    extensions: [...ALL_NODES, ...ALL_MARKS, BlockFormat, UndoRedo, BlockIdentity, BlockKeymap, BlockSelectionExtension, MarkdownShortcuts],
    content: { type: "doc", content },
    editorProps: { handlePaste: (view, event, slice) => handleEditorPaste(view, event, slice, { editable: true, insertFiles: options.insertFiles ?? (() => undefined) }) },
  });
}
const texts = (e: Editor) => {
  const out: string[] = [];
  e.state.doc.forEach((n) => out.push(`${n.type.name}:${n.textContent}@${n.attrs.depth}`));
  return out;
};
const ids = (e: Editor) => {
  const out: string[] = [];
  e.state.doc.forEach((n) => out.push(String(n.attrs.id)));
  return out;
};
/** A clipboard that can be written (copy, cut) and read (paste). */
function clipboard(data: Record<string, string> = {}, files: File[] = []): DataTransfer {
  const store = { ...data };
  return {
    getData: (type: string) => store[type] ?? "",
    setData: (type: string, value: string) => void (store[type] = value),
    clearData: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
    files,
  } as unknown as DataTransfer;
}
function fire(e: Editor, type: "paste" | "copy" | "cut", data: DataTransfer) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: data });
  e.view.dom.dispatchEvent(event);
  return event;
}
const caretAtEnd = (e: Editor, index = e.state.doc.childCount - 1) => {
  let pos = 0;
  for (let i = 0; i <= index; i++) pos += e.state.doc.child(i).nodeSize;
  e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, pos - 1)));
};

describe("pasting over selected blocks (P1)", () => {
  test("text takes the blocks' place, and one undo brings them back", () => {
    const e = make([p("one"), p("two"), p("three")]);
    const before = ids(e);
    setBlockSelection(e.view, 0, 1);
    const depth = undoDepth(e.state);
    fire(e, "paste", clipboard({ "text/plain": "alpha\nbeta" }));
    expect(texts(e)).toEqual(["paragraph:alpha@0", "paragraph:beta@0", "paragraph:three@0"]);
    expect(blockSelectionRange(e.state)).toBeNull();
    expect(undoDepth(e.state) - depth).toBe(1);
    e.commands.undo();
    expect(texts(e)).toEqual(["paragraph:one@0", "paragraph:two@0", "paragraph:three@0"]);
    expect(ids(e)).toEqual(before);
    e.destroy();
  });

  test("one line of text (ProseMirror's own paste) is one undo step too, without the formatting of the block it replaced", () => {
    const e = make([p("one"), { type: "paragraph", attrs: { depth: 0, id: ulid() }, content: [{ type: "text", text: "bold", marks: [{ type: "bold" }] }] }, p("three")]);
    setBlockSelection(e.view, 0, 1);
    const depth = undoDepth(e.state);
    fire(e, "paste", clipboard({ "text/plain": "single" }));
    expect(texts(e)).toEqual(["paragraph:single@0", "paragraph:three@0"]);
    expect(e.state.doc.child(0).firstChild!.marks.length).toBe(0);
    expect(undoDepth(e.state) - depth).toBe(1);
    e.commands.undo();
    expect(texts(e)).toEqual(["paragraph:one@0", "paragraph:bold@0", "paragraph:three@0"]);
    e.destroy();
  });

  test("a file the note refuses (over the size limit) leaves the blocks alone and still selected", () => {
    const insertFiles = vi.fn();
    const e = make([p("one"), p("two"), p("three")], { insertFiles });
    setBlockSelection(e.view, 0, 1);
    const before = e.state.doc;
    const big = new File(["x"], "photo.png", { type: "image/png" });
    Object.defineProperty(big, "size", { value: MAX_IMAGE_BYTES + 1 });
    expect(someFileFits([big])).toBe(false);
    fire(e, "paste", clipboard({}, [big]));
    // insertFiles is still asked (it is what says "too large"), and adds nothing.
    expect(insertFiles).toHaveBeenCalledWith([big]);
    expect(e.state.doc.eq(before)).toBe(true);
    expect(blockSelectionRange(e.state)).toEqual({ from: 0, to: 1 });
    e.destroy();
  });

  test("a file that fits gets the blocks' place: an empty line for it to fill", () => {
    const insertFiles = vi.fn();
    const e = make([p("one"), p("two"), p("three")], { insertFiles });
    setBlockSelection(e.view, 0, 1);
    const small = new File(["x"], "photo.png", { type: "image/png" });
    fire(e, "paste", clipboard({}, [small]));
    expect(insertFiles).toHaveBeenCalledWith([small]);
    expect(texts(e)).toEqual(["paragraph:@0", "paragraph:three@0"]);
    expect(e.state.selection.$from.index(0)).toBe(0);
    e.destroy();
  });

  test("a web address and another app's HTML take the blocks' place in one step each", () => {
    const e = make([p("one"), p("two"), p("three")]);
    setBlockSelection(e.view, 0, 1);
    let depth = undoDepth(e.state);
    fire(e, "paste", clipboard({ "text/plain": "https://example.com" }));
    expect(texts(e)).toEqual(["paragraph:https://example.com@0", "paragraph:three@0"]);
    expect(e.state.doc.rangeHasMark(0, e.state.doc.child(0).nodeSize, e.schema.marks.link!)).toBe(true);
    expect(undoDepth(e.state) - depth).toBe(1);
    e.commands.undo();
    expect(texts(e)).toEqual(["paragraph:one@0", "paragraph:two@0", "paragraph:three@0"]);
    setBlockSelection(e.view, 1, 2);
    depth = undoDepth(e.state);
    fire(e, "paste", clipboard({ "text/html": "<h2>Title</h2><ul><li>item</li></ul>", "text/plain": "Title\nitem" }));
    expect(texts(e)).toEqual(["paragraph:one@0", "heading:Title@0", "bulleted:item@0"]);
    expect(undoDepth(e.state) - depth).toBe(1);
    e.commands.undo();
    expect(texts(e)).toEqual(["paragraph:one@0", "paragraph:two@0", "paragraph:three@0"]);
    e.destroy();
  });

  test("a selected code block is replaced like any block, not pasted into", () => {
    const e = make([{ type: "codeBlock", attrs: { depth: 0, id: ulid(), language: "plaintext" }, content: [{ type: "text", text: "code" }] }, p("after")]);
    setBlockSelection(e.view, 0, 0);
    fire(e, "paste", clipboard({ "text/plain": "one\ntwo" }));
    expect(texts(e)).toEqual(["paragraph:one@0", "paragraph:two@0", "paragraph:after@0"]);
    e.commands.undo();
    expect(texts(e)).toEqual(["codeBlock:code@0", "paragraph:after@0"]);
    e.destroy();
  });

  test("nothing on the clipboard leaves the blocks alone", () => {
    const e = make([p("one"), p("two")]);
    setBlockSelection(e.view, 0, 1);
    fire(e, "paste", clipboard({}));
    expect(texts(e)).toEqual(["paragraph:one@0", "paragraph:two@0"]);
    e.destroy();
  });

  test("a plain-text paste from the menu takes the selected blocks' place in one step", () => {
    const e = make([p("one"), p("two"), p("three")]);
    setBlockSelection(e.view, 1, 2);
    expect(pastePlainText(e.view, "x\ny")).toBe(true);
    expect(texts(e)).toEqual(["paragraph:one@0", "paragraph:x@0", "paragraph:y@0"]);
    e.commands.undo();
    expect(texts(e)).toEqual(["paragraph:one@0", "paragraph:two@0", "paragraph:three@0"]);
    e.destroy();
  });
});

describe("a list or a heading pasted at the end of a line (P7)", () => {
  test("Markdown that starts with a heading follows the line; the line and the heading stay", () => {
    const e = make([p("Notes from the call")]);
    caretAtEnd(e);
    fire(e, "paste", clipboard({ "text/plain": "## Plan\n- first\n- second" }));
    expect(texts(e)).toEqual(["paragraph:Notes from the call@0", "heading:Plan@0", "bulleted:first@0", "bulleted:second@0"]);
    e.destroy();
  });

  test("a list from a web page follows the line as a list", () => {
    const e = make([p("Shopping:")]);
    caretAtEnd(e);
    fire(e, "paste", clipboard({ "text/html": "<ul><li>milk</li><li>eggs</li></ul>", "text/plain": "milk\neggs" }));
    expect(texts(e)).toEqual(["paragraph:Shopping:@0", "bulleted:milk@0", "bulleted:eggs@0"]);
    e.destroy();
  });

  test("plain lines still continue the line, and so does one heading or list item on its own", () => {
    const e = make([p("Hello")]);
    caretAtEnd(e);
    fire(e, "paste", clipboard({ "text/plain": "one\ntwo" }));
    expect(texts(e)).toEqual(["paragraph:Helloone@0", "paragraph:two@0"]);
    const f = make([p("Hello")]);
    caretAtEnd(f);
    fire(f, "paste", clipboard({ "text/html": "<h2>Big</h2>", "text/plain": "Big" }));
    expect(texts(f)).toEqual(["paragraph:HelloBig@0"]);
    e.destroy();
    f.destroy();
  });

  test("in the middle of a sentence a pasted list still joins it at both ends", () => {
    const e = make([p("HelloWorld")]);
    e.commands.setTextSelection(6);
    fire(e, "paste", clipboard({ "text/plain": "- a\n- b" }));
    expect(texts(e)).toEqual(["paragraph:Helloa@0", "bulleted:bWorld@0"]);
    e.destroy();
  });
});

describe("every paste is one undo step of its own (P16)", () => {
  test("with a divider selected, two pasted lines go after it and one undo takes them back", () => {
    const e = make([p("one"), divider(), p("three")]);
    e.view.dispatch(e.state.tr.setSelection(NodeSelection.create(e.state.doc, 5)));
    const depth = undoDepth(e.state);
    fire(e, "paste", clipboard({ "text/plain": "alpha\nbeta" }));
    expect(texts(e)).toEqual(["paragraph:one@0", "divider:@0", "paragraph:alpha@0", "paragraph:beta@0", "paragraph:three@0"]);
    expect(undoDepth(e.state) - depth).toBe(1);
    e.commands.undo();
    expect(texts(e)).toEqual(["paragraph:one@0", "divider:@0", "paragraph:three@0"]);
    e.destroy();
  });

  test("with a divider selected, one pasted line (ProseMirror's own paste) is one step as well", () => {
    const e = make([p("one"), divider(), p("three")]);
    e.view.dispatch(e.state.tr.setSelection(NodeSelection.create(e.state.doc, 5)));
    const depth = undoDepth(e.state);
    fire(e, "paste", clipboard({ "text/plain": "alpha" }));
    expect(texts(e)).toEqual(["paragraph:one@0", "divider:@0", "paragraph:alpha@0", "paragraph:three@0"]);
    expect(undoDepth(e.state) - depth).toBe(1);
    e.commands.undo();
    expect(texts(e)).toEqual(["paragraph:one@0", "divider:@0", "paragraph:three@0"]);
    e.destroy();
  });

  test("typing and then pasting one line right away: undo takes back the paste only", () => {
    const e = make([p("")]);
    e.commands.focus();
    e.view.dispatch(e.state.tr.insertText("typed "));
    fire(e, "paste", clipboard({ "text/plain": "pasted" }));
    expect(texts(e)).toEqual(["paragraph:typed pasted@0"]);
    e.commands.undo();
    expect(texts(e)).toEqual(["paragraph:typed @0"]);
    e.destroy();
  });

  test("pasting and then typing right away: undo takes back the typing only", () => {
    const e = make([p("start")]);
    caretAtEnd(e);
    fire(e, "paste", clipboard({ "text/plain": "alpha\nbeta" }));
    e.view.dispatch(e.state.tr.insertText("X"));
    expect(texts(e)).toEqual(["paragraph:startalpha@0", "paragraph:betaX@0"]);
    e.commands.undo();
    expect(texts(e)).toEqual(["paragraph:startalpha@0", "paragraph:beta@0"]);
    e.commands.undo();
    expect(texts(e)).toEqual(["paragraph:start@0"]);
    e.destroy();
  });

  test("one pasted line and then typing right away are two steps too", () => {
    const e = make([p("start ")]);
    caretAtEnd(e);
    fire(e, "paste", clipboard({ "text/plain": "pasted" }));
    e.view.dispatch(e.state.tr.insertText("X"));
    expect(texts(e)).toEqual(["paragraph:start pastedX@0"]);
    e.commands.undo();
    expect(texts(e)).toEqual(["paragraph:start pasted@0"]);
    e.commands.undo();
    expect(texts(e)).toEqual(["paragraph:start @0"]);
    e.destroy();
  });

  test("text pasted into a code block is a step of its own between what was typed before and after", () => {
    const e = make([{ type: "codeBlock", attrs: { depth: 0, id: ulid(), language: "plaintext" }, content: [] }]);
    e.commands.setTextSelection(1);
    e.view.dispatch(e.state.tr.insertText("a = 1"));
    fire(e, "paste", clipboard({ "text/html": "<p><b>b</b> = 2</p>", "text/plain": "\nb = 2" }));
    e.view.dispatch(e.state.tr.insertText(";"));
    expect(texts(e)).toEqual(["codeBlock:a = 1\nb = 2;@0"]);
    e.commands.undo();
    expect(texts(e)).toEqual(["codeBlock:a = 1\nb = 2@0"]);
    e.commands.undo();
    expect(texts(e)).toEqual(["codeBlock:a = 1@0"]);
    e.destroy();
  });

  test("an editor that gets the note ready itself (the home page's demo) still pastes after a selected block", () => {
    const e = make([p("one"), divider(), p("three")]);
    e.view.dispatch(e.state.tr.setSelection(NodeSelection.create(e.state.doc, 5)));
    prepareForPaste(e.view, null);
    insertPastedBlocks(e.view, clipboardBlocks(e.view, clipboard({ "text/plain": "alpha\nbeta" }))!);
    expect(texts(e)).toEqual(["paragraph:one@0", "divider:@0", "paragraph:alpha@0", "paragraph:beta@0", "paragraph:three@0"]);
    e.destroy();
  });

  test("a pasted web address is a step of its own between what was typed before and after", () => {
    const e = make([p("")]);
    e.commands.focus();
    e.view.dispatch(e.state.tr.insertText("see "));
    fire(e, "paste", clipboard({ "text/plain": "https://example.com" }));
    e.view.dispatch(e.state.tr.insertText("!"));
    expect(texts(e)).toEqual(["paragraph:see https://example.com!@0"]);
    e.commands.undo();
    expect(texts(e)).toEqual(["paragraph:see https://example.com@0"]);
    e.commands.undo();
    expect(texts(e)).toEqual(["paragraph:see @0"]);
    e.destroy();
  });

  test("Folevi's own copied text pastes back as it was (ProseMirror reads it, once)", () => {
    const source = make([line("bulleted", "parent"), line("bulleted", "child", { depth: 1 }), line("numbered", "n1", { depth: 1 }), p("tail")]);
    source.view.dispatch(source.state.tr.setSelection(TextSelection.create(source.state.doc, 3, source.state.doc.content.size - 3)));
    const { dom, text } = source.view.serializeForClipboard(source.state.selection.content());
    const e = make([p("target here")]);
    e.commands.setTextSelection(8);
    const depth = undoDepth(e.state);
    fire(e, "paste", clipboard({ "text/html": dom.innerHTML, "text/plain": text }));
    expect(texts(e)).toEqual(["paragraph:target rent@0", "bulleted:child@1", "numbered:n1@1", "paragraph:tahere@0"]);
    expect(new Set(ids(e)).size).toBe(e.state.doc.childCount);
    expect(ids(e).some((id) => ids(source).includes(id))).toBe(false);
    expect(undoDepth(e.state) - depth).toBe(1);
    source.destroy();
    e.destroy();
  });
});

describe("Folevi's own copied text and the room a note has (P14)", () => {
  test("more blocks than the note has room for are not pasted, and it is said", () => {
    const source = make(Array.from({ length: 40 }, (_, i) => p(`copied ${i}`)));
    const { dom, text } = source.view.serializeForClipboard(source.state.doc.slice(0, source.state.doc.content.size));
    const e = make(Array.from({ length: LIMITS.maxBlocksPerDocument - 5 }, (_, i) => p(`existing ${i}`)));
    caretAtEnd(e);
    const before = e.state.doc;
    const said: string[] = [];
    const onError = (event: Event) => void said.push(String((event as CustomEvent<unknown>).detail));
    window.addEventListener("folevi:error", onError);
    const event = fire(e, "paste", clipboard({ "text/html": dom.innerHTML, "text/plain": text }));
    window.removeEventListener("folevi:error", onError);
    expect(said).toEqual(["That paste is too large for this note. It would add 40 blocks, and the note has room for 5 more."]);
    expect(event.defaultPrevented).toBe(true);
    expect(e.state.doc.eq(before)).toBe(true);
    source.destroy();
    e.destroy();
  }, 30_000);
});

describe("blocks moved by cut and paste keep their ids (P18)", () => {
  const NOTE = ulid();

  test("cut in a note and pasted lower in the same note, a block is the same block; pasted again it is a new one", () => {
    const e = make([p("first"), line("todo", "commented", { checked: true }), p("last")], { documentId: NOTE });
    const [, moved] = ids(e);
    setBlockSelection(e.view, 1, 1);
    const data = clipboard();
    fire(e, "cut", data);
    expect(texts(e)).toEqual(["paragraph:first@0", "paragraph:last@0"]);
    expect(readBlockClip(data)).toMatchObject({ cut: true, documentId: NOTE, blocks: [{ id: moved }] });
    caretAtEnd(e);
    fire(e, "paste", data);
    expect(texts(e)).toEqual(["paragraph:first@0", "paragraph:last@0", "todo:commented@0"]);
    expect(ids(e)[2]).toBe(moved);
    expect(e.state.doc.child(2).attrs.checked).toBe(true);
    caretAtEnd(e);
    fire(e, "paste", data);
    expect(texts(e)[3]).toBe("todo:commented@0");
    expect(ids(e)[3]).not.toBe(moved);
    expect(new Set(ids(e)).size).toBe(4);
    e.destroy();
  });

  test("a plain paragraph moved to an empty line or the end of a line stays its own block, with its id", () => {
    const e = make([p("first"), p("moved"), p("")], { documentId: NOTE });
    const [, moved] = ids(e);
    setBlockSelection(e.view, 1, 1);
    const data = clipboard();
    fire(e, "cut", data);
    e.commands.setTextSelection(e.state.doc.content.size - 1);
    fire(e, "paste", data);
    expect(texts(e)).toEqual(["paragraph:first@0", "paragraph:moved@0"]);
    expect(ids(e)[1]).toBe(moved);
    e.destroy();
  });

  test("copied blocks, and blocks cut from another note, get new ids", () => {
    const e = make([p("first"), p("second")], { documentId: NOTE });
    const [, second] = ids(e);
    setBlockSelection(e.view, 1, 1);
    const copied = clipboard();
    fire(e, "copy", copied);
    expect(readBlockClip(copied)!.cut).toBeUndefined();
    expect(readBlockClip(copied)!.blocks[0]!.id).not.toBe(second);
    const data = clipboard();
    fire(e, "cut", data);
    const other = make([p("elsewhere")], { documentId: ulid() });
    caretAtEnd(other);
    fire(other, "paste", data);
    expect(texts(other)).toEqual(["paragraph:elsewheresecond@0"]);
    expect(ids(other)).not.toContain(second);
    e.destroy();
    other.destroy();
  });

  test("an id the schema would refuse is never taken from the clipboard", () => {
    const e = make([p("first")], { documentId: NOTE });
    caretAtEnd(e);
    const clip = { v: 1, documentId: NOTE, cut: true, blocks: [{ id: "<b>not an id</b>", type: "heading", parentId: null, rank: "a", schemaVersion: 1, text: [{ type: "text", text: "Title" }], props: { level: 1 } }] };
    fire(e, "paste", clipboard({ [FOLEVI_BLOCKS_MIME]: JSON.stringify(clip) }));
    expect(texts(e)).toEqual(["paragraph:first@0", "heading:Title@0"]);
    expect(ids(e)[1]).toMatch(/^[0-9A-Z]{26}$/);
    e.destroy();
  });
});
