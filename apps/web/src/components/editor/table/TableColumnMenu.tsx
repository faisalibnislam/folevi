"use client";

import { useEffect, useId, useState, type RefObject } from "react";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Columns2, Trash2 } from "lucide-react";
import { TABLE_CURRENCIES, columnLetter, type TableColumn, type TableFilterOp, type TableViewSettings } from "@folevi/editor-schema";
import { Popover } from "@/components/ui/Popover";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";

const FILTER_LABEL: Record<TableFilterOp, string> = {
  contains: "Contains",
  notContains: "Doesn't contain",
  equals: "Is",
  notEquals: "Isn't",
  empty: "Is empty",
  notEmpty: "Isn't empty",
  gt: "Greater than",
  gte: "At least",
  lt: "Less than",
  lte: "At most",
};
const NO_VALUE: TableFilterOp[] = ["empty", "notEmpty"];

/** The column's name for people: its header text, or its letter. */
export function columnName(name: string, c: number): string {
  return name.trim() || `Column ${columnLetter(c)}`;
}

/**
 * A column's options: how its numbers show (number, currency, percent, date and decimals), sorting and
 * filtering the table by it (a saved view everyone sees; the rows themselves stay where they are), and
 * adding or deleting columns.
 */
export function TableColumnMenu({
  open,
  onClose,
  anchor,
  column,
  name,
  settings,
  view,
  canDelete,
  canAdd,
  onSettings,
  onView,
  onInsert,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  anchor: RefObject<HTMLElement | null>;
  column: number;
  name: string;
  settings: TableColumn;
  view: TableViewSettings | null;
  canDelete: boolean;
  canAdd: boolean;
  onSettings: (next: TableColumn) => void;
  onView: (next: TableViewSettings | null) => void;
  onInsert: (side: "left" | "right") => void;
  onDelete: () => void;
}) {
  const id = useId();
  const filter = view?.filters?.find((f) => f.column === column) ?? null;
  const [op, setOp] = useState<TableFilterOp>((filter?.op as TableFilterOp) ?? "contains");
  const [value, setValue] = useState(filter?.value ?? "");
  useEffect(() => {
    if (!open) return;
    setOp((filter?.op as TableFilterOp) ?? "contains");
    setValue(filter?.value ?? "");
    // Only when it opens: typing a filter isn't overwritten by the view it's about to change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const sortedHere = view?.sort?.column === column ? view.sort : null;
  const format = settings.format ?? "";
  const label = columnName(name, column);

  const setSort = (desc: boolean | null) => {
    const rest: TableViewSettings = { ...(view ?? {}) };
    if (desc === null) delete rest.sort;
    else rest.sort = desc ? { column, desc: true } : { column };
    onView(rest);
  };
  const setFilter = (next: { op: TableFilterOp; value: string } | null) => {
    const others = (view?.filters ?? []).filter((f) => f.column !== column);
    const filters = next ? [...others, NO_VALUE.includes(next.op) ? { column, op: next.op } : { column, op: next.op, value: next.value.slice(0, 500) }] : others;
    const rest: TableViewSettings = { ...(view ?? {}) };
    if (filters.length) rest.filters = filters;
    else delete rest.filters;
    onView(rest);
  };
  const row = "flex items-center justify-between gap-3";
  const caps = "ui-caps mb-1.5 px-0.5";

  return (
    <Popover open={open} onClose={onClose} anchor={anchor} label={`${label} options`} className="w-72">
      <div className="space-y-4 p-3 text-sm" data-cell-tools="">
        <p className="ui-display truncate px-0.5 text-[15px] font-semibold text-heading">{label}</p>
        <section aria-labelledby={`${id}-format`}>
          <h3 id={`${id}-format`} className={caps}>
            Numbers
          </h3>
          <div className="space-y-1.5">
            <div className={row}>
              <span className="text-muted">Show as</span>
              <Select
                aria-label="Number format"
                value={format}
                onChange={(e) => {
                  const f = e.target.value as TableColumn["format"] | "";
                  const next: TableColumn = { ...settings };
                  if (f) next.format = f;
                  else delete next.format;
                  if (f !== "currency") delete next.currency;
                  else next.currency ??= "USD";
                  if (!f || f === "date") delete next.decimals;
                  onSettings(next);
                }}
              >
                <option value="">Automatic</option>
                <option value="number">Number</option>
                <option value="currency">Currency</option>
                <option value="percent">Percent</option>
                <option value="date">Date</option>
              </Select>
            </div>
            {format === "currency" ? (
              <div className={row}>
                <span className="text-muted">Currency</span>
                <Select aria-label="Currency" value={settings.currency ?? "USD"} onChange={(e) => onSettings({ ...settings, currency: e.target.value })}>
                  {TABLE_CURRENCIES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
            {format && format !== "date" ? (
              <div className={row}>
                <span className="text-muted">Decimals</span>
                <Select
                  aria-label="Decimal places"
                  value={settings.decimals === undefined ? "" : String(settings.decimals)}
                  onChange={(e) => {
                    const next: TableColumn = { ...settings };
                    if (e.target.value === "") delete next.decimals;
                    else next.decimals = Number(e.target.value);
                    onSettings(next);
                  }}
                >
                  <option value="">Automatic</option>
                  {[0, 1, 2, 3, 4].map((d) => (
                    <option key={d} value={String(d)}>
                      {String(d)}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
          </div>
        </section>
        <section aria-labelledby={`${id}-sort`}>
          <h3 id={`${id}-sort`} className={caps}>
            Sort the table
          </h3>
          <div className="grid grid-cols-2 gap-1.5">
            <button type="button" aria-pressed={Boolean(sortedHere && !sortedHere.desc)} onClick={() => setSort(sortedHere && !sortedHere.desc ? null : false)} className={`inline-flex h-9 items-center text-[13px] justify-center gap-1.5 rounded-chip ${sortedHere && !sortedHere.desc ? "bg-accent-soft font-semibold text-heading" : "bg-sunken/80 text-ink hover:bg-accent-soft/70"}`}>
              <ArrowUpNarrowWide size={14} aria-hidden /> A to Z
            </button>
            <button type="button" aria-pressed={Boolean(sortedHere?.desc)} onClick={() => setSort(sortedHere?.desc ? null : true)} className={`inline-flex h-9 items-center text-[13px] justify-center gap-1.5 rounded-chip ${sortedHere?.desc ? "bg-accent-soft font-semibold text-heading" : "bg-sunken/80 text-ink hover:bg-accent-soft/70"}`}>
              <ArrowDownWideNarrow size={14} aria-hidden /> Z to A
            </button>
          </div>
          <p className="mt-1.5 px-0.5 text-xs text-muted">Everyone sees the table sorted. The rows stay where they are, so clearing it puts them back.</p>
        </section>
        <section aria-labelledby={`${id}-filter`}>
          <h3 id={`${id}-filter`} className={caps}>
            Show only rows where it
          </h3>
          <form
            className="space-y-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              setFilter({ op, value });
            }}
          >
            <Select aria-label="Filter condition" value={op} onChange={(e) => setOp(e.target.value as TableFilterOp)} className="w-full">
              {(Object.keys(FILTER_LABEL) as TableFilterOp[]).map((k) => (
                <option key={k} value={k}>
                  {FILTER_LABEL[k]}
                </option>
              ))}
            </Select>
            {NO_VALUE.includes(op) ? null : <input value={value} onChange={(e) => setValue(e.target.value)} aria-label="Filter value" placeholder="Value" maxLength={500} className="ui-input h-8 w-full rounded-chip px-3 text-sm" />}
            <div className="flex gap-1.5">
              <Button size="sm" type="submit" disabled={!NO_VALUE.includes(op) && !value.trim()}>
                {filter ? "Update filter" : "Filter"}
              </Button>
              {filter ? (
                <Button size="sm" variant="quiet" onClick={() => setFilter(null)}>
                  Remove filter
                </Button>
              ) : null}
            </div>
          </form>
        </section>
        <section className="flex flex-wrap gap-1.5 border-t border-line pt-3">
          <Button size="sm" variant="quiet" disabled={!canAdd} onClick={() => onInsert("left")}>
            <Columns2 size={14} aria-hidden /> Insert left
          </Button>
          <Button size="sm" variant="quiet" disabled={!canAdd} onClick={() => onInsert("right")}>
            <Columns2 size={14} aria-hidden /> Insert right
          </Button>
          <Button size="sm" variant="quiet" disabled={!canDelete} onClick={onDelete} className="text-danger">
            <Trash2 size={14} aria-hidden /> Delete column
          </Button>
        </section>
      </div>
    </Popover>
  );
}
