import { describe, expect, test } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import { NodeSelection } from "@tiptap/pm/state";
import { ALL_MARKS, ALL_NODES } from "@/components/editor/extensions";
import { BlockIdentity, BlockKeymap, MarkdownShortcuts } from "@/components/editor/plugins";
import { blocksInSelection, deleteBlocks, moveSubtreeTo, turnInto } from "@/components/editor/commands";
import { insertPastedBlocks } from "@/components/editor/paste";
import { markdownToBlocks } from "@folevi/editor-schema";

const p = (text: string, depth = 0, extra: Record<string, unknown> = {}): JSONContent => ({ type: "paragraph", attrs: { depth, ...extra }, content: text ? [{ type: "text", text }] : [] });

function make(content: JSONContent[]) {
  return new Editor({ extensions: [...ALL_NODES, ...ALL_MARKS, UndoRedo, BlockIdentity, BlockKeymap, MarkdownShortcuts], content: { type: "doc", content } });
}
const texts = (e: Editor) => {
  const out: string[] = [];
  e.state.doc.forEach((n) => out.push(`${n.type.name}:${n.textContent}@${n.attrs.depth}`));
  return out;
};

describe("editor fixes", () => {
  test("a selected divider is the only block a command acts on", () => {
    const e = make([p("a"), { type: "divider", attrs: { depth: 0 } }, p("b")]);
    e.view.dispatch(e.state.tr.setSelection(NodeSelection.create(e.state.doc, 3)));
    expect(blocksInSelection(e.state).map((r) => r.node.type.name)).toEqual(["divider"]);
    e.destroy();
  });

  test("deleting a block takes its nested blocks with it", () => {
    const e = make([p("parent"), p("child", 1), p("next")]);
    deleteBlocks(e, [0]);
    expect(texts(e)).toEqual(["paragraph:next@0"]);
    e.destroy();
  });

  test("code turned into text becomes one line per block, keeping the id on the first", () => {
    const e = make([{ type: "codeBlock", attrs: { id: "C1", depth: 0, language: "plaintext" }, content: [{ type: "text", text: "one\ntwo" }] }]);
    e.commands.setTextSelection(2);
    turnInto(e, "paragraph");
    expect(texts(e)).toEqual(["paragraph:one@0", "paragraph:two@0"]);
    expect(e.state.doc.child(0).attrs.id).toBe("C1");
    e.destroy();
  });

  test("dropping a block under a collapsed toggle opens it", () => {
    const e = make([{ type: "toggle", attrs: { depth: 0, collapsed: true }, content: [{ type: "text", text: "t" }] }, p("x")]);
    const moved = moveSubtreeTo(e.state, 1, 1, 1)!;
    e.view.dispatch(moved.tr);
    expect(e.state.doc.child(0).attrs.collapsed).toBe(false);
    e.destroy();
  });

  test("pasted blocks land at the caret, splitting the line", () => {
    const e = make([p("HelloWorld")]);
    e.commands.setTextSelection(6);
    insertPastedBlocks(e.view, markdownToBlocks("- a\n- b", { titleFromHeading: false }).blocks);
    expect(texts(e)).toEqual(["paragraph:Hello@0", "bulleted:a@0", "bulleted:b@0", "paragraph:World@0"]);
    e.destroy();
  });

  test("pasted copies of blocks get new ids", () => {
    const e = make([p("keep", 0, { id: "A1" })]);
    const html = '<p data-block="paragraph" data-block-id="A1" data-pm-slice="0 0 []">copy</p>';
    e.view.pasteHTML(html, new Event("paste") as ClipboardEvent);
    const ids: string[] = [];
    e.state.doc.forEach((n) => ids.push(n.attrs.id));
    expect(ids.filter((id) => id === "A1")).toHaveLength(1);
    e.destroy();
  });
});
