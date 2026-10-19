"use client";

// The chart's own data table, edited in place in the block: column names across the top, a row per
// category (or person, or set), a cell per value. Enter and the arrow keys move between cells, Tab across;
// pasting rows from a spreadsheet or CSV fills cells from the one you're in. Each column and row has a menu
// (insert, move, delete). A cell keeps what you type while you're in it ("1,2" on the way to "1,200") and
// is saved as you go. When the rows come from a table or a collection the grid is read-only and says where.
import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Plus } from "lucide-react";
import { CHART_LIMITS, chartCell, chartCellText, parseDelimited, type ChartCell, type ChartKind } from "@folevi/editor-schema";
import { MenuButton } from "@/components/ui/Menu";

export interface GridData {
  columns: string[];
  rows: ChartCell[][];
}

/** What each column holds, for the empty cells' hints. */
function hints(kind: ChartKind, col: number): string {
  if (kind === "org") return ["Name", "Reports to", "Role"][col] ?? "";
  if (kind === "venn") return ["Set, or A & B", "Size"][col] ?? "";
  return col === 0 ? "Label" : "0";
}

function Cell({ value, onCommit, label, placeholder, readOnly, header, onKey, onPasteGrid, cellRef }: { value: string; onCommit: (text: string) => void; label: string; placeholder?: string; readOnly: boolean; header?: boolean; onKey: (e: React.KeyboardEvent<HTMLInputElement>) => void; onPasteGrid: (grid: string[][]) => void; cellRef?: (el: HTMLInputElement | null) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      ref={cellRef}
      className={`fb-chart-cell ${header ? "fb-chart-cell-head" : ""}`}
      value={draft ?? value}
      aria-label={label}
      placeholder={placeholder}
      readOnly={readOnly}
      maxLength={CHART_LIMITS.maxCell}
      onFocus={() => setDraft(value)}
      onBlur={() => {
        if (draft !== null && draft !== value) onCommit(draft);
        setDraft(null);
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        onCommit(e.target.value);
      }}
      onKeyDown={onKey}
      onPaste={(e) => {
        if (readOnly) return;
        const text = e.clipboardData.getData("text/plain");
        if (!/[\t\n]/.test(text.trim())) return;
        e.preventDefault();
        onPasteGrid(parseDelimited(text, CHART_LIMITS.maxRows, CHART_LIMITS.maxColumns));
      }}
    />
  );
}

export function DataGrid({ data, kind, readOnly, note, onChange }: { data: GridData; kind: ChartKind; readOnly: boolean; note?: React.ReactNode; onChange: (next: GridData) => void }) {
  const cells = useRef(new Map<string, HTMLInputElement>());
  const [focusNext, setFocusNext] = useState<string | null>(null);
  const width = data.columns.length;
  const L = CHART_LIMITS;

  // A new row or column takes focus once it's drawn.
  useEffect(() => {
    if (!focusNext) return;
    const el = cells.current.get(focusNext);
    if (el) {
      el.focus();
      el.select();
      setFocusNext(null);
    }
  }, [focusNext, data]);

  const setCell = (r: number, c: number, text: string) => {
    const rows = data.rows.map((row) => [...row]);
    rows[r]![c] = chartCell(text);
    onChange({ columns: data.columns, rows });
  };
  const setColumn = (c: number, text: string) => onChange({ columns: data.columns.map((x, i) => (i === c ? text.replace(/\n+/g, " ") : x)), rows: data.rows });
  const addRow = (at = data.rows.length) => {
    if (data.rows.length >= L.maxRows) return;
    const rows = [...data.rows];
    rows.splice(at, 0, Array.from({ length: width }, () => null));
    onChange({ columns: data.columns, rows });
    setFocusNext(`${at}:0`);
  };
  const addColumn = (at = width) => {
    if (width >= L.maxColumns) return;
    const columns = [...data.columns];
    columns.splice(at, 0, `Series ${width}`);
    onChange({ columns, rows: data.rows.map((r) => [...r.slice(0, at), null, ...r.slice(at)]) });
    setFocusNext(`h:${at}`);
  };
  const deleteRow = (r: number) => onChange({ columns: data.columns, rows: data.rows.filter((_, i) => i !== r) });
  const deleteColumn = (c: number) => onChange({ columns: data.columns.filter((_, i) => i !== c), rows: data.rows.map((r) => r.filter((_, i) => i !== c)) });
  const moveRow = (r: number, d: -1 | 1) => {
    const rows = [...data.rows];
    [rows[r], rows[r + d]] = [rows[r + d]!, rows[r]!];
    onChange({ columns: data.columns, rows });
  };
  const moveColumn = (c: number, d: -1 | 1) => {
    const swap = <T,>(a: T[]) => {
      const b = [...a];
      [b[c], b[c + d]] = [b[c + d]!, b[c]!];
      return b;
    };
    onChange({ columns: swap(data.columns), rows: data.rows.map(swap) });
  };
  /** Pasted rows fill cells from (r, c) on (r -1: the column names first), growing the table as needed. */
  const paste = (r: number, c: number, grid: string[][]) => {
    const columns = [...data.columns];
    const rows = data.rows.map((row) => [...row]);
    const w = Math.min(L.maxColumns, Math.max(columns.length, c + Math.max(...grid.map((g) => g.length))));
    while (columns.length < w) columns.push(`Series ${columns.length}`);
    for (const row of rows) while (row.length < w) row.push(null);
    grid.forEach((line, i) => {
      const at = r + i;
      if (at >= L.maxRows) return;
      line.forEach((text, j) => {
        if (c + j >= w) return;
        if (at < 0) columns[c + j] = text.trim() || columns[c + j]!;
        else {
          while (rows.length <= at) rows.push(Array.from({ length: w }, () => null));
          rows[at]![c + j] = chartCell(text);
        }
      });
    });
    onChange({ columns, rows });
  };

  const keyFor = (r: number, c: number) => (r < 0 ? `h:${c}` : `${r}:${c}`);
  const onKey = (r: number, c: number) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const go = (nr: number, nc: number) => {
      const el = cells.current.get(keyFor(nr, nc));
      if (!el) return false;
      e.preventDefault();
      el.focus();
      el.select();
      return true;
    };
    if (e.key === "Enter" && !e.shiftKey) {
      if (!go(r + 1, c) && !readOnly && r >= 0) addRow(r + 1);
      else e.preventDefault();
    } else if (e.key === "Enter" && e.shiftKey) go(r - 1, c);
    else if (e.key === "ArrowDown") go(r + 1, c);
    else if (e.key === "ArrowUp") go(r - 1, c);
    else if (e.key === "Escape") (e.currentTarget.closest(".fb-canvas-body") as HTMLElement | null)?.focus();
  };
  const register = (k: string) => (el: HTMLInputElement | null) => {
    if (el) cells.current.set(k, el);
    else cells.current.delete(k);
  };

  return (
    <div className="fb-chart-grid" onPointerDown={(e) => e.stopPropagation()}>
      {note ? <div className="fb-chart-grid-note">{note}</div> : null}
      <div className="fb-chart-grid-scroll fb-hscroll">
        <table aria-label="Chart data" aria-readonly={readOnly || undefined}>
          <thead>
            <tr>
              <th className="fb-chart-grid-corner" aria-hidden />
              {data.columns.map((name, c) => (
                <th key={c} scope="col">
                  <div className="fb-chart-grid-head">
                    <Cell value={name} header label={`Column ${c + 1} name`} placeholder={c === 0 ? "Label" : "Series"} readOnly={readOnly} onCommit={(t) => setColumn(c, t)} onKey={onKey(-1, c)} onPasteGrid={(g) => paste(-1, c, g)} cellRef={register(keyFor(-1, c))} />
                    {readOnly ? null : (
                      <MenuButton
                        label={`Column ${c + 1} options`}
                        triggerClassName="fb-chart-grid-menu"
                        trigger={<MoreHorizontal size={13} aria-hidden />}
                        items={[
                          { label: "Insert column left", onSelect: () => addColumn(c), disabled: width >= L.maxColumns || c === 0 },
                          { label: "Insert column right", onSelect: () => addColumn(c + 1), disabled: width >= L.maxColumns },
                          { label: "Move left", onSelect: () => moveColumn(c, -1), disabled: c === 0 },
                          { label: "Move right", onSelect: () => moveColumn(c, 1), disabled: c === width - 1 },
                          "separator",
                          { label: "Delete column", danger: true, onSelect: () => deleteColumn(c), disabled: width <= 1 },
                        ]}
                      />
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, r) => (
              <tr key={r}>
                <th scope="row" className="fb-chart-grid-num">
                  {readOnly ? (
                    <span>{r + 1}</span>
                  ) : (
                    <MenuButton
                      label={`Row ${r + 1} options`}
                      triggerClassName="fb-chart-grid-rowbtn"
                      trigger={<span>{r + 1}</span>}
                      items={[
                        { label: "Insert row above", onSelect: () => addRow(r) },
                        { label: "Insert row below", onSelect: () => addRow(r + 1) },
                        { label: "Move up", onSelect: () => moveRow(r, -1), disabled: r === 0 },
                        { label: "Move down", onSelect: () => moveRow(r, 1), disabled: r === data.rows.length - 1 },
                        "separator",
                        { label: "Delete row", danger: true, onSelect: () => deleteRow(r) },
                      ]}
                    />
                  )}
                </th>
                {row.map((cell, c) => (
                  <td key={c} data-number={typeof cell === "number" || undefined}>
                    <Cell
                      value={chartCellText(cell)}
                      label={`${data.columns[c] || `Column ${c + 1}`}, row ${r + 1}`}
                      placeholder={r === 0 ? hints(kind, c) : undefined}
                      readOnly={readOnly}
                      onCommit={(t) => setCell(r, c, t)}
                      onKey={onKey(r, c)}
                      onPasteGrid={(g) => paste(r, c, g)}
                      cellRef={register(keyFor(r, c))}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {readOnly ? null : (
        <div className="fb-chart-grid-actions">
          <button type="button" className="fb-chart-grid-add" onClick={() => addRow()} disabled={data.rows.length >= L.maxRows}>
            <Plus size={13} aria-hidden /> Row
          </button>
          <button type="button" className="fb-chart-grid-add" onClick={() => addColumn()} disabled={width >= L.maxColumns}>
            <Plus size={13} aria-hidden /> Column
          </button>
          <span className="fb-chart-grid-tip">Paste rows from a spreadsheet into any cell.</span>
        </div>
      )}
    </div>
  );
}
