"use client";

// The table block in a note: cells with formatted text and formulas, row and column tools, number formats,
// a totals row, a saved sort and filter, spreadsheet paste and Foli AI. Cells show their stored content (or a
// formula's result); the one being edited opens a small editor of its own (CellEditor.tsx explains why).
//
// It is also a grid, as in Numbers or Excel: dragging across cells (or Shift and a click or an arrow) selects
// a rectangle of them to clear, copy, cut or paste over; the line between two columns drags to set a width;
// and a row or a column drags by its handle to another place.
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { closeHistory } from "@tiptap/pm/history";
import { NodeSelection, Selection } from "@tiptap/pm/state";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronDown, GripHorizontal, GripVertical, Minus, Plus, Sigma, X } from "lucide-react";
import {
  LIMITS,
  TOTALS_FUNCTIONS,
  cellReference,
  columnLetter,
  evaluateTable,
  insertIndexMap,
  moveIndexMap,
  tableCellText,
  tableRowOrder,
  totalsFormula,
  totalsFunctionOf,
  type InlineNode,
  type TableViewSettings,
  type TotalsFunction,
} from "@folevi/editor-schema";
import { announce } from "@/lib/a11y/announce";
import { keyLabel } from "@/lib/shortcuts";
import { MenuButton } from "@/components/ui/Menu";
import { useAiEnabled } from "@/components/ai/useAi";
import { AiIcon } from "@/components/ai/AiIcon";
import { useIphoneApp } from "@/lib/iphone";
import { useScrollEdges } from "../scrollEdges";
import { endHistoryGroup } from "../commands";
import { useEditable } from "../useEditable";
import { cellInline } from "../paste";
import { CellEditor, type CaretStart, type CellEditorHandlers, type CellKeyEvent } from "./CellEditor";
import { StaticCell, cellClass, localToday } from "./TableStatic";
import { TableColumnMenu, columnName } from "./TableColumnMenu";
import { clipboardGrid, type SheetGrid } from "./sheetPaste";
import { rangeClipboard } from "./tableClipboard";
import * as model from "./tableModel";
import type { TableData } from "./tableModel";
import type { TableAiMode, TableAiResult } from "./TableAi";
import { TABLE_AI_EVENT } from "./events";
import "./table.css";

const TableAi = lazy(() => import("./TableAi").then((m) => ({ default: m.TableAi })));


const TOTAL_LABEL: Record<TotalsFunction, string> = { SUM: "Sum", AVERAGE: "Average", COUNT: "Count numbers", COUNTA: "Count filled", MIN: "Smallest", MAX: "Largest" };

type Active = { r: number; c: number; caret: CaretStart };
/** A cell by its stored row and its column. */
type Cell = { r: number; c: number };
/** Cells selected as a rectangle: from the cell it started at (the anchor) to the one it reaches now. */
type Range = { anchor: Cell; head: Cell };
/** A row or column being dragged to another place: where it would land (a slot before row or column `slot`) and the line that shows it. */
type Reorder = { kind: "row" | "col"; from: number; slot: number; line: { left: number; top: number; width: number; height: number } };

/** How far the pointer moves before a press on a handle is a drag. */
const DRAG_START = 4;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Plain text that isn't a spreadsheet's, pasted over a range: each line a row of one cell. */
function linesGrid(value: string): SheetGrid | null {
  const lines = value.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n").slice(0, LIMITS.maxTableRows);
  if (!lines.some((line) => line.trim())) return null;
  return { rows: lines.map((line): InlineNode[][] => [line ? [{ type: "text", text: line.slice(0, LIMITS.maxTextLength) }] : []]), headerRow: false };
}

export function TableView({ node, selected, updateAttributes, editor, getPos }: ReactNodeViewProps) {
  const editable = useEditable(editor);
  const aiOn = useAiEnabled();
  // The table as the note has it now: a tool's change shows in the same event (opening a cell in a row just
  // added needs it drawn), not a moment later when the view's own props catch up.
  let attrs = node.attrs;
  try {
    const pos = typeof getPos === "function" ? getPos() : undefined;
    const now = typeof pos === "number" ? editor.state.doc.nodeAt(pos) : null;
    if (now?.type.name === "table") attrs = now.attrs;
  } catch {
    /* the view is being taken down */
  }
  const t = useMemo(() => model.tableData(attrs), [attrs]);
  const width = model.width(t);
  const today = localToday();
  const [preview, setPreview] = useState<TableAiResult | null>(null);
  // What's shown: the table, or Foli AI's proposed version of it while it's being previewed.
  const shownTable: TableData = preview?.table ?? t;
  const evaluated = useMemo(() => evaluateTable(shownTable.rows, model.tableOptions(shownTable, today)), [shownTable, today]);
  const viewOrder = useMemo(() => tableRowOrder(evaluated, model.tableOptions(shownTable), shownTable.view), [evaluated, shownTable]);
  const [active, setActive] = useState<Active | null>(null);
  // Cells selected as a rectangle (no cell is open then: the keyboard is on the table's hidden field below).
  const [range, setRange] = useState<Range | null>(null);
  // A column's width while its edge is dragged (written to the note once, on release).
  const [sizing, setSizing] = useState<{ c: number; width: number } | null>(null);
  const [reorder, setReorder] = useState<Reorder | null>(null);
  // While a cell is being edited the rows stay where they are: the sort and the filters are applied again
  // once the table is left. Otherwise a row would jump (or vanish) under the caret the moment what is typed
  // sorts elsewhere or stops matching a filter, and a row just added to a filtered table would never show.
  const held = useRef<{ order: number[]; rows: number } | null>(null);
  let order = viewOrder;
  if (active && !preview) {
    const rows = shownTable.rows.length;
    // The row being edited always shows (last, above the totals).
    const withRow = (list: number[], r: number) => {
      if (list.includes(r) || r < 0 || r >= rows) return list;
      const totals = shownTable.totalsRow && list[list.length - 1] === rows - 1 ? 1 : 0;
      return [...list.slice(0, list.length - totals), r, ...list.slice(list.length - totals)];
    };
    // (Rows added, removed or moved by a tool renumber them: the held order starts over from the view's.)
    if (!held.current || held.current.rows !== rows) held.current = { order: withRow(viewOrder, active.r), rows };
    else held.current = { order: withRow(held.current.order, active.r), rows };
    order = held.current.order;
  } else held.current = null;
  const [focusWithin, setFocusWithin] = useState(false);
  const [menuColumn, setMenuColumn] = useState<number | null>(null);
  const [ai, setAi] = useState<TableAiMode | null>(null);
  const menuAnchor = useRef<HTMLButtonElement | null>(null);
  // The cell editor (CellEditor.tsx): made the first time a cell is edited, then moved from cell to cell.
  const cellEd = useRef<CellEditor | null>(null);
  const activeRef = useRef<Active | null>(null);
  activeRef.current = active;
  const rangeRef = useRef<Range | null>(null);
  rangeRef.current = range;
  // Where the keyboard is while a range is selected: a field nobody sees. Keys, and the copy, cut and paste
  // the browser only sends to something that can hold text, arrive there.
  const gridRef = useRef<HTMLTextAreaElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  useScrollEdges(scrollerRef);
  // Tools show while the table is selected or being edited.
  const tools = editable && !preview && (selected || focusWithin || active !== null);
  // The iPhone layout: a 44 pt "+" after the last column and under the last row (always there, as in Numbers),
  // instead of the small "+ Row" and "+ Column" links; the other tools show only while the table is in use.
  const phone = useIphoneApp();
  const phoneAdd = phone && editable && !preview;
  const viewOn = Boolean(t.view?.sort || t.view?.filters?.length);
  const activeText = active ? tableCellText(t.rows[active.r]?.[active.c] ?? []) : "";
  const formulaMode = active !== null && /^\s*=/.test(activeText);
  // The range as rows and columns of what shows: `order` positions i0 to i1 (so a sorted or filtered table
  // selects the rows seen), columns c0 to c1. Null when a cell it hangs on is no longer shown.
  const sel = useMemo(() => {
    if (!range || preview) return null;
    const a = order.indexOf(range.anchor.r);
    const h = order.indexOf(range.head.r);
    if (a < 0 || h < 0 || Math.max(range.anchor.c, range.head.c) >= width) return null;
    const i0 = Math.min(a, h);
    const i1 = Math.max(a, h);
    return { i0, i1, c0: Math.min(range.anchor.c, range.head.c), c1: Math.max(range.anchor.c, range.head.c), rows: order.slice(i0, i1 + 1) };
  }, [range, order, width, preview]);
  const selRef = useRef(sel);
  selRef.current = sel;
  const orderRef = useRef(order);
  orderRef.current = order;

  // The table as it is now (the view re-renders a moment after each change, so `t` can be a step behind).
  const live = useCallback((): { data: TableData; pos: number } | null => {
    const pos = typeof getPos === "function" ? getPos() : undefined;
    const n = typeof pos === "number" ? editor.state.doc.nodeAt(pos) : null;
    return n?.type.name === "table" && typeof pos === "number" ? { data: model.tableData(n.attrs), pos } : null;
  }, [editor, getPos]);

  // The rows this view last drew or wrote itself. Rows that arrive and aren't these were changed by something
  // else (another device, the note's undo): the open cell then finds its row again (see below).
  const seenRows = useRef(t.rows);

  /** Typing: grouped into the note's undo steps like any typing. */
  const write = useCallback(
    (change: (d: TableData) => TableData | null) => {
      if (!editor.isEditable) return;
      const now = live();
      if (!now) return;
      const next = change(now.data);
      if (!next) return;
      seenRows.current = next.rows;
      updateAttributes(model.tableAttrs(next));
    },
    [editor, live, updateAttributes],
  );
  /** A tool (rows, columns, formats, the view, Foli AI): its own undo step. */
  const tool = useCallback(
    (change: (d: TableData) => TableData | null) => {
      if (!editor.isEditable) return false;
      const now = live();
      if (!now) return false;
      const next = change(now.data);
      if (!next) return false;
      seenRows.current = next.rows;
      const n = editor.state.doc.nodeAt(now.pos)!;
      editor.view.dispatch(closeHistory(editor.state.tr.setNodeMarkup(now.pos, undefined, { ...n.attrs, ...model.tableAttrs(next) })));
      endHistoryGroup(editor);
      return true;
    },
    [editor, live],
  );

  /** The note's selection is the table while a cell is edited (no other block's tools stay up). */
  const selectTable = useCallback(() => {
    const now = live();
    if (!now || (editor.state.selection instanceof NodeSelection && editor.state.selection.from === now.pos)) return;
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, now.pos)).setMeta("addToHistory", false));
  }, [editor, live]);

  // Rows or columns added, removed or moved by something other than this view, above or before the open cell:
  // the cell follows its row and column (found by their content, model.followCell) instead of staying on a
  // number that now means another row, and closes when its row is gone. What this view changed itself it has
  // already followed (`follow`). The move happens a moment later, outside the render that noticed it;
  // `moving` keeps the effects below from loading the wrong row's text into the cell meanwhile. A selected
  // range follows the same way (or is dropped), so Delete never clears rows that merely took its numbers.
  const moving = useRef(false);
  useEffect(() => {
    const prev = seenRows.current;
    seenRows.current = t.rows;
    if (prev === t.rows) return;
    const g = rangeRef.current;
    if (g) {
      const anchor = model.followCell(prev, t.rows, g.anchor.r, g.anchor.c);
      const head = model.followCell(prev, t.rows, g.head.r, g.head.c);
      if (!anchor || !head) setRange(null);
      else if (anchor.r !== g.anchor.r || anchor.c !== g.anchor.c || head.r !== g.head.r || head.c !== g.head.c) setRange({ anchor, head });
    }
    const a = activeRef.current;
    if (!a) return;
    const to = model.followCell(prev, t.rows, a.r, a.c);
    if (to && to.r === a.r && to.c === a.c) return;
    moving.current = true;
    queueMicrotask(() => {
      moving.current = false;
      if (activeRef.current !== a) return;
      if (to) follow(to.r, to.c);
      else {
        setActive(null);
        editor.view.focus();
      }
    });
    // Only when the rows change: `follow` and the editor are read when that happens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.rows]);

  // A cell that's gone (its row or column deleted, undone) closes; the note takes focus back so ⌘Z keeps working.
  useEffect(() => {
    if (!active || moving.current) return;
    if (active.r >= t.rows.length || active.c >= width) {
      setActive(null);
      editor.view.focus();
    }
  }, [active, t.rows.length, width, editor]);

  // The note turning read-only, or the caret moving elsewhere in it, closes the cell and drops the range.
  const inUse = active !== null || range !== null;
  useEffect(() => {
    if (!inUse) return;
    const onFocus = () => {
      setActive(null);
      setRange(null);
    };
    editor.on("focus", onFocus);
    return () => {
      editor.off("focus", onFocus);
    };
  }, [inUse, editor]);
  useEffect(() => {
    if (!editable) {
      setActive(null);
      setRange(null);
    }
  }, [editable]);
  // A range whose cells no longer show (their rows deleted, filtered away, the table previewed) is dropped.
  useEffect(() => {
    if (range && !sel) setRange(null);
  }, [range, sel]);
  // The keyboard was on a range that's gone: back to the note, on the table, so the next key isn't lost.
  useEffect(() => {
    if (range || active || !gridRef.current || document.activeElement !== gridRef.current) return;
    const now = live();
    if (now) editor.chain().setNodeSelection(now.pos).run();
    editor.view.focus();
  }, [range, active, editor, live]);
  // What is selected, said once it settles (not at every cell a drag crosses).
  const selSize = sel ? `${sel.rows.length}:${sel.c1 - sel.c0 + 1}` : "";
  useEffect(() => {
    if (!selSize) return;
    const [h, w] = selSize.split(":").map(Number) as [number, number];
    const timer = window.setTimeout(() => announce(`${plural(h, "row")} by ${plural(w, "column")} selected`), 250);
    return () => window.clearTimeout(timer);
  }, [selSize]);

  // What the cell editor does in the open cell (it reads the latest of these).
  const handlers = useRef<CellEditorHandlers>(null as unknown as CellEditorHandlers);
  handlers.current = {
    onChange: (next) => {
      const a = activeRef.current;
      if (a) write((d) => model.setCell(d, a.r, a.c, next));
    },
    onKey: (e) => {
      const a = activeRef.current;
      return a ? onKey(a.r, a.c)(e) : false;
    },
    onPaste: (data) => {
      const a = activeRef.current;
      return a ? onPaste(a.r, a.c)(data) : false;
    },
    onBlur: (to) => {
      // Focus moving to the Format panel (its link field) or the table's own tools keeps the cell open.
      const keep = (el: Element | null) => Boolean(el && (el.closest("[data-cell-tools]") || frameRef.current?.contains(el)));
      if (keep(to) || keep(document.activeElement)) return;
      setActive(null);
    },
  };
  // The open cell keeps up with changes made elsewhere (the note's undo, another device).
  useEffect(() => {
    if (active && moving.current) return;
    if (active) {
      cellEd.current?.sync(t.rows[active.r]?.[active.c] ?? []);
      // An undo puts back the selection it had: the table stays selected while its cell is open.
      selectTable();
    } else cellEd.current?.close();
  }, [active, t.rows, selectTable]);
  useEffect(
    () => () => {
      cellEd.current?.destroy();
      cellEd.current = null;
    },
    [],
  );

  // Foli AI from the block menu.
  useEffect(() => {
    const el = frameRef.current?.closest("[data-block-id]") ?? frameRef.current;
    if (!el) return;
    const on = (e: Event) => {
      const mode = (e as CustomEvent<{ mode: TableAiMode }>).detail?.mode;
      if (!mode || !editor.isEditable) return;
      setActive(null);
      setRange(null);
      setPreview(null);
      setAi(mode);
    };
    el.addEventListener(TABLE_AI_EVENT, on);
    return () => el.removeEventListener(TABLE_AI_EVENT, on);
  }, [editor]);

  /**
   * Opens cell (r, c) for editing, in the same event: the cell is drawn with its slot at once (flushSync) and
   * the cell editor moved in, so what's typed next goes into it.
   */
  const open = (r: number, c: number, caret: CaretStart = "end", attempt = 0) => {
    if (!editor.isEditable || preview) return;
    const next = { r, c, caret };
    // Each cell's typing is its own undo step (typed fast, one cell after another, they would otherwise undo together).
    if (attempt === 0 && (activeRef.current?.r !== r || activeRef.current?.c !== c)) endHistoryGroup(editor);
    activeRef.current = next;
    rangeRef.current = null;
    flushSync(() => {
      setActive(next);
      setRange(null);
      setFocusWithin(true);
    });
    const slot = tableRef.current?.querySelector<HTMLElement>(`[data-cell-at="${r}:${c}"] [data-cell-slot]`);
    // A row just added may not be drawn yet: once it is.
    if (!slot) {
      if (attempt < 3) requestAnimationFrame(() => open(r, c, caret, attempt + 1));
      return;
    }
    const now = live();
    const cell = now?.data.rows[r]?.[c] ?? [];
    selectTable();
    cellEd.current ??= new CellEditor(editor, handlers);
    cellEd.current.open(slot, cell, `Row ${r + 1}, column ${c + 1}`, caret);
  };
  /** The open cell moved (its row or column did): the editor follows, the caret where it was. */
  const follow = (r: number, c: number) => open(r, c, cellEd.current?.editor.state.selection.from ?? "end");

  /** The next cell in the order rows show (the view), or null at an edge. */
  const step = (r: number, c: number, dr: number, dc: number): { r: number; c: number } | null => {
    const at = order.indexOf(r);
    if (dc) {
      let col = c + dc;
      let i = at;
      if (col >= width) {
        col = 0;
        i++;
      } else if (col < 0) {
        col = width - 1;
        i--;
      }
      return i >= 0 && i < order.length ? { r: order[i]!, c: col } : null;
    }
    const i = at + dr;
    return i >= 0 && i < order.length ? { r: order[i]!, c } : null;
  };

  /** A new row after the last data row, opened at column `c`. */
  const addRowAndOpen = (c: number) => {
    const now = live();
    if (!now) return;
    const at = now.data.totalsRow ? now.data.rows.length - 1 : now.data.rows.length;
    if (tool((d) => model.addRow(d))) open(at, c, "start");
  };

  /** The cell next to `cell` in the order rows show (no wrapping to the next row), or null at the table's edge. */
  const beside = (cell: Cell, dr: number, dc: number): Cell | null => {
    const list = orderRef.current;
    const i = list.indexOf(cell.r) + dr;
    const c = cell.c + dc;
    return i >= 0 && i < list.length && c >= 0 && c < width ? { r: list[i]!, c } : null;
  };

  /**
   * Selects the cells from `anchor` to `head`. The open cell closes (what was typed is already in the note)
   * and the keyboard goes to the table's hidden field, so the next key acts on the range.
   */
  const selectRange = (anchor: Cell, head: Cell) => {
    if (!editor.isEditable || preview) return;
    const next = { anchor, head };
    rangeRef.current = next;
    activeRef.current = null;
    setActive(null);
    setRange(next);
    setFocusWithin(true);
    selectTable();
    if (document.activeElement !== gridRef.current) gridRef.current?.focus({ preventScroll: true });
  };
  const selectAll = () => {
    const list = orderRef.current;
    if (list.length) selectRange({ r: list[0]!, c: 0 }, { r: list[list.length - 1]!, c: width - 1 });
  };
  /** Brings a cell the keyboard moved to into view (a wide or long table scrolls). */
  const reveal = (cell: Cell) => {
    requestAnimationFrame(() => tableRef.current?.querySelector<HTMLElement>(`[data-cell-at="${cell.r}:${cell.c}"]`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" }));
  };

  const close = (selectTable: boolean) => {
    setActive(null);
    setRange(null);
    if (selectTable) {
      const pos = typeof getPos === "function" ? getPos() : undefined;
      if (typeof pos === "number") editor.chain().setNodeSelection(pos).run();
    }
    editor.view.focus();
  };

  /** Leaves the table for the line above or below it (the table stays selected when there is none). */
  const leave = (dir: -1 | 1) => {
    setActive(null);
    const pos = typeof getPos === "function" ? getPos() : undefined;
    const n = typeof pos === "number" ? editor.state.doc.nodeAt(pos) : null;
    if (typeof pos !== "number" || !n) return editor.view.focus();
    const { doc } = editor.state;
    const near = Selection.findFrom(doc.resolve(dir > 0 ? pos + n.nodeSize : pos), dir, true);
    editor.view.dispatch(editor.state.tr.setSelection(near ?? NodeSelection.create(doc, pos)).scrollIntoView());
    editor.view.focus();
  };

  /**
   * After a tool renumbered rows or columns (one moved, one was added): the open cell and the range go where
   * their rows and columns went, whichever row or column the tool was used on.
   */
  const renumber = (rows: (i: number) => number, cols: (i: number) => number) => {
    const a = activeRef.current;
    if (a && (rows(a.r) !== a.r || cols(a.c) !== a.c)) follow(rows(a.r), cols(a.c));
    const g = rangeRef.current;
    if (g) setRange({ anchor: { r: rows(g.anchor.r), c: cols(g.anchor.c) }, head: { r: rows(g.head.r), c: cols(g.head.c) } });
  };
  const same = (i: number) => i;
  /** Row `from` to index `to` (an arrow button, its key, or a drag): one undo step. */
  const moveRowTo = (from: number, to: number) => {
    if (!tool((d) => model.moveRowTo(d, from, to))) return false;
    renumber(moveIndexMap(from, to), same);
    return true;
  };
  const moveColTo = (from: number, to: number) => {
    if (!tool((d) => model.moveColumnTo(d, from, to))) return false;
    renumber(same, moveIndexMap(from, to));
    return true;
  };
  const moveRow = (r: number, dir: -1 | 1) => {
    if (moveRowTo(r, r + dir)) announce(dir < 0 ? "Row moved up" : "Row moved down");
  };
  const moveCol = (c: number, dir: -1 | 1) => {
    if (moveColTo(c, c + dir)) announce(dir < 0 ? "Column moved left" : "Column moved right");
  };
  const insertColumn = (at: number) => {
    if (tool((d) => model.addColumn(d, at))) renumber(same, insertIndexMap(at));
  };
  const removeRow = (r: number) => {
    if (tool((d) => model.deleteRow(d, r))) {
      setRange(null);
      announce(`Row ${r + 1} deleted`);
      if (active) {
        const rows = t.rows.length - 1;
        // The open cell stays the same row (one up when a row above it went); the deleted row's place when it was that one.
        const row = r < active.r ? active.r - 1 : active.r;
        if (rows > 0) open(Math.max(0, Math.min(row, rows - 1)), active.c, "end");
        else setActive(null);
      }
    }
  };
  const removeCol = (c: number) => {
    if (tool((d) => model.deleteColumn(d, c))) {
      setRange(null);
      announce(`Column ${columnLetter(c)} deleted`);
      // (The open cell stays the same column: one to the left when a column before it went.)
      if (active) open(active.r, Math.max(0, Math.min(c < active.c ? active.c - 1 : active.c, width - 2)), "end");
    }
  };

  // Keys in a cell: Tab and Shift+Tab go cell to cell (Tab in the last adds a row), Enter goes down (adding a
  // row at the end), ↑/↓ and ←/→ at the cell's edge move to the next cell, Escape returns to the note with
  // the table selected, ⌥⇧ and an arrow move the row or column, ⌘⇧⌫ deletes the row. Shift and an arrow at
  // the cell's edge starts selecting cells, and ⌘A selects the cell's text, then (again) every cell.
  const onKey = (r: number, c: number) => ({ event: e, view, atEdge }: CellKeyEvent): boolean => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.altKey && e.shiftKey && !mod && e.key.startsWith("Arrow")) {
      const dir = e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 1;
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        if (!viewOn) moveRow(r, dir);
      } else moveCol(c, dir);
      return true;
    }
    if (mod && e.shiftKey && !e.altKey && e.key === "Backspace") {
      if (t.rows.length > 1) removeRow(r);
      return true;
    }
    if (e.key === "Escape") {
      close(true);
      return true;
    }
    if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "a") {
      const { from, to } = view.state.selection;
      if (from > 1 || to < view.state.doc.content.size - 1) return false;
      selectAll();
      return true;
    }
    if (mod || e.altKey) return false;
    // (While a formula is written Shift and an arrow select its text, as any other key there edits it.)
    if (e.shiftKey && e.key.startsWith("Arrow") && !formulaMode) {
      const head = view.state.selection.head;
      const edge = e.key === "ArrowLeft" ? head <= 1 : e.key === "ArrowRight" ? head >= view.state.doc.content.size - 1 : view.endOfTextblock(e.key === "ArrowUp" ? "up" : "down");
      const next = edge ? beside({ r, c }, e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0, e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0) : null;
      if (!next) return false;
      selectRange({ r, c }, next);
      reveal(next);
      return true;
    }
    if (e.key === "Tab") {
      const next = step(r, c, 0, e.shiftKey ? -1 : 1);
      if (next) open(next.r, next.c, "all");
      else if (!e.shiftKey) addRowAndOpen(0);
      return true;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      const next = step(r, c, 1, 0);
      if (next && !(t.totalsRow && next.r === t.rows.length - 1)) open(next.r, c, "end");
      else addRowAndOpen(c);
      return true;
    }
    if (e.shiftKey) return false;
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && atEdge(e.key === "ArrowDown" ? "down" : "up")) {
      const next = step(r, c, e.key === "ArrowDown" ? 1 : -1, 0);
      if (next) open(next.r, next.c, "end");
      // Past the first or last row: on into the note, as the caret leaves any other block.
      else leave(e.key === "ArrowDown" ? 1 : -1);
      return true;
    }
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && atEdge(e.key === "ArrowLeft" ? "left" : "right")) {
      const next = step(r, c, 0, e.key === "ArrowLeft" ? -1 : 1);
      if (!next) return false;
      open(next.r, next.c, e.key === "ArrowLeft" ? "end" : "start");
      return true;
    }
    return false;
  };

  /**
   * A copied grid written from the row at place `at` of the rows shown and column `c0` on (one undo step).
   * Cells copied from a Folevi table bring their formulas, moved by as far as the cells moved, as a
   * spreadsheet does.
   */
  const pasteGrid = (grid: SheetGrid, at: number, c0: number) => {
    const shown = orderRef.current.slice(Math.max(0, at));
    if (!shown.length) return;
    const rows = grid.origin ? model.shiftGridFormulas(grid.rows, shown[0]! - grid.origin.r, c0 - grid.origin.c) : grid.rows;
    if (tool((d) => model.pasteGridShown(d, shown, c0, rows))) announce(`Pasted ${plural(grid.rows.length, "row")}`);
  };

  // Rows and columns pasted from a spreadsheet fill the table from this cell on.
  const onPaste = (r: number, c: number) => (data: DataTransfer) => {
    const grid = clipboardGrid(data, cellInline, true);
    if (!grid || (grid.rows.length === 1 && grid.rows[0]!.length === 1)) return false;
    pasteGrid(grid, orderRef.current.indexOf(r), c);
    return true;
  };

  // ---- A range of cells: its keys and its clipboard (they arrive at the hidden field, gridRef).
  const clearRange = () => {
    const s = selRef.current;
    if (s && tool((d) => model.clearCells(d, s.rows, s.c0, s.c1))) announce(`${plural(s.rows.length * (s.c1 - s.c0 + 1), "cell")} cleared`);
  };
  // Arrows collapse the range and move (Shift grows it), Tab goes cell to cell, Enter or F2 opens the anchor
  // cell, typing opens it and replaces what it holds, ⌫ clears the cells, ⌘A selects them all, Escape goes
  // back to the note with the table selected. ⌘Z is the note's (NodeViews' isHistoryKey lets it through).
  const onGridKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const cur = rangeRef.current;
    if (!cur || !selRef.current) return;
    const { anchor } = cur;
    // An input method starting to compose: it writes in the anchor cell, over what was there.
    if (e.nativeEvent.isComposing || e.keyCode === 229) {
      open(anchor.r, anchor.c, "all");
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
      return;
    }
    if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "a") {
      e.preventDefault();
      selectAll();
      return;
    }
    if (mod || e.altKey) return;
    if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      const dr = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
      const dc = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
      if (e.shiftKey) {
        const head = beside(cur.head, dr, dc);
        if (head) {
          selectRange(anchor, head);
          reveal(head);
        }
      } else {
        const to = beside(anchor, dr, dc) ?? anchor;
        selectRange(to, to);
        reveal(to);
      }
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const to = step(anchor.r, anchor.c, 0, e.shiftKey ? -1 : 1);
      if (to) {
        selectRange(to, to);
        reveal(to);
      }
      return;
    }
    if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      open(anchor.r, anchor.c, "end");
      return;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      clearRange();
      return;
    }
    // A character: the anchor cell opens with its content selected, and (the key not being stopped here) the
    // character is typed into it, replacing what it held.
    if ([...e.key].length === 1) open(anchor.r, anchor.c, "all");
  };
  // Text that reached the hidden field anyway (dictation, an on-screen keyboard): into the anchor cell.
  const onGridText = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    const cell = rangeRef.current?.anchor ?? activeRef.current;
    if (!text || !cell) return;
    if (rangeRef.current) open(cell.r, cell.c, "all");
    cellEd.current?.insert(text);
  };
  // Copy and cut: the cells as a spreadsheet would put them on the clipboard (tableClipboard.ts).
  const onGridCopy = (cut: boolean) => (e: React.ClipboardEvent) => {
    const s = selRef.current;
    if (!s) return;
    e.preventDefault();
    const { text, html } = rangeClipboard(t, evaluated, s.rows, s.c0, s.c1);
    e.clipboardData.setData("text/plain", text);
    e.clipboardData.setData("text/html", html);
    const cells = plural(s.rows.length * (s.c1 - s.c0 + 1), "cell");
    if (cut && tool((d) => model.clearCells(d, s.rows, s.c0, s.c1))) announce(`${cells} cut`);
    else announce(`${cells} copied`);
  };
  // Safari only sends "copy" and "cut" where something is selected, unless their "before" event is refused.
  // The hidden field holds nothing to select, so it refuses them, and the copy and cut above get to run.
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const allow = (e: Event) => {
      if (rangeRef.current) e.preventDefault();
    };
    el.addEventListener("beforecopy", allow);
    el.addEventListener("beforecut", allow);
    return () => {
      el.removeEventListener("beforecopy", allow);
      el.removeEventListener("beforecut", allow);
    };
  }, [editable]);
  // Paste: a grid goes in from the range's first cell on; one copied value fills every selected cell.
  const onGridPaste = (e: React.ClipboardEvent) => {
    const s = selRef.current;
    if (!s) return;
    e.preventDefault();
    const grid = clipboardGrid(e.clipboardData, cellInline, true) ?? linesGrid(e.clipboardData.getData("text/plain"));
    if (!grid) return;
    const one = grid.rows.length === 1 && grid.rows[0]!.length === 1 ? grid.rows[0]![0]! : null;
    if (!one) {
      pasteGrid(grid, s.i0, s.c0);
      return;
    }
    // (A formula copied from a Folevi table is moved to each cell it fills, as a spreadsheet fills down.)
    const from = grid.origin;
    const cell = (r: number, c: number) => (from ? model.shiftGridFormulas([[one]], r - from.r, c - from.c)[0]![0]! : one);
    if (tool((d) => model.fillCells(d, s.rows, s.c0, s.c1, cell))) announce(`Pasted into ${plural(s.rows.length * (s.c1 - s.c0 + 1), "cell")}`);
  };

  // Formulas: while one is being written, clicking a cell puts its reference in (dragging makes a range).
  const refDrag = useRef<{ from: { r: number; c: number }; range: { from: number; to: number } } | null>(null);
  // The cell the mouse went down on: moving onto another cell with the button held selects from it to there.
  const cellDrag = useRef<Cell | null>(null);
  useEffect(() => {
    const up = () => {
      refDrag.current = null;
      cellDrag.current = null;
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);
  const insertReference = (r: number, c: number) => {
    const range = cellEd.current?.insert(cellReference(r, c));
    if (range) refDrag.current = { from: { r, c }, range };
  };
  const extendReference = (r: number, c: number) => {
    const drag = refDrag.current;
    if (!drag) return;
    const a = drag.from;
    const text = a.r === r && a.c === c ? cellReference(r, c) : `${cellReference(Math.min(a.r, r), Math.min(a.c, c))}:${cellReference(Math.max(a.r, r), Math.max(a.c, c))}`;
    const range = cellEd.current?.insert(text, drag.range);
    if (range) drag.range = range;
  };

  const onCellMouseDown = (r: number, c: number) => (e: React.MouseEvent) => {
    if (!editable || e.button !== 0 || preview) return;
    const here = active?.r === r && active.c === c;
    // ⌘-click (Ctrl-click) follows a link in a cell.
    if (!here && (e.metaKey || e.ctrlKey) && (e.target as Element).closest("a[href]")) return;
    if (formulaMode && active) {
      if (here) return;
      e.preventDefault();
      insertReference(r, c);
      return;
    }
    // Shift-click: the cells from the open cell (or the range's first) to this one.
    const from = e.shiftKey ? (range?.anchor ?? (active ? { r: active.r, c: active.c } : null)) : null;
    if (from && !here) {
      e.preventDefault();
      cellDrag.current = from;
      selectRange(from, { r, c });
      return;
    }
    cellDrag.current = { r, c };
    // (In the open cell the click is the cell editor's: it places the caret, or starts selecting text.)
    if (here) return;
    e.preventDefault();
    open(r, c, { x: e.clientX, y: e.clientY });
  };
  // The mouse, its button still down, came onto a cell: a reference being dragged out grows to it, or the
  // cells from where it went down to here are selected (a click that never left its cell just opened it).
  const onCellMouseEnter = (r: number, c: number) => (e: React.MouseEvent) => {
    if (refDrag.current) {
      extendReference(r, c);
      return;
    }
    const from = cellDrag.current;
    if (!from || !(e.buttons & 1) || formulaMode) return;
    if (!rangeRef.current && from.r === r && from.c === c) return;
    selectRange(from, { r, c });
    // (Text the drag began to select in the cell it started in.)
    window.getSelection()?.removeAllRanges();
  };

  // ---- Column widths: the line between two columns drags (TableColumn.width, whole pixels). The width shows
  // as it is dragged and is written once, on release: one change to sync and one step to undo.
  const sizeDrag = useRef<{ c: number; x: number; start: number; width: number; moved: boolean } | null>(null);
  const columnWidthNow = (c: number) => tableRef.current?.querySelector<HTMLElement>(`tbody [data-cell-at$=":${c}"]`)?.getBoundingClientRect().width ?? 0;
  const startResize = (c: number) => (e: React.PointerEvent<HTMLElement>) => {
    if (!editor.isEditable || preview || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    // From the width it has: the one set, or as wide as its content has made it.
    const start = t.columns[c]?.width ?? (columnWidthNow(c) || LIMITS.minTableColumnWidth * 2);
    sizeDrag.current = { c, x: e.clientX, start, width: model.clampColumnWidth(start), moved: false };
  };
  const dragResize = (e: React.PointerEvent) => {
    const d = sizeDrag.current;
    // (A press that doesn't move is not a resize: a double-click is two of them.)
    if (!d || (!d.moved && Math.abs(e.clientX - d.x) < 2)) return;
    d.moved = true;
    d.width = model.clampColumnWidth(d.start + e.clientX - d.x);
    setSizing({ c: d.c, width: d.width });
  };
  const endResize = (commit: boolean) => {
    const d = sizeDrag.current;
    sizeDrag.current = null;
    setSizing(null);
    if (d && commit && d.moved && tool((data) => model.setColumnWidth(data, d.c, d.width))) announce(`Column ${columnLetter(d.c)} is ${d.width} pixels wide`);
  };
  const setWidth = (c: number, px: number | null) => {
    if (tool((d) => model.setColumnWidth(d, c, px))) announce(px === null ? `Column ${columnLetter(c)} width is automatic` : `Column ${columnLetter(c)} is ${model.clampColumnWidth(px)} pixels wide`);
  };

  // ---- Rows and columns dragged by their handles to another place. A line shows where it would land; the
  // move is made on release (one undo step), and the open cell follows its row or column.
  const moveDrag = useRef<{ kind: "row" | "col"; from: number; x: number; y: number; at: Reorder | null } | null>(null);
  /** The place a pointer is over: the slot (before row or column `slot`) and where its line is drawn in the scroller. */
  const dropSlot = (kind: "row" | "col", x: number, y: number): Pick<Reorder, "slot" | "line"> | null => {
    const scroller = scrollerRef.current;
    const trs = [...(tableRef.current?.querySelectorAll<HTMLElement>("tbody > tr") ?? [])];
    const cells = [...(trs[0]?.querySelectorAll<HTMLElement>("[data-cell-at]") ?? [])];
    if (!scroller || !trs.length || !cells.length) return null;
    const box = scroller.getBoundingClientRect();
    const left = cells[0]!.getBoundingClientRect().left;
    const right = cells[cells.length - 1]!.getBoundingClientRect().right;
    const top = trs[0]!.getBoundingClientRect().top;
    const bottom = trs[trs.length - 1]!.getBoundingClientRect().bottom;
    const line = (l: number, tp: number, w: number, h: number) => ({ left: l - box.left + scroller.scrollLeft, top: tp - box.top + scroller.scrollTop, width: w, height: h });
    // The first row or column whose middle is past the pointer: the dragged one lands before it.
    const before = (list: HTMLElement[], end: number, past: (b: DOMRect) => boolean) => {
      for (let i = 0; i < end; i++) if (past(list[i]!.getBoundingClientRect())) return i;
      return end;
    };
    if (kind === "row") {
      // Nothing lands under the totals row.
      const slot = before(trs, t.totalsRow ? trs.length - 1 : trs.length, (b) => y < b.top + b.height / 2);
      return { slot, line: line(left, slot < trs.length ? trs[slot]!.getBoundingClientRect().top : bottom, right - left, 0) };
    }
    const slot = before(cells, cells.length, (b) => x < b.left + b.width / 2);
    return { slot, line: line(slot < cells.length ? cells[slot]!.getBoundingClientRect().left : right, top, 0, bottom - top) };
  };
  const endReorder = (commit: boolean) => {
    const d = moveDrag.current;
    moveDrag.current = null;
    setReorder(null);
    if (!d?.at || !commit) return;
    // Landing before the slot after it, or its own, leaves it where it is.
    const to = d.at.slot > d.from ? d.at.slot - 1 : d.at.slot;
    if (to === d.from) return;
    if (d.kind === "row" ? moveRowTo(d.from, to) : moveColTo(d.from, to)) announce(d.kind === "row" ? `Row ${d.from + 1} moved to row ${to + 1}` : `Column ${columnLetter(d.from)} moved to column ${columnLetter(to)}`);
  };
  /** What makes a handle drag its row or column (pointer events, so a finger drags it too). */
  const handle = (kind: "row" | "col", index: number) => ({
    "data-table-grip": "",
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (!editor.isEditable || e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      moveDrag.current = { kind, from: index, x: e.clientX, y: e.clientY, at: null };
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const d = moveDrag.current;
      if (!d || (!d.at && Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_START)) return;
      const at = dropSlot(d.kind, e.clientX, e.clientY);
      if (!at) return;
      d.at = { kind: d.kind, from: d.from, ...at };
      setReorder(d.at);
    },
    onPointerUp: () => endReorder(true),
    onPointerCancel: () => endReorder(false),
    onLostPointerCapture: () => endReorder(false),
  });
  // Escape gives up a drag (a width or a move), and goes no further: the cell and the note don't also act on it.
  const dragging = sizing !== null || reorder !== null;
  useEffect(() => {
    if (!dragging) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      sizeDrag.current = null;
      moveDrag.current = null;
      setSizing(null);
      setReorder(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dragging]);

  const setTotal = (c: number, fn: TotalsFunction | null) => {
    tool((d) => model.setCell(d, d.rows.length - 1, c, fn ? [{ type: "text", text: totalsFormula(fn, c) }] : []));
  };

  const toolBtn = "grid h-6 w-6 place-items-center rounded-chip text-faint transition-colors hover:bg-accent-soft hover:text-heading disabled:opacity-30 disabled:hover:bg-transparent";
  const changed = (r: number, c: number) => Boolean(preview?.changed.has(`${r}:${c}`));
  const sortName = t.view?.sort ? columnName(evaluated.names[t.view.sort.column] ?? "", t.view.sort.column) : "";
  const filterCount = t.view?.filters?.length ?? 0;
  // A column's width: the one being dragged, else the one saved. Without one it is as wide as its content needs.
  const colWidth = (c: number) => (sizing?.c === c ? sizing.width : (shownTable.columns[c]?.width ?? null));
  // A width is both the column's (<col>, which stops it growing with its content) and each of its cells'
  // least width (which stops a table wider than the note squeezing it: the table scrolls sideways instead).
  const sizedStyle = (c: number): React.CSSProperties | undefined => {
    const w = colWidth(c);
    return w === null ? undefined : ({ minWidth: w, "--fb-col-w": `${w}px` } as React.CSSProperties);
  };
  // Every column given a width: the table is exactly as wide as they add up to (it would otherwise stretch
  // them to fill the note). With any left automatic it fills the note and those take up the room.
  const allSized = shownTable.rows[0]!.every((_, c) => colWidth(c) !== null);
  const moveRowsHint = viewOn ? "Clear the sort and filter to move rows" : null;

  return (
    <NodeViewWrapper className={`fb-atom fb-table-block ${selected ? "fb-atom-selected" : ""}`} data-drag-handle="" role="group" aria-label="Table">
      <div ref={frameRef}>
        {viewOn && !preview ? (
          <div className="fb-table-viewbar" contentEditable={false}>
            <span>
              {[sortName ? `Sorted by ${sortName}${t.view?.sort?.desc ? ", Z to A" : ""}` : "", filterCount ? `${filterCount} filter${filterCount === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ")}
              {filterCount ? ` · ${order.length - (t.headerRow ? 1 : 0) - (t.totalsRow ? 1 : 0)} of ${evaluated.bodyRows.length} rows` : ""}
            </span>
            {editable ? (
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => tool((d) => model.setView(d, null))}>
                <X size={12} aria-hidden /> Clear
              </button>
            ) : null}
          </div>
        ) : null}
        <div
          ref={scrollerRef}
          className="fb-hscroll relative my-2 overflow-x-auto"
          contentEditable={false}
          // The tools never take focus: it stays in the cell (or the note), so ⌘Z next undoes what the tool did.
          onMouseDown={(e) => {
            if ((e.target as Element).closest("button")) e.preventDefault();
          }}
          onFocus={() => setFocusWithin(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusWithin(false);
          }}
        >
          <table ref={tableRef} className={`fb-table border-collapse text-subheadline ${allSized ? "fb-table-sized" : "w-full"} ${formulaMode ? "fb-table-formula" : ""} ${range ? "fb-table-ranging" : ""}`}>
            <colgroup>
              {shownTable.rows[0]!.map((_, c) => {
                const w = colWidth(c);
                return <col key={c} style={w === null ? undefined : { width: w }} />;
              })}
            </colgroup>
            {editable ? (
              <thead className={tools ? undefined : "invisible"} aria-hidden={tools ? undefined : true}>
                <tr>
                  {t.rows[0]!.map((_, c) => (
                    <td key={c} className="border-0 px-1 pb-1">
                      {/* (Over a column dragged narrow the tools wrap onto a second line, rather than hold it wide.) */}
                      <span className={`flex items-center justify-center gap-0.5 ${colWidth(c) === null ? "" : "flex-wrap"}`} role="group" aria-label={`Column ${columnLetter(c)}`}>
                        <button type="button" className="fb-table-grip" tabIndex={-1} disabled={width <= 1} {...handle("col", c)} aria-label={`Drag column ${columnLetter(c)} to move it`} title="Drag to move the column">
                          <GripHorizontal size={10} aria-hidden />
                          <span className={`fb-table-label ${formulaMode ? "is-on" : ""}`} aria-hidden>
                            {columnLetter(c)}
                          </span>
                        </button>
                        <button type="button" className={toolBtn} tabIndex={-1} disabled={c === 0} onClick={() => moveCol(c, -1)} aria-label={`Move column ${columnLetter(c)} left`} title={`Move column left (${keyLabel("⌥⇧←")})`}>
                          <ArrowLeft size={12} aria-hidden />
                        </button>
                        <button type="button" className={toolBtn} tabIndex={-1} disabled={c === width - 1} onClick={() => moveCol(c, 1)} aria-label={`Move column ${columnLetter(c)} right`} title={`Move column right (${keyLabel("⌥⇧→")})`}>
                          <ArrowRight size={12} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className={`${toolBtn} ${t.columns[c]?.format || t.view?.sort?.column === c || t.view?.filters?.some((f) => f.column === c) ? "!text-heading" : ""}`}
                          tabIndex={-1}
                          aria-haspopup="dialog"
                          aria-expanded={menuColumn === c}
                          onClick={(e) => {
                            menuAnchor.current = e.currentTarget;
                            setMenuColumn(menuColumn === c ? null : c);
                          }}
                          aria-label={`Column ${columnLetter(c)} options: format, sort, filter`}
                          title="Format, sort and filter"
                        >
                          <ChevronDown size={12} aria-hidden />
                        </button>
                      </span>
                      {/* The line between this column and the next, the full height of the table (table.css
                          places it): drag it for a width, double-click it for automatic. */}
                      <span className="fb-col-resize-at">
                        <span
                          className={`fb-col-resize ${sizing?.c === c ? "is-on" : ""}`}
                          data-table-grip=""
                          title="Drag to resize the column. Double-click for automatic."
                          onMouseDown={(e) => e.preventDefault()}
                          onPointerDown={startResize(c)}
                          onPointerMove={dragResize}
                          onPointerUp={() => endResize(true)}
                          onPointerCancel={() => endResize(false)}
                          onLostPointerCapture={() => endResize(false)}
                          onDoubleClick={() => setWidth(c, null)}
                        />
                      </span>
                    </td>
                  ))}
                  {phoneAdd ? <td className="border-0" /> : null}
                  <td className="border-0" />
                </tr>
              </thead>
            ) : null}
            <tbody>
              {order.map((r, i) => {
                const row = shownTable.rows[r]!;
                const header = shownTable.headerRow && r === 0;
                const total = shownTable.totalsRow && r === shownTable.rows.length - 1 && r > 0;
                return (
                  <tr key={r} className={`group/row ${total ? `fb-table-totals ${tools ? "with-tools" : ""}` : ""} ${reorder?.kind === "row" && reorder.from === r ? "fb-table-moving" : ""}`}>
                    {row.map((cell, c) => {
                      const Tag = header ? "th" : "td";
                      const shown = evaluated.cells[r]?.[c];
                      const isActive = active?.r === r && active.c === c && !preview;
                      const label = `Row ${r + 1}, column ${c + 1}`;
                      const fn = total ? totalsFunctionOf(tableCellText(cell), c) : null;
                      // In the selected rectangle: tinted, with the rectangle's outline on the sides that are its edge.
                      const picked = sel !== null && i >= sel.i0 && i <= sel.i1 && c >= sel.c0 && c <= sel.c1;
                      const pickedClass = picked ? `fb-cell-selected ${i === sel.i0 ? "fb-sel-t" : ""} ${i === sel.i1 ? "fb-sel-b" : ""} ${c === sel.c0 ? "fb-sel-l" : ""} ${c === sel.c1 ? "fb-sel-r" : ""} ${range?.anchor.r === r && range.anchor.c === c ? "fb-sel-anchor" : ""}` : "";
                      return (
                        <Tag
                          key={c}
                          scope={header ? "col" : undefined}
                          className={`relative border border-line p-0 text-left align-top ${isActive ? "fb-cell-active" : ""} ${pickedClass} ${colWidth(c) === null ? "" : "fb-col-sized"} ${reorder?.kind === "col" && reorder.from === c ? "fb-table-moving" : ""} ${changed(r, c) ? "fb-cell-changed" : ""} ${cellClass(isActive ? undefined : shown, header, total)} ${header ? "font-semibold" : ""}`}
                          style={sizedStyle(c)}
                          data-cell-at={`${r}:${c}`}
                          onMouseDown={onCellMouseDown(r, c)}
                          onMouseEnter={onCellMouseEnter(r, c)}
                        >
                          {isActive ? (
                            // The cell editor is moved in here (see open).
                            <div data-cell-slot="" className={header ? "font-semibold" : undefined} />
                          ) : (
                            <div
                              className={`fb-cell block min-w-[6rem] px-2.5 py-1.5 ${shown?.numeric && shown.kind !== "date" && !header ? "text-right" : ""}`}
                              data-cell={`${r}:${c}`}
                              data-enter-focus={r === 0 && c === 0 && editable ? "" : undefined}
                              role={editable ? "textbox" : undefined}
                              aria-label={editable ? label : undefined}
                              aria-readonly={editable ? undefined : true}
                              tabIndex={editable && !preview ? -1 : undefined}
                              onFocus={() => open(r, c, "end")}
                            >
                              <StaticCell cell={cell} shown={shown} />
                              {!cell.length && !shown?.display ? "​" : null}
                            </div>
                          )}
                          {total && tools ? (
                            <MenuButton
                              label={`Total for column ${columnLetter(c)}`}
                              trigger={<Sigma size={11} aria-hidden />}
                              className="fb-total-pick"
                              triggerClassName="grid h-5 w-5 place-items-center rounded-tiny text-faint hover:bg-accent-soft hover:text-heading"
                              align="start"
                              items={[
                                ...TOTALS_FUNCTIONS.map((f) => ({ label: TOTAL_LABEL[f], checked: fn === f, onSelect: () => setTotal(c, f) })),
                                "separator" as const,
                                { label: "None", checked: !tableCellText(cell).trim(), onSelect: () => setTotal(c, null) },
                              ]}
                            />
                          ) : null}
                        </Tag>
                      );
                    })}
                    {phoneAdd && r === order[0] ? (
                      <td rowSpan={order.length} className="fb-table-add-col border-0 p-0 pl-1.5 align-top">
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => tool((d) => model.addColumn(d))}
                          disabled={width >= LIMITS.maxTableColumns}
                          aria-label="Add a column"
                          title="Add a column"
                          className="fb-table-add grid h-full min-h-11 w-11 place-items-center enabled:hover:bg-[var(--glass-hover)]"
                        >
                          <Plus size={20} strokeWidth={2.2} aria-hidden />
                        </button>
                      </td>
                    ) : null}
                    {editable && !(phone && !tools) ? (
                      <td className={`w-[7.25rem] border-0 pl-1 ${tools ? "" : "invisible"}`} aria-hidden={tools ? undefined : true}>
                        <span className="flex items-center gap-0.5" role="group" aria-label={`Row ${r + 1}`}>
                          <button type="button" className="fb-table-grip fb-table-grip-row" tabIndex={-1} disabled={viewOn || total || t.rows.length - (t.totalsRow ? 1 : 0) <= 1} {...handle("row", r)} aria-label={`Drag row ${r + 1} to move it`} title={moveRowsHint ?? "Drag to move the row"}>
                            <GripVertical size={10} aria-hidden />
                            <span className={`fb-table-label ${formulaMode ? "is-on" : ""}`} aria-hidden>
                              {r + 1}
                            </span>
                          </button>
                          <button type="button" className={toolBtn} tabIndex={-1} disabled={r === 0 || viewOn || total} onClick={() => moveRow(r, -1)} aria-label={`Move row ${r + 1} up`} title={moveRowsHint ?? `Move row up (${keyLabel("⌥⇧↑")})`}>
                            <ArrowUp size={12} aria-hidden />
                          </button>
                          <button type="button" className={toolBtn} tabIndex={-1} disabled={r === t.rows.length - 1 || viewOn || total || (t.totalsRow && r === t.rows.length - 2)} onClick={() => moveRow(r, 1)} aria-label={`Move row ${r + 1} down`} title={moveRowsHint ?? `Move row down (${keyLabel("⌥⇧↓")})`}>
                            <ArrowDown size={12} aria-hidden />
                          </button>
                          <button type="button" className={`${toolBtn} hover:!text-danger`} tabIndex={-1} disabled={t.rows.length <= 1} onClick={() => removeRow(r)} aria-label={`Delete row ${r + 1}`} title={`Delete row (${keyLabel("⌘⇧⌫")})`}>
                            <Minus size={12} aria-hidden />
                          </button>
                        </span>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
            {phoneAdd ? (
              <tfoot>
                <tr>
                  <td colSpan={width} className="border-0 p-0 pt-1.5">
                    <button type="button" tabIndex={-1} onClick={() => addRowAndOpen(0)} disabled={t.rows.length >= LIMITS.maxTableRows} aria-label="Add a row" title="Add a row" className="fb-table-add grid h-11 w-full place-items-center enabled:hover:bg-[var(--glass-hover)]">
                      <Plus size={20} strokeWidth={2.2} aria-hidden />
                    </button>
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
          {reorder ? <div className="fb-table-dropline" data-kind={reorder.kind} style={reorder.line} aria-hidden /> : null}
          {editable ? (
            // Where the keyboard is while cells are selected (see gridRef). It holds nothing: a key that types
            // opens the range's first cell, and is typed there.
            <textarea
              ref={gridRef}
              className="fb-table-keys"
              tabIndex={-1}
              aria-label={sel ? `${plural(sel.rows.length, "row")} by ${plural(sel.c1 - sel.c0 + 1, "column")} selected` : "Table cells"}
              // A block's own field: the note's shortcuts leave it alone, and ⌘Z in it is the note's undo.
              data-draft=""
              // No on-screen keyboard for a selection (iPad): one comes with the cell, when it opens.
              inputMode="none"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              rows={1}
              value=""
              onChange={onGridText}
              onKeyDown={onGridKey}
              onCopy={onGridCopy(false)}
              onCut={onGridCopy(true)}
              onPaste={onGridPaste}
              onBlur={(e) => {
                // To the cell that's opening or the table's own tools: the range is theirs to keep or drop.
                // Another window coming to the front isn't leaving the table either.
                const to = e.relatedTarget as Element | null;
                if ((to && (frameRef.current?.contains(to) || to.closest("[data-cell-tools]"))) || !document.hasFocus()) return;
                setRange(null);
              }}
            />
          ) : null}
          {editable && !preview && !(phone && !tools) ? (
            <div className={`mt-1.5 flex flex-wrap gap-2 text-footnote text-muted ${phone ? "fb-table-tools-phone" : ""}`}>
              {phone ? null : (
              <>
              <button type="button" onClick={() => addRowAndOpen(0)} disabled={t.rows.length >= LIMITS.maxTableRows} className="inline-flex items-center gap-1 rounded-chip px-2 py-1 hover:bg-accent-soft hover:text-heading disabled:opacity-40">
                <Plus size={12} aria-hidden /> Row
              </button>
              <button type="button" onClick={() => tool((d) => model.addColumn(d))} disabled={width >= LIMITS.maxTableColumns} className="inline-flex items-center gap-1 rounded-chip px-2 py-1 hover:bg-accent-soft hover:text-heading disabled:opacity-40">
                <Plus size={12} aria-hidden /> Column
              </button>
              </>
              )}
              <button type="button" aria-pressed={t.headerRow} onClick={() => tool((d) => ({ ...d, headerRow: !d.headerRow }))} className={`inline-flex items-center gap-1 rounded-chip px-2 py-1 hover:bg-accent-soft hover:text-heading ${tools ? "" : "invisible"} ${t.headerRow ? "text-heading" : ""}`}>
                {t.headerRow ? <Check size={12} aria-hidden /> : <Plus size={12} aria-hidden />} Header row
              </button>
              <button type="button" aria-pressed={t.totalsRow} onClick={() => tool((d) => model.setTotalsRow(d, !d.totalsRow)) && announce(t.totalsRow ? "Totals row removed" : "Totals row added")} className={`inline-flex items-center gap-1 rounded-chip px-2 py-1 hover:bg-accent-soft hover:text-heading ${tools ? "" : "invisible"} ${t.totalsRow ? "text-heading" : ""}`}>
                {t.totalsRow ? <Check size={12} aria-hidden /> : <Sigma size={12} aria-hidden />} Totals row
              </button>
              {aiOn ? (
                <button type="button" onClick={() => setAi("edit")} className={`inline-flex items-center gap-1 rounded-chip px-2 py-1 hover:bg-accent-soft hover:text-heading ${tools ? "" : "invisible"}`}>
                  <AiIcon size={12} className="text-[#7c6cf0]" /> Foli AI
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        {formulaMode ? (
          <p className="fb-table-hint" contentEditable={false} aria-live="polite">
            Click a cell to use it, or drag across cells for a range. Column names work too, like =SUM({columnName(evaluated.names[1] ?? "", 1).replace(/\s+/g, "_")}).
          </p>
        ) : null}
        {ai && editable ? (
          <Suspense fallback={null}>
            <TableAi
              mode={ai}
              table={t}
              names={evaluated.names}
              activeCell={active}
              editor={editor}
              getPos={getPos}
              preview={preview}
              onPreview={setPreview}
              onAccept={(result) => {
                tool(() => result.table);
                setPreview(null);
                setAi(null);
                announce("Foli AI's changes applied. Undo with ⌘Z.");
              }}
              onClose={() => {
                setPreview(null);
                setAi(null);
              }}
              onMode={setAi}
            />
          </Suspense>
        ) : null}
        {menuColumn !== null && menuColumn < width ? (
          <TableColumnMenu
            open
            onClose={() => {
              setMenuColumn(null);
              // Back to the cell being edited, if one is open.
              requestAnimationFrame(() => activeRef.current && cellEd.current?.editor.view.focus());
            }}
            anchor={menuAnchor}
            column={menuColumn}
            name={evaluated.names[menuColumn] ?? ""}
            settings={t.columns[menuColumn] ?? {}}
            view={t.view}
            canAdd={width < LIMITS.maxTableColumns}
            canDelete={width > 1}
            onSettings={(next) => tool((d) => model.setColumn(d, menuColumn, next))}
            shownWidth={() => Math.round(columnWidthNow(menuColumn))}
            onWidth={(px) => setWidth(menuColumn, px)}
            onView={(next: TableViewSettings | null) => tool((d) => model.setView(d, next))}
            onInsert={(side) => insertColumn(side === "left" ? menuColumn : menuColumn + 1)}
            onDelete={() => {
              removeCol(menuColumn);
              setMenuColumn(null);
            }}
          />
        ) : null}
      </div>
    </NodeViewWrapper>
  );
}

/**
 * Whether an event belongs to the table's own controls (cells, tools, menus, the handles and lines that drag,
 * and the hidden field the keyboard is on while cells are selected), so the note leaves it alone: a key, a
 * copy or a paste there is the table's, not the note acting on the selected block.
 */
export function tableHandlesEvent(event: Event): boolean {
  const t = event.target;
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t instanceof Element && Boolean(t.closest("button, [role=dialog], [data-table-grip], .fb-table tbody td, .fb-table tbody th, .fb-cell-editor")));
}
