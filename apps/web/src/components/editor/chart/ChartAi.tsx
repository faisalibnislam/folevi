"use client";

// Foli AI in the chart's toolbar (hidden when Foli AI is off): suggest the chart type and layout, explain the
// data (takeaways under the chart), tidy and style, and make a chart from words (it finds the numbers in the
// note). Each result is shown first, then applied as one change (⌘Z undoes it). The server checks every
// reply (convex/chartAi.ts) and charges AI credits like Foli AI's other actions.
import { useAction } from "convex/react";
import { useState } from "react";
import { ArrowUp, BarChart3, Lightbulb, ListChecks, Sparkles } from "lucide-react";
import { CHART_KIND_LABEL, parseChart, type ChartData } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AiIcon } from "@/components/ai/AiIcon";
import { AiCreditsNote, AiProblemNotice, aiProblem, type AiProblem } from "@/components/ai/AiCredits";
import { Takeaway } from "./render";

export type ChartAiTask = "suggest" | "explain" | "tidy" | "title";

/** What a task changes, as the server returns it. */
export interface ChartPatch {
  kind?: ChartData["kind"];
  title?: string;
  takeaway?: string;
  columns?: string[];
  rowLabels?: string[];
  xLabel?: string;
  yLabel?: string;
  legend?: ChartData["legend"];
  sort?: ChartData["sort"];
  values?: boolean;
  horizontal?: boolean;
  colors?: ChartData["colors"];
  reason?: string;
}

/** A patch applied to the chart (row labels go into the first column; values never change). */
export function applyPatch(chart: ChartData, p: ChartPatch): ChartData {
  const next: ChartData = { ...chart };
  for (const k of ["kind", "title", "takeaway", "xLabel", "yLabel", "legend", "sort", "values", "horizontal"] as const) {
    if (p[k] !== undefined) (next as unknown as Record<string, unknown>)[k] = p[k];
  }
  if (p.colors) next.colors = { ...chart.colors, ...p.colors };
  if (p.columns && p.columns.length === chart.columns.length) next.columns = p.columns;
  if (p.rowLabels && p.rowLabels.length === chart.rows.length) next.rows = chart.rows.map((r, i) => [p.rowLabels![i]!, ...r.slice(1)]);
  return next;
}

/** The chart actions, as the signed-in person, in the current place (the note's scope decides on the server). */
export function useChartAi() {
  const { scope } = useAppState();
  const assist = useAction(api.chartAi.assist);
  const words = useAction(api.chartAi.fromWords);
  return {
    assist: (task: ChartAiTask, chart: string, documentId?: string) => assist({ scope, task, chart, documentId }) as Promise<ChartPatch>,
    fromWords: (instruction: string, documentId?: string) => words({ scope, instruction, documentId }),
  };
}

type Result = { kind: "patch"; task: ChartAiTask; patch: ChartPatch } | { kind: "chart"; data: string };

/** What a result would change, in a few words. */
function describe(r: Result, chart: ChartData): string {
  if (r.kind === "chart") {
    const c = parseChart(r.data);
    return `A ${CHART_KIND_LABEL[c.kind].toLowerCase()} chart${c.title ? `, “${c.title}”` : ""}, with ${c.rows.length} row${c.rows.length === 1 ? "" : "s"}.`;
  }
  const p = r.patch;
  if (r.task === "suggest") return p.kind && p.kind !== chart.kind ? `Show it as a ${CHART_KIND_LABEL[p.kind].toLowerCase()} chart.` : "It already suits this data; the layout can be tuned.";
  const parts = [p.title ? "the title" : "", p.columns || p.rowLabels ? "the names" : "", p.kind && p.kind !== chart.kind ? "the chart type" : "", p.colors ? "the colors" : "", p.sort || p.legend || p.values !== undefined || p.horizontal !== undefined ? "the layout" : "", p.xLabel || p.yLabel ? "the axis titles" : ""].filter(Boolean);
  return parts.length ? `Changes ${parts.join(", ").replace(/, ([^,]*)$/, " and $1")}.` : "Nothing to change.";
}

const ACTIONS: { task: Exclude<ChartAiTask, "title">; label: string; icon: React.ReactNode; busy: string }[] = [
  { task: "suggest", label: "Suggest a chart type", icon: <Lightbulb size={15} aria-hidden />, busy: "Looking at the data…" },
  { task: "explain", label: "Explain the data", icon: <ListChecks size={15} aria-hidden />, busy: "Reading the numbers…" },
  { task: "tidy", label: "Tidy and style", icon: <Sparkles size={15} aria-hidden />, busy: "Tidying the chart…" },
];

export function ChartAiPanel({ chart, data, documentId, onApply, onClose }: { chart: ChartData; data: string; documentId?: string; onApply: (next: ChartData) => void; onClose: () => void }) {
  const ai = useChartAi();
  const hasData = chart.columns.length > 0 && chart.rows.length > 0;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<AiProblem | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [text, setText] = useState("");

  const run = async (label: string, work: () => Promise<Result>) => {
    if (busy) return;
    setBusy(label);
    setError(null);
    setResult(null);
    try {
      setResult(await work());
    } catch (e) {
      setError(aiProblem(e));
    } finally {
      setBusy(null);
    }
  };
  const apply = () => {
    if (!result) return;
    if (result.kind === "chart") {
      const made = parseChart(result.data);
      onApply({ ...made, colors: chart.colors, source: null });
    } else onApply(applyPatch(chart, result.task === "explain" ? { takeaway: result.patch.takeaway } : result.patch));
    onClose();
  };

  return (
    <div className="fb-chart-panel fb-chart-ai" onKeyDown={(e) => e.stopPropagation()}>
      <p className="fb-chart-ai-head">
        <AiIcon size={15} className="flex-none" /> Foli AI
      </p>
      {hasData ? (
        <div className="fb-chart-ai-actions" role="group" aria-label="Foli AI actions">
          {ACTIONS.map((a) => (
            <button key={a.task} type="button" className="fb-chart-ai-action" disabled={Boolean(busy)} onClick={() => void run(a.busy, async () => ({ kind: "patch", task: a.task, patch: await ai.assist(a.task, data, documentId) }))}>
              {a.icon}
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
      <form
        className="fb-chart-ai-form ui-input"
        onSubmit={(e) => {
          e.preventDefault();
          const ask = text.trim();
          if (ask) void run("Finding the numbers…", async () => ({ kind: "chart", data: (await ai.fromWords(ask, documentId)).data }));
        }}
      >
        <BarChart3 size={15} className="fb-chart-ai-mark" aria-hidden />
        <textarea
          rows={2}
          value={text}
          maxLength={2000}
          disabled={Boolean(busy)}
          aria-label="Make a chart from words"
          placeholder={hasData ? "Make a new chart from words, e.g. costs by month from this note" : "Describe the chart, e.g. sign ups by month from this note"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button type="submit" className="fb-chart-ai-send" aria-label="Make the chart" disabled={Boolean(busy) || !text.trim()}>
          <ArrowUp size={15} aria-hidden />
        </button>
      </form>
      {busy ? (
        <p className="fb-chart-ai-status" role="status">
          {busy}
        </p>
      ) : error ? (
        <AiProblemNotice problem={error} className={error.kind === "other" ? "fb-chart-ai-error" : undefined} />
      ) : result ? (
        <div className="fb-chart-ai-result" role="status">
          {result.kind === "patch" && result.task === "explain" && result.patch.takeaway ? <Takeaway text={result.patch.takeaway} className="fb-chart-takeaway" /> : <p>{describe(result, chart)}</p>}
          {result.kind === "patch" && result.patch.reason ? <p className="fb-chart-ai-reason">{result.patch.reason}</p> : null}
          <div className="fb-chart-ai-buttons">
            <button type="button" className="ui-btn ui-btn-primary h-8 px-3 text-callout pointer-coarse:h-11" onClick={apply}>
              {result.kind === "patch" && result.task === "explain" ? "Use as takeaway" : result.kind === "chart" && hasData ? "Replace this chart" : "Apply"}
            </button>
            <button type="button" className="ui-btn ui-btn-ghost h-8 px-3 text-callout pointer-coarse:h-11" onClick={() => setResult(null)}>
              Discard
            </button>
          </div>
        </div>
      ) : (
        <AiCreditsNote documentId={documentId} className="mx-1 mt-1" />
      )}
      <p className="fb-chart-ai-foot">Foli AI can make mistakes. Sent to Google Gemini. Undo with ⌘Z.</p>
    </div>
  );
}
