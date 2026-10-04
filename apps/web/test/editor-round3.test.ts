import { describe, expect, test } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import { TextSelection } from "@tiptap/pm/state";
import { ALL_MARKS, ALL_NODES, BlockFormat } from "@/components/editor/extensions";
import { BlockDecorations, BlockIdentity, BlockKeymap, MarkdownShortcuts, deleteVisibleRange } from "@/components/editor/plugins";
import { htmlToBlocks } from "@/components/editor/paste";
import { sliceToText } from "@/components/editor/clipboardText";
import { addressIn } from "@/components/editor/autolink";

const p = (text: string, depth = 0): JSONContent => ({ type: "paragraph", attrs: { depth }, content: text ? [{ type: "text", text }] : [] });
const make = (content: JSONContent[]) => new Editor({ extensions: [...ALL_NODES, ...ALL_MARKS, BlockFormat, UndoRedo, BlockIdentity, BlockKeymap, MarkdownShortcuts, BlockDecorations], content: { type: "doc", content } });
const lines = (e: Editor) => {
  const out: string[] = [];
  e.state.doc.forEach((n) => out.push(`${n.type.name}:${n.textContent}@${n.attrs.depth}`));
  return out;
};
const type = (e: Editor, text: string) => {
  for (const ch of text) {
    const { from, to } = e.state.selection;
    const handled = e.view.someProp("handleTextInput", (f) => f(e.view, from, to, ch, () => e.state.tr.insertText(ch, from, to)));
    if (!handled) e.view.dispatch(e.state.tr.insertText(ch, from, to));
  }
};

describe("editor round three", () => {
  test("Google Docs list levels, Word list paragraphs and <details> paste with their structure", () => {
    const gdocs = htmlToBlocks('<ul><li aria-level="1"><p>a</p></li><li aria-level="2"><p>b</p></li><li aria-level="3"><p>c</p></li></ul>');
    expect(gdocs.map((b) => b.parentId === null)).toEqual([true, false, false]);
    const word = htmlToBlocks(`<p style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">1.<span> </span></span>First</p><p style="mso-list:l0 level2 lfo1"><span style="mso-list:Ignore">·<span> </span></span>Inner</p>`);
    expect(word.map((b) => [b.type, (b.text[0] as { text: string }).text])).toEqual([["numbered", "First"], ["bulleted", "Inner"]]);
    const details = htmlToBlocks("<details open><summary>More</summary><p>inside</p></details>");
    expect(details.map((b) => b.type)).toEqual(["toggle", "paragraph"]);
    expect(details[0]!.props.collapsed).toBe(false);
  });

  test("callouts, mentions and page links survive copy and paste", () => {
    const e = make([
      { type: "callout", attrs: { depth: 0, tone: "note" }, content: [{ type: "text", text: "note it" }] },
      { type: "paragraph", attrs: { depth: 0 }, content: [{ type: "mention", attrs: { userId: "u1", label: "Ada" } }, { type: "text", text: " and " }, { type: "pageLink", attrs: { documentId: "d1", label: "Plans" } }] },
      p(""),
    ]);
    const end = e.state.doc.child(0).nodeSize + e.state.doc.child(1).nodeSize;
    const html = e.view.serializeForClipboard(e.state.doc.slice(0, end)).dom.innerHTML;
    e.commands.setTextSelection(e.state.doc.content.size - 1);
    e.view.pasteHTML(html, new Event("paste") as ClipboardEvent);
    const pasted = e.state.doc.child(2);
    expect(pasted.type.name).toBe("callout");
    expect(pasted.textContent).toBe("note it");
    const para = e.state.doc.child(3);
    expect(para.child(0).type.name).toBe("mention");
    expect(para.child(0).attrs).toMatchObject({ userId: "u1", label: "Ada" });
    expect(para.child(2).type.name).toBe("pageLink");
    e.destroy();
  });

  test("an inline Markdown shortcut keeps the formatting already there", () => {
    const e = make([{ type: "paragraph", attrs: { depth: 0 }, content: [{ type: "text", text: "x ", marks: [{ type: "italic" }] }] }]);
    e.commands.setTextSelection(3);
    e.commands.setMark("italic");
    type(e, "**b**");
    const b = e.state.doc.child(0).child(e.state.doc.child(0).childCount - 1);
    expect(b.text).toBe("b");
    expect(b.marks.map((m) => m.type.name).sort()).toEqual(["bold", "italic"]);
    e.destroy();
  });

  test("a range from text into code keeps the code a code block", () => {
    const e = make([p("alpha beta"), { type: "codeBlock", attrs: { depth: 0, language: "plaintext" }, content: [{ type: "text", text: "x = 1\ny = 2" }] }]);
    const codeStart = e.state.doc.child(0).nodeSize + 1;
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 8, codeStart + 5)));
    e.view.dispatch(deleteVisibleRange(e.state)!);
    expect(lines(e)).toEqual(["paragraph:alpha b@0", "codeBlock:\ny = 2@0"]);
    e.destroy();
  });

  test("numbering stays right while typing and after structural edits", () => {
    const e = make([{ type: "numbered", attrs: { depth: 0 }, content: [{ type: "text", text: "a" }] }, { type: "numbered", attrs: { depth: 0 }, content: [{ type: "text", text: "b" }] }]);
    const index = () => [...e.view.dom.querySelectorAll("[data-index]")].map((el) => el.getAttribute("data-index"));
    expect(index()).toEqual(["1", "2"]);
    e.commands.setTextSelection(2);
    type(e, "xyz");
    expect(index()).toEqual(["1", "2"]);
    e.commands.setTextSelection(1);
    e.view.someProp("handleKeyDown", (f) => f(e.view, new KeyboardEvent("keydown", { key: "Enter" })));
    expect(index()).toEqual(["1", "2", "3"]);
    e.destroy();
  });

  test("plain text for other apps is one line per block, Markdown-style", () => {
    const e = make([
      { type: "heading", attrs: { depth: 0, level: 2 }, content: [{ type: "text", text: "Plan" }] },
      { type: "bulleted", attrs: { depth: 0 }, content: [{ type: "text", text: "one" }] },
      { type: "todo", attrs: { depth: 1, checked: true }, content: [{ type: "text", text: "done" }] },
      { type: "numbered", attrs: { depth: 0 }, content: [{ type: "text", text: "first" }] },
      { type: "numbered", attrs: { depth: 0 }, content: [{ type: "text", text: "second" }] },
      p("end"),
    ]);
    expect(sliceToText(e.state.doc.slice(0, e.state.doc.content.size))).toBe("## Plan\n- one\n  - [x] done\n1. first\n2. second\nend");
    e.destroy();
  });

  test("addresses are recognised, other dotted words aren't", () => {
    expect(addressIn("involets.com")?.href).toBe("https://involets.com");
    expect(addressIn("(example.com)")?.text).toBe("example.com");
    expect(addressIn("www.example.org/page.")?.text).toBe("www.example.org/page");
    for (const w of ["notes.txt", "v2.final", "e.g.", "a.b"]) expect(addressIn(w)).toBeNull();
  });
});
