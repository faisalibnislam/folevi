// Reading plain text when it is pasted (paste.ts): a "---" first line, blank lines, bullet characters, tabs
// inside text, and the limits a note and a code block have (said through the app's message event).
import { describe, expect, test, vi } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import { ALL_MARKS, ALL_NODES, BlockFormat } from "@/components/editor/extensions";
import { BlockIdentity, BlockKeymap, MarkdownShortcuts } from "@/components/editor/plugins";
import { TABLE_CUT_NOTICE, clipboardBlocks, handleEditorPaste, insertPastedBlocks, pastePlainText, textTableIsCut } from "@/components/editor/paste";
import { LIMITS, flattenTree, plainText } from "@folevi/editor-schema";

const line = (type: string, text: string, attrs: Record<string, unknown> = {}): JSONContent => ({ type, attrs: { depth: 0, ...attrs }, content: text ? [{ type: "text", text }] : [] });
const p = (text: string, attrs: Record<string, unknown> = {}) => line("paragraph", text, attrs);
const make = (content: JSONContent[]) => new Editor({ extensions: [...ALL_NODES, ...ALL_MARKS, BlockFormat, UndoRedo, BlockIdentity, BlockKeymap, MarkdownShortcuts], content: { type: "doc", content } });
const texts = (e: Editor) => {
  const out: string[] = [];
  e.state.doc.forEach((n) => out.push(`${n.type.name}:${n.textContent}@${n.attrs.depth}`));
  return out;
};
function clipboard(data: Record<string, string>, files: File[] = []): DataTransfer {
  return { getData: (type: string) => data[type] ?? "", files } as unknown as DataTransfer;
}
const pasteEvent = (data: DataTransfer) => ({ clipboardData: data, preventDefault: vi.fn() }) as unknown as ClipboardEvent;
/** What plain text becomes on an empty line: "type:text" per block, two spaces per level. */
const read = (text: string) => {
  const e = make([p("")]);
  const blocks = clipboardBlocks(e.view, clipboard({ "text/plain": text }));
  e.destroy();
  return blocks ? flattenTree(blocks).map((entry) => `${"  ".repeat(entry.depth)}${entry.block.type}:${plainText(entry.block.text)}`) : null;
};
/** What the editor said through the app's message event while `run` ran. */
function messages(run: () => void): string[] {
  const said: string[] = [];
  const onError = (e: Event) => void said.push(String((e as CustomEvent<unknown>).detail));
  window.addEventListener("folevi:error", onError);
  try {
    run();
  } finally {
    window.removeEventListener("folevi:error", onError);
  }
  return said;
}

describe("a pasted first line of --- is a divider (P6)", () => {
  test("nothing between two dividers is lost to front matter", () => {
    expect(read("---\nFoo bar\n- item\n---\nAfter")).toEqual(["divider:", "paragraph:Foo bar", "bulleted:item", "divider:", "paragraph:After"]);
  });

  test("text that really looks like front matter is kept as text too", () => {
    expect(read("---\ntitle: Plan\ntags: a\n---\n- one")).toEqual(["divider:", "paragraph:title: Plan\ntags: a", "divider:", "bulleted:one"]);
  });
});

describe("blank lines (P15)", () => {
  test("one blank line between two lines only separates them, with or without Markdown further down", () => {
    expect(read("First paragraph.\n\nSecond paragraph.")).toEqual(["paragraph:First paragraph.", "paragraph:Second paragraph."]);
    expect(read("First paragraph.\n\nSecond paragraph.\n\n- item")).toEqual(["paragraph:First paragraph.", "paragraph:Second paragraph.", "bulleted:item"]);
  });

  test("two or more blank lines leave one empty line; blank lines at either end are dropped", () => {
    expect(read("one\n\n\n\ntwo\nthree")).toEqual(["paragraph:one", "paragraph:", "paragraph:two", "paragraph:three"]);
    expect(read("\n\none\ntwo\n\n\n")).toEqual(["paragraph:one", "paragraph:two"]);
  });

  test("pastePlainText (the menu's and the shortcut's plain paste) follows the same rule and makes list items in a list", () => {
    const e = make([line("bulleted", "first"), line("bulleted", "")]);
    e.commands.setTextSelection(e.state.doc.content.size - 1);
    expect(pastePlainText(e.view, "one\n\ntwo\n- **three**")).toBe(true);
    expect(texts(e)).toEqual(["bulleted:first@0", "bulleted:one@0", "bulleted:two@0", "bulleted:- **three**@0"]);
    e.destroy();
  });
});

describe("bullet characters start list items", () => {
  test("• and ◦ lines (a PDF, Messages, Notes) are a list, nested by their indent", () => {
    expect(read("• one\n• two\n\t◦ sub")).toEqual(["bulleted:one", "bulleted:two", "  bulleted:sub"]);
    expect(read("Shopping\n•milk\n● eggs")).toEqual(["paragraph:Shopping", "bulleted:milk", "bulleted:eggs"]);
  });

  test("one such line pasted into a sentence keeps its characters", () => {
    const e = make([p("HelloWorld")]);
    e.commands.setTextSelection(6);
    insertPastedBlocks(e.view, clipboardBlocks(e.view, clipboard({ "text/plain": "• 5 degrees" }))!);
    expect(texts(e)).toEqual(["paragraph:Hello• 5 degreesWorld@0"]);
    e.destroy();
  });
});

describe("tabs inside text", () => {
  test("the Markdown route keeps a tab in a line's text, and still nests by a tab at its start", () => {
    const e = make([p("")]);
    const blocks = flattenTree(clipboardBlocks(e.view, clipboard({ "text/plain": "- item\twith tab\n\t- sub\tb" }))!);
    expect(blocks.map((entry) => `${entry.depth}:${plainText(entry.block.text)}`)).toEqual(["0:item\twith tab", "1:sub\tb"]);
    e.destroy();
  });
});

describe("the limits a paste can pass (P14)", () => {
  const filler = (n: number) => Array.from({ length: n }, (_, i) => p(`existing ${i}`));
  /** A note at its limit is thousands of blocks: slow to set up when every test file runs at once. */
  const LONG = 30_000;

  test("more plain lines than the note has room for are kept, together in fewer paragraphs, and it is said", () => {
    const e = make([...filler(LIMITS.maxBlocksPerDocument - 10), p("")]);
    e.commands.setTextSelection(e.state.doc.content.size - 1);
    const lines = Array.from({ length: 600 }, (_, i) => `pasted line ${i}`);
    const said = messages(() => {
      expect(handleEditorPaste(e.view, pasteEvent(clipboard({ "text/plain": lines.join("\n") })), null, { editable: true, insertFiles: vi.fn() })).toBe(true);
    });
    expect(said).toEqual(["That paste has more lines than this note has room for, so its lines were put together in 1 paragraph."]);
    expect(e.state.doc.childCount).toBe(LIMITS.maxBlocksPerDocument - 9);
    expect(e.state.doc.lastChild!.textContent).toBe(lines.join(""));
    let breaks = 0;
    e.state.doc.lastChild!.forEach((n) => void (breaks += n.type.name === "hardBreak" ? 1 : 0));
    expect(breaks).toBe(lines.length - 1);
    e.destroy();
  }, LONG);

  test("blocks that are not plain lines are not pasted into a note without room, and the note is unchanged", () => {
    const e = make([...filler(LIMITS.maxBlocksPerDocument - 10), p("")]);
    e.commands.setTextSelection(e.state.doc.content.size - 1);
    const before = e.state.doc;
    const list = Array.from({ length: 50 }, (_, i) => `- item ${i}`).join("\n");
    const said = messages(() => {
      expect(handleEditorPaste(e.view, pasteEvent(clipboard({ "text/plain": list })), null, { editable: true, insertFiles: vi.fn() })).toBe(true);
    });
    expect(said).toEqual(["That paste is too large for this note. It would add 50 blocks, and the note has room for 10 more."]);
    expect(e.state.doc.eq(before)).toBe(true);
    e.destroy();
  }, LONG);

  test("a full note says it is full", () => {
    const e = make(filler(LIMITS.maxBlocksPerDocument));
    e.commands.setTextSelection(e.state.doc.content.size - 1);
    const said = messages(() => insertPastedBlocks(e.view, clipboardBlocks(make([p("")]).view, clipboard({ "text/plain": "- a\n- b" }))!));
    expect(said).toEqual(["This note is full, so nothing was pasted. A note holds up to 5,000 blocks."]);
    expect(e.state.doc.childCount).toBe(LIMITS.maxBlocksPerDocument);
    e.destroy();
  }, LONG);

  test("one line longer than a block's text may be is cut into several blocks, each within the limit", () => {
    const long = "word ".repeat(LIMITS.maxTextLength / 2).trim();
    const e = make([p("")]);
    e.commands.setTextSelection(1);
    expect(handleEditorPaste(e.view, pasteEvent(clipboard({ "text/plain": long })), null, { editable: true, insertFiles: vi.fn() })).toBe(true);
    expect(e.state.doc.childCount).toBeGreaterThan(1);
    const parts: string[] = [];
    e.state.doc.forEach((n) => {
      expect(n.textContent.length).toBeLessThanOrEqual(LIMITS.maxTextLength);
      parts.push(n.textContent);
    });
    expect(parts.join(" ")).toBe(long);
    e.destroy();
  });

  test("a paste that fits says nothing", () => {
    const e = make([p("")]);
    e.commands.setTextSelection(1);
    expect(messages(() => handleEditorPaste(e.view, pasteEvent(clipboard({ "text/plain": "one\ntwo" })), null, { editable: true, insertFiles: vi.fn() }))).toEqual([]);
    expect(texts(e)).toEqual(["paragraph:one@0", "paragraph:two@0"]);
    e.destroy();
  });

  test("text pasted into a code block over its length continues in more code blocks of the same language", () => {
    const e = make([{ type: "codeBlock", attrs: { depth: 0, language: "python" }, content: [{ type: "text", text: "start\nend" }] }, p("after")]);
    e.commands.setTextSelection(7);
    const pasted = Array.from({ length: 25000 }, (_, i) => `row ${i}`).join("\n");
    expect(pasted.length).toBeGreaterThan(LIMITS.maxCodeLength);
    expect(handleEditorPaste(e.view, pasteEvent(clipboard({ "text/plain": pasted })), null, { editable: true, insertFiles: vi.fn() })).toBe(true);
    const code: string[] = [];
    e.state.doc.forEach((n) => {
      if (n.type.name !== "codeBlock") return;
      expect(n.attrs.language).toBe("python");
      expect(n.textContent.length).toBeLessThanOrEqual(LIMITS.maxCodeLength);
      code.push(n.textContent);
    });
    expect(code.length).toBeGreaterThan(1);
    expect(code.join("\n")).toBe(`start\n${pasted}end`);
    expect(e.state.doc.lastChild!.textContent).toBe("after");
    const ids = new Set<string>();
    e.state.doc.forEach((n) => void ids.add(String(n.attrs.id)));
    expect(ids.size).toBe(e.state.doc.childCount);
    // One undo step for the whole paste.
    e.commands.undo();
    expect(texts(e)).toEqual(["codeBlock:start\nend@0", "paragraph:after@0"]);
    e.destroy();
  });

  test("a Markdown code fence over the length is split the same way", () => {
    const body = Array.from({ length: 25000 }, (_, i) => `row ${i}`).join("\n");
    const e = make([p("")]);
    const blocks = clipboardBlocks(e.view, clipboard({ "text/plain": "```js\n" + body + "\n```" }))!;
    expect(blocks.length).toBeGreaterThan(1);
    expect(blocks.every((b) => b.type === "code" && (b.props as { code: string; language: string }).code.length <= LIMITS.maxCodeLength && (b.props as { language: string }).language === "javascript")).toBe(true);
    expect(blocks.map((b) => (b.props as { code: string }).code).join("\n")).toBe(body);
    e.destroy();
  });

  test("rows of tab-separated cells past a table's size are cut, and the paste says so", () => {
    const rows = Array.from({ length: LIMITS.maxTableRows + 20 }, (_, i) => `${i}\tname ${i}`).join("\n");
    expect(textTableIsCut(rows)).toBe(true);
    expect(textTableIsCut("a\tb\n1\t2")).toBe(false);
    const e = make([p("")]);
    e.commands.setTextSelection(1);
    const said = messages(() => handleEditorPaste(e.view, pasteEvent(clipboard({ "text/plain": rows })), null, { editable: true, insertFiles: vi.fn() }));
    expect(said).toEqual([TABLE_CUT_NOTICE]);
    expect(TABLE_CUT_NOTICE).toBe("That table was too large to paste whole. It was cut to 200 rows and 20 columns.");
    expect((e.state.doc.child(0).attrs.rows as unknown[]).length).toBe(LIMITS.maxTableRows);
    e.destroy();
  });
});
