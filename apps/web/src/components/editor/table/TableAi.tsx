"use client";

// Foli AI for a table (the block menu's Foli AI items, or the table's own Foli AI button; hidden when Foli AI
// is off): edit it with a prompt, fill and clean it, write a formula from words into a cell, or explain it.
// Changes show first as a preview in the table, the cells they change marked, then Accept applies them as
// one change (⌘Z undoes it) or Discard leaves the table as it was. The server checks every reply
// (convex/tableAi.ts) and charges AI credits like Foli AI's other actions.
import { useAction } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { ArrowUp, Check, X } from "lucide-react";
import type { Editor } from "@tiptap/core";
import { canonicalJson, cellReference, tableCellText, ulid, type InlineNode, type Mark } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AiIcon } from "@/components/ai/AiIcon";
import { AiCreditsNote, AiProblemNotice, aiProblem, type AiProblem } from "@/components/ai/AiCredits";
import { columnName } from "./TableColumnMenu";
import type { TableData } from "./tableModel";

export type TableAiMode = "edit" | "clean" | "formula" | "explain";

export interface TableAiResult {
  table: TableData;
  /** The cells (row:column of the new table) Foli AI changed. */
  changed: Set<string>;
  summary: string;
}

const MODES: { mode: TableAiMode; label: string }[] = [
  { mode: "edit", label: "Edit" },
  { mode: "clean", label: "Fill and clean" },
  { mode: "formula", label: "Formula" },
  { mode: "explain", label: "Explain" },
];

const IDEAS: Record<"edit" | "formula", string[]> = {
  edit: ["Add a column with each row's share of the total", "Sort the rows by the second column", "Translate the table into Spanish"],
  formula: ["Price times quantity", "Days from the start date until today", "Yes when the score is above 80"],
};

const firstMarks = (cell: InlineNode[] | undefined) => (cell?.find((n) => n.type === "text") as { marks?: Mark[] } | undefined)?.marks;
const textCell = (text: string, like?: InlineNode[]): InlineNode[] => {
  if (!text) return [];
  const marks = firstMarks(like);
  return [marks?.length ? { type: "text", text, marks } : { type: "text", text }];
};

/**
 * Foli AI's rows (text) as the table's rows: a row it kept unchanged keeps its formatting (found by its text,
 * so removed duplicates don't mark everything after them as changed), a changed cell takes its text with the
 * cell's first formatting.
 */
export function mergeAiRows(table: TableData, rows: string[][]): TableAiResult {
  const texts = table.rows.map((r) => r.map((c) => tableCellText(c)));
  const keyOf = (r: string[]) => canonicalJson(r);
  const used = new Set<number>();
  // Rows kept as they were, found by their text (so a removed row doesn't mark everything after it).
  const exact = rows.map((row) => {
    const i = texts.findIndex((t, k) => !used.has(k) && keyOf(t) === keyOf(row) && table.rows[k]!.length === row.length);
    if (i >= 0) used.add(i);
    return i;
  });
  const changed = new Set<string>();
  const out: InlineNode[][][] = rows.map((row, r) => {
    if (exact[r]! >= 0) return table.rows[exact[r]!]!;
    // A changed row: the unused row it shares most cells with (else the one in its place) gives the rest.
    let best = -1;
    let score = 0;
    texts.forEach((t, k) => {
      if (used.has(k)) return;
      const same = row.filter((x, c) => x && t[c] === x).length;
      if (same > score) {
        score = same;
        best = k;
      }
    });
    if (best < 0 && !used.has(r) && r < texts.length) best = r;
    if (best >= 0) used.add(best);
    const like = best >= 0 ? table.rows[best] : undefined;
    return row.map((text, c) => {
      const old = like?.[c];
      if (old && tableCellText(old) === text) return old;
      changed.add(`${r}:${c}`);
      return textCell(text, old);
    });
  });
  const width = out[0]?.length ?? 1;
  const keepsTotals = table.totalsRow && out.length >= 2 && keyOf(rows[rows.length - 1]!) === keyOf(texts[texts.length - 1]!);
  const result: TableData = {
    ...table,
    rows: out,
    totalsRow: table.totalsRow && (keepsTotals || out.length >= 2),
    columns: table.columns.slice(0, width),
    view: table.view,
  };
  return { table: result, changed, summary: "" };
}

/** A table's cells as text (formulas as written), for Foli AI. */
const plainRows = (t: TableData) => t.rows.map((r) => r.map((c) => tableCellText(c).slice(0, 1000)));

export function TableAi({
  mode,
  table,
  names,
  activeCell,
  editor,
  getPos,
  preview,
  onPreview,
  onAccept,
  onClose,
  onMode,
}: {
  mode: TableAiMode;
  table: TableData;
  names: string[];
  activeCell: { r: number; c: number } | null;
  editor: Editor;
  getPos: () => number | undefined;
  preview: TableAiResult | null;
  onPreview: (r: TableAiResult | null) => void;
  onAccept: (r: TableAiResult) => void;
  onClose: () => void;
  onMode: (m: TableAiMode) => void;
}) {
  const { scope } = useAppState();
  const documentId = (editor.view.dom as HTMLElement).closest("[data-fb-root]")?.getAttribute("data-fb-root") ?? undefined;
  const editAction = useAction(api.tableAi.edit);
  const cleanAction = useAction(api.tableAi.clean);
  const formulaAction = useAction(api.tableAi.formula);
  const explainAction = useAction(api.tableAi.explain);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AiProblem | null>(null);
  const [explained, setExplained] = useState<{ summary: string; points: string[] } | null>(null);
  // The formula's cell: the one being edited, else the first empty cell of the last column's data.
  const [target, setTarget] = useState<{ r: number; c: number } | null>(activeCell);
  const cell = useMemo(() => {
    if (activeCell) return activeCell;
    if (target) return target;
    const c = (table.rows[0]?.length ?? 1) - 1;
    const first = table.headerRow ? 1 : 0;
    const r = table.rows.findIndex((row, i) => i >= first && !tableCellText(row[c] ?? []).trim());
    return { r: r >= 0 ? r : first, c };
  }, [activeCell, target, table]);
  useEffect(() => {
    if (activeCell) setTarget(activeCell);
  }, [activeCell]);

  const send = { scope, documentId, table: { rows: plainRows(table), headerRow: table.headerRow, totalsRow: table.totalsRow } };

  const run = async () => {
    if (busy) return;
    if ((mode === "edit" || mode === "formula") && !text.trim()) return;
    setBusy(true);
    setError(null);
    setExplained(null);
    onPreview(null);
    try {
      if (mode === "edit" || mode === "clean") {
        const reply = mode === "edit" ? await editAction({ ...send, instruction: text.trim() }) : await cleanAction(send);
        const merged = mergeAiRows(table, reply.rows);
        onPreview({ ...merged, summary: merged.changed.size || reply.rows.length !== table.rows.length ? reply.summary || "Foli AI changed the table." : "Foli AI didn't find anything to change." });
      } else if (mode === "formula") {
        const reply = await formulaAction({ ...send, instruction: text.trim(), row: cell.r, column: cell.c });
        const rows = table.rows.map((row, r) => (r === cell.r ? row.map((old, c) => (c === cell.c ? textCell(reply.formula, old) : old)) : row));
        onPreview({ table: { ...table, rows }, changed: new Set([`${cell.r}:${cell.c}`]), summary: `${reply.formula}${reply.explanation ? ` · ${reply.explanation}` : ""}` });
      } else {
        setExplained(await explainAction(send));
      }
    } catch (e) {
      setError(aiProblem(e));
    } finally {
      setBusy(false);
    }
  };

  // The explanation as text under the table (a paragraph and a bulleted list), one undo step.
  const insertBelow = () => {
    if (!explained) return;
    const pos = getPos();
    const node = typeof pos === "number" ? editor.state.doc.nodeAt(pos) : null;
    if (!node || typeof pos !== "number") return;
    const depth = Number(node.attrs.depth ?? 0);
    const content = [
      ...(explained.summary ? [{ type: "paragraph", attrs: { id: ulid(), depth }, content: [{ type: "text", text: explained.summary }] }] : []),
      ...explained.points.map((p) => ({ type: "bulleted", attrs: { id: ulid(), depth }, content: [{ type: "text", text: p }] })),
    ];
    editor.chain().insertContentAt(pos + node.nodeSize, content).run();
    onClose();
  };

  const placeholder = mode === "edit" ? "How should the table change?" : mode === "formula" ? `What should ${cellReference(cell.r, cell.c)} work out?` : "";
  const ideas = mode === "edit" || mode === "formula" ? IDEAS[mode] : [];
  const needsText = mode === "edit" || mode === "formula";

  return (
    <div
      className="fb-table-ai ui-pop"
      role="dialog"
      aria-label="Foli AI for this table"
      contentEditable={false}
      data-cell-tools=""
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="fb-table-ai-head">
        <AiIcon size={15} className="flex-none text-[#7c6cf0]" />
        <div className="flex flex-1 flex-wrap gap-1" role="tablist" aria-label="What Foli AI should do">
          {MODES.map((m) => (
            <button
              key={m.mode}
              type="button"
              role="tab"
              aria-selected={mode === m.mode}
              disabled={busy || Boolean(preview)}
              onClick={() => {
                setError(null);
                setExplained(null);
                onMode(m.mode);
              }}
              className={`rounded-chip px-2.5 py-1 text-subheadline ${mode === m.mode ? "bg-accent-soft font-semibold text-heading" : "text-muted hover:bg-accent-soft/70 hover:text-heading"} disabled:opacity-50`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <button type="button" className="grid h-7 w-7 place-items-center rounded-chip text-muted hover:bg-accent-soft hover:text-heading" aria-label="Close Foli AI" title="Close (Esc)" onClick={onClose}>
          <X size={15} aria-hidden />
        </button>
      </div>
      {preview ? (
        <div className="fb-table-ai-body">
          <p className="text-subheadline text-ink" role="status">
            {preview.summary}
            {preview.changed.size ? <span className="text-muted"> {preview.changed.size === 1 ? "1 cell changes" : `${preview.changed.size} cells change`}, marked in the table.</span> : null}
          </p>
          <div className="mt-2 flex gap-1.5">
            <button type="button" className="ui-btn ui-btn-primary h-8 px-3.5 text-callout" onClick={() => onAccept(preview)}>
              <Check size={14} aria-hidden /> Accept
            </button>
            <button type="button" className="ui-btn ui-btn-quiet h-8 px-3.5 text-callout" onClick={() => onPreview(null)}>
              Discard
            </button>
          </div>
        </div>
      ) : explained ? (
        <div className="fb-table-ai-body">
          {explained.summary ? <p className="text-subheadline text-ink">{explained.summary}</p> : null}
          {explained.points.length ? (
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-subheadline text-ink">
              {explained.points.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          ) : null}
          <div className="mt-2 flex gap-1.5">
            <button type="button" className="ui-btn ui-btn-primary h-8 px-3.5 text-callout" onClick={insertBelow}>
              Insert under the table
            </button>
            <button type="button" className="ui-btn ui-btn-quiet h-8 px-3.5 text-callout" onClick={() => setExplained(null)}>
              Discard
            </button>
          </div>
        </div>
      ) : (
        <form
          className="fb-table-ai-body"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          {mode === "formula" ? (
            <p className="mb-1.5 text-footnote text-muted">
              For cell <strong className="font-semibold text-ink">{cellReference(cell.r, cell.c)}</strong> ({columnName(names[cell.c] ?? "", cell.c)}). Click another cell to change it.
            </p>
          ) : null}
          {needsText ? (
            <div className="flex items-end gap-1.5">
              <textarea
                autoFocus
                rows={2}
                value={text}
                disabled={busy}
                maxLength={2000}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void run();
                  }
                }}
                aria-label={placeholder}
                placeholder={placeholder}
                className="ui-input min-h-[3.25rem] flex-1 resize-none rounded-chip px-3 py-2 text-callout"
              />
              <button type="submit" className="ui-btn ui-btn-primary grid h-9 w-9 place-items-center p-0" aria-label="Ask Foli AI" disabled={busy || !text.trim()}>
                <ArrowUp size={15} aria-hidden />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <p className="flex-1 text-subheadline text-muted">{mode === "clean" ? "Fills empty cells the table makes clear, fixes typos and formats, and removes repeated rows." : "A short summary of what the table says, with its main takeaways."}</p>
              <button type="submit" autoFocus className="ui-btn ui-btn-primary h-8 px-3.5 text-callout" disabled={busy}>
                {mode === "clean" ? "Clean up" : "Explain"}
              </button>
            </div>
          )}
          {busy ? (
            <p className="mt-2 text-footnote text-muted" role="status">
              Foli AI is working on the table…
            </p>
          ) : error ? (
            <AiProblemNotice problem={error} className="mt-2" />
          ) : (
            <>
              {ideas.length ? (
                <ul className="mt-2 flex flex-wrap gap-1" aria-label="Ideas">
                  {ideas.map((idea) => (
                    <li key={idea}>
                      <button type="button" className="rounded-chip bg-sunken/80 px-2 py-1 text-footnote text-ink hover:bg-accent-soft" onClick={() => setText(idea)}>
                        {idea}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <AiCreditsNote documentId={documentId} className="mt-2" />
            </>
          )}
          <p className="mt-1.5 text-footnote text-faint">Foli AI can make mistakes. You see every change before it's made.</p>
        </form>
      )}
    </div>
  );
}
