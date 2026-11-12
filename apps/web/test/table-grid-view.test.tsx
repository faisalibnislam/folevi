// The table block as a grid, in a real editor (components/editor/table/TableView.tsx): selecting a range of
// cells with the mouse and the keyboard and what its keys and clipboard do, dragging a column's edge for a
// width, dragging a row or column to another place, and the open cell staying on its row when rows change
// under it. Each change is checked in the note itself, and that it is one step to undo.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor, EditorContent, ReactNodeViewRenderer, type JSONContent } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { tableCellText, type InlineNode } from "@folevi/editor-schema";
import { ALL_MARKS, ALL_NODES, TableBlock } from "@/components/editor/extensions";
import { NoteHistory } from "@/components/editor/noteHistory";
import { TableView, tableHandlesEvent } from "@/components/editor/table/TableView";
import * as model from "@/components/editor/table/tableModel";

// Foli AI's switch asks the server; these tests have none.
vi.mock("@/components/ai/useAi", () => ({ useAiEnabled: () => false }));

const txt = (t: string): InlineNode[] => (t ? [{ type: "text", text: t }] : []);
const p = (text: string): JSONContent => ({ type: "paragraph", attrs: { depth: 0 }, content: text ? [{ type: "text", text }] : [] });
const TableWithView = TableBlock.extend({ addNodeView: () => ReactNodeViewRenderer(TableView, { stopEvent: ({ event }) => tableHandlesEvent(event) }) });

const ROWS = [
  ["Item", "Price", "Qty"],
  ["Tea", "3", "2"],
  ["Cake", "4", "5"],
  ["Jam", "6", "1"],
];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // What jsdom doesn't have and the editor asks for.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  document.elementFromPoint ??= () => null;
  Element.prototype.scrollIntoView ??= () => {};
});

let mounted: { root: Root; editor: Editor; host: HTMLElement } | null = null;
afterEach(() => {
  if (mounted) {
    const { root, editor, host } = mounted;
    act(() => root.unmount());
    editor.destroy();
    host.remove();
  }
  mounted = null;
  vi.restoreAllMocks();
});

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

async function mount(rows: string[][] = ROWS, attrs: Record<string, unknown> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const editor = new Editor({
    extensions: [...ALL_NODES.filter((n) => n.name !== "table"), TableWithView, ...ALL_MARKS, NoteHistory],
    content: { type: "doc", content: [p("before"), { type: "table", attrs: { id: "T1", depth: 0, rows: rows.map((r) => r.map(txt)), headerRow: true, ...attrs } }, p("after")] },
  });
  const root = createRoot(host);
  act(() => root.render(<EditorContent editor={editor} />));
  await settle();
  mounted = { root, editor, host };
  const pos = () => {
    let at = -1;
    editor.state.doc.forEach((n, offset) => {
      if (n.type.name === "table") at = offset;
    });
    return at;
  };
  const data = () => model.tableData(editor.state.doc.nodeAt(pos())!.attrs);
  const texts = () => data().rows.map((r) => r.map((c) => tableCellText(c)));
  const cell = (r: number, c: number) => host.querySelector<HTMLElement>(`[data-cell-at="${r}:${c}"]`)!;
  const keys = () => host.querySelector<HTMLTextAreaElement>("textarea.fb-table-keys")!;
  const selected = () => [...host.querySelectorAll<HTMLElement>(".fb-cell-selected")].map((el) => el.dataset.cellAt);
  const openCell = () => host.querySelector<HTMLElement>("[data-cell-slot]")?.closest<HTMLElement>("[data-cell-at]")?.dataset.cellAt ?? null;
  const mouse = (el: Element, type: string, init: MouseEventInit = {}) => act(() => void el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init })));
  const key = (el: Element, k: string, init: KeyboardEventInit = {}) => act(() => void el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })));
  const pointer = (el: Element, type: string, x = 0, y = 0) => act(() => void el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })));
  /** The mouse moving from one cell onto another (React reads "entered" from the cell it left). */
  const enter = (to: [number, number], from: [number, number], buttons = 1) => mouse(cell(...from), "mouseout", { buttons, relatedTarget: cell(...to) });
  /** Mouse down on one cell, across to another with the button held, and up. */
  const dragCells = (from: [number, number], to: [number, number]) => {
    mouse(cell(...from), "mousedown", { buttons: 1 });
    if (from[0] !== to[0] || from[1] !== to[1]) enter(to, from);
    mouse(cell(...to), "mouseup");
  };
  /** A copy, cut or paste in the hidden field, with a clipboard that records what is put on it. */
  const clip = (type: "copy" | "cut" | "paste", held: Record<string, string> = {}) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { getData: (t: string) => held[t] ?? "", setData: (t: string, v: string) => void (held[t] = v) } });
    act(() => void keys().dispatchEvent(event));
    return held;
  };
  /** The note's undo (the table draws what it brought back a moment later, as after any change from outside it). */
  const undo = async () => {
    act(() => void editor.commands.undo());
    await settle();
  };
  return { host, editor, pos, data, texts, cell, keys, selected, openCell, mouse, enter, key, pointer, dragCells, clip, undo };
}

describe("selecting a range of cells", () => {
  test("a click still opens the cell; dragging across cells selects the rectangle and closes it", async () => {
    const t = await mount();
    t.mouse(t.cell(1, 0), "mousedown", { buttons: 1 });
    expect(t.openCell()).toBe("1:0");
    expect(t.selected()).toEqual([]);
    t.enter([2, 1], [1, 0]);
    expect(t.selected()).toEqual(["1:0", "1:1", "2:0", "2:1"]);
    expect(t.openCell()).toBeNull();
    expect(document.activeElement).toBe(t.keys());
    // The outline is drawn by the cells on the rectangle's edge; the cell it started at is marked.
    expect(t.cell(1, 0).className).toMatch(/fb-sel-t.*fb-sel-l.*fb-sel-anchor/);
    expect(t.cell(2, 1).className).toMatch(/fb-sel-b.*fb-sel-r/);
    expect(t.cell(2, 1).className).not.toMatch(/fb-sel-t|fb-sel-l|fb-sel-anchor/);
    // The table block is the note's selection, so no other block's tools are up.
    expect(t.editor.state.selection instanceof NodeSelection && t.editor.state.selection.from === t.pos()).toBe(true);
    // Moving on with the button up selects nothing more.
    t.mouse(t.cell(2, 1), "mouseup");
    t.enter([3, 2], [2, 1], 0);
    expect(t.selected().length).toBe(4);
    await settle();
  });

  test("Shift-click extends from the open cell, and again from where the range started", async () => {
    const t = await mount();
    t.mouse(t.cell(1, 1), "mousedown");
    t.mouse(t.cell(1, 1), "mouseup");
    t.mouse(t.cell(3, 2), "mousedown", { shiftKey: true });
    expect(t.selected()).toEqual(["1:1", "1:2", "2:1", "2:2", "3:1", "3:2"]);
    t.mouse(t.cell(3, 2), "mouseup");
    t.mouse(t.cell(0, 0), "mousedown", { shiftKey: true });
    expect(t.selected()).toEqual(["0:0", "0:1", "1:0", "1:1"]);
    await settle();
  });

  test("the range is the rows as they show: a sorted table selects what is seen", async () => {
    // Sorted by price, high to low: Jam (row 3), Cake (2), Tea (1).
    const t = await mount(ROWS, { view: { sort: { column: 1, desc: true } } });
    expect([...t.host.querySelectorAll("tbody tr")].map((tr) => tr.querySelector<HTMLElement>("[data-cell-at]")!.dataset.cellAt)).toEqual(["0:0", "3:0", "2:0", "1:0"]);
    t.dragCells([3, 0], [2, 1]);
    expect(t.selected()).toEqual(["3:0", "3:1", "2:0", "2:1"]);
    t.key(t.keys(), "Delete");
    expect(t.texts()).toEqual([["Item", "Price", "Qty"], ["Tea", "3", "2"], ["", "", "5"], ["", "", "1"]]);
    await settle();
  });

  test("arrows collapse the range and move, Shift and an arrow grow it, and it stops at the table's edge", async () => {
    const t = await mount();
    t.dragCells([1, 0], [2, 1]);
    t.key(t.keys(), "ArrowRight");
    expect(t.selected()).toEqual(["1:1"]);
    t.key(t.keys(), "ArrowDown", { shiftKey: true });
    t.key(t.keys(), "ArrowRight", { shiftKey: true });
    expect(t.selected()).toEqual(["1:1", "1:2", "2:1", "2:2"]);
    t.key(t.keys(), "ArrowRight", { shiftKey: true });
    expect(t.selected().length).toBe(4);
    t.key(t.keys(), "ArrowUp");
    t.key(t.keys(), "ArrowUp");
    t.key(t.keys(), "ArrowUp");
    expect(t.selected()).toEqual(["0:1"]);
    await settle();
  });

  test("⌘A selects every cell; Escape drops the range and leaves the table block selected in the note", async () => {
    const t = await mount();
    t.dragCells([1, 0], [1, 1]);
    t.key(t.keys(), "a", { metaKey: true });
    expect(t.selected().length).toBe(12);
    t.key(t.keys(), "Escape");
    expect(t.selected()).toEqual([]);
    expect(t.editor.state.selection instanceof NodeSelection && t.editor.state.selection.from === t.pos()).toBe(true);
    expect(document.activeElement).not.toBe(t.keys());
    await settle();
  });

  test("Enter opens the cell the range started at; a typed character opens it with its content selected", async () => {
    const t = await mount();
    t.dragCells([2, 1], [3, 2]);
    t.key(t.keys(), "Enter");
    expect(t.openCell()).toBe("2:1");
    expect(t.selected()).toEqual([]);
    t.mouse(t.cell(3, 2), "mousedown", { shiftKey: true });
    t.mouse(t.cell(3, 2), "mouseup");
    const typed = new KeyboardEvent("keydown", { key: "x", bubbles: true, cancelable: true });
    act(() => void t.keys().dispatchEvent(typed));
    expect(t.openCell()).toBe("2:1");
    // The key itself is left to the browser, which types it into the cell that now has the keyboard.
    expect(typed.defaultPrevented).toBe(false);
    const editorEl = t.host.querySelector<HTMLElement>(".fb-cell-editor")!;
    expect(document.activeElement).toBe(editorEl);
    await settle();
  });

  test("Shift and an arrow from an open cell starts a range from it", async () => {
    const t = await mount();
    t.mouse(t.cell(1, 1), "mousedown");
    t.mouse(t.cell(1, 1), "mouseup");
    const editorEl = t.host.querySelector<HTMLElement & { editor: Editor }>(".fb-cell-editor")!;
    // The caret is before the "3" (where jsdom puts a click): Shift+→ has text to select, so the cell keeps it.
    t.key(editorEl, "ArrowRight", { shiftKey: true });
    expect(t.selected()).toEqual([]);
    expect(t.openCell()).toBe("1:1");
    // At the cell's edge it has nowhere to go in the cell: the cells are selected instead.
    t.key(editorEl, "ArrowLeft", { shiftKey: true });
    expect(t.selected()).toEqual(["1:0", "1:1"]);
    expect(t.openCell()).toBeNull();
    t.key(t.keys(), "ArrowDown", { shiftKey: true });
    expect(t.selected()).toEqual(["1:0", "1:1", "2:0", "2:1"]);
    await settle();
  });
});

describe("moving between a cell and a range", () => {
  test("⌘A in a cell selects its text first, and every cell once the text is all selected", async () => {
    const t = await mount();
    t.mouse(t.cell(2, 0), "mousedown");
    t.mouse(t.cell(2, 0), "mouseup");
    const editorEl = t.host.querySelector<HTMLElement & { editor: Editor }>(".fb-cell-editor")!;
    t.key(editorEl, "a", { metaKey: true });
    expect(t.selected()).toEqual([]);
    expect(t.openCell()).toBe("2:0");
    act(() => void editorEl.editor.commands.selectAll());
    t.key(editorEl, "a", { metaKey: true });
    expect(t.selected().length).toBe(12);
    expect(t.openCell()).toBeNull();
    await settle();
  });

  test("Tab goes cell to cell with the range, wrapping to the next row", async () => {
    const t = await mount();
    t.dragCells([1, 1], [1, 2]);
    t.key(t.keys(), "Tab");
    expect(t.selected()).toEqual(["1:2"]);
    t.key(t.keys(), "Tab");
    expect(t.selected()).toEqual(["2:0"]);
    t.key(t.keys(), "Tab", { shiftKey: true });
    expect(t.selected()).toEqual(["1:2"]);
    await settle();
  });

  test("the caret going back into the note's text drops the range", async () => {
    const t = await mount();
    t.dragCells([1, 0], [2, 1]);
    expect(t.selected().length).toBe(4);
    act(() => t.editor.view.focus());
    await settle();
    expect(document.activeElement).toBe(t.editor.view.dom);
    expect(t.selected()).toEqual([]);
  });

  test("a range follows its rows when another device adds one above, and goes when its rows do", async () => {
    const t = await mount();
    t.dragCells([2, 0], [3, 1]);
    const change = (fn: (d: model.TableData) => model.TableData | null) =>
      act(() => {
        const node = t.editor.state.doc.nodeAt(t.pos())!;
        t.editor.view.dispatch(t.editor.state.tr.setNodeMarkup(t.pos(), undefined, { ...node.attrs, ...model.tableAttrs(fn(model.tableData(node.attrs))!) }).setMeta("addToHistory", false));
      });
    change((d) => model.addRow(d, 1));
    await settle();
    expect(t.selected()).toEqual(["3:0", "3:1", "4:0", "4:1"]);
    t.key(t.keys(), "Delete");
    expect(t.texts()).toEqual([["Item", "Price", "Qty"], ["", "", ""], ["Tea", "3", "2"], ["", "", "5"], ["", "", "1"]]);
    change((d) => model.deleteRow(d, 4));
    await settle();
    expect(t.selected()).toEqual([]);
  });

  test("a grid pasted into an open cell fills from that cell on, in one step", async () => {
    const t = await mount();
    t.mouse(t.cell(2, 1), "mousedown");
    t.mouse(t.cell(2, 1), "mouseup");
    const editorEl = t.host.querySelector<HTMLElement>(".fb-cell-editor")!;
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { getData: (type: string) => (type === "text/plain" ? "a\tb\nc\td" : ""), types: ["text/plain"], files: [], items: [] } });
    act(() => void editorEl.dispatchEvent(paste));
    await settle();
    expect(t.texts()).toEqual([["Item", "Price", "Qty"], ["Tea", "3", "2"], ["Cake", "a", "b"], ["Jam", "c", "d"]]);
    await t.undo();
    expect(t.texts()).toEqual(ROWS);
  });
});

describe("what a range's keys and clipboard do", () => {
  test("Delete clears the cells in one undo step", async () => {
    const t = await mount();
    t.dragCells([1, 1], [2, 2]);
    t.key(t.keys(), "Backspace");
    expect(t.texts()).toEqual([["Item", "Price", "Qty"], ["Tea", "", ""], ["Cake", "", ""], ["Jam", "6", "1"]]);
    expect(t.selected().length).toBe(4);
    await t.undo();
    expect(t.texts()).toEqual(ROWS);
    await settle();
  });

  test("copy puts tab-separated text and an HTML table on the clipboard; cut also clears, in one step", async () => {
    const t = await mount();
    t.dragCells([1, 0], [2, 1]);
    const copied = t.clip("copy");
    expect(copied["text/plain"]).toBe("Tea\t3\nCake\t4");
    expect(copied["text/html"]).toContain("<table");
    expect(t.texts()).toEqual(ROWS);
    const cut = t.clip("cut");
    expect(cut["text/plain"]).toBe("Tea\t3\nCake\t4");
    expect(t.texts().slice(1, 3)).toEqual([["", "", "2"], ["", "", "5"]]);
    await t.undo();
    expect(t.texts()).toEqual(ROWS);
    await settle();
  });

  test("a copied range pastes back from the range's first cell, growing the table, in one step", async () => {
    const t = await mount();
    t.dragCells([1, 0], [2, 1]);
    const copied = t.clip("copy");
    t.key(t.keys(), "ArrowDown");
    t.key(t.keys(), "ArrowDown");
    t.key(t.keys(), "ArrowRight");
    expect(t.selected()).toEqual(["3:1"]);
    t.clip("paste", copied);
    expect(t.texts()).toEqual([["Item", "Price", "Qty"], ["Tea", "3", "2"], ["Cake", "4", "5"], ["Jam", "Tea", "3"], ["", "Cake", "4"]]);
    await t.undo();
    expect(t.texts()).toEqual(ROWS);
    await settle();
  });

  test("one copied value fills the whole range; a copied formula points at each row it fills", async () => {
    const t = await mount([...ROWS.map((r, i) => [...r, i ? `=B${i + 1}*C${i + 1}` : "Total"])]);
    t.dragCells([1, 0], [3, 0]);
    t.clip("paste", { "text/plain": "same" });
    expect(t.texts().map((r) => r[0])).toEqual(["Item", "same", "same", "same"]);
    await t.undo();
    // Row 2's total, copied and pasted over rows 2 to 4.
    t.dragCells([1, 2], [1, 3]);
    t.key(t.keys(), "ArrowRight");
    expect(t.selected()).toEqual(["1:3"]);
    const copied = t.clip("copy");
    expect(copied["text/plain"]).toBe("6");
    t.key(t.keys(), "ArrowDown", { shiftKey: true });
    t.key(t.keys(), "ArrowDown", { shiftKey: true });
    t.clip("paste", copied);
    expect(t.texts().map((r) => r[3])).toEqual(["Total", "=B2*C2", "=B3*C3", "=B4*C4"]);
    await settle();
  });

  test("the note leaves the range's keys, copy and paste to the table", async () => {
    const t = await mount();
    for (const type of ["keydown", "copy", "cut", "paste", "mousedown"]) {
      const event = new Event(type, { bubbles: true });
      Object.defineProperty(event, "target", { value: t.keys() });
      expect(tableHandlesEvent(event)).toBe(true);
    }
    const grip = new Event("mousedown", { bubbles: true });
    Object.defineProperty(grip, "target", { value: t.host.querySelector(".fb-col-resize") });
    expect(tableHandlesEvent(grip)).toBe(true);
    await settle();
  });
});

describe("a column's width", () => {
  test("dragging the line at its right edge shows the width at once and writes it once, on release", async () => {
    const t = await mount();
    const line = t.host.querySelectorAll<HTMLElement>(".fb-col-resize")[1]!;
    const col = () => t.host.querySelectorAll<HTMLElement>("col")[1]!;
    vi.spyOn(t.cell(0, 1), "getBoundingClientRect").mockReturnValue({ width: 140 } as DOMRect);
    const before = t.editor.state.doc;
    t.pointer(line, "pointerdown", 300);
    t.pointer(line, "pointermove", 330);
    expect(col().style.width).toBe("170px");
    t.pointer(line, "pointermove", 361);
    expect(col().style.width).toBe("201px");
    expect(t.editor.state.doc).toBe(before);
    t.pointer(line, "pointerup", 361);
    expect(t.data().columns).toEqual([{}, { width: 201 }]);
    expect(col().style.width).toBe("201px");
    expect(t.cell(1, 1).className).toContain("fb-col-sized");
    await t.undo();
    expect(t.data().columns).toEqual([]);
    expect(col().style.width).toBe("");
    await settle();
  });

  test("stays within 60 and 800 pixels, and Escape gives the drag up", async () => {
    const t = await mount();
    const line = t.host.querySelectorAll<HTMLElement>(".fb-col-resize")[0]!;
    vi.spyOn(t.cell(0, 0), "getBoundingClientRect").mockReturnValue({ width: 140 } as DOMRect);
    t.pointer(line, "pointerdown", 300);
    t.pointer(line, "pointermove", 0);
    expect(t.host.querySelector<HTMLElement>("col")!.style.width).toBe("60px");
    t.pointer(line, "pointermove", 2000);
    expect(t.host.querySelector<HTMLElement>("col")!.style.width).toBe("800px");
    act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(t.host.querySelector<HTMLElement>("col")!.style.width).toBe("");
    t.pointer(line, "pointerup", 2000);
    expect(t.data().columns).toEqual([]);
    await settle();
  });

  test("a press that doesn't move writes nothing; a double-click makes the column automatic again", async () => {
    const t = await mount(ROWS, { columns: [{ format: "number", width: 220 }] });
    expect(t.host.querySelector<HTMLElement>("col")!.style.width).toBe("220px");
    const line = t.host.querySelectorAll<HTMLElement>(".fb-col-resize")[0]!;
    const before = t.editor.state.doc;
    t.pointer(line, "pointerdown", 300);
    t.pointer(line, "pointerup", 300);
    expect(t.editor.state.doc).toBe(before);
    t.mouse(line, "dblclick");
    await settle();
    expect(t.data().columns).toEqual([{ format: "number" }]);
    expect(t.host.querySelector<HTMLElement>("col")!.style.width).toBe("");
    await t.undo();
    expect(t.data().columns).toEqual([{ format: "number", width: 220 }]);
    await settle();
  });

  test("every column with a width: the table is as wide as they add up to, not stretched to the note", async () => {
    const t = await mount(ROWS, { columns: [{ width: 100 }, { width: 100 }] });
    expect(t.host.querySelector(".fb-table")!.className).toContain("w-full");
    const sized = await mount(ROWS, { columns: [{ width: 100 }, { width: 100 }, { width: 300 }] });
    expect(sized.host.querySelector(".fb-table")!.className).toContain("fb-table-sized");
    expect(sized.host.querySelector(".fb-table")!.className).not.toContain("w-full");
    t.editor.destroy();
    t.host.remove();
    await settle();
  });
});

describe("dragging a row or a column to another place", () => {
  /** Rows 30 px tall and columns 100 px wide, where jsdom lays nothing out. */
  const layOut = (host: HTMLElement) => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const box = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
      const td = this.closest<HTMLElement>("[data-cell-at]");
      const tr = this.closest("tbody > tr");
      const rowAt = tr ? [...host.querySelectorAll("tbody > tr")].indexOf(tr) : 0;
      if (this.matches("[data-cell-at]") && td) return box([...td.parentElement!.querySelectorAll("[data-cell-at]")].indexOf(td) * 100, rowAt * 30, 100, 30);
      if (this.matches("tbody > tr")) return box(0, rowAt * 30, 300, 30);
      return box(0, 0, 0, 0);
    });
  };

  test("a row dragged by its handle shows where it will land and moves on release, in one step", async () => {
    const t = await mount([...ROWS.map((r, i) => [...r, i ? `=B${i + 1}*C${i + 1}` : "Total"])]);
    layOut(t.host);
    const grip = t.host.querySelectorAll<HTMLElement>(".fb-table-grip-row")[1]!;
    expect(grip.getAttribute("aria-label")).toBe("Drag row 2 to move it");
    t.pointer(grip, "pointerdown", 400, 45);
    t.pointer(grip, "pointermove", 400, 47);
    expect(t.host.querySelector(".fb-table-dropline")).toBeNull();
    // Past the middle of the last row: it lands after it.
    t.pointer(grip, "pointermove", 400, 110);
    const line = t.host.querySelector<HTMLElement>(".fb-table-dropline")!;
    expect(line.dataset.kind).toBe("row");
    expect(line.style.top).toBe("120px");
    expect(line.style.width).toBe("400px");
    expect(t.texts()[1]![0]).toBe("Tea");
    t.pointer(grip, "pointerup", 400, 110);
    expect(t.host.querySelector(".fb-table-dropline")).toBeNull();
    expect(t.texts()).toEqual([["Item", "Price", "Qty", "Total"], ["Cake", "4", "5", "=B2*C2"], ["Jam", "6", "1", "=B3*C3"], ["Tea", "3", "2", "=B4*C4"]]);
    await t.undo();
    expect(t.texts()[1]).toEqual(["Tea", "3", "2", "=B2*C2"]);
    await settle();
  });

  test("Escape gives the drag up, and dropping a row where it already is changes nothing", async () => {
    const t = await mount();
    layOut(t.host);
    const before = t.editor.state.doc;
    const grip = t.host.querySelectorAll<HTMLElement>(".fb-table-grip-row")[1]!;
    t.pointer(grip, "pointerdown", 400, 45);
    t.pointer(grip, "pointermove", 400, 110);
    expect(t.host.querySelector(".fb-table-dropline")).not.toBeNull();
    act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(t.host.querySelector(".fb-table-dropline")).toBeNull();
    t.pointer(grip, "pointerup", 400, 110);
    expect(t.editor.state.doc).toBe(before);
    t.pointer(grip, "pointerdown", 400, 45);
    t.pointer(grip, "pointermove", 400, 62);
    t.pointer(grip, "pointerup", 400, 62);
    expect(t.editor.state.doc).toBe(before);
    await settle();
  });

  test("a column dragged by its handle moves with its width, and the open cell follows it", async () => {
    const t = await mount(ROWS, { columns: [{ width: 220 }] });
    layOut(t.host);
    t.mouse(t.cell(2, 0), "mousedown");
    t.mouse(t.cell(2, 0), "mouseup");
    expect(t.openCell()).toBe("2:0");
    const grip = t.host.querySelector<HTMLElement>("thead .fb-table-grip")!;
    expect(grip.getAttribute("aria-label")).toBe("Drag column A to move it");
    t.pointer(grip, "pointerdown", 50, 5);
    t.pointer(grip, "pointermove", 290, 5);
    const line = t.host.querySelector<HTMLElement>(".fb-table-dropline")!;
    expect(line.dataset.kind).toBe("col");
    expect(line.style.left).toBe("300px");
    t.pointer(grip, "pointerup", 290, 5);
    expect(t.texts()[2]).toEqual(["4", "5", "Cake"]);
    expect(t.data().columns).toEqual([{}, {}, { width: 220 }]);
    expect(t.openCell()).toBe("2:2");
    await settle();
  });

  test("rows can't be dragged while a sort or filter is on, or past the totals row", async () => {
    const sorted = await mount(ROWS, { view: { sort: { column: 1 } } });
    const grips = [...sorted.host.querySelectorAll<HTMLButtonElement>(".fb-table-grip-row")];
    expect(grips.every((g) => g.disabled)).toBe(true);
    expect(grips[1]!.title).toBe("Clear the sort and filter to move rows");
    sorted.editor.destroy();
    sorted.host.remove();
    const t = await mount([...ROWS, ["Total", "13", "8"]], { totalsRow: true });
    layOut(t.host);
    const rows = [...t.host.querySelectorAll<HTMLButtonElement>(".fb-table-grip-row")];
    expect(rows[4]!.disabled).toBe(true);
    t.pointer(rows[1]!, "pointerdown", 400, 45);
    t.pointer(rows[1]!, "pointermove", 400, 149);
    // Under the pointer is the totals row: the line is above it, not below.
    expect(t.host.querySelector<HTMLElement>(".fb-table-dropline")!.style.top).toBe("120px");
    t.pointer(rows[1]!, "pointerup", 400, 149);
    expect(t.texts().map((r) => r[0])).toEqual(["Item", "Cake", "Jam", "Tea", "Total"]);
    await settle();
  });
});

describe("the open cell stays on its row", () => {
  /** A change this view didn't make: another device's, as the note receives it. */
  const remote = (t: Awaited<ReturnType<typeof mount>>, change: (d: model.TableData) => model.TableData | null) =>
    act(() => {
      const node = t.editor.state.doc.nodeAt(t.pos())!;
      t.editor.view.dispatch(t.editor.state.tr.setNodeMarkup(t.pos(), undefined, { ...node.attrs, ...model.tableAttrs(change(model.tableData(node.attrs))!) }).setMeta("addToHistory", false));
    });
  const type = (t: Awaited<ReturnType<typeof mount>>, text: string) =>
    act(() => {
      const view = (t.host.querySelector(".fb-cell-editor") as HTMLElement & { editor?: Editor }).editor!.view;
      view.dispatch(view.state.tr.insertText(text, view.state.doc.content.size - 1));
    });

  test("a row added above by another device: the cell follows, and typing goes into the same row", async () => {
    const t = await mount();
    t.mouse(t.cell(2, 0), "mousedown");
    t.mouse(t.cell(2, 0), "mouseup");
    expect(t.openCell()).toBe("2:0");
    remote(t, (d) => model.addRow(d, 1));
    await settle();
    expect(t.openCell()).toBe("3:0");
    type(t, "!");
    expect(t.texts().map((r) => r[0])).toEqual(["Item", "", "Tea", "Cake!", "Jam"]);
    await settle();
  });

  test("a row removed above: the cell moves up with its row; its own row removed: the cell closes", async () => {
    const t = await mount();
    t.mouse(t.cell(3, 1), "mousedown");
    t.mouse(t.cell(3, 1), "mouseup");
    remote(t, (d) => model.deleteRow(d, 1));
    await settle();
    expect(t.openCell()).toBe("2:1");
    type(t, "0");
    expect(t.texts()).toEqual([["Item", "Price", "Qty"], ["Cake", "4", "5"], ["Jam", "60", "1"]]);
    remote(t, (d) => model.deleteRow(d, 2));
    await settle();
    expect(t.openCell()).toBeNull();
    expect(t.texts()).toEqual([["Item", "Price", "Qty"], ["Cake", "4", "5"]]);
    await settle();
  });

  test("undoing a row this view added above the open cell brings the cell back with its row", async () => {
    const t = await mount();
    t.mouse(t.cell(2, 0), "mousedown");
    t.mouse(t.cell(2, 0), "mouseup");
    // The view's own change (the row tools' arrow): the cell follows at once.
    const up = t.host.querySelector<HTMLButtonElement>('[aria-label="Move row 3 up"]')!;
    act(() => up.click());
    expect(t.openCell()).toBe("1:0");
    expect(t.texts().map((r) => r[0])).toEqual(["Item", "Cake", "Tea", "Jam"]);
    await t.undo();
    await settle();
    expect(t.texts().map((r) => r[0])).toEqual(["Item", "Tea", "Cake", "Jam"]);
    expect(t.openCell()).toBe("2:0");
    await settle();
  });

  test("a column added before the open cell by its own menu's neighbour moves the cell with its column", async () => {
    const t = await mount();
    t.mouse(t.cell(1, 1), "mousedown");
    t.mouse(t.cell(1, 1), "mouseup");
    remote(t, (d) => model.addColumn(d, 0));
    await settle();
    expect(t.openCell()).toBe("1:2");
    type(t, "9");
    expect(t.texts()[1]).toEqual(["", "Tea", "39", "2"]);
    await settle();
  });
});
