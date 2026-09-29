import { describe, expect, test } from "vitest";
import { Editor } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import { SCHEMA_VERSION, type WireBlock } from "@folevi/editor-schema";
import { ALL_MARKS, ALL_NODES } from "@/components/editor/extensions";
import { BlockIdentity } from "@/components/editor/plugins";
import { blocksToDoc, diffBlocks, docToBlocks } from "@/components/editor/convert";
import { FindReplace, findState, replaceAll, replaceCurrent, setFind } from "@/components/editor/findReplace";

const para = (id: string, text: string, rank: string): WireBlock => ({ id, type: "paragraph", parentId: null, rank, schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text }], props: {} });
const blocks = [para("b1", "The cat sat. The CAT ran.", "a"), para("b2", "No felines here", "b"), para("b3", "cat", "c")];

function makeEditor() {
  return new Editor({ extensions: [...ALL_NODES, ...ALL_MARKS, UndoRedo, BlockIdentity, FindReplace], content: blocksToDoc(blocks) });
}

const texts = (editor: Editor) => docToBlocks(editor.state.doc, new Map()).map((b) => b.text.map((n) => (n.type === "text" ? n.text : "")).join(""));

describe("find & replace", () => {
  test("finds every match, ignoring case unless asked", () => {
    const editor = makeEditor();
    setFind(editor, { query: "cat" }, false);
    expect(findState(editor).matches).toHaveLength(3);
    setFind(editor, { caseSensitive: true }, false);
    expect(findState(editor).matches).toHaveLength(2);
    // Each match covers exactly the query's text.
    for (const m of findState(editor).matches) expect(editor.state.doc.textBetween(m.from, m.to)).toBe("cat");
    // The current match wraps around.
    setFind(editor, { index: 2 }, false);
    expect(findState(editor).index).toBe(0);
    setFind(editor, { index: -1 }, false);
    expect(findState(editor).index).toBe(1);
    editor.destroy();
  });

  test("replace changes the current match and moves to the next; the edit is ordinary content (ids kept)", () => {
    const editor = makeEditor();
    const before = new Map(docToBlocks(editor.state.doc, new Map()).map((b) => [b.id, b]));
    setFind(editor, { query: "cat" }, false);
    expect(replaceCurrent(editor, "dog")).toBe(true);
    expect(texts(editor)).toEqual(["The dog sat. The CAT ran.", "No felines here", "cat"]);
    expect(findState(editor)).toMatchObject({ index: 0 });
    expect(findState(editor).matches).toHaveLength(2);
    const diff = diffBlocks(before, docToBlocks(editor.state.doc, before));
    expect(diff.deletes).toEqual([]);
    expect(diff.upserts.map((u) => [u.block.id, u.fields])).toEqual([["b1", ["content"]]]);
    // A replacement that still contains the query steps past it instead of looping on it.
    expect(replaceCurrent(editor, "cats")).toBe(true);
    expect(findState(editor).index).toBe(1);
    editor.destroy();
  });

  test("replace all is a single undo step", () => {
    const editor = makeEditor();
    setFind(editor, { query: "cat" }, false);
    expect(replaceAll(editor, "owl")).toBe(3);
    expect(texts(editor)).toEqual(["The owl sat. The owl ran.", "No felines here", "owl"]);
    expect(findState(editor).matches).toHaveLength(0);
    editor.commands.undo();
    expect(texts(editor)).toEqual(["The cat sat. The CAT ran.", "No felines here", "cat"]);
    editor.destroy();
  });

  test("nothing is replaced in a read-only editor", () => {
    const editor = makeEditor();
    editor.setEditable(false);
    setFind(editor, { query: "cat" }, false);
    expect(replaceCurrent(editor, "x")).toBe(false);
    expect(replaceAll(editor, "x")).toBe(0);
    expect(texts(editor)[0]).toBe("The cat sat. The CAT ran.");
    editor.destroy();
  });
});
