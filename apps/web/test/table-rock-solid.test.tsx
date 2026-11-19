// The table block in a real editor, the faults an audit of it found (components/editor/table): text pasted
// into a cell on several lines, a cell and a table that are full, a paste that doesn't fit, how little is
// drawn again for a key, the column menu following its column, Foli AI's change applied to the table as it is
// by then, an input method composing while the cell changes under it, and a finger on a column's edge.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor, EditorContent, ReactNodeViewRenderer, type JSONContent } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { LIMITS, TABLE_LIMITS, tableCellText, tableFormulaParses, type InlineNode } from "@folevi/editor-schema";
import { ALL_MARKS, ALL_NODES, TableBlock } from "@/components/editor/extensions";
import { NoteHistory } from "@/components/editor/noteHistory";
import { TableView, tableHandlesEvent } from "@/components/editor/table/TableView";
import { TABLE_AI_EVENT } from "@/components/editor/table/events";
import { cellComposing } from "@/components/editor/table/cellEditorStore";
import * as model from "@/components/editor/table/tableModel";
import type { TableAiResult } from "@/components/editor/table/TableAi";

// Foli AI's switch asks the server; these tests have none.
vi.mock("@/components/ai/useAi", () => ({ useAiEnabled: () => false }));

// How many cells are drawn: each cell that isn't open draws one StaticCell, so counting them counts the cells
// a change drew again.
const drawn = vi.hoisted(() => ({ cells: 0 }));
vi.mock("@/components/editor/table/TableStatic", async (original) => {
  const real = await original<typeof import("@/components/editor/table/TableStatic")>();
  return {
    ...real,
    StaticCell: (props: Parameters<typeof real.StaticCell>[0]) => {
      drawn.cells++;
      return real.StaticCell(props);
    },
  };
});

// Foli AI's panel asks the server: here it is a stand-in that hands the test what the table gave it.
type AiProps = { table: model.TableData; preview: TableAiResult | null; onPreview: (r: TableAiResult | null) => void; onAccept: (r: TableAiResult) => void };
const ai = vi.hoisted(() => ({ props: null as unknown }));
vi.mock("@/components/editor/table/TableAi", async (original) => {
  const real = await original<typeof import("@/components/editor/table/TableAi")>();
  return {
    ...real,
    TableAi: (props: unknown) => {
      ai.props = props;
      return null;
    },
  };
});
const aiProps = () => ai.props as AiProps;

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
  (globalThis as { ClipboardEvent?: unknown }).ClipboardEvent ??= class extends Event {};
  // (A paste scrolls the caret into view, which measures the text.)
  const none = { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) } as DOMRect;
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => none;
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
  ai.props = null;
  vi.restoreAllMocks();
});

const settle = (ms = 0) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

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
  const openCell = () => host.querySelector<HTMLElement>("[data-cell-slot]")?.closest<HTMLElement>("[data-cell-at]")?.dataset.cellAt ?? null;
  const mouse = (el: Element, type: string, init: MouseEventInit = {}) => act(() => void el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init })));
  const open = (r: number, c: number) => {
    mouse(cell(r, c), "mousedown");
    mouse(cell(r, c), "mouseup");
  };
  /** The open cell's own editor. */
  const view = () => (host.querySelector(".fb-cell-editor") as HTMLElement & { editor?: Editor }).editor!.view;
  /** Text typed at the end of the open cell. */
  const type = (text: string) => act(() => void view().dispatch(view().state.tr.insertText(text, view().state.doc.content.size - 1)));
  /** The caret at the end of the open cell's text. */
  const caretEnd = () => act(() => void view().dispatch(view().state.tr.setSelection(TextSelection.create(view().state.doc, view().state.doc.content.size - 1))));
  const key = (el: Element, k: string, init: KeyboardEventInit = {}) => act(() => void el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })));
  /** A paste into the open cell, as the clipboard hands it over. */
  const paste = (held: Record<string, string>) => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { getData: (t: string) => held[t] ?? "", types: Object.keys(held), files: [], items: [] } });
    act(() => void host.querySelector<HTMLElement>(".fb-cell-editor")!.dispatchEvent(event));
  };
  /** A change this view didn't make: another device's, as the note receives it. */
  const remote = (change: (d: model.TableData) => model.TableData | null) =>
    act(() => {
      const node = editor.state.doc.nodeAt(pos())!;
      editor.view.dispatch(editor.state.tr.setNodeMarkup(pos(), undefined, { ...node.attrs, ...model.tableAttrs(change(model.tableData(node.attrs))!) }).setMeta("addToHistory", false));
    });
  const notice = () => host.querySelector("[data-table-notice]")?.textContent ?? null;
  const undo = async () => {
    act(() => void editor.commands.undo());
    await settle();
  };
  return { host, editor, pos, data, texts, cell, openCell, mouse, open, view, type, caretEnd, key, paste, remote, notice, undo };
}

describe("text pasted into an open cell", () => {
  test("several lines stay several lines of the cell, where only the first used to be kept", async () => {
    const t = await mount();
    t.open(1, 0);
    t.caretEnd();
    act(() => void t.view().pasteText("first line\nsecond line\nthird"));
    expect(t.texts()[1]![0]).toBe("Teafirst line\nsecond line\nthird");
    // The cell shows them on three lines, as Shift+Enter writes them.
    expect(t.view().dom.querySelectorAll("br").length).toBeGreaterThanOrEqual(2);
    await t.undo();
    expect(t.texts()).toEqual(ROWS);
    await settle();
  });

  test("paragraphs from a page come in the same way, with their formatting; one line is pasted as it always was", async () => {
    const t = await mount();
    t.open(2, 0);
    t.caretEnd();
    act(() => void t.view().pasteHTML("<p>one <b>bold</b></p><p>two</p><ul><li>three</li></ul>"));
    expect(t.texts()[2]![0]).toBe("Cakeone bold\ntwo\nthree");
    expect(t.data().rows[2]![0]).toContainEqual({ type: "text", text: "bold", marks: [{ type: "bold" }] });
    t.open(3, 0);
    t.caretEnd();
    act(() => void t.view().pasteText(" and bread"));
    expect(t.texts()[3]![0]).toBe("Jam and bread");
    await settle();
  });
});

describe("a cell and a table that are full", () => {
  test("a cell stops at the length a paragraph may have, and says so; shorter text still goes in", async () => {
    const t = await mount();
    t.open(1, 0);
    t.type("x".repeat(TABLE_LIMITS.cellLength));
    // Refused whole: neither the cell nor the note took any of it.
    expect(t.texts()[1]![0]).toBe("Tea");
    expect(t.view().state.doc.textContent).toBe("Tea");
    expect(t.notice()).toBe("A cell holds up to 20,000 characters. The text wasn't added.");
    t.type("!");
    expect(t.texts()[1]![0]).toBe("Tea!");
    await settle();
  });

  test("a table stops at 400,000 bytes of text: typing and pasting are refused with a message, deleting is not", async () => {
    // 20 rows by 20 columns of 970 characters: just under the limit.
    const big = Array.from({ length: 20 }, () => Array.from({ length: 20 }, () => "y".repeat(970)));
    const t = await mount(big, { headerRow: false });
    expect(model.tableBytes(t.data().rows)).toBeLessThanOrEqual(TABLE_LIMITS.dataBytes);
    t.open(3, 3);
    t.type("z".repeat(2000));
    expect(t.texts()[3]![3]).toBe("y".repeat(970));
    expect(t.notice()).toBe("This table is full. Remove some text to make room.");
    // A paste of cells that would fill it: refused whole, nothing written.
    const before = t.editor.state.doc;
    t.paste({ "text/plain": `${"p".repeat(3000)}\t${"q".repeat(3000)}` });
    await settle();
    expect(t.editor.state.doc).toBe(before);
    expect(t.notice()).toBe("This table is full. Remove some text to make room.");
    // Text can always be taken out.
    act(() => void t.view().dispatch(t.view().state.tr.delete(1, 501)));
    expect(t.texts()[3]![3]).toBe("y".repeat(470));
    await settle();
  });
});

describe("a paste that doesn't fit, and a row that can't be added", () => {
  const full = () => [["n"], ...Array.from({ length: LIMITS.maxTableRows - 2 }, (_, i) => [String(i + 1)]), ["=SUM(A:A)"]];

  test("at the row limit the totals row is left alone and a notice says how much went in", async () => {
    const t = await mount(full(), { totalsRow: true });
    expect(t.data().rows.length).toBe(LIMITS.maxTableRows);
    t.open(197, 0);
    t.paste({ "text/plain": "a\tb\nc\td\ne\tf\ng\th" });
    await settle();
    expect(t.texts().slice(196).map((r) => r[0])).toEqual(["196", "a", "c", "=SUM(A:A)"]);
    expect(t.notice()).toBe("Pasted 2 of 4 rows. A table holds up to 200 rows and 20 columns.");
    await settle();
  });

  test("Enter in the last row of a full table says why no row was added", async () => {
    const t = await mount(full().slice(0, -1).concat([["last"]]));
    expect(t.data().rows.length).toBe(LIMITS.maxTableRows);
    t.open(199, 0);
    const before = t.editor.state.doc;
    t.key(t.view().dom, "Enter");
    expect(t.editor.state.doc).toBe(before);
    expect(t.notice()).toBe("A table holds up to 200 rows.");
    await settle();
  });
});

describe("how much is drawn again", () => {
  test("a key typed in a cell draws that row's cells, not the table's", async () => {
    const t = await mount();
    t.open(2, 0);
    await settle();
    drawn.cells = 0;
    t.type("!");
    await settle();
    expect(t.texts()[2]![0]).toBe("Cake!");
    // Row 2 has three cells and one of them is open: two are drawn. (All eleven used to be.)
    expect(drawn.cells).toBeLessThanOrEqual(2);
  });

  test("with formulas: the row typed in and the rows whose results changed, each formula read once", async () => {
    const t = await mount([
      ["Item", "Price", "Qty", "Total"],
      ["Tea", "3", "2", "=B2*C2"],
      ["Cake", "4", "5", "=B3*C3"],
      ["Jam", "6", "1", "=B4*C4"],
      ["All", "", "", "=SUM(D2:D4)"],
    ]);
    expect(t.cell(4, 3).textContent).toBe("32");
    t.open(1, 1);
    await settle();
    drawn.cells = 0;
    const parses = tableFormulaParses();
    t.type("0");
    await settle();
    expect(t.cell(1, 3).textContent).toBe("60");
    expect(t.cell(4, 3).textContent).toBe("86");
    // Rows 1 and 4 show something new (three and four cells); rows 0, 2 and 3 are left as they are.
    expect(drawn.cells).toBeLessThanOrEqual(7);
    expect(tableFormulaParses()).toBe(parses);
  });

  test("moving to the next cell draws the two rows involved", async () => {
    const t = await mount();
    t.open(1, 2);
    await settle();
    drawn.cells = 0;
    t.key(t.view().dom, "Tab");
    await settle();
    expect(t.openCell()).toBe("2:0");
    expect(drawn.cells).toBeLessThanOrEqual(5);
  });
});

describe("a column's edge being dragged", () => {
  test("the column takes each width at once; its cells are drawn once a frame, not once for every move", async () => {
    const t = await mount();
    const line = t.host.querySelectorAll<HTMLElement>(".fb-col-resize")[1]!;
    const col = () => t.host.querySelectorAll<HTMLElement>("col")[1]!;
    const move = (type: string, x: number) => act(() => void line.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x })));
    vi.spyOn(t.cell(0, 1), "getBoundingClientRect").mockReturnValue({ width: 140 } as DOMRect);
    move("pointerdown", 300);
    drawn.cells = 0;
    for (const x of [310, 320, 330, 340, 350]) move("pointermove", x);
    expect(col().style.width).toBe("190px");
    // Five moves used to draw all twelve cells five times, there and then.
    expect(drawn.cells).toBe(0);
    await settle(40);
    expect(drawn.cells).toBe(12);
    expect(t.cell(2, 1).style.minWidth).toBe("190px");
    move("pointerup", 350);
    expect(t.data().columns).toEqual([{}, { width: 190 }]);
    expect(t.cell(2, 1).style.minWidth).toBe("190px");
    await settle();
  });
});

describe("the column menu stays on its column", () => {
  const openMenu = (t: Awaited<ReturnType<typeof mount>>, letter: string) => act(() => t.host.querySelector<HTMLButtonElement>(`[aria-label="Column ${letter} options: format, sort, filter"]`)!.click());
  const expanded = (t: Awaited<ReturnType<typeof mount>>) => [...t.host.querySelectorAll<HTMLButtonElement>('[aria-label$="options: format, sort, filter"]')].map((b) => b.getAttribute("aria-expanded"));

  test("a column added before it by another device: the menu is still its column's; the column gone: it closes", async () => {
    const t = await mount();
    openMenu(t, "B");
    await settle();
    expect(expanded(t)).toEqual(["false", "true", "false"]);
    t.remote((d) => model.addColumn(d, 0));
    await settle();
    // "Price" was column B and is column C now. (The menu used to stay on B, which is now "Item".)
    expect(expanded(t)).toEqual(["false", "false", "true", "false"]);
    t.remote((d) => model.deleteColumn(d, 2));
    await settle();
    expect(expanded(t)).toEqual(["false", "false", "false"]);
    await settle();
  });

  test("a column this view moves takes the menu with it", async () => {
    const t = await mount();
    openMenu(t, "B");
    await settle();
    act(() => t.host.querySelector<HTMLButtonElement>('[aria-label="Move column B right"]')!.click());
    await settle();
    expect(t.texts()[0]).toEqual(["Item", "Qty", "Price"]);
    expect(expanded(t)).toEqual(["false", "false", "true"]);
    await settle();
  });
});

describe("Foli AI's change, accepted after the table moved on", () => {
  const start = async (t: Awaited<ReturnType<typeof mount>>) => {
    const frame = t.host.querySelector(".fb-table-block > div")!;
    act(() => void frame.dispatchEvent(new CustomEvent(TABLE_AI_EVENT, { detail: { mode: "edit" } })));
    // (The panel is loaded when first asked for.)
    for (let i = 0; i < 20 && !ai.props; i++) await settle(5);
    expect(ai.props).not.toBeNull();
  };

  test("a cell typed while it worked is kept, beside the cell it changed", async () => {
    const { mergeAiRows } = await import("@/components/editor/table/TableAi");
    const t = await mount();
    await start(t);
    // Foli AI is sent the table as it is now, and answers a while later.
    const sent = aiProps().table;
    t.open(3, 0);
    t.type(" tart");
    await settle();
    const reply = mergeAiRows(sent, [["Item", "Price", "Qty"], ["Tea", "3.50", "2"], ["Cake", "4", "5"], ["Jam", "6", "1"]]);
    expect([...reply.changed]).toEqual(["1:1"]);
    act(() => aiProps().onPreview({ ...reply, summary: "Tea costs more." }));
    await settle();
    // What shows is its change on the table as it is now.
    expect(t.cell(1, 1).textContent).toBe("3.50");
    expect(t.cell(1, 1).className).toContain("fb-cell-changed");
    expect(t.cell(3, 0).textContent).toBe("Jam tart");
    act(() => aiProps().onAccept(aiProps().preview!));
    await settle();
    expect(t.texts()).toEqual([["Item", "Price", "Qty"], ["Tea", "3.50", "2"], ["Cake", "4", "5"], ["Jam tart", "6", "1"]]);
    // One step to undo, which leaves what was typed.
    await t.undo();
    expect(t.texts()[1]![1]).toBe("3");
    expect(t.texts()[3]![0]).toBe("Jam tart");
    await settle();
  });

  test("the table's columns changed meanwhile: its version isn't applied, and a notice says so", async () => {
    const { mergeAiRows } = await import("@/components/editor/table/TableAi");
    const t = await mount();
    await start(t);
    const reply = mergeAiRows(aiProps().table, [["Item", "Price", "Qty"], ["Tea", "9", "2"], ["Cake", "4", "5"], ["Jam", "6", "1"]]);
    t.remote((d) => model.addColumn(d, 0));
    await settle();
    act(() => aiProps().onPreview({ ...reply, summary: "" }));
    await settle();
    expect(t.notice()).toBe("The table changed while Foli AI was working, so its changes weren't applied. Ask again.");
    expect(t.texts()[1]).toEqual(["", "Tea", "3", "2"]);
    await settle();
  });
});

describe("an input method composing in the cell", () => {
  const compose = (t: Awaited<ReturnType<typeof mount>>, type: "compositionstart" | "compositionend") => act(() => void t.view().dom.dispatchEvent(new Event(type, { bubbles: true })));

  test("the cell's text isn't replaced under the marked text; a change from elsewhere arrives once it is done", async () => {
    const t = await mount();
    t.open(1, 0);
    compose(t, "compositionstart");
    expect(cellComposing()).toBe(true);
    t.remote((d) => model.setCell(d, 1, 0, txt("Remote")));
    await settle();
    // (It used to be loaded at once, over what was being composed.)
    expect(t.view().state.doc.textContent).toBe("Tea");
    compose(t, "compositionend");
    await settle(80);
    expect(cellComposing()).toBe(false);
    expect(t.view().state.doc.textContent).toBe("Remote");
    await settle();
  });

  test("what was composed wins over the older change; and moving to another cell ends the composition in this one first", async () => {
    const t = await mount();
    t.open(1, 0);
    compose(t, "compositionstart");
    t.remote((d) => model.setCell(d, 1, 0, txt("Remote")));
    await settle();
    t.type("ち");
    compose(t, "compositionend");
    await settle(80);
    expect(t.texts()[1]![0]).toBe("Teaち");
    expect(t.view().state.doc.textContent).toBe("Teaち");
    // Still composing when another cell is pressed: the field is left first, which makes the keyboard commit.
    compose(t, "compositionstart");
    const blur = vi.spyOn(t.view().dom, "blur");
    t.open(2, 1);
    expect(blur).toHaveBeenCalled();
    expect(t.openCell()).toBe("2:1");
    await settle();
  });
});

describe("a finger on a column's edge", () => {
  const press = (el: Element, type: string, x: number, y: number, pointerType: string) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
    Object.defineProperty(event, "pointerType", { value: pointerType });
    act(() => void el.dispatchEvent(event));
  };

  test("on the line where it runs down over the cells nothing is resized; in the tools row it is", async () => {
    const t = await mount();
    const line = t.host.querySelectorAll<HTMLElement>(".fb-col-resize")[1]!;
    const col = () => t.host.querySelectorAll<HTMLElement>("col")[1]!;
    vi.spyOn(t.host.querySelector("thead")!, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 30 } as DOMRect);
    vi.spyOn(t.cell(0, 1), "getBoundingClientRect").mockReturnValue({ width: 140 } as DOMRect);
    const before = t.editor.state.doc;
    // A swipe that begins on the line, level with the third row.
    press(line, "pointerdown", 300, 120, "touch");
    press(line, "pointermove", 360, 120, "touch");
    press(line, "pointerup", 360, 120, "touch");
    expect(col().style.width).toBe("");
    expect(t.editor.state.doc).toBe(before);
    // The same press with a mouse is a resize, as it was; so is a finger on the tools row's part of the line.
    press(line, "pointerdown", 300, 10, "touch");
    press(line, "pointermove", 360, 10, "touch");
    expect(col().style.width).toBe("200px");
    press(line, "pointerup", 360, 10, "touch");
    expect(t.data().columns).toEqual([{}, { width: 200 }]);
    press(line, "pointerdown", 300, 120, "mouse");
    press(line, "pointermove", 320, 120, "mouse");
    press(line, "pointerup", 320, 120, "mouse");
    expect(t.data().columns).toEqual([{}, { width: 220 }]);
    await settle();
  });

  test("where touch is the way in, the line is kept to the tools row and hidden with it (table.css)", () => {
    const css = readFileSync(resolve(process.cwd(), "src/components/editor/table/table.css"), "utf8");
    const coarse = [...css.matchAll(/@media \(pointer: coarse\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]!).join("\n");
    // Placed against the tools row's cells (so it ends where they do), and no longer forced visible.
    expect(coarse).toMatch(/\.fb-table > thead > tr > td \{ position: relative; \}/);
    expect(coarse).toMatch(/\.fb-col-resize \{[^}]*visibility: inherit;/);
  });
});
