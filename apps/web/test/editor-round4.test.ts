import { describe, expect, test } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { ALL_MARKS, ALL_NODES, BlockFormat } from "@/components/editor/extensions";
import { BlockDecorations, BlockIdentity, BlockKeymap, MarkdownShortcuts } from "@/components/editor/plugins";
import { changeDepth, turnInto } from "@/components/editor/commands";
import { findMatches } from "@/components/editor/findReplace";
import { LIMITS } from "@folevi/editor-schema";

const p = (text: string, depth = 0): JSONContent => ({ type: "paragraph", attrs: { depth }, content: text ? [{ type: "text", text }] : [] });
const make = (content: JSONContent[]) => new Editor({ extensions: [...ALL_NODES, ...ALL_MARKS, BlockFormat, UndoRedo, BlockIdentity, BlockKeymap, MarkdownShortcuts, BlockDecorations], content: { type: "doc", content } });
const key = (e: Editor, k: string, extra: KeyboardEventInit = {}) => e.view.someProp("handleKeyDown", (f) => f(e.view, new KeyboardEvent("keydown", { key: k, ...extra })));
const startOf = (e: Editor, index: number) => {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += e.state.doc.child(i).nodeSize;
  return pos + 1;
};

describe("editor round four", () => {
  test("copied HTML has real lists, tables and images for other apps, and still pastes back as blocks", () => {
    const e = make([
      { type: "bulleted", attrs: { depth: 0 }, content: [{ type: "text", text: "one" }] },
      { type: "bulleted", attrs: { depth: 0 }, content: [{ type: "text", text: "two" }] },
      { type: "numbered", attrs: { depth: 0 }, content: [{ type: "text", text: "first" }] },
      { type: "table", attrs: { depth: 0, headerRow: true, rows: [[[{ type: "text", text: "A" }], [{ type: "text", text: "B" }]], [[{ type: "text", text: "1" }], [{ type: "text", text: "2" }]]] } },
      { type: "image", attrs: { depth: 0, url: "https://example.com/a.png", alt: "pic" } },
      p(""),
    ]);
    let end = 0;
    for (let i = 0; i < 5; i++) end += e.state.doc.child(i).nodeSize;
    const html = e.view.serializeForClipboard(e.state.doc.slice(0, end)).dom.innerHTML;
    const dom = new DOMParser().parseFromString(html, "text/html");
    expect(dom.querySelectorAll("ul > li").length).toBe(2);
    expect(dom.querySelectorAll("ul").length).toBe(1);
    expect(dom.querySelectorAll("ol > li").length).toBe(1);
    expect([...dom.querySelectorAll("th")].map((c) => c.textContent)).toEqual(["A", "B"]);
    expect([...dom.querySelectorAll("td")].map((c) => c.textContent)).toEqual(["1", "2"]);
    expect(dom.querySelector("img")?.getAttribute("src")).toBe("https://example.com/a.png");
    // Back into a note: the same blocks.
    e.commands.setTextSelection(e.state.doc.content.size - 1);
    e.view.pasteHTML(html, new Event("paste") as ClipboardEvent);
    const types: string[] = [];
    e.state.doc.forEach((n) => types.push(n.type.name));
    expect(types.slice(5, 10)).toEqual(["bulleted", "bulleted", "numbered", "table", "image"]);
    expect(e.state.doc.child(8).attrs.rows).toEqual(e.state.doc.child(3).attrs.rows);
    e.destroy();
  });

  test("Backspace on an empty line under an image removes the line and selects the image", () => {
    const e = make([p("a"), { type: "image", attrs: { depth: 0, url: "https://example.com/a.png" } }, p(""), p("next")]);
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, startOf(e, 2))));
    key(e, "Backspace");
    expect(e.state.doc.childCount).toBe(3);
    expect(e.state.selection).toBeInstanceOf(NodeSelection);
    expect((e.state.selection as NodeSelection).node.type.name).toBe("image");
    e.destroy();
  });

  test("Tab at the depth limit leaves a block alone rather than flattening its children", () => {
    const max = LIMITS.maxDepth;
    const e = make([p("anchor", max - 2), p("x", max - 1), p("child", max)]);
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, startOf(e, 1))));
    changeDepth(e, 1);
    const depths: number[] = [];
    e.state.doc.forEach((n) => depths.push(Number(n.attrs.depth)));
    expect(depths).toEqual([max - 2, max - 1, max]);
    e.destroy();
  });

  test("Turn into code keeps line breaks and the text of mentions", () => {
    const e = make([
      {
        type: "paragraph",
        attrs: { depth: 0 },
        content: [{ type: "text", text: "one" }, { type: "hardBreak" }, { type: "text", text: "two " }, { type: "mention", attrs: { userId: "u", label: "Ann" } }],
      },
    ]);
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 2)));
    turnInto(e, "codeBlock");
    expect(e.state.doc.child(0).type.name).toBe("codeBlock");
    expect(e.state.doc.child(0).textContent).toBe("one\ntwo @Ann");
    e.destroy();
  });

  test("find ignores case for Greek words ending in a final sigma", () => {
    const e = make([p("ο δρόμος ΟΔΟΣ")]);
    expect(findMatches(e.state.doc, "ΟΔΟΣ", false)).toHaveLength(1);
    expect(findMatches(e.state.doc, "οδοσ", false)).toHaveLength(1);
    e.destroy();
  });
});
