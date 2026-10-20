// Tabs inside a note, in the editor (components/editor/tabs): what's shown and how far in, keeping a tabs
// block in shape after edits, the keys that mustn't reach into hidden tabs, drag and drop, and the round trip
// to wire blocks.
import { describe, expect, test, beforeEach } from "vitest";
import { Editor } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import { TextSelection } from "@tiptap/pm/state";
import { ALL_MARKS, ALL_NODES } from "@/components/editor/extensions";
import { BlockIdentity, BlockKeymap } from "@/components/editor/plugins";
import { changeDepth } from "@/components/editor/commands";
import { blocksToDoc, docToBlocks } from "@/components/editor/convert";
import { nodesToBlocks } from "@/components/editor/blockClipboard";
import { sliceToText } from "@/components/editor/clipboardText";
import { Fragment, Slice } from "@tiptap/pm/model";
import { hiddenIndices } from "@/components/editor/blockSelectionState";
import { layoutOf, tabFloor, tabsDrop } from "@/components/editor/tabs/tabsState";
import { addTab, deleteTab, insertTabs, moveTab, openTab, renameTab, TabsExtension } from "@/components/editor/tabs/tabsExtension";

const para = (id: string, text: string, depth = 0) => ({ type: "paragraph", attrs: { id, depth }, content: text ? [{ type: "text", text }] : [] });
const tabs = (id: string, depth = 0) => ({ type: "tabs", attrs: { id, depth } });
const tab = (id: string, name: string, depth = 1) => ({ type: "tab", attrs: { id, depth, name } });
const doc = (...nodes: object[]) => ({ type: "doc", content: nodes });

function makeEditor(content: object) {
  return new Editor({ extensions: [...ALL_NODES, ...ALL_MARKS, UndoRedo, BlockIdentity, BlockKeymap, TabsExtension], content });
}

/** intro, tabs [A: a1, a2] [B: b1], outro */
const sample = () => doc(para("intro", "Intro"), tabs("T"), tab("A", "Alpha"), para("a1", "One", 2), para("a2", "Two", 2), tab("B", "Beta"), para("b1", "Bee", 2), para("outro", "Outro"));

const lines = (e: Editor) => {
  const out: string[] = [];
  e.state.doc.forEach((n) => out.push(`${n.type.name}:${n.type.name === "tab" ? n.attrs.name : n.textContent}:${n.attrs.depth}`));
  return out;
};

function key(e: Editor, k: string, opts: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...opts });
  return Boolean(e.view.someProp("handleKeyDown", (f) => f(e.view, event)));
}

function caretIn(e: Editor, index: number, at: "start" | "end" = "start") {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += e.state.doc.child(i).nodeSize;
  const node = e.state.doc.child(index);
  e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, at === "start" ? pos + 1 : pos + node.nodeSize - 1)));
}

beforeEach(() => localStorage.clear());

describe("what a tabs block shows", () => {
  test("only the open tab's lines show; tab lines never do; the first tab opens by default", () => {
    const e = makeEditor(sample());
    const layout = layoutOf(e.state);
    expect(layout.groups[0]!.tabs.map((t) => t.name)).toEqual(["Alpha", "Beta"]);
    expect(layout.groups[0]!.open).toBe("A");
    expect([...hiddenIndices(e.state)].sort()).toEqual([2, 5, 6]);
    // Its lines are drawn two levels out: at the tabs block's indent.
    expect(layout.lift.get(3)).toBe(2);
    expect(layout.lift.get(7)).toBeUndefined();
    // The tabs block's edge is drawn under the open tab's last line.
    expect([...layout.last.keys()]).toEqual([4]);
  });

  test("opening a tab is this viewer's own, remembered on the device, and isn't an edit", () => {
    const e = makeEditor(sample());
    const before = e.state.doc;
    openTab(e.view, "T", "B");
    expect(e.state.doc).toBe(before);
    expect(layoutOf(e.state).groups[0]!.open).toBe("B");
    expect([...hiddenIndices(e.state)].sort()).toEqual([2, 3, 4, 5]);
    expect(localStorage.getItem("folevi:tab:T")).toBe("B");
    // Another editor on this device opens the same tab.
    const other = makeEditor(sample());
    expect(layoutOf(other.state).groups[0]!.open).toBe("B");
  });

  test("the caret never stays in a tab that was just hidden", () => {
    const e = makeEditor(sample());
    caretIn(e, 3);
    openTab(e.view, "T", "B");
    expect(e.state.selection.$from.index(0)).toBe(6);
  });
});

describe("keeping tabs in shape", () => {
  test("a tab's lines outdent no further than the tab, and the line after a tabs block can't indent into it", () => {
    const e = makeEditor(sample());
    expect(tabFloor(e.state, 3)).toBe(2);
    caretIn(e, 3);
    changeDepth(e, -1);
    expect(lines(e)[3]).toBe("paragraph:One:2");
    caretIn(e, 7);
    changeDepth(e, 1);
    expect(lines(e)[7]).toBe("paragraph:Outro:0");
  });

  test("a line left directly in a tabs block goes into the tab before it", () => {
    const e = makeEditor(sample());
    // As if a drop put a line at the tabs block's level after Alpha's lines.
    e.view.dispatch(e.state.tr.insert(e.state.doc.child(0).nodeSize + e.state.doc.child(1).nodeSize + e.state.doc.child(2).nodeSize + e.state.doc.child(3).nodeSize + e.state.doc.child(4).nodeSize, e.schema.nodes.paragraph!.create({ id: "stray", depth: 1 }, e.schema.text("Stray"))));
    expect(lines(e)).toEqual(["paragraph:Intro:0", "tabs::0", "tab:Alpha:1", "paragraph:One:2", "paragraph:Two:2", "paragraph:Stray:2", "tab:Beta:1", "paragraph:Bee:2", "paragraph:Outro:0"]);
  });

  test("a line before the first tab moves into it, as its first line", () => {
    const e = makeEditor(sample());
    e.view.dispatch(e.state.tr.insert(e.state.doc.child(0).nodeSize + e.state.doc.child(1).nodeSize, e.schema.nodes.paragraph!.create({ id: "early", depth: 1 }, e.schema.text("Early"))));
    expect(lines(e).slice(1, 5)).toEqual(["tabs::0", "tab:Alpha:1", "paragraph:Early:2", "paragraph:One:2"]);
  });

  test("a tab outside a tabs block becomes a line with its name; nothing is lost", () => {
    const e = makeEditor(sample());
    // Deleting the tab strip alone (not the whole block): the tabs and their lines stay, as plain lines.
    e.view.dispatch(e.state.tr.delete(e.state.doc.child(0).nodeSize, e.state.doc.child(0).nodeSize + e.state.doc.child(1).nodeSize));
    expect(lines(e)).toEqual(["paragraph:Intro:0", "paragraph:Alpha:1", "paragraph:One:2", "paragraph:Two:2", "paragraph:Beta:1", "paragraph:Bee:2", "paragraph:Outro:0"]);
  });

  test("Backspace or Delete on the selected tabs block removes it with all its tabs", () => {
    const e = makeEditor(sample());
    e.commands.setNodeSelection(e.state.doc.child(0).nodeSize);
    expect(key(e, "Backspace")).toBe(true);
    expect(lines(e)).toEqual(["paragraph:Intro:0", "paragraph:Outro:0"]);
  });

  test("Delete at the end of the open tab's last line doesn't pull in the next (hidden) tab", () => {
    const e = makeEditor(sample());
    caretIn(e, 4, "end");
    key(e, "Delete");
    expect(lines(e)).toHaveLength(8);
    expect(lines(e)[5]).toBe("tab:Beta:1");
  });

  test("Backspace at the start of a tab's first line stays in the tab", () => {
    const e = makeEditor(sample());
    caretIn(e, 3);
    key(e, "Backspace");
    expect(lines(e)).toEqual(lines(makeEditor(sample())));
  });
});

describe("tab commands", () => {
  test("add, rename, move and delete tabs", () => {
    const e = makeEditor(sample());
    const id = addTab(e.view, "T")!;
    expect(layoutOf(e.state).groups[0]!.open).toBe(id);
    renameTab(e.view, "T", id, "  Gamma   ray ");
    expect(layoutOf(e.state).groups[0]!.tabs.map((t) => t.name)).toEqual(["Alpha", "Beta", "Gamma ray"]);
    moveTab(e.view, "T", id, 0);
    expect(layoutOf(e.state).groups[0]!.tabs.map((t) => t.name)).toEqual(["Gamma ray", "Alpha", "Beta"]);
    moveTab(e.view, "T", "A", 2);
    expect(layoutOf(e.state).groups[0]!.tabs.map((t) => t.name)).toEqual(["Gamma ray", "Beta", "Alpha"]);
    // Alpha's lines moved with it.
    expect(lines(e).slice(-3)).toEqual(["paragraph:One:2", "paragraph:Two:2", "paragraph:Outro:0"]);
    deleteTab(e.view, "T", "B");
    expect(layoutOf(e.state).groups[0]!.tabs.map((t) => t.name)).toEqual(["Gamma ray", "Alpha"]);
    expect(lines(e).some((l) => l.includes("Bee"))).toBe(false);
  });

  test("deleting the only tab deletes the tabs block", () => {
    const e = makeEditor(doc(para("x", "Keep"), tabs("T"), tab("A", "Only"), para("a", "In", 2)));
    deleteTab(e.view, "T", "A");
    expect(lines(e)).toEqual(["paragraph:Keep:0"]);
  });

  test("inserting tabs puts two tabs in place of an empty line, the caret in the first", () => {
    const e = makeEditor(doc(para("x", "Hello"), para("y", "")));
    caretIn(e, 1);
    insertTabs(e);
    expect(lines(e)).toEqual(["paragraph:Hello:0", "tabs::0", "tab:Tab 1:1", "paragraph::2", "tab:Tab 2:1", "paragraph::2", "paragraph::0"]);
    expect(e.state.selection.$from.index(0)).toBe(3);
  });
});

describe("dropping blocks around tabs", () => {
  test("under the open tab's last line it goes into that tab; further out, after the tabs block", () => {
    const e = makeEditor(sample());
    const layout = layoutOf(e.state);
    // The drop line under "Two" (index 4), drawn at the tabs block's indent: into Alpha, at depth 2.
    expect(tabsDrop(layout, 7, 0, 4)).toEqual({ index: 5, depth: 2 });
    // Drawn one further in: nested under Two.
    expect(tabsDrop(layout, 7, 1, 4)).toEqual({ index: 5, depth: 3 });
    // Under the strip: the open tab's first line.
    expect(tabsDrop(layout, 3, 0, 1)).toEqual({ index: 3, depth: 2 });
    // Between two of the tab's lines it stays in the tab.
    expect(tabsDrop(layout, 4, 0, 3)).toEqual({ index: 4, depth: 2 });
    // Elsewhere nothing changes.
    expect(tabsDrop(layout, 1, 0, 0)).toEqual({ index: 1, depth: 0 });
  });
});

describe("tabs as wire blocks", () => {
  test("a tab's name is its text; the tree round-trips", () => {
    const e = makeEditor(sample());
    const blocks = docToBlocks(e.state.doc, new Map());
    const t = blocks.find((b) => b.id === "A")!;
    expect(t.type).toBe("tab");
    expect(t.text).toEqual([{ type: "text", text: "Alpha" }]);
    expect(t.props).toEqual({});
    expect(t.parentId).toBe("T");
    expect(blocks.find((b) => b.id === "a1")!.parentId).toBe("A");
    const again = makeEditor(blocksToDoc(blocks));
    expect(lines(again)).toEqual(lines(e));
  });
});

describe("copying tabs", () => {
  test("a copied tabs block keeps its tabs, names and lines (as blocks for Folevi, text for elsewhere)", () => {
    const e = makeEditor(sample());
    const nodes: import("@tiptap/pm/model").Node[] = [];
    e.state.doc.forEach((n, _o, i) => {
      if (i >= 1 && i <= 6) nodes.push(n);
    });
    const blocks = nodesToBlocks(nodes);
    const byType = blocks.map((b) => b.type);
    expect(byType).toEqual(["tabs", "tab", "paragraph", "paragraph", "tab", "paragraph"]);
    const tabsId = blocks[0]!.id;
    expect(blocks.filter((b) => b.type === "tab").every((b) => b.parentId === tabsId)).toBe(true);
    expect(blocks[1]!.text).toEqual([{ type: "text", text: "Alpha" }]);
    expect(blocks[2]!.parentId).toBe(blocks[1]!.id);
    const text = sliceToText(new Slice(Fragment.fromArray(nodes), 0, 0));
    expect(text).toContain("### Alpha");
    expect(text).toContain("### Beta");
    expect(text).toContain("Bee");
  });
});
