import { describe, expect, test } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import { ALL_MARKS, ALL_NODES, BlockFormat } from "@/components/editor/extensions";
import { BlockIdentity, BlockKeymap, MarkdownShortcuts } from "@/components/editor/plugins";
import { clipboardBlocks, htmlToBlocks, insertPastedBlocks, looksLikeMarkdown } from "@/components/editor/paste";
import { sliceToText } from "@/components/editor/clipboardText";
import { LIMITS, markdownToBlocks, plainText, validateWireBlock, type WireBlock } from "@folevi/editor-schema";

const p = (text: string, depth = 0): JSONContent => ({ type: "paragraph", attrs: { depth }, content: text ? [{ type: "text", text }] : [] });
const make = (content: JSONContent[]) => new Editor({ extensions: [...ALL_NODES, ...ALL_MARKS, BlockFormat, UndoRedo, BlockIdentity, BlockKeymap, MarkdownShortcuts], content: { type: "doc", content } });
/** Each block as type:text, with the index of its parent (or -1). */
const shape = (blocks: WireBlock[]) => blocks.map((b) => `${b.type}:${plainText(b.text)}^${blocks.findIndex((x) => x.id === b.parentId)}`);
const clipboard = (data: Record<string, string>) => ({ getData: (type: string) => data[type] ?? "" }) as DataTransfer;

describe("pasted HTML keeps blocks at their depth", () => {
  test("code inside a numbered item nests under it, and the numbering goes on", () => {
    const blocks = htmlToBlocks("<ol><li><p>Step</p><pre>npm i</pre></li><li>Step two</li></ol>");
    expect(shape(blocks)).toEqual(["numbered:Step^-1", "code:^0", "numbered:Step two^-1"]);
  });

  test("a paragraph after code in a <details> stays in the toggle, not under the code", () => {
    const blocks = htmlToBlocks("<details><summary>T</summary><p>a</p><pre>x</pre><p>b</p></details>");
    expect(shape(blocks)).toEqual(["toggle:T^-1", "paragraph:a^0", "code:^0", "paragraph:b^0"]);
  });

  test("a list after a heading in an item stays under the item", () => {
    const blocks = htmlToBlocks("<ul><li><p>A</p><h3>H</h3><ul><li>B</li></ul></li></ul>");
    expect(shape(blocks)).toEqual(["bulleted:A^-1", "heading:H^0", "bulleted:B^0"]);
  });

  test("dividers and tables inside an item nest too", () => {
    const blocks = htmlToBlocks("<ul><li><p>A</p><hr><table><tr><td>c</td></tr></table></li></ul>");
    expect(shape(blocks)).toEqual(["bulleted:A^-1", "divider:^0", "table:^0"]);
  });
});

describe("pasted code keeps its lines", () => {
  test("VS Code's HTML becomes one code block with its indentation", () => {
    const html =
      '<meta charset="utf-8"><div style="color: #d4d4d4;background-color: #1e1e1e;font-family: Menlo, Monaco, \'Courier New\', monospace;font-size: 12px;white-space: pre;">' +
      '<div><span style="color: #569cd6;">function</span><span> f() {</span></div><div><span>    return 1;</span></div><div><br></div><div><span>}</span></div></div>';
    const blocks = htmlToBlocks(html);
    expect(blocks.map((b) => b.type)).toEqual(["code"]);
    expect(blocks[0]!.props.code).toBe("function f() {\n    return 1;\n\n}");
  });

  test("a code-font container alone is code; pre-wrap text isn't", () => {
    expect(htmlToBlocks('<div style="font-family: Consolas, monospace"><div>a</div><div>  b</div></div>').map((b) => b.props.code)).toEqual(["a\n  b"]);
    expect(htmlToBlocks('<div style="white-space: pre-wrap"><div>a</div></div>').map((b) => b.type)).toEqual(["paragraph"]);
  });

  test("<br> inside <pre> is a line break", () => {
    expect(htmlToBlocks("<pre>a<br>b</pre>")[0]!.props.code).toBe("a\nb");
    expect(htmlToBlocks('<pre><code class="language-js">x\n  y\n</code></pre>')[0]!.props).toMatchObject({ language: "javascript", code: "x\n  y" });
  });
});

describe("pasted text over the limits", () => {
  test("an overlong HTML paragraph becomes several valid paragraphs", () => {
    const blocks = htmlToBlocks(`<p>${"word ".repeat(9000)}</p>`);
    expect(blocks.length).toBe(3);
    for (const b of blocks) expect(validateWireBlock(b)).toEqual([]);
  });

  test("an overlong plain line is cut too", () => {
    const e = make([p("")]);
    const blocks = clipboardBlocks(e.view, clipboard({ "text/plain": `${"x ".repeat(LIMITS.maxTextLength)}\nsecond` }))!;
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "paragraph", "paragraph"]);
    for (const b of blocks) expect(validateWireBlock(b)).toEqual([]);
    e.destroy();
  });
});

describe("plain text read as Markdown", () => {
  test("a letter with a list keeps its first lines apart", () => {
    const e = make([p("")]);
    const blocks = clipboardBlocks(e.view, clipboard({ "text/plain": "Dear John,\nHere are the items:\n- a\n- b" }))!;
    expect(blocks.map((b) => [b.type, plainText(b.text)])).toEqual([
      ["paragraph", "Dear John,\nHere are the items:"],
      ["bulleted", "a"],
      ["bulleted", "b"],
    ]);
    e.destroy();
  });

  test("# comments in code-like text are not headings", () => {
    expect(looksLikeMarkdown("x = 1\n# add one\nx += 1")).toBe(false);
    expect(looksLikeMarkdown("# Title\n\nSome text")).toBe(true);
    expect(looksLikeMarkdown("Intro\n**bold** words")).toBe(true);
    expect(looksLikeMarkdown("a ** b ** c\nd")).toBe(false);
    const e = make([p("")]);
    const blocks = clipboardBlocks(e.view, clipboard({ "text/plain": "x = 1\n# add one\nx += 1" }))!;
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "paragraph", "paragraph"]);
    e.destroy();
  });

  test("ChatGPT-style Markdown still pastes as blocks", () => {
    const e = make([p("")]);
    const blocks = clipboardBlocks(e.view, clipboard({ "text/plain": "## Setup\n\n1. Install:\n\n   ```bash\n   npm i\n   ```\n2. Run it" }))!;
    expect(shape(blocks)).toEqual(["heading:Setup^-1", "numbered:Install:^-1", "code:^1", "numbered:Run it^-1"]);
    expect(blocks[2]!.props.code).toBe("npm i");
    e.destroy();
  });
});

describe("pasting into the middle of a to-do", () => {
  test("the second half is a fresh to-do without the task details", () => {
    const e = make([{ type: "todo", attrs: { id: "T1", depth: 0, checked: true, dueDate: "2026-10-05", reminderAt: 123, color: "blue" }, content: [{ type: "text", text: "HelloWorld" }] }]);
    e.commands.setTextSelection(6);
    insertPastedBlocks(e.view, markdownToBlocks("- a\n- b", { titleFromHeading: false }).blocks);
    const nodes: { type: string; text: string; attrs: Record<string, unknown> }[] = [];
    e.state.doc.forEach((n) => nodes.push({ type: n.type.name, text: n.textContent, attrs: n.attrs }));
    expect(nodes.map((n) => `${n.type}:${n.text}`)).toEqual(["todo:Hello", "bulleted:a", "bulleted:b", "todo:World"]);
    expect(nodes[0]!.attrs).toMatchObject({ id: "T1", checked: true, dueDate: "2026-10-05", reminderAt: 123 });
    const second = nodes[3]!.attrs;
    expect(second.id).not.toBe("T1");
    expect(second.checked).toBe(false);
    expect(second.dueDate ?? null).toBeNull();
    expect(second.reminderAt ?? null).toBeNull();
    expect(second.color).toBe("blue");
    e.destroy();
  });
});

describe("plain-text copy", () => {
  test("tables get a separator row, escaped pipes and mentions with their @", () => {
    const cell = (text: string) => [{ type: "text", text }];
    const e = make([
      { type: "table", attrs: { depth: 0, headerRow: true, rows: [[cell("a|b"), [{ type: "mention", userId: "u1", label: "Ada" }]], [cell("1"), cell("2")]] } },
      p(""),
    ]);
    const text = sliceToText(e.state.doc.slice(0, e.state.doc.child(0).nodeSize));
    expect(text).toBe("| a\\|b | @Ada |\n| --- | --- |\n| 1 | 2 |");
    const [table] = markdownToBlocks(text, { titleFromHeading: false }).blocks;
    expect(table!.type).toBe("table");
    expect(plainText((table!.props.rows as never[][][])[0]![0]!)).toBe("a|b");
    e.destroy();
  });

  test("nested quotes, callouts and headings keep their indent", () => {
    const e = make([
      { type: "bulleted", attrs: { depth: 0 }, content: [{ type: "text", text: "item" }] },
      { type: "quote", attrs: { depth: 1 }, content: [{ type: "text", text: "said" }] },
      { type: "callout", attrs: { depth: 1, tone: "note" }, content: [{ type: "text", text: "note" }] },
      { type: "heading", attrs: { depth: 1, level: 2 }, content: [{ type: "text", text: "H" }] },
    ]);
    expect(sliceToText(e.state.doc.slice(0, e.state.doc.content.size))).toBe("- item\n  > said\n  > note\n  ## H");
    e.destroy();
  });
});
