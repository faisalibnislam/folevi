"use client";

import { useMemo } from "react";
import { evaluateTable, tableRowOrder, type EvaluatedCell, type InlineNode, type Mark } from "@folevi/editor-schema";
import { CellContent, marked } from "./CellContent";
import { tableData, tableOptions } from "./tableModel";

/** Today as YYYY-MM-DD where the reader is (TODAY() in formulas). */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * What a cell shows when it isn't being edited: its own content, or (a formula, a formatted number) its
 * result in the cell's formatting. An error shows its code with the explanation on hover.
 */
export function StaticCell({ cell, shown }: { cell: InlineNode[]; shown: EvaluatedCell | undefined }) {
  if (!shown?.changed) return <CellContent nodes={cell} />;
  const marks = (cell.find((n) => n.type === "text") as { marks?: Mark[] } | undefined)?.marks;
  if (shown.error)
    return (
      <span className="fb-cell-error" title={shown.error.message}>
        {shown.display}
        <span className="sr-only">: {shown.error.message}</span>
      </span>
    );
  return <>{marked(shown.display, marks)}</>;
}

/** Cell classes shared by the editor and read-only pages. */
export function cellClass(shown: EvaluatedCell | undefined, header: boolean, total: boolean): string {
  return `${shown?.numeric && !header ? "fb-cell-number" : ""} ${shown?.error ? "fb-cell-has-error" : ""} ${total ? "fb-cell-total" : ""}`;
}

/** A table read-only (shared pages, version previews): results of formulas, formats, and its saved view. */
export function TableStatic({ props }: { props: Record<string, unknown> }) {
  const t = useMemo(() => tableData(props), [props]);
  const today = localToday();
  const evaluated = useMemo(() => evaluateTable(t.rows, tableOptions(t, today)), [t, today]);
  const order = useMemo(() => tableRowOrder(evaluated, tableOptions(t), t.view), [evaluated, t]);
  return (
    <div className="fb-hscroll my-3 overflow-x-auto">
      <table className="fb-table w-full border-collapse text-sm">
        <tbody>
          {order.map((r) => {
            const row = t.rows[r]!;
            const header = t.headerRow && r === 0;
            const total = t.totalsRow && r === t.rows.length - 1 && r > 0;
            return (
              <tr key={r}>
                {row.map((cell, c) => {
                  const shown = evaluated.cells[r]?.[c];
                  const Tag = header ? "th" : "td";
                  return (
                    <Tag key={c} scope={header ? "col" : undefined} className={`border border-line px-2.5 py-1.5 text-left align-top ${header ? "font-semibold" : ""} ${cellClass(shown, header, total)}`}>
                      <StaticCell cell={cell} shown={shown} />
                    </Tag>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
