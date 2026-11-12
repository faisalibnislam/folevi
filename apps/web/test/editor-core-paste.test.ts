// Pasting into a note (docs/EDITOR_AUDIT_2026-11-12.md, section 6: T1 to T4): a paste joins the line the caret
// is in, words win over a picture of them, tabs alone don't make a table, and Shift pastes plain text.
import { describe, expect, test, vi } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import { ALL_MARKS, ALL_NODES, BlockFormat } from "@/components/editor/extensions";
import { BlockIdentity, BlockKeymap, MarkdownShortcuts } from "@/components/editor/plugins";
import { clipboardBlocks, handleEditorPaste, htmlToBlocks, insertPastedBlocks, pasteIsFiles } from "@/components/editor/paste";
import { gridFromText, isTabSeparated } from "@/components/editor/table/sheetPaste";
import { markdownToBlocks, plainText } from "@folevi/editor-schema";

const line = (type: string, text: string, attrs: Record<string, unknown> = {}): JSONContent => ({ type, attrs: { depth: 0, ...attrs }, content: text ? [{ type: "text", text }] : [] });
const p = (text: string, attrs: Record<string, unknown> = {}) => line("paragraph", text, attrs);
const make = (content: JSONContent[]) => new Editor({ extensions: [...ALL_NODES, ...ALL_MARKS, BlockFormat, UndoRedo, BlockIdentity, BlockKeymap, MarkdownShortcuts], content: { type: "doc", content } });
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
const md = (text: string) => markdownToBlocks(text, { titleFromHeading: false }).blocks;
const plain = (text: string) => clipboardBlocks(make([p("")]).view, clipboard({ "text/plain": text }));
/** The text before and after the caret, in the caret's line. */
const caret = (e: Editor) => {
  const { $from } = e.state.selection;
  return `${$from.parent.textBetween(0, $from.parentOffset)}|${$from.parent.textBetween($from.parentOffset, $from.parent.content.size)}`;
};
function clipboard(data: Record<string, string>, files: File[] = []): DataTransfer {
  return { getData: (type: string) => data[type] ?? "", files } as unknown as DataTransfer;
}
function pasteEvent(data: DataTransfer) {
  return { clipboardData: data, preventDefault: vi.fn() } as unknown as ClipboardEvent;
}

describe("a paste joins the line the caret is in", () => {
  test("two lines in the middle of a sentence: the first continues the line, the rest of the line ends the last", () => {
    const e = make([p("HelloWorld", { id: "L1" })]);
    e.commands.setTextSelection(6);
    insertPastedBlocks(e.view, md("one\n\ntwo"));
    expect(texts(e)).toEqual(["paragraph:Helloone@0", "paragraph:twoWorld@0"]);
    expect(caret(e)).toBe("two|World");
    expect(e.state.doc.child(0).attrs.id).toBe("L1");
    expect(new Set(ids(e)).size).toBe(2);
    e.destroy();
  });

  test("the line keeps its own kind, and the last pasted block its own", () => {
    const e = make([line("heading", "HelloWorld", { level: 2 })]);
    e.commands.setTextSelection(6);
    insertPastedBlocks(e.view, md("- a\n- b"));
    expect(texts(e)).toEqual(["heading:Helloa@0", "bulleted:bWorld@0"]);
    expect(e.state.doc.child(0).attrs.level).toBe(2);
    e.destroy();
  });

  test("three lines: the middle ones are blocks of their own", () => {
    const e = make([p("AB")]);
    e.commands.setTextSelection(2);
    insertPastedBlocks(e.view, md("1\n\n2\n\n3"));
    expect(texts(e)).toEqual(["paragraph:A1@0", "paragraph:2@0", "paragraph:3B@0"]);
    e.destroy();
  });

  test("at the end of a line the first pasted line continues it and the rest follow", () => {
    const e = make([p("Hello"), p("next")]);
    e.commands.setTextSelection(6);
    insertPastedBlocks(e.view, md("one\n\ntwo"));
    expect(texts(e)).toEqual(["paragraph:Helloone@0", "paragraph:two@0", "paragraph:next@0"]);
    expect(caret(e)).toBe("two|");
    e.destroy();
  });

  test("at the start of a line the blocks go above it and the line stays itself", () => {
    const e = make([line("heading", "Title", { id: "H1", level: 1 })]);
    e.commands.setTextSelection(1);
    insertPastedBlocks(e.view, md("one\n\ntwo"));
    expect(texts(e)).toEqual(["paragraph:one@0", "heading:twoTitle@0"]);
    expect(e.state.doc.child(1).attrs.id).toBe("H1");
    expect(caret(e)).toBe("two|Title");
    e.destroy();
  });

  test("an empty line takes the first pasted block's kind and keeps its id", () => {
    const e = make([p("", { id: "E1" }), p("after")]);
    e.commands.setTextSelection(1);
    insertPastedBlocks(e.view, md("## Title\n\ntext"));
    expect(texts(e)).toEqual(["heading:Title@0", "paragraph:text@0", "paragraph:after@0"]);
    expect(e.state.doc.child(0).attrs.id).toBe("E1");
    e.destroy();
  });

  test("plain lines pasted into an empty heading leave it a heading", () => {
    const e = make([line("heading", "", { level: 3 })]);
    e.commands.setTextSelection(1);
    insertPastedBlocks(e.view, md("one\n\ntwo"));
    expect(texts(e)).toEqual(["heading:one@0", "paragraph:two@0"]);
    expect(e.state.doc.child(0).attrs.level).toBe(3);
    e.destroy();
  });

  test("plain lines pasted into an empty bullet are bullets", () => {
    const e = make([line("bulleted", "first"), line("bulleted", "")]);
    e.commands.setTextSelection(e.state.doc.content.size - 1);
    insertPastedBlocks(e.view, md("one\n\ntwo\n\nthree"));
    expect(texts(e)).toEqual(["bulleted:first@0", "bulleted:one@0", "bulleted:two@0", "bulleted:three@0"]);
    e.destroy();
  });

  test("plain lines pasted into a to-do are to-dos, and the to-do keeps its details", () => {
    const e = make([line("todo", "", { id: "T1", checked: true, dueDate: "2026-12-01" })]);
    e.commands.setTextSelection(1);
    insertPastedBlocks(e.view, md("one\n\ntwo"));
    expect(texts(e)).toEqual(["todo:one@0", "todo:two@0"]);
    expect(e.state.doc.child(0).attrs).toMatchObject({ id: "T1", checked: true, dueDate: "2026-12-01" });
    expect(e.state.doc.child(1).attrs.checked).toBe(false);
    e.destroy();
  });

  test("plain lines pasted in the middle of a bullet stay in the list", () => {
    const e = make([line("bulleted", "HelloWorld")]);
    e.commands.setTextSelection(6);
    insertPastedBlocks(e.view, md("one\n\ntwo"));
    expect(texts(e)).toEqual(["bulleted:Helloone@0", "bulleted:twoWorld@0"]);
    e.destroy();
  });

  test("one heading or list item pasted into a sentence goes in as its text", () => {
    const e = make([p("HelloWorld")]);
    e.commands.setTextSelection(6);
    insertPastedBlocks(e.view, htmlToBlocks("<h2>Big</h2>"));
    expect(texts(e)).toEqual(["paragraph:HelloBigWorld@0"]);
    expect(caret(e)).toBe("HelloBig|World");
    e.destroy();
  });

  test("one Markdown-looking line of plain text pasted into a sentence keeps its characters", () => {
    const e = make([p("HelloWorld")]);
    e.commands.setTextSelection(6);
    const blocks = clipboardBlocks(e.view, clipboard({ "text/plain": "- 5 degrees" }))!;
    insertPastedBlocks(e.view, blocks);
    expect(texts(e)).toEqual(["paragraph:Hello- 5 degreesWorld@0"]);
    // On an empty line the same text is a list item.
    const f = make([p("")]);
    expect(clipboardBlocks(f.view, clipboard({ "text/plain": "- 5 degrees" }))!.map((b) => b.type)).toEqual(["bulleted"]);
    e.destroy();
    f.destroy();
  });

  test("a block without text still splits the line, and the second half is a fresh line of the same kind", () => {
    const e = make([line("todo", "HelloWorld", { id: "T1", checked: true, dueDate: "2026-10-05" })]);
    e.commands.setTextSelection(6);
    insertPastedBlocks(e.view, htmlToBlocks("<hr>"));
    expect(texts(e)).toEqual(["todo:Hello@0", "divider:@0", "todo:World@0"]);
    expect(e.state.doc.child(0).attrs).toMatchObject({ id: "T1", checked: true, dueDate: "2026-10-05" });
    expect(e.state.doc.child(2).attrs.id).not.toBe("T1");
    expect(e.state.doc.child(2).attrs.checked).toBe(false);
    expect(e.state.doc.child(2).attrs.dueDate ?? null).toBeNull();
    e.destroy();
  });

  test("text, then a table, then text: each end joins the line and the table sits between", () => {
    const e = make([p("HelloWorld")]);
    e.commands.setTextSelection(6);
    insertPastedBlocks(e.view, htmlToBlocks("<p>a</p><table><tr><td>c</td></tr></table><p>b</p>"));
    expect(texts(e)).toEqual(["paragraph:Helloa@0", "table:@0", "paragraph:bWorld@0"]);
    e.destroy();
  });

  test("what was nested under the first pasted block nests under the line", () => {
    const e = make([p("Hello")]);
    e.commands.setTextSelection(6);
    insertPastedBlocks(e.view, md("- a\n  - a1\n- b"));
    expect(texts(e)).toEqual(["paragraph:Helloa@0", "bulleted:a1@1", "bulleted:b@0"]);
    e.destroy();
  });

  test("one undo takes the whole paste back, and nothing typed before it", () => {
    const e = make([p("")]);
    e.commands.setTextSelection(1);
    e.view.dispatch(e.state.tr.insertText("HelloWorld"));
    e.commands.setTextSelection(6);
    insertPastedBlocks(e.view, md("one\n\ntwo\n\nthree"));
    expect(e.state.doc.childCount).toBe(3);
    e.commands.undo();
    expect(texts(e)).toEqual(["paragraph:HelloWorld@0"]);
    e.destroy();
  });

  test("every block has its own id after a paste", () => {
    const e = make([p("HelloWorld", { id: "L1" }), p("x", { id: "L2" })]);
    e.commands.setTextSelection(6);
    const blocks = md("- a\n- b\n- c");
    insertPastedBlocks(e.view, blocks);
    insertPastedBlocks(e.view, blocks);
    const all = ids(e);
    expect(all.every((id) => id && id !== "null")).toBe(true);
    expect(new Set(all).size).toBe(all.length);
    e.destroy();
  });
});

describe("blocks copied as blocks in Folevi come back as blocks", () => {
  const clip = (text: string) => clipboard({ "application/x-folevi-blocks": JSON.stringify({ v: 1, documentId: null, blocks: md(text) }), "text/plain": text });

  test("in the middle of a line they land between its two halves, each with its own kind", () => {
    const e = make([p("HelloWorld", { id: "L1" })]);
    e.commands.setTextSelection(6);
    expect(handleEditorPaste(e.view, pasteEvent(clip("## Title\n\n- [ ] task")), null, { editable: true, insertFiles: vi.fn() })).toBe(true);
    expect(texts(e)).toEqual(["paragraph:Hello@0", "heading:Title@0", "todo:task@0", "paragraph:World@0"]);
    expect(e.state.doc.child(0).attrs.id).toBe("L1");
    e.destroy();
  });

  test("at the end of a line they follow it; one plain paragraph still goes into the line", () => {
    const e = make([p("Hello")]);
    e.commands.setTextSelection(6);
    handleEditorPaste(e.view, pasteEvent(clip("- a\n- b")), null, { editable: true, insertFiles: vi.fn() });
    expect(texts(e)).toEqual(["paragraph:Hello@0", "bulleted:a@0", "bulleted:b@0"]);
    const f = make([p("Hello")]);
    f.commands.setTextSelection(6);
    handleEditorPaste(f.view, pasteEvent(clip("there")), null, { editable: true, insertFiles: vi.fn() });
    expect(texts(f)).toEqual(["paragraph:Hellothere@0"]);
    e.destroy();
    f.destroy();
  });
});

describe("words win over a picture of them", () => {
  const png = new File(["x"], "image.png", { type: "image/png" });
  test("Word, Excel and PowerPoint (a picture beside HTML and text) paste their words", () => {
    expect(pasteIsFiles(clipboard({ "text/html": "<p>Quarterly <b>numbers</b></p>", "text/plain": "Quarterly numbers" }, [png]))).toBe(false);
    expect(pasteIsFiles(clipboard({ "text/html": "<table><tr><td>1</td><td>2</td></tr></table>", "text/plain": "1\t2" }, [png]))).toBe(false);
    expect(pasteIsFiles(clipboard({ "text/plain": "Just the words" }, [png]))).toBe(false);
  });

  test("a screenshot, a picture copied in a browser and files from Finder are still files", () => {
    expect(pasteIsFiles(clipboard({}, [png]))).toBe(true);
    expect(pasteIsFiles(clipboard({ "text/html": '<meta charset="utf-8"><img src="https://example.com/a.png" alt="">' }, [png]))).toBe(true);
    const report = new File(["x"], "Report final.pdf", { type: "application/pdf" });
    expect(pasteIsFiles(clipboard({ "text/plain": "Report final.pdf" }, [report]))).toBe(true);
    expect(pasteIsFiles(clipboard({ "text/plain": "/Users/me/Desktop/Report final.pdf" }, [report]))).toBe(true);
    expect(pasteIsFiles(clipboard({ "text/plain": "file:///Users/me/Desktop/Report%20final.pdf" }, [report]))).toBe(true);
    expect(pasteIsFiles(clipboard({ "text/plain": "text" }))).toBe(false);
  });

  test("the paste itself: Word's words become text and no file is inserted", () => {
    const e = make([p("")]);
    e.commands.setTextSelection(1);
    const insertFiles = vi.fn();
    const event = pasteEvent(clipboard({ "text/html": "<p>One</p><p>Two</p>", "text/plain": "One\nTwo" }, [png]));
    expect(handleEditorPaste(e.view, event, null, { editable: true, insertFiles })).toBe(true);
    expect(insertFiles).not.toHaveBeenCalled();
    expect(texts(e)).toEqual(["paragraph:One@0", "paragraph:Two@0"]);
    const shot = pasteEvent(clipboard({}, [png]));
    expect(handleEditorPaste(e.view, shot, null, { editable: true, insertFiles })).toBe(true);
    expect(insertFiles).toHaveBeenCalledWith([png]);
    e.destroy();
  });
});

describe("tabs alone don't make a table", () => {
  test("rows of the same number of cells are a table", () => {
    expect(isTabSeparated("a\tb\n1\t2")).toBe(true);
    expect(isTabSeparated("a\tb\tc\r\n1\t2\t3\r\n")).toBe(true);
    expect(plain("Name\tAge\nAnn\t31")!.map((b) => b.type)).toEqual(["table"]);
  });

  test("indented code, a Makefile and a sentence with a tab are text", () => {
    expect(isTabSeparated("if (x) {\n\treturn 1;\n}")).toBe(false);
    expect(isTabSeparated("build:\n\tnpm run build\n\tnpm test")).toBe(false);
    expect(isTabSeparated("a\tb\nonly one cell")).toBe(false);
    expect(isTabSeparated("a\tb\n1\t2\t3")).toBe(false);
    expect(gridFromText("build:\n\tnpm run build")).toBeNull();
    const blocks = plain("build:\n\tnpm run build\n\tnpm test")!;
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "paragraph", "paragraph"]);
    expect(plainText(blocks[1]!.text)).toBe("\tnpm run build");
  });
});

describe("Shift with the paste shortcut pastes plain text", () => {
  const shift = (e: Editor, on: boolean) => Object.assign((e.view as unknown as { input: Record<string, unknown> }).input, { shiftKey: on, lastKeyCode: 86 });
  const rich = () => clipboard({ "text/html": "<h2>Title</h2><ul><li><b>bold</b> item</li></ul>", "text/plain": "Title\n- **bold** item\nhttps://example.com" });

  test("the clipboard's text goes in line by line: no formatting, no blocks, no link", () => {
    const e = make([p("HelloWorld")]);
    e.commands.setTextSelection(6);
    shift(e, true);
    expect(handleEditorPaste(e.view, pasteEvent(rich()), null, { editable: true, insertFiles: vi.fn() })).toBe(true);
    expect(texts(e)).toEqual(["paragraph:HelloTitle@0", "paragraph:- **bold** item@0", "paragraph:https://example.comWorld@0"]);
    let marks = 0;
    e.state.doc.descendants((n) => void (marks += n.marks.length));
    expect(marks).toBe(0);
    e.destroy();
  });

  test("without Shift the same clipboard pastes its blocks", () => {
    const e = make([p("")]);
    e.commands.setTextSelection(1);
    shift(e, false);
    expect(handleEditorPaste(e.view, pasteEvent(rich()), null, { editable: true, insertFiles: vi.fn() })).toBe(true);
    expect(texts(e)).toEqual(["heading:Title@0", "bulleted:bold item@0"]);
    e.destroy();
  });

  test("in a code block the text goes in as it is", () => {
    const e = make([{ type: "codeBlock", attrs: { depth: 0, language: "plaintext" }, content: [{ type: "text", text: "a" }] }]);
    e.commands.setTextSelection(2);
    shift(e, true);
    handleEditorPaste(e.view, pasteEvent(clipboard({ "text/plain": "\n- b\r\n- c" })), null, { editable: true, insertFiles: vi.fn() });
    expect(texts(e)).toEqual(["codeBlock:a\n- b\n- c@0"]);
    e.destroy();
  });

  test("a single address pasted plain stays text", () => {
    const e = make([p("see ")]);
    e.commands.setTextSelection(5);
    shift(e, true);
    handleEditorPaste(e.view, pasteEvent(clipboard({ "text/plain": "https://example.com" })), null, { editable: true, insertFiles: vi.fn() });
    expect(texts(e)).toEqual(["paragraph:see https://example.com@0"]);
    expect(e.state.doc.rangeHasMark(0, e.state.doc.content.size, e.schema.marks.link!)).toBe(false);
    e.destroy();
  });
});
