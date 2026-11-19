"use client";

// One row of the table block (TableView.tsx draws the table; this draws a row of it and its tools).
//
// A row is drawn again only when something it shows changed: its own cells, what they work out to, whether one
// of them is open or selected, a column's width. A key typed in a cell used to draw every cell of the table
// again, four thousand in the largest table; it now draws the row being typed in, and any row whose formulas
// read it. For that to hold, everything a row is given either stays the same object from one change to the
// next (the row's cells, what they show, the widths, `actions`) or is a plain value.
import { memo } from "react";
import { ArrowDown, ArrowUp, GripVertical, Minus, Plus, Sigma } from "lucide-react";
import { LIMITS, TOTALS_FUNCTIONS, columnLetter, tableCellText, totalsFunctionOf, type EvaluatedCell, type InlineNode, type TotalsFunction } from "@folevi/editor-schema";
import { keyLabel } from "@/lib/shortcuts";
import { MenuButton } from "@/components/ui/Menu";
import { StaticCell, cellClass } from "./TableStatic";

const TOTAL_LABEL: Record<TotalsFunction, string> = { SUM: "Sum", AVERAGE: "Average", COUNT: "Count numbers", COUNTA: "Count filled", MIN: "Smallest", MAX: "Largest" };

/** The classes of the small buttons in the row and column tools. */
export const TOOL_BUTTON = "grid h-6 w-6 place-items-center rounded-chip text-faint transition-colors hover:bg-accent-soft hover:text-heading disabled:opacity-30 disabled:hover:bg-transparent";

/**
 * What a row asks the table to do. One object for the life of the table (each function reads the table as it
 * is when called), so handing it to a row never makes the row draw again.
 */
export interface RowActions {
  cellMouseDown: (r: number, c: number, e: React.MouseEvent) => void;
  cellMouseEnter: (r: number, c: number, e: React.MouseEvent) => void;
  /** A cell took the keyboard (Tab into the table, a screen reader): it opens. */
  openCell: (r: number, c: number) => void;
  setTotal: (c: number, fn: TotalsFunction | null) => void;
  addColumn: () => void;
  moveRow: (r: number, dir: -1 | 1) => void;
  removeRow: (r: number) => void;
  /** What makes the row's handle drag it (see TableView's `handle`). */
  rowGrip: (r: number) => Record<string, unknown>;
}

export interface TableRowProps {
  /** The row's number as stored, and its cells. */
  r: number;
  row: InlineNode[][];
  /** What each cell shows (a formula's result, a formatted number). */
  shown: readonly EvaluatedCell[] | undefined;
  header: boolean;
  total: boolean;
  editable: boolean;
  /** Foli AI's version is being shown: nothing opens. */
  previewing: boolean;
  /** The table's tools are showing. */
  tools: boolean;
  /** The column of the open cell when it is in this row, else -1. */
  activeC: number;
  /** The selected range's columns when this row is in it (else -1), and whether it is the range's first or last row. */
  selC0: number;
  selC1: number;
  selTop: boolean;
  selBottom: boolean;
  /** The column of the cell the range started at when it is in this row, else -1. */
  anchorC: number;
  /** Each column's width in pixels (null: as wide as its content needs). */
  widths: readonly (number | null)[];
  /** This row, or column `movingCol`, is being dragged to another place. */
  movingRow: boolean;
  movingCol: number;
  /** The columns of the cells Foli AI changed in this row, as "1,3" ("" for none). */
  changed: string;
  /** In the iPhone layout the first row shown holds the "add a column" button, this many rows tall (else 0). */
  addColumnSpan: number;
  canAddColumn: boolean;
  /** Whether the row's own tools are drawn at all, and which of them can be used. */
  rowTools: boolean;
  canDrag: boolean;
  canUp: boolean;
  canDown: boolean;
  canDelete: boolean;
  /** Why rows can't be moved (a sort or filter is on), for the tooltips. */
  moveRowsHint: string | null;
  /** A formula is being written: the row numbers light up, as what a reference names. */
  formulaMode: boolean;
  actions: RowActions;
}

export const TableRow = memo(function TableRow(p: TableRowProps) {
  const { r, row, shown: shownRow, header, total, editable, previewing, tools, actions } = p;
  const changed = p.changed ? new Set(p.changed.split(",").map(Number)) : null;
  return (
    <tr className={`group/row ${total ? `fb-table-totals ${tools ? "with-tools" : ""}` : ""} ${p.movingRow ? "fb-table-moving" : ""}`}>
      {row.map((cell, c) => {
        const Tag = header ? "th" : "td";
        const shown = shownRow?.[c];
        const isActive = p.activeC === c && !previewing;
        const label = `Row ${r + 1}, column ${c + 1}`;
        const fn = total ? totalsFunctionOf(tableCellText(cell), c) : null;
        // In the selected rectangle: tinted, with the rectangle's outline on the sides that are its edge.
        const picked = p.selC0 >= 0 && c >= p.selC0 && c <= p.selC1;
        const pickedClass = picked ? `fb-cell-selected ${p.selTop ? "fb-sel-t" : ""} ${p.selBottom ? "fb-sel-b" : ""} ${c === p.selC0 ? "fb-sel-l" : ""} ${c === p.selC1 ? "fb-sel-r" : ""} ${p.anchorC === c ? "fb-sel-anchor" : ""}` : "";
        const w = p.widths[c] ?? null;
        return (
          <Tag
            key={c}
            scope={header ? "col" : undefined}
            className={`relative border border-line p-0 text-left align-top ${isActive ? "fb-cell-active" : ""} ${pickedClass} ${w === null ? "" : "fb-col-sized"} ${p.movingCol === c ? "fb-table-moving" : ""} ${changed?.has(c) ? "fb-cell-changed" : ""} ${cellClass(isActive ? undefined : shown, header, total)} ${header ? "font-semibold" : ""}`}
            // A width is both the column's (<col>, which stops it growing with its content) and each of its cells'
            // least width (which stops a table wider than the note squeezing it: the table scrolls sideways instead).
            style={w === null ? undefined : ({ minWidth: w, "--fb-col-w": `${w}px` } as React.CSSProperties)}
            data-cell-at={`${r}:${c}`}
            onMouseDown={(e) => actions.cellMouseDown(r, c, e)}
            onMouseEnter={(e) => actions.cellMouseEnter(r, c, e)}
          >
            {isActive ? (
              // The cell editor is moved in here (see TableView's open).
              <div data-cell-slot="" className={header ? "font-semibold" : undefined} />
            ) : (
              <div
                className={`fb-cell block min-w-[6rem] px-2.5 py-1.5 ${shown?.numeric && shown.kind !== "date" && !header ? "text-right" : ""}`}
                data-cell={`${r}:${c}`}
                data-enter-focus={r === 0 && c === 0 && editable ? "" : undefined}
                role={editable ? "textbox" : undefined}
                aria-label={editable ? label : undefined}
                aria-readonly={editable ? undefined : true}
                tabIndex={editable && !previewing ? -1 : undefined}
                onFocus={() => actions.openCell(r, c)}
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
                  ...TOTALS_FUNCTIONS.map((f) => ({ label: TOTAL_LABEL[f], checked: fn === f, onSelect: () => actions.setTotal(c, f) })),
                  "separator" as const,
                  { label: "None", checked: !tableCellText(cell).trim(), onSelect: () => actions.setTotal(c, null) },
                ]}
              />
            ) : null}
          </Tag>
        );
      })}
      {p.addColumnSpan > 0 ? (
        <td rowSpan={p.addColumnSpan} className="fb-table-add-col border-0 p-0 pl-1.5 align-top">
          <button
            type="button"
            tabIndex={-1}
            onClick={() => actions.addColumn()}
            disabled={!p.canAddColumn}
            aria-label="Add a column"
            title="Add a column"
            className="fb-table-add grid h-full min-h-11 w-11 place-items-center enabled:hover:bg-[var(--glass-hover)]"
          >
            <Plus size={20} strokeWidth={2.2} aria-hidden />
          </button>
        </td>
      ) : null}
      {p.rowTools ? (
        <td className={`w-[7.25rem] border-0 pl-1 ${tools ? "" : "invisible"}`} aria-hidden={tools ? undefined : true}>
          <span className="flex items-center gap-0.5" role="group" aria-label={`Row ${r + 1}`}>
            <button type="button" className="fb-table-grip fb-table-grip-row" tabIndex={-1} disabled={!p.canDrag} {...actions.rowGrip(r)} aria-label={`Drag row ${r + 1} to move it`} title={p.moveRowsHint ?? "Drag to move the row"}>
              <GripVertical size={10} aria-hidden />
              <span className={`fb-table-label ${p.formulaMode ? "is-on" : ""}`} aria-hidden>
                {r + 1}
              </span>
            </button>
            <button type="button" className={TOOL_BUTTON} tabIndex={-1} disabled={!p.canUp} onClick={() => actions.moveRow(r, -1)} aria-label={`Move row ${r + 1} up`} title={p.moveRowsHint ?? `Move row up (${keyLabel("⌥⇧↑")})`}>
              <ArrowUp size={12} aria-hidden />
            </button>
            <button type="button" className={TOOL_BUTTON} tabIndex={-1} disabled={!p.canDown} onClick={() => actions.moveRow(r, 1)} aria-label={`Move row ${r + 1} down`} title={p.moveRowsHint ?? `Move row down (${keyLabel("⌥⇧↓")})`}>
              <ArrowDown size={12} aria-hidden />
            </button>
            {/* (On a touch screen it stands a little apart: a finger aiming at "move down" doesn't delete the row.) */}
            <button type="button" className={`${TOOL_BUTTON} hover:!text-danger pointer-coarse:ml-2`} tabIndex={-1} disabled={!p.canDelete} onClick={() => actions.removeRow(r)} aria-label={`Delete row ${r + 1}`} title={`Delete row (${keyLabel("⌘⇧⌫")})`}>
              <Minus size={12} aria-hidden />
            </button>
          </span>
        </td>
      ) : null}
    </tr>
  );
});

/** Whether a table can take another column (the "add a column" button). */
export const roomForColumn = (width: number) => width < LIMITS.maxTableColumns;
