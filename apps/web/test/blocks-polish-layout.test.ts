// Where things land (docs/EDITOR_AUDIT_2026-11-12.md): a click in the empty space under a short column, and a
// card dropped between the cards of a board column.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { ALL_MARKS, ALL_NODES } from "@/components/editor/extensions";
import { BlockIdentity, BlockKeymap } from "@/components/editor/plugins";
import { ColumnBlock, ColumnsBlock, ColumnsExtension } from "@/components/editor/columns/columnsExtension";
import { columnEndSelection } from "@/components/editor/columns/columnsCommands";
import { columnSpaceAt } from "@/components/editor/columns/columnsLayout";
import { boardDropAfter, cardBelowPointer } from "@/components/editor/collection/boardDrop";

const p = (id: string, text: string, depth = 0): JSONContent => ({ type: "paragraph", attrs: { id, depth }, content: text ? [{ type: "text", text }] : [] });
const row = (id: string): JSONContent => ({ type: "columns", attrs: { id, depth: 0 } });
const col = (id: string): JSONContent => ({ type: "column", attrs: { id, depth: 1, width: null } });

describe("the empty space under a short column", () => {
  // jsdom lays nothing out. The page here: 800 px wide, every line 24 px tall and drawn where its column's
  // lines stack (the layout's own sums); a line's box is given by its place in its column.
  const saved: [string, PropertyDescriptor | undefined][] = [];
  const stub = (name: string, get: (this: HTMLElement) => unknown) => {
    saved.push([name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)]);
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get });
  };
  let host: HTMLDivElement;
  let editor: Editor;
  /** Top and bottom of each line on the page, by block id. */
  const boxes: Record<string, [number, number]> = { a1: [0, 24], a2: [24, 48], a3: [48, 72], b1: [0, 24], pic: [0, 24] };

  beforeEach(() => {
    stub("offsetParent", () => document.body);
    stub("offsetWidth", () => 800);
    stub("offsetHeight", () => 24);
    stub("offsetTop", () => 0);
    stub("offsetLeft", () => 0);
    stub("clientWidth", () => 800);
    saved.push(["getBoundingClientRect", Object.getOwnPropertyDescriptor(HTMLElement.prototype, "getBoundingClientRect")]);
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const [top, bottom] = boxes[this.dataset.blockId ?? ""] ?? [0, 0];
      return { left: 0, right: 800, top, bottom, width: 800, height: bottom - top, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    };
    host = document.createElement("div");
    document.body.append(host);
  });
  afterEach(() => {
    editor?.destroy();
    host.remove();
    for (const [name, d] of saved.splice(0)) {
      if (d) Object.defineProperty(HTMLElement.prototype, name, d);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
    }
  });

  function make(content: JSONContent[]) {
    editor = new Editor({ element: host, extensions: [...ALL_NODES, ColumnsBlock, ColumnBlock, ...ALL_MARKS, UndoRedo, BlockIdentity, BlockKeymap, ColumnsExtension], content: { type: "doc", content } });
    return editor;
  }
  const marker = () => host.querySelector<HTMLElement>('[data-block="columns"]')!;
  const press = (x: number, y: number, init: MouseEventInit = {}) => {
    const event = new MouseEvent("mousedown", { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true, ...init });
    marker().dispatchEvent(event);
    return event;
  };
  /** A tall first column (three lines) beside a short second one (one line): columns at 0..368 and 432..800. */
  const tallAndShort = () => [p("top", "Top"), row("R"), col("C1"), p("a1", "One", 2), p("a2", "Two", 2), p("a3", "Three", 2), col("C2"), p("b1", "Bee", 2), p("end", "End")];
  const endOf = (e: Editor, text: string) => {
    let pos = -1;
    e.state.doc.forEach((n, offset) => {
      if (n.textContent === text) pos = offset + n.nodeSize - 1;
    });
    return pos;
  };

  test("the layout says which column's space a point is in, and its last line", () => {
    const e = make(tallAndShort());
    // Row is line 1; the second column's only line is line 7.
    expect(columnSpaceAt(e.view, 1, 600, 60)).toEqual({ column: 1, last: 7 });
    // Beside the short column's own line (not under it), and beside the tall column's lines: nobody's space.
    expect(columnSpaceAt(e.view, 1, 600, 12)).toBeNull();
    expect(columnSpaceAt(e.view, 1, 100, 60)).toBeNull();
    // Under the tall column too.
    expect(columnSpaceAt(e.view, 1, 100, 80)).toEqual({ column: 0, last: 5 });
  });

  test("a click there puts the caret at the end of that column's last line", () => {
    const e = make(tallAndShort());
    e.commands.setTextSelection(2);
    const event = press(600, 60);
    expect(event.defaultPrevented).toBe(true);
    expect(e.state.selection).toBeInstanceOf(TextSelection);
    expect(e.state.selection.empty).toBe(true);
    expect(e.state.selection.from).toBe(endOf(e, "Bee"));
    // And typing goes on from there.
    e.commands.insertContent("!");
    expect(e.state.doc.child(7).textContent).toBe("Bee!");
  });

  test("a column that ends in a block with no text (a divider) has that block selected", () => {
    boxes.pic = [0, 24];
    const e = make([row("R"), col("C1"), p("a1", "One", 2), p("a2", "Two", 2), col("C2"), { type: "divider", attrs: { id: "pic", depth: 2 } }]);
    press(600, 40);
    expect(e.state.selection).toBeInstanceOf(NodeSelection);
    expect((e.state.selection as NodeSelection).node.type.name).toBe("divider");
  });

  test("beside a column's lines, with a modifier, with another button, or in a read-only note, the caret stays where it was", () => {
    const e = make(tallAndShort());
    e.commands.setTextSelection(2);
    const at = e.state.selection.from;
    press(600, 12);
    press(600, 60, { shiftKey: true });
    press(600, 60, { button: 2 });
    expect(e.state.selection.from).toBe(at);
    e.setEditable(false);
    press(600, 60);
    expect(e.state.selection.from).toBe(at);
  });

  test("a press on the handle between two columns is the handle's: the caret doesn't move", () => {
    const e = make(tallAndShort());
    e.commands.setTextSelection(2);
    const at = e.state.selection.from;
    const gutter = host.querySelector<HTMLElement>(".fb-columns-gutter")!;
    expect(gutter).not.toBeNull();
    gutter.dispatchEvent(new MouseEvent("mousedown", { clientX: 400, clientY: 60, button: 0, bubbles: true, cancelable: true }));
    expect(e.state.selection.from).toBe(at);
  });

  test("the selection for a column's end: a caret after its text, the block itself when it has none", () => {
    const e = make([p("a", "Hello"), { type: "divider", attrs: { id: "d", depth: 0 } }]);
    const text = columnEndSelection(e.state.doc, 0)!;
    expect(text).toBeInstanceOf(TextSelection);
    expect(text.from).toBe(6);
    expect(columnEndSelection(e.state.doc, 1)).toBeInstanceOf(NodeSelection);
    expect(columnEndSelection(e.state.doc, 9)).toBeNull();
  });
});

describe("a card dropped on a board column", () => {
  const ids = (...list: string[]) => list.map((id) => ({ id }));
  // The collection's own order; the column "todo" shows a, c and e of it, "done" shows b and d.
  const all = ids("a", "b", "c", "d", "e");
  const todo = ids("a", "c", "e");
  const done = ids("b", "d");

  test("between two cards of another column, it follows the card above", () => {
    expect(boardDropAfter(all, todo, "b", "c")).toEqual({ afterRowId: "a" });
    expect(boardDropAfter(all, todo, "b", "e")).toEqual({ afterRowId: "c" });
  });

  test("under the last card, it follows that card", () => {
    expect(boardDropAfter(all, todo, "b", null)).toEqual({ afterRowId: "e" });
  });

  test("above the first card, it goes right before it in the collection's order", () => {
    // Before c's column-mate a: nothing comes before a at all.
    expect(boardDropAfter(all, todo, "d", "a")).toEqual({ afterRowId: null });
    // Before "done"'s first card b: after a, the row before b (the dragged card itself doesn't count).
    expect(boardDropAfter(all, done, "e", "b")).toEqual({ afterRowId: "a" });
    expect(boardDropAfter(ids("x", "b", "d"), done, "x", "b")).toEqual({ afterRowId: null });
  });

  test("within its own column it moves up and down, and stays put when dropped where it is", () => {
    expect(boardDropAfter(all, todo, "e", "a")).toEqual({ afterRowId: null });
    expect(boardDropAfter(all, todo, "a", null)).toEqual({ afterRowId: "e" });
    expect(boardDropAfter(all, todo, "a", "e")).toEqual({ afterRowId: "c" });
    // Already there: above the card after it, or last and dropped under the last.
    expect(boardDropAfter(all, todo, "c", "e")).toBeNull();
    expect(boardDropAfter(all, todo, "a", "c")).toBeNull();
    expect(boardDropAfter(all, todo, "e", null)).toBeNull();
  });

  test("an empty column takes it as its only card", () => {
    expect(boardDropAfter(all, [], "c", null)).toEqual({ afterRowId: null });
  });

  test("the card under the pointer: the first whose middle is below it, never the dragged one", () => {
    const column = document.createElement("section");
    column.innerHTML = `<ul><li data-row-id="a"></li><li data-row-id="c"></li><li data-row-id="e"></li></ul>`;
    [...column.querySelectorAll("li")].forEach((li, i) => {
      li.getBoundingClientRect = () => ({ top: i * 50, bottom: i * 50 + 40, height: 40, left: 0, right: 200, width: 200, x: 0, y: i * 50, toJSON: () => ({}) }) as DOMRect;
    });
    expect(cardBelowPointer(column, 10, "x")).toBe("a");
    expect(cardBelowPointer(column, 30, "x")).toBe("c");
    expect(cardBelowPointer(column, 115, "x")).toBe("e");
    expect(cardBelowPointer(column, 130, "x")).toBeNull();
    // Dragging "a" itself over its own place: the next card down is the one it would go above.
    expect(cardBelowPointer(column, 10, "a")).toBe("c");
  });
});
