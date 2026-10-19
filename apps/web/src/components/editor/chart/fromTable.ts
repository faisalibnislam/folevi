// "Turn into chart" on a table block (its block menu): a chart block under the table that follows it live
// (the chart keeps the table's block id), drawn as the kind that suits the numbers, titled after the heading
// above the table. When Foli AI is on, the chart asks it for a title and a takeaway line once it's shown
// (ChartView reads `takeStyleRequest`).
import type { Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { CHART_DEFAULT_HEIGHT, chartNumber, emptyChart, serializeChart, ulid, type ChartData, type ChartKind } from "@folevi/editor-schema";
import { subtreeRange } from "../commands";
import { tableBlockRows, type ChartRows } from "./sources";

/** Charts just made from a table that should ask Foli AI for a title and takeaway, by block id. */
const styleRequests = new Set<string>();

/** Whether the chart with this block id was just made from a table (asked once). */
export function takeStyleRequest(blockId: string): boolean {
  return styleRequests.delete(blockId);
}

const TIME = /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+\d{2,4})?$|^q[1-4](?:\s+\d{2,4})?$|^(?:19|20)\d{2}$|^\d{4}-\d{2}(?:-\d{2})?$|^(?:week|wk|day|month)\s*\d+$|^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*$/i;

/** The kind of chart that suits these rows: a line over time, otherwise bars (stacked for parts of a whole). */
export function kindFor(rows: ChartRows): ChartKind {
  const numeric = rows.columns.map((_, i) => i > 0 && rows.rows.some((r) => chartNumber(r[i]) !== null));
  const series = numeric.filter(Boolean).length;
  const labels = rows.rows.map((r) => String(r[0] ?? "").trim()).filter(Boolean);
  const timeLike = labels.length >= 3 && labels.filter((l) => TIME.test(l)).length >= labels.length * 0.7;
  if (!series && rows.columns.length >= 2 && rows.rows.length) return "org";
  if (timeLike) return "line";
  return "bar";
}

/** The text of the heading just above block `index` (with nothing but empty lines between). */
function headingAbove(editor: Editor, index: number): string {
  for (let i = index - 1; i >= 0 && i >= index - 3; i--) {
    const n = editor.state.doc.child(i);
    if (n.type.name === "heading") return n.textContent.trim().slice(0, 200);
    if (n.textContent.trim()) return "";
  }
  return "";
}

/** A chart from a table block (the same reading as a live table source). */
export function chartFromTable(attrs: Record<string, unknown>, blockId: string, title = ""): ChartData {
  const data = tableBlockRows(attrs);
  return { ...emptyChart(), kind: kindFor(data), title, columns: data.columns, rows: data.rows, source: { type: "table", blockId } };
}

/**
 * Puts a chart of the table at block `index` right under it (and under anything nested in it), selects it
 * and scrolls to it. `askAi`: the chart asks Foli AI for a title and takeaway. Returns the chart's block id.
 */
export function turnTableIntoChart(editor: Editor, index: number, askAi: boolean): string | null {
  const { state } = editor;
  const table = state.doc.maybeChild(index);
  const type = state.schema.nodes.chart;
  if (!table || table.type.name !== "table" || !type) return null;
  const id = ulid();
  const chart = chartFromTable(table.attrs, String(table.attrs.id ?? ""), headingAbove(editor, index));
  if (!table.attrs.id) chart.source = null;
  const at = subtreeRange(state, index).end;
  const node = type.create({ id, depth: table.attrs.depth ?? 0, data: serializeChart(chart), height: CHART_DEFAULT_HEIGHT });
  const tr = state.tr.insert(at, node);
  tr.setSelection(NodeSelection.create(tr.doc, at));
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
  if (askAi && chart.columns.length) styleRequests.add(id);
  return id;
}
