import { describe, expect, test } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import { NodeSelection } from "@tiptap/pm/state";
import { ALL_MARKS, ALL_NODES, BlockFormat } from "@/components/editor/extensions";
import { BlockIdentity, BlockKeymap, MarkdownShortcuts } from "@/components/editor/plugins";
import { htmlToBlocks } from "@/components/editor/paste";
import { blockToNode, pmInline } from "@/components/editor/convert";
import { SCHEMA_VERSION } from "@folevi/editor-schema";

const p = (text: string, depth = 0): JSONContent => ({ type: "paragraph", attrs: { depth }, content: text ? [{ type: "text", text }] : [] });
const make = (content: JSONContent[]) => new Editor({ extensions: [...ALL_NODES, ...ALL_MARKS, BlockFormat, UndoRedo, BlockIdentity, BlockKeymap, MarkdownShortcuts], content: { type: "doc", content } });
const lines = (e: Editor) => {
  const out: string[] = [];
  e.state.doc.forEach((n) => out.push(`${n.type.name}${n.attrs.level ?? ""}:${n.textContent}@${n.attrs.depth}`));
  return out;
};
// A real key press through the editor (Tiptap's keyboardShortcut command replays only document changes).
const key = (e: Editor, k: string) => {
  const event = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
  e.view.someProp("handleKeyDown", (f) => f(e.view, event));
};

describe("editor round two", () => {
  test("copied headings keep their level", () => {
    const e = make([{ type: "heading", attrs: { depth: 0, level: 1 }, content: [{ type: "text", text: "One" }] }, { type: "heading", attrs: { depth: 0, level: 3 }, content: [{ type: "text", text: "Three" }] }, p("")]);
    const html = e.view.serializeForClipboard(e.state.doc.slice(0, e.state.doc.child(0).nodeSize + e.state.doc.child(1).nodeSize)).dom.innerHTML;
    e.commands.setTextSelection(e.state.doc.content.size - 1);
    e.view.pasteHTML(html, new Event("paste") as ClipboardEvent);
    expect(lines(e).filter((l) => l.startsWith("heading"))).toEqual(["heading1:One@0", "heading3:Three@0", "heading1:One@0", "heading3:Three@0"]);
    e.destroy();
  });

  test("a sentence from a web page stays one line with its link and bold", () => {
    const blocks = htmlToBlocks('<span>Some text with </span><a href="https://example.com">a link</a><span> and </span><b>bold</b>');
    expect(blocks).toHaveLength(1);
    const text = blocks[0]!.text as { text: string; marks?: { type: string }[] }[];
    expect(text.map((t) => t.text).join("")).toBe("Some text with a link and bold");
    expect(text.find((t) => t.text === "a link")?.marks?.[0]?.type).toBe("link");
    expect(text.find((t) => t.text === "bold")?.marks?.[0]?.type).toBe("bold");
  });

  test("table cells and list items keep text wrapped in paragraphs", () => {
    const [table] = htmlToBlocks("<table><tr><td><p>a</p><p>b</p></td></tr></table>");
    expect(JSON.stringify(table!.props.rows)).toContain("a");
    expect(JSON.stringify(table!.props.rows)).toContain("b");
    const list = htmlToBlocks("<ul><li><p>first</p><p>second</p></li></ul>");
    expect(list.map((b) => b.type)).toEqual(["bulleted", "paragraph"]);
  });

  test("a hidden image in a collapsed toggle is never selected by Backspace", () => {
    const e = make([{ type: "toggle", attrs: { depth: 0, collapsed: true }, content: [{ type: "text", text: "T" }] }, { type: "image", attrs: { depth: 1, url: "https://example.com/a.png" } }, p("x")]);
    let pos = 0;
    e.state.doc.forEach((n, o, i) => {
      if (i === 2) pos = o + 1;
    });
    e.commands.setTextSelection(pos);
    key(e, "Backspace");
    expect(e.state.selection instanceof NodeSelection).toBe(false);
    expect(lines(e)).toContain("image:@1");
    e.destroy();
  });

  test("undo brings back nesting the identity fix-up changed", () => {
    const e = make([p("a"), p("kid", 1), p("g", 2)]);
    e.commands.setTextSelection(2);
    key(e, "Delete");
    e.commands.undo();
    expect(lines(e)).toEqual(["paragraph:a@0", "paragraph:kid@1", "paragraph:g@2"]);
    e.destroy();
  });

  test("a line break in stored text is a line break in the editor and round-trips", () => {
    const block = { id: "b1", type: "paragraph", parentId: null, rank: "a0", schemaVersion: SCHEMA_VERSION, text: [{ type: "text" as const, text: "one\ntwo", marks: [{ type: "bold" as const }] }], props: {} };
    const e = make([blockToNode(block, 0)]);
    expect(e.state.doc.child(0).child(1).type.name).toBe("hardBreak");
    expect(pmInline(e.state.doc.child(0))).toEqual(block.text);
    e.destroy();
  });

  test("Tab on several blocks does nothing when the first can't go deeper", () => {
    const e = make([p("a"), p("b"), p("c")]);
    e.commands.setTextSelection({ from: 2, to: e.state.doc.content.size - 1 });
    key(e, "Tab");
    expect(lines(e)).toEqual(["paragraph:a@0", "paragraph:b@0", "paragraph:c@0"]);
    e.destroy();
  });
});
