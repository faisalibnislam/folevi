"use client";

// The table block in a note: cells with formatted text and formulas, row and column tools, number formats,
// a totals row, a saved sort and filter, spreadsheet paste and Foli AI. Cells show their stored content (or a
// formula's result); the one being edited opens a small editor of its own (CellEditor.tsx explains why).
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { closeHistory } from "@tiptap/pm/history";
import { NodeSelection } from "@tiptap/pm/state";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronDown, Minus, Plus, Sigma, X } from "lucide-react";
import {
  LIMITS,
  TOTALS_FUNCTIONS,
  cellReference,
  columnLetter,
  evaluateTable,
  tableCellText,
  tableRowOrder,
  totalsFormula,
  totalsFunctionOf,
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
import { clipboardGrid } from "./sheetPaste";
import * as model from "./tableModel";
import type { TableData } from "./tableModel";
import type { TableAiMode, TableAiResult } from "./TableAi";
import { TABLE_AI_EVENT } from "./events";

const TableAi = lazy(() => import("./TableAi").then((m) => ({ default: m.TableAi })));


const TOTAL_LABEL: Record<TotalsFunction, string> = { SUM: "Sum", AVERAGE: "Average", COUNT: "Count numbers", COUNTA: "Count filled", MIN: "Smallest", MAX: "Largest" };

type Active = { r: number; c: number; caret: CaretStart };

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
  const order = useMemo(() => tableRowOrder(evaluated, model.tableOptions(shownTable), shownTable.view), [evaluated, shownTable]);
  const [active, setActive] = useState<Active | null>(null);
  const [focusWithin, setFocusWithin] = useState(false);
  const [menuColumn, setMenuColumn] = useState<number | null>(null);
  const [ai, setAi] = useState<TableAiMode | null>(null);
  const menuAnchor = useRef<HTMLButtonElement | null>(null);
  // The cell editor (CellEditor.tsx): made the first time a cell is edited, then moved from cell to cell.
  const cellEd = useRef<CellEditor | null>(null);
  const activeRef = useRef<Active | null>(null);
  activeRef.current = active;
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

  // The table as it is now (the view re-renders a moment after each change, so `t` can be a step behind).
  const live = useCallback((): { data: TableData; pos: number } | null => {
    const pos = typeof getPos === "function" ? getPos() : undefined;
    const n = typeof pos === "number" ? editor.state.doc.nodeAt(pos) : null;
    return n?.type.name === "table" && typeof pos === "number" ? { data: model.tableData(n.attrs), pos } : null;
  }, [editor, getPos]);

  /** Typing: grouped into the note's undo steps like any typing. */
  const write = useCallback(
    (change: (d: TableData) => TableData | null) => {
      if (!editor.isEditable) return;
      const now = live();
      if (!now) return;
      const next = change(now.data);
      if (next) updateAttributes(model.tableAttrs(next));
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

  // A cell that's gone (its row or column deleted, undone) closes; the note takes focus back so ⌘Z keeps working.
  useEffect(() => {
    if (!active) return;
    if (active.r >= t.rows.length || active.c >= width) {
      setActive(null);
      editor.view.focus();
    }
  }, [active, t.rows.length, width, editor]);

  // The note turning read-only, or the caret moving elsewhere in it, closes the cell.
  useEffect(() => {
    if (!active) return;
    const onFocus = () => setActive(null);
    editor.on("focus", onFocus);
    return () => {
      editor.off("focus", onFocus);
    };
  }, [active, editor]);
  useEffect(() => {
    if (!editable) setActive(null);
  }, [editable]);

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
    activeRef.current = next;
    flushSync(() => {
      setActive(next);
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

  const close = (selectTable: boolean) => {
    setActive(null);
    if (selectTable) {
      const pos = typeof getPos === "function" ? getPos() : undefined;
      if (typeof pos === "number") editor.chain().setNodeSelection(pos).run();
    }
    editor.view.focus();
  };

  const moveRow = (r: number, dir: -1 | 1) => {
    if (tool((d) => model.moveRow(d, r, dir))) {
      if (active?.r === r) follow(r + dir, active.c);
      announce(dir < 0 ? "Row moved up" : "Row moved down");
    }
  };
  const moveCol = (c: number, dir: -1 | 1) => {
    if (tool((d) => model.moveColumn(d, c, dir))) {
      if (active?.c === c) follow(active.r, c + dir);
      announce(dir < 0 ? "Column moved left" : "Column moved right");
    }
  };
  const removeRow = (r: number) => {
    if (tool((d) => model.deleteRow(d, r))) {
      announce(`Row ${r + 1} deleted`);
      if (active) {
        const rows = t.rows.length - 1;
        if (rows > 0) open(Math.max(0, Math.min(r, rows - 1)), active.c, "end");
        else setActive(null);
      }
    }
  };
  const removeCol = (c: number) => {
    if (tool((d) => model.deleteColumn(d, c))) {
      announce(`Column ${columnLetter(c)} deleted`);
      if (active) open(active.r, Math.max(0, Math.min(active.c, width - 2)), "end");
    }
  };

  // Keys in a cell: Tab and Shift+Tab go cell to cell (Tab in the last adds a row), Enter goes down (adding a
  // row at the end), ↑/↓ and ←/→ at the cell's edge move to the next cell, Escape returns to the note with
  // the table selected, ⌥⇧ and an arrow move the row or column, ⌘⇧⌫ deletes the row.
  const onKey = (r: number, c: number) => ({ event: e, atEdge }: CellKeyEvent): boolean => {
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
    if (mod || e.altKey) return false;
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

  // Rows and columns pasted from a spreadsheet fill the table from this cell on (one undo step).
  const onPaste = (r: number, c: number) => (data: DataTransfer) => {
    const grid = clipboardGrid(data, cellInline);
    if (!grid || (grid.rows.length === 1 && grid.rows[0]!.length === 1)) return false;
    if (tool((d) => model.pasteGrid(d, r, c, grid.rows))) announce(`Pasted ${grid.rows.length} rows`);
    return true;
  };

  // Formulas: while one is being written, clicking a cell puts its reference in (dragging makes a range).
  const refDrag = useRef<{ from: { r: number; c: number }; range: { from: number; to: number } } | null>(null);
  useEffect(() => {
    const up = () => (refDrag.current = null);
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
    if (active?.r === r && active.c === c) return;
    // ⌘-click (Ctrl-click) follows a link in a cell.
    if ((e.metaKey || e.ctrlKey) && (e.target as Element).closest("a[href]")) return;
    e.preventDefault();
    if (formulaMode && active) {
      insertReference(r, c);
      return;
    }
    open(r, c, { x: e.clientX, y: e.clientY });
  };

  const setTotal = (c: number, fn: TotalsFunction | null) => {
    tool((d) => model.setCell(d, d.rows.length - 1, c, fn ? [{ type: "text", text: totalsFormula(fn, c) }] : []));
  };

  const toolBtn = "grid h-6 w-6 place-items-center rounded-chip text-faint transition-colors hover:bg-accent-soft hover:text-heading disabled:opacity-30 disabled:hover:bg-transparent";
  const changed = (r: number, c: number) => Boolean(preview?.changed.has(`${r}:${c}`));
  const sortName = t.view?.sort ? columnName(evaluated.names[t.view.sort.column] ?? "", t.view.sort.column) : "";
  const filterCount = t.view?.filters?.length ?? 0;

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
          className="fb-hscroll my-2 overflow-x-auto"
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
          <table ref={tableRef} className={`fb-table w-full border-collapse text-sm ${formulaMode ? "fb-table-formula" : ""}`}>
            {editable ? (
              <thead className={tools ? undefined : "invisible"} aria-hidden={tools ? undefined : true}>
                <tr>
                  {t.rows[0]!.map((_, c) => (
                    <td key={c} className="border-0 px-1 pb-1">
                      <span className="flex items-center justify-center gap-0.5" role="group" aria-label={`Column ${columnLetter(c)}`}>
                        <span className={`fb-table-label ${formulaMode ? "is-on" : ""}`} aria-hidden>
                          {columnLetter(c)}
                        </span>
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
                    </td>
                  ))}
                  {phoneAdd ? <td className="border-0" /> : null}
                  <td className="border-0" />
                </tr>
              </thead>
            ) : null}
            <tbody>
              {order.map((r) => {
                const row = shownTable.rows[r]!;
                const header = shownTable.headerRow && r === 0;
                const total = shownTable.totalsRow && r === shownTable.rows.length - 1 && r > 0;
                return (
                  <tr key={r} className={`group/row ${total ? `fb-table-totals ${tools ? "with-tools" : ""}` : ""}`}>
                    {row.map((cell, c) => {
                      const Tag = header ? "th" : "td";
                      const shown = evaluated.cells[r]?.[c];
                      const isActive = active?.r === r && active.c === c && !preview;
                      const label = `Row ${r + 1}, column ${c + 1}`;
                      const fn = total ? totalsFunctionOf(tableCellText(cell), c) : null;
                      return (
                        <Tag
                          key={c}
                          scope={header ? "col" : undefined}
                          className={`relative border border-line p-0 text-left align-top ${isActive ? "fb-cell-active" : ""} ${changed(r, c) ? "fb-cell-changed" : ""} ${cellClass(isActive ? undefined : shown, header, total)} ${header ? "font-semibold" : ""}`}
                          data-cell-at={`${r}:${c}`}
                          onMouseDown={onCellMouseDown(r, c)}
                          onMouseEnter={() => refDrag.current && extendReference(r, c)}
                        >
                          {isActive ? (
                            // The cell editor is moved in here (see open).
                            <div data-cell-slot="" className={header ? "font-semibold" : undefined} />
                          ) : (
                            <div
                              className={`fb-cell block min-w-[6rem] px-2.5 py-1.5 ${shown?.numeric && !header ? "text-right" : ""}`}
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
                          className="fb-table-add grid h-full min-h-11 w-11 place-items-center"
                        >
                          <Plus size={20} strokeWidth={2.2} aria-hidden />
                        </button>
                      </td>
                    ) : null}
                    {editable && !(phone && !tools) ? (
                      <td className={`w-[6.25rem] border-0 pl-1 ${tools ? "" : "invisible"}`} aria-hidden={tools ? undefined : true}>
                        <span className="flex items-center gap-0.5" role="group" aria-label={`Row ${r + 1}`}>
                          <span className={`fb-table-label w-6 text-right ${formulaMode ? "is-on" : ""}`} aria-hidden>
                            {r + 1}
                          </span>
                          <button type="button" className={toolBtn} tabIndex={-1} disabled={r === 0 || viewOn || total} onClick={() => moveRow(r, -1)} aria-label={`Move row ${r + 1} up`} title={viewOn ? "Clear the sort and filter to move rows" : `Move row up (${keyLabel("⌥⇧↑")})`}>
                            <ArrowUp size={12} aria-hidden />
                          </button>
                          <button type="button" className={toolBtn} tabIndex={-1} disabled={r === t.rows.length - 1 || viewOn || total || (t.totalsRow && r === t.rows.length - 2)} onClick={() => moveRow(r, 1)} aria-label={`Move row ${r + 1} down`} title={viewOn ? "Clear the sort and filter to move rows" : `Move row down (${keyLabel("⌥⇧↓")})`}>
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
                    <button type="button" tabIndex={-1} onClick={() => addRowAndOpen(0)} disabled={t.rows.length >= LIMITS.maxTableRows} aria-label="Add a row" className="fb-table-add grid h-11 w-full place-items-center">
                      <Plus size={20} strokeWidth={2.2} aria-hidden />
                    </button>
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
          {editable && !preview && !(phone && !tools) ? (
            <div className={`mt-1.5 flex flex-wrap gap-2 text-xs text-muted ${phone ? "fb-table-tools-phone" : ""}`}>
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
            onView={(next: TableViewSettings | null) => tool((d) => model.setView(d, next))}
            onInsert={(side) => tool((d) => model.addColumn(d, side === "left" ? menuColumn : menuColumn + 1))}
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

/** Whether an event belongs to the table's own controls (cells, tools, menus), so the note leaves it alone. */
export function tableHandlesEvent(event: Event): boolean {
  const t = event.target;
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t instanceof Element && Boolean(t.closest("button, [role=dialog], .fb-table tbody td, .fb-table tbody th, .fb-cell-editor")));
}
