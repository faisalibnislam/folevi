// Columns in the editor (components/editor/columns/): inserting a row, the keys at a column's own level,
// dropping a block beside another, and the repair that keeps rows in shape after local edits.
import { describe, expect, test } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import { TextSelection } from "@tiptap/pm/state";
import { ALL_MARKS, ALL_NODES } from "@/components/editor/extensions";
import { BlockIdentity, BlockKeymap } from "@/components/editor/plugins";
import { ColumnBlock, ColumnsBlock, ColumnsExtension } from "@/components/editor/columns/columnsExtension";
import { applySideDrop, insertColumns, setColumnShares } from "@/components/editor/columns/columnsCommands";
import { columnsModel } from "@/components/editor/columns/columnsModel";
import { changeDepth, moveSubtreeTo } from "@/components/editor/commands";
import { docToBlocks } from "@/components/editor/convert";

const p = (text: string, depth = 0): JSONContent => ({ type: "paragraph", attrs: { depth }, content: text ? [{ type: "text", text }] : [] });
const row = (depth = 0): JSONContent => ({ type: "columns", attrs: { depth } });
const col = (depth = 1, width: number | null = null): JSONContent => ({ type: "column", attrs: { depth, width } });

function make(content: JSONContent[]) {
  return new Editor({ extensions: [...ALL_NODES, ColumnsBlock, ColumnBlock, ...ALL_MARKS, UndoRedo, BlockIdentity, BlockKeymap, ColumnsExtension], content: { type: "doc", content } });
}
const lines = (e: Editor) => {
  const out: string[] = [];
  e.state.doc.forEach((n) => out.push(`${n.type.name}${n.textContent ? `:${n.textContent}` : ""}@${n.attrs.depth}`));
  return out;
};
/** Puts the caret in the line whose text is `text`, at `at` ("start" or "end"). */
function caret(e: Editor, text: string, at: "start" | "end" = "start") {
  let pos = -1;
  e.state.doc.forEach((n, offset) => {
    if (pos < 0 && n.textContent === text) pos = at === "start" ? offset + 1 : offset + n.nodeSize - 1;
  });
  e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, pos)));
}
const key = (e: Editor, k: string) => e.commands.keyboardShortcut(k);

describe("columns in the editor", () => {
  test("inserting a row puts the caret in its first column, in place of an empty line", () => {
    const e = make([p("Intro"), p("")]);
    caret(e, "");
    insertColumns(e, 3);
    expect(lines(e)).toEqual(["paragraph:Intro@0", "columns@0", "column@1", "paragraph@2", "column@1", "paragraph@2", "column@1", "paragraph@2"]);
    e.commands.insertContent("Left");
    expect(e.state.doc.child(3).textContent).toBe("Left");
    // Saved as a tree: the row, its columns, their blocks.
    const blocks = docToBlocks(e.state.doc, new Map());
    const [, r, c1, left] = blocks;
    expect(c1!.parentId).toBe(r!.id);
    expect(left!.parentId).toBe(c1!.id);
    e.destroy();
  });

  test("a row inserted from inside a column goes after the row", () => {
    const e = make([row(), col(), p("a", 2), col(), p("b", 2), p("after")]);
    caret(e, "b");
    insertColumns(e, 2);
    expect(columnsModel(e.state.doc).rows.map((r) => r.index)).toEqual([0, 5]);
    e.destroy();
  });

  test("Backspace joins lines within a column, never across columns", () => {
    const e = make([row(), col(), p("one", 2), p("two", 2), col(), p("three", 2)]);
    caret(e, "two");
    key(e, "Backspace");
    expect(lines(e)).toEqual(["columns@0", "column@1", "paragraph:onetwo@2", "column@1", "paragraph:three@2"]);
    caret(e, "three");
    key(e, "Backspace");
    expect(lines(e)).toEqual(["columns@0", "column@1", "paragraph:onetwo@2", "column@1", "paragraph:three@2"]);
    e.destroy();
  });

  test("Backspace in a column's emptied only line removes the column, and a row of one becomes its blocks", () => {
    const e = make([p("before"), row(), col(), p("keep", 2), col(), p("", 2), p("after")]);
    let pos = 0;
    e.state.doc.forEach((n, offset, i) => {
      if (i === 5) pos = offset + 1;
    });
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, pos)));
    key(e, "Backspace");
    expect(lines(e)).toEqual(["paragraph:before@0", "paragraph:keep@0", "paragraph:after@0"]);
    // One undo brings the row back.
    e.commands.undo();
    expect(lines(e)).toEqual(["paragraph:before@0", "columns@0", "column@1", "paragraph:keep@2", "column@1", "paragraph@2", "paragraph:after@0"]);
    e.destroy();
  });

  test("Shift+Tab at a column's own level keeps the line in its column; deeper lines still outdent", () => {
    const e = make([row(), col(), p("a", 2), p("nested", 3), col(), p("b", 2)]);
    caret(e, "a");
    key(e, "Shift-Tab");
    expect(lines(e)[2]).toBe("paragraph:a@2");
    caret(e, "nested");
    key(e, "Shift-Tab");
    expect(lines(e)[3]).toBe("paragraph:nested@2");
    e.destroy();
  });

  test("an empty list item at a column's own level ends the list in the column", () => {
    const e = make([row(), col(), { type: "bulleted", attrs: { depth: 2 }, content: [] }, col(), p("b", 2)]);
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 3)));
    key(e, "Enter");
    expect(lines(e)).toEqual(["columns@0", "column@1", "paragraph@2", "column@1", "paragraph:b@2"]);
    e.destroy();
  });

  test("an outdent that would leave a column (changeDepth) is put back into it", () => {
    const e = make([row(), col(), p("a", 2), col(), p("b", 2)]);
    caret(e, "b");
    changeDepth(e, -1);
    expect(lines(e)).toEqual(["columns@0", "column@1", "paragraph:a@2", "column@1", "paragraph:b@2"]);
    e.destroy();
  });

  test("dropping a block beside another makes a row of the two", () => {
    const e = make([p("Alpha"), p("child", 1), p("Bravo"), p("Charlie")]);
    const made = applySideDrop(e.state, 3, 3, { kind: "new", target: 0, side: "right" })!;
    e.view.dispatch(made.tr);
    expect(lines(e)).toEqual(["columns@0", "column@1", "paragraph:Alpha@2", "paragraph:child@3", "column@1", "paragraph:Charlie@2", "paragraph:Bravo@0"]);
    expect(e.state.doc.child(made.index).textContent).toBe("Charlie");
    // On its left side instead.
    const f = make([p("Alpha"), p("Bravo")]);
    f.view.dispatch(applySideDrop(f.state, 1, 1, { kind: "new", target: 0, side: "left" })!.tr);
    expect(lines(f)).toEqual(["columns@0", "column@1", "paragraph:Bravo@2", "column@1", "paragraph:Alpha@2"]);
    e.destroy();
    f.destroy();
  });

  test("dropping a block into a row's gap adds a column there, every column an equal share again", () => {
    const e = make([row(), col(1, 0.7), p("a", 2), col(1, 0.3), p("b", 2), p("c")]);
    e.view.dispatch(applySideDrop(e.state, 5, 5, { kind: "add", row: 0, at: 1 })!.tr);
    expect(lines(e)).toEqual(["columns@0", "column@1", "paragraph:a@2", "column@1", "paragraph:c@2", "column@1", "paragraph:b@2"]);
    expect(columnsModel(e.state.doc).rows[0]!.shares).toEqual([1 / 3, 1 / 3, 1 / 3]);
    e.destroy();
  });

  test("moving the last block out of a column removes the column, and the row with it", () => {
    const e = make([row(), col(), p("a", 2), col(), p("b", 2), p("after")]);
    const moved = moveSubtreeTo(e.state, 4, 6, 0)!;
    e.view.dispatch(moved.tr);
    expect(lines(e)).toEqual(["paragraph:a@0", "paragraph:after@0", "paragraph:b@0"]);
    e.destroy();
  });

  test("resizing saves every column's share, adding up to the row", () => {
    const e = make([row(), col(), p("a", 2), col(), p("b", 2), col(), p("c", 2)]);
    setColumnShares(e, 0, [0.5, 0.25, 0.25]);
    expect(columnsModel(e.state.doc).rows[0]!.shares).toEqual([0.5, 0.25, 0.25]);
    const blocks = docToBlocks(e.state.doc, new Map());
    expect(blocks.filter((b) => b.type === "column").map((b) => b.props.width)).toEqual([0.5, 0.25, 0.25]);
    setColumnShares(e, 0, null);
    expect(columnsModel(e.state.doc).rows[0]!.shares).toEqual([1 / 3, 1 / 3, 1 / 3]);
    e.destroy();
  });
});
