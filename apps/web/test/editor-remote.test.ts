import { describe, expect, test } from "vitest";
import { Editor } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import { rankSequence, SCHEMA_VERSION, type WireBlock } from "@folevi/editor-schema";
import { ALL_MARKS, ALL_NODES } from "@/components/editor/extensions";
import { BlockIdentity, BlockKeymap } from "@/components/editor/plugins";
import { blocksToDoc } from "@/components/editor/convert";
import { remoteTransaction } from "@/components/editor/remoteApply";

const ranks = rankSequence(10);
const para = (id: string, text: string, i: number, parentId: string | null = null): WireBlock => ({
  id,
  type: "paragraph",
  parentId,
  rank: ranks[i]!,
  schemaVersion: SCHEMA_VERSION,
  text: text ? [{ type: "text", text }] : [],
  props: {},
});

function make(blocks: WireBlock[]) {
  return new Editor({ extensions: [...ALL_NODES, ...ALL_MARKS, UndoRedo, BlockIdentity, BlockKeymap], content: blocksToDoc(blocks) });
}
const apply = (e: Editor, blocks: WireBlock[]) => {
  const tr = remoteTransaction(e.state, blocks);
  if (tr) e.view.dispatch(tr.setMeta("addToHistory", false).setMeta("remote", true));
};
const lines = (e: Editor) => {
  const out: string[] = [];
  e.state.doc.forEach((n) => out.push(`${n.attrs.id}:${n.textContent}@${n.attrs.depth}`));
  return out;
};
const posIn = (e: Editor, id: string, offset: number) => {
  let at = -1;
  e.state.doc.forEach((n, o) => {
    if (n.attrs.id === id) at = o + 1 + offset;
  });
  return at;
};

describe("remote changes", () => {
  test("someone else reordering and adding blocks keeps my undo and my caret", () => {
    const base = [para("A", "alpha", 0), para("B", "beta", 1), para("C", "gamma", 2)];
    const e = make(base);
    // I type in A.
    e.commands.setTextSelection(posIn(e, "A", 5));
    e.commands.insertContent("!");
    // Someone moves C to the top and adds D at the end.
    apply(e, [para("C", "gamma", 0), para("A", "alpha!", 1), para("B", "beta", 2), para("D", "delta", 3)]);
    expect(lines(e)).toEqual(["C:gamma@0", "A:alpha!@0", "B:beta@0", "D:delta@0"]);
    expect(e.state.selection.from).toBe(posIn(e, "A", 6));
    // My undo still takes back what I typed, and nothing else.
    e.commands.undo();
    expect(lines(e)).toEqual(["C:gamma@0", "A:alpha@0", "B:beta@0", "D:delta@0"]);
    e.destroy();
  });

  test("a remote edit to my block changes only the text that differs", () => {
    const e = make([para("A", "hello world", 0)]);
    e.commands.setTextSelection(posIn(e, "A", 2));
    apply(e, [para("A", "hello brave world", 0)]);
    expect(lines(e)).toEqual(["A:hello brave world@0"]);
    expect(e.state.selection.from).toBe(posIn(e, "A", 2));
    e.destroy();
  });

  test("deleted and nested blocks", () => {
    const e = make([para("A", "a", 0), para("B", "b", 1), para("C", "c", 2)]);
    apply(e, [para("A", "a", 0), para("C", "c", 0, "A")]);
    expect(lines(e)).toEqual(["A:a@0", "C:c@1"]);
    expect(remoteTransaction(e.state, [para("A", "a", 0), para("C", "c", 0, "A")])).toBeNull();
    e.destroy();
  });
});
