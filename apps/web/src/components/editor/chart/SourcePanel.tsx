"use client";

// Where the chart's rows come from: its own table (edited in the block), a table block in this note (live:
// the chart follows it as it changes), a collection grouped by one of its fields and counted, summed or
// averaged (live), or a CSV file or rows pasted from a spreadsheet (copied in). Chosen in the toolbar's
// Data menu; this is the panel behind it.
import { useQuery } from "convex/react";
import { useMemo, useRef, useState } from "react";
import { FileUp, Table2, LayoutList, ClipboardPaste, PencilLine } from "lucide-react";
import type { Editor } from "@tiptap/react";
import type { ChartAggregate, ChartData, ChartSource } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { Select } from "@/components/ui/Select";
import { aggregateCollection, groupableTypes, tableBlockRows, textToChartRows, TITLE_FIELD, type ChartRows, type CollectionLike } from "./sources";

/** The table blocks in a note, in order, each with a name made from its first row. */
export function noteTables(editor: Editor): { id: string; label: string; data: ChartRows }[] {
  const out: { id: string; label: string; data: ChartRows }[] = [];
  let n = 0;
  editor.state.doc.forEach((node) => {
    if (node.type.name !== "table") return;
    n++;
    if (!node.attrs.id) return;
    const data = tableBlockRows(node.attrs);
    const names = node.attrs.headerRow !== false ? data.columns.filter(Boolean).slice(0, 4).join(", ") : "";
    out.push({ id: String(node.attrs.id), label: `Table ${n}${names ? `: ${names}` : ""}`, data });
  });
  return out;
}

type Step = "menu" | "table" | "collection" | "paste";

export function SourcePanel({
  chart,
  editor,
  demo,
  onUseOwn,
  onSource,
  onRows,
  onUnavailable,
}: {
  chart: ChartData;
  editor: Editor;
  demo: boolean;
  /** Keep the rows as the chart's own data (no source). */
  onUseOwn: () => void;
  /** Take the rows from a source (and its rows as they are now). */
  onSource: (source: ChartSource, rows: ChartRows) => void;
  /** Rows copied in (CSV or pasted). */
  onRows: (rows: ChartRows) => void;
  onUnavailable: (feature: string) => void;
}) {
  const [step, setStep] = useState<Step>("menu");
  const [pasted, setPasted] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const tables = useMemo(() => (step === "table" ? noteTables(editor) : []), [step, editor]);
  const source = chart.source;

  const readFile = async (f: File) => {
    setProblem(null);
    if (f.size > 2_000_000) return setProblem("That file is too big to chart. Try one under 2 MB.");
    const rows = textToChartRows(await f.text());
    if (!rows.columns.length) return setProblem("There's nothing in that file to chart.");
    onRows(rows);
  };

  if (step === "table") {
    return (
      <div className="fb-chart-panel">
        <h3 className="ui-caps">A table in this note</h3>
        {tables.length ? (
          <ul className="fb-chart-choices">
            {tables.map((t) => (
              <li key={t.id}>
                <button type="button" className="fb-chart-choice" aria-pressed={source?.type === "table" && source.blockId === t.id} onClick={() => onSource({ type: "table", blockId: t.id }, t.data)}>
                  <Table2 size={15} aria-hidden />
                  <span>{t.label}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="fb-chart-panel-note">There are no tables in this note yet. Add one, then pick it here: the chart follows it as it changes.</p>
        )}
        <button type="button" className="fb-chart-link" onClick={() => setStep("menu")}>
          Back
        </button>
      </div>
    );
  }
  if (step === "collection") return <CollectionStep chart={chart} onSource={onSource} onBack={() => setStep("menu")} />;
  if (step === "paste") {
    return (
      <div className="fb-chart-panel">
        <h3 className="ui-caps">Paste rows</h3>
        <p className="fb-chart-panel-note">From a spreadsheet, or as CSV. The first row names the columns.</p>
        <textarea className="ui-input fb-chart-paste" rows={6} value={pasted} onChange={(e) => setPasted(e.target.value)} aria-label="Rows to paste" placeholder={"Month, Web, iPhone\nJan, 120, 40"} data-autofocus />
        {problem ? <p className="fb-chart-panel-problem" role="alert">{problem}</p> : null}
        <div className="fb-chart-ai-buttons">
          <button
            type="button"
            className="ui-btn ui-btn-primary h-8 px-3 text-callout pointer-coarse:h-11"
            disabled={!pasted.trim()}
            onClick={() => {
              const rows = textToChartRows(pasted);
              if (!rows.columns.length) return setProblem("There's nothing there to chart.");
              onRows(rows);
            }}
          >
            Use these rows
          </button>
          <button type="button" className="ui-btn ui-btn-ghost h-8 px-3 text-callout pointer-coarse:h-11" onClick={() => setStep("menu")}>
            Back
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="fb-chart-panel">
      <h3 className="ui-caps">Data from</h3>
      <ul className="fb-chart-choices">
        <li>
          <button type="button" className="fb-chart-choice" aria-pressed={!source} onClick={onUseOwn}>
            <PencilLine size={15} aria-hidden />
            <span>
              Its own table
              <small>Edit the numbers in the chart</small>
            </span>
          </button>
        </li>
        <li>
          <button type="button" className="fb-chart-choice" aria-pressed={source?.type === "table"} onClick={() => setStep("table")}>
            <Table2 size={15} aria-hidden />
            <span>
              A table in this note
              <small>Follows the table as it changes</small>
            </span>
          </button>
        </li>
        <li>
          <button type="button" className="fb-chart-choice" aria-pressed={source?.type === "collection"} onClick={() => (demo ? onUnavailable("Collections") : setStep("collection"))}>
            <LayoutList size={15} aria-hidden />
            <span>
              A collection
              <small>Counted or added up by a field, live</small>
            </span>
          </button>
        </li>
        <li>
          <button type="button" className="fb-chart-choice" onClick={() => file.current?.click()}>
            <FileUp size={15} aria-hidden />
            <span>
              A CSV file
              <small>Copied into the chart</small>
            </span>
          </button>
        </li>
        <li>
          <button type="button" className="fb-chart-choice" onClick={() => setStep("paste")}>
            <ClipboardPaste size={15} aria-hidden />
            <span>
              Pasted rows
              <small>From a spreadsheet or CSV</small>
            </span>
          </button>
        </li>
      </ul>
      {problem ? <p className="fb-chart-panel-problem" role="alert">{problem}</p> : null}
      <input
        ref={file}
        type="file"
        accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void readFile(f);
        }}
      />
    </div>
  );
}

/** Picking a collection, the field its rows are grouped by, and what's counted or added up. */
function CollectionStep({ chart, onSource, onBack }: { chart: ChartData; onSource: (source: ChartSource, rows: ChartRows) => void; onBack: () => void }) {
  const { scope } = useAppState();
  const list = useQuery(api.charts.collections, { scope });
  const current = chart.source?.type === "collection" ? chart.source : null;
  const [collectionId, setCollectionId] = useState(current?.collectionId ?? "");
  const picked = collectionId || list?.[0]?.id || "";
  const data = useQuery(api.collections.get, picked ? { collectionId: picked } : "skip") as CollectionLike | undefined;
  const groupable = (data?.properties ?? []).filter((p) => groupableTypes.has(p.type));
  const numbers = (data?.properties ?? []).filter((p) => p.type === "number");
  const [groupBy, setGroupBy] = useState(current?.groupBy ?? "");
  const [measure, setMeasure] = useState(current ? `${current.aggregate}:${current.field ?? ""}` : "count:");
  const group = groupable.some((p) => p.id === groupBy) || groupBy === TITLE_FIELD ? groupBy : (groupable.find((p) => p.type === "select")?.id ?? groupable[0]?.id ?? TITLE_FIELD);
  const [aggregate, field] = measure.split(":") as [ChartAggregate, string];
  const usable = aggregate === "count" || numbers.some((p) => p.id === field);

  return (
    <div className="fb-chart-panel">
      <h3 className="ui-caps">A collection</h3>
      {list === undefined ? (
        <p className="fb-chart-panel-note">Loading…</p>
      ) : !list.length ? (
        <p className="fb-chart-panel-note">There are no collections here yet. Add one to a note (Insert, Data and more), then chart it here.</p>
      ) : (
        <div className="fb-chart-fields">
          <label className="fb-chart-field fb-chart-field-wide">
            <span>Collection</span>
            <Select value={picked} onChange={(e) => setCollectionId(e.target.value)} aria-label="Collection">
              {list.map((c) => (
                <option key={c.id} value={c.id}>
                  {`${c.name} (in ${c.note})`}
                </option>
              ))}
            </Select>
          </label>
          <label className="fb-chart-field fb-chart-field-wide">
            <span>Group by</span>
            <Select value={group} onChange={(e) => setGroupBy(e.target.value)} aria-label="Group by">
              <option value={TITLE_FIELD}>Each row (by name)</option>
              {groupable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="fb-chart-field fb-chart-field-wide">
            <span>Show</span>
            <Select value={usable ? measure : "count:"} onChange={(e) => setMeasure(e.target.value)} aria-label="Show">
              <option value="count:">Number of rows</option>
              {numbers.flatMap((p) => [
                <option key={`s${p.id}`} value={`sum:${p.id}`}>{`Total ${p.name}`}</option>,
                <option key={`a${p.id}`} value={`average:${p.id}`}>{`Average ${p.name}`}</option>,
              ])}
            </Select>
          </label>
        </div>
      )}
      <div className="fb-chart-ai-buttons">
        <button
          type="button"
          className="ui-btn ui-btn-primary h-8 px-3 text-callout pointer-coarse:h-11"
          disabled={!data || !picked}
          onClick={() => {
            if (!data) return;
            const agg: ChartAggregate = usable ? aggregate : "count";
            const src: ChartSource = agg === "count" ? { type: "collection", collectionId: picked, groupBy: group, aggregate: "count" } : { type: "collection", collectionId: picked, groupBy: group, aggregate: agg, field };
            onSource(src, aggregateCollection(data, group, agg, agg === "count" ? undefined : field));
          }}
        >
          Chart this collection
        </button>
        <button type="button" className="ui-btn ui-btn-ghost h-8 px-3 text-callout pointer-coarse:h-11" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}
