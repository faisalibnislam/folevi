// The columns layout after the editor audit (M17 / S8, M26): it is worked out again only when something it is
// drawn from changed (a row's lines, where a row sits, a size it read, whether the note can be edited), not on
// every key and every move of the caret, with the same result; and a drag on a gap's handle ends when the
// handle goes away under it.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import { TextSelection } from "@tiptap/pm/state";
import { ALL_MARKS, ALL_NODES } from "@/components/editor/extensions";
import { BlockIdentity, BlockKeymap } from "@/components/editor/plugins";
import { ColumnBlock, ColumnsBlock, ColumnsExtension } from "@/components/editor/columns/columnsExtension";
import { columnsLayoutOf, columnsSnapshot } from "@/components/editor/columns/columnsLayout";
import { columnsModel } from "@/components/editor/columns/columnsModel";

if (!(globalThis as { CSS?: { escape?: unknown } }).CSS?.escape) vi.stubGlobal("CSS", { escape: (s: string) => s.replace(/["\\\]]/g, "\\$&") });

const p = (id: string, text: string, depth = 0): JSONContent => ({ type: "paragraph", attrs: { id, depth }, content: text ? [{ type: "text", text }] : [] });
const row = (id: string): JSONContent => ({ type: "columns", attrs: { id, depth: 0 } });
const col = (id: string): JSONContent => ({ type: "column", attrs: { id, depth: 1, width: null } });

// jsdom lays nothing out: the sizes the layout reads are given here. A row is as wide as `rowWidth`, a line 24 px tall.
let rowWidth = 900;
const sizes: [string, (this: HTMLElement) => unknown][] = [
  ["offsetParent", () => document.body],
  ["offsetWidth", function () { return this.classList.contains("fb-columns") ? rowWidth : 400; }],
  ["offsetHeight", () => 24],
  ["offsetTop", () => 0],
  ["offsetLeft", () => 0],
  ["clientWidth", () => 900],
];
const kept = new Map<string, PropertyDescriptor | undefined>();

let editor: Editor | null = null;
function make(content: JSONContent[]): Editor {
  const element = document.createElement("div");
  document.body.append(element);
  editor = new Editor({ element, extensions: [...ALL_NODES, ColumnsBlock, ColumnBlock, ...ALL_MARKS, UndoRedo, BlockIdentity, BlockKeymap, ColumnsExtension], content: { type: "doc", content } });
  return editor;
}
const note = () => [p("top", "above the row"), row("R"), col("C1"), p("a", "left", 2), col("C2"), p("b", "right", 2), p("end", "below the row")];
const posIn = (e: Editor, id: string) => {
  let at = -1;
  e.state.doc.forEach((n, pos) => {
    if (n.attrs.id === id) at = pos + 1;
  });
  return at;
};
const sheet = () => document.head.querySelector<HTMLStyleElement>("style[data-fb-columns]")!.textContent;

beforeEach(() => {
  rowWidth = 900;
  for (const [name, get] of sizes) {
    kept.set(name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name));
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get });
  }
});
afterEach(() => {
  editor?.destroy();
  editor = null;
  document.body.innerHTML = "";
  document.documentElement.classList.remove("fb-columns-resizing");
  for (const [name] of sizes) {
    const had = kept.get(name);
    if (had) Object.defineProperty(HTMLElement.prototype, name, had);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
  }
  vi.restoreAllMocks();
});

describe("M17: the columns layout runs when something it depends on changed", () => {
  test("the columns are side by side to begin with", () => {
    const e = make(note());
    const snap = columnsSnapshot(e.view.dom)!;
    expect(snap.rows).toHaveLength(1);
    expect(snap.rows[0]!.stacked).toBe(false);
    expect(snap.rows[0]!.columns.map((c) => c.items)).toEqual([[3], [5]]);
    expect(sheet()).toContain('[data-block-id="a"]{position:absolute!important');
  });

  test("moving the caret lays nothing out", () => {
    const e = make(note());
    const layout = vi.spyOn(columnsLayoutOf(e.view.dom)!, "layout");
    const styles = vi.spyOn(window, "getComputedStyle");
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, posIn(e, "top") + 2)));
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, posIn(e, "a") + 1)));
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, posIn(e, "end"))));
    expect(layout).not.toHaveBeenCalled();
    expect(styles).not.toHaveBeenCalled();
  });

  test("typing outside the row, with the row where it was, reads no line's style and leaves the same layout", () => {
    const e = make(note());
    const before = sheet();
    const snapshot = columnsSnapshot(e.view.dom);
    const layout = vi.spyOn(columnsLayoutOf(e.view.dom)!, "layout");
    const styles = vi.spyOn(window, "getComputedStyle");
    e.view.dispatch(e.state.tr.insertText("typed ", posIn(e, "end")));
    e.view.dispatch(e.state.tr.insertText("x", posIn(e, "top")));
    expect(layout).not.toHaveBeenCalled();
    expect(styles.mock.calls.filter(([el]) => el instanceof HTMLElement && ["a", "b"].includes(el.dataset.blockId ?? ""))).toEqual([]);
    expect(sheet()).toBe(before);
    expect(columnsSnapshot(e.view.dom)).toBe(snapshot);
    // Asked to lay out all the same (as a size change does), it writes what was already there.
    columnsLayoutOf(e.view.dom)!.layout();
    expect(sheet()).toBe(before);
    expect(columnsSnapshot(e.view.dom)).toEqual(snapshot);
  });

  test("an edit in a column's line, a new line in the row, or a row moved among the note's lines lays out again", () => {
    const e = make(note());
    const layout = vi.spyOn(columnsLayoutOf(e.view.dom)!, "layout");
    e.view.dispatch(e.state.tr.insertText("more ", posIn(e, "a")));
    expect(layout).toHaveBeenCalledTimes(1);
    // A line added above the row: the row is the same, its place among the lines isn't.
    e.view.dispatch(e.state.tr.insert(0, e.schema.nodes.paragraph!.create({ id: "new", depth: 0 })));
    expect(layout).toHaveBeenCalledTimes(2);
    expect(columnsSnapshot(e.view.dom)!.rows[0]!.index).toBe(columnsModel(e.state.doc).rows[0]!.index);
    expect(columnsSnapshot(e.view.dom)!.rows[0]!.columns.map((c) => c.items)).toEqual([[4], [6]]);
  });

  test("so does a size it read changing (a line above grew), and the note turning read-only", () => {
    const e = make(note());
    const layout = vi.spyOn(columnsLayoutOf(e.view.dom)!, "layout");
    // The row's line is pushed down by 20 px.
    Object.defineProperty(HTMLElement.prototype, "offsetTop", { configurable: true, get(this: HTMLElement) { return this.classList.contains("fb-columns") ? 20 : 0; } });
    e.view.dispatch(e.state.tr.insertText("wraps ", posIn(e, "top")));
    expect(layout).toHaveBeenCalledTimes(1);
    expect(columnsSnapshot(e.view.dom)!.rows[0]!.top).toBe(20);
    expect(e.view.dom.querySelectorAll(".fb-columns-gutter")).toHaveLength(1);
    e.setEditable(false);
    expect(layout.mock.calls.length).toBeGreaterThan(1);
    expect(e.view.dom.querySelectorAll(".fb-columns-gutter")).toHaveLength(0);
  });

  test("a layout that changes nothing doesn't touch the gaps' handles", () => {
    const e = make(note());
    const gutter = e.view.dom.querySelector<HTMLElement>(".fb-columns-gutter")!;
    const set = vi.spyOn(gutter, "setAttribute");
    columnsLayoutOf(e.view.dom)!.layout();
    expect(set).not.toHaveBeenCalled();
  });
});

describe("M26: a drag on a gap's handle always ends", () => {
  const pointer = (type: string, x: number) => Object.assign(new MouseEvent(type, { clientX: x, clientY: 10, button: 0, bubbles: true, cancelable: true }), { pointerId: 3 });
  const resizing = () => document.documentElement.classList.contains("fb-columns-resizing");
  const widths = (e: Editor) => {
    const out: unknown[] = [];
    e.state.doc.forEach((n) => {
      if (n.type.name === "column") out.push(n.attrs.width);
    });
    return out;
  };

  test("let go anywhere in the window, it saves the new shares", () => {
    const e = make(note());
    const gutter = e.view.dom.querySelector<HTMLElement>(".fb-columns-gutter")!;
    gutter.dispatchEvent(pointer("pointerdown", 450));
    expect(resizing()).toBe(true);
    window.dispatchEvent(pointer("pointermove", 550));
    window.dispatchEvent(pointer("pointerup", 550));
    expect(resizing()).toBe(false);
    const saved = widths(e) as number[];
    expect(saved[0]).toBeGreaterThan(0.55);
    expect(saved[0]! + saved[1]!).toBeCloseTo(1, 5);
  });

  test("the handle taken away mid-drag (the row stacks as the screen narrows) ends the drag and saves nothing", () => {
    const e = make(note());
    const gutter = e.view.dom.querySelector<HTMLElement>(".fb-columns-gutter")!;
    gutter.dispatchEvent(pointer("pointerdown", 450));
    window.dispatchEvent(pointer("pointermove", 520));
    expect(resizing()).toBe(true);
    // An iPad turned to portrait: too narrow for columns side by side.
    rowWidth = 300;
    columnsLayoutOf(e.view.dom)!.layout();
    expect(columnsSnapshot(e.view.dom)!.rows[0]!.stacked).toBe(true);
    expect(e.view.dom.querySelector(".fb-columns-gutter")).toBeNull();
    expect(resizing()).toBe(false);
    expect(widths(e)).toEqual([null, null]);
    // What the finger does next is no longer the drag's.
    window.dispatchEvent(pointer("pointerup", 700));
    expect(widths(e)).toEqual([null, null]);
  });

  test("so does the row itself going away (a change from another device)", () => {
    const e = make(note());
    e.view.dom.querySelector<HTMLElement>(".fb-columns-gutter")!.dispatchEvent(pointer("pointerdown", 450));
    expect(resizing()).toBe(true);
    e.commands.setContent({ type: "doc", content: [p("only", "just text now")] });
    expect(resizing()).toBe(false);
  });
});
