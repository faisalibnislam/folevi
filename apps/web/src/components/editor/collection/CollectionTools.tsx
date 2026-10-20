"use client";

// A collection view's summary row (sum, average, count... under each column, saved with the view, like a
// spreadsheet's totals) and its Export menu (CSV and Markdown of what the view shows, formula results
// included). Both work from the rows this device already has.
import { useConvex } from "convex/react";
import { Download } from "lucide-react";
import { MenuButton, type MenuEntry } from "@/components/ui/Menu";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/convex/api";
import { saveFile } from "@/components/editor/canvas/exportImage";
import { TITLE_ID, exportTable, summarize, summaryFns, summaryLabel, toCsv, toMarkdownTable, type FilterTarget, type SummaryFn, type ViewProperty, type ViewRow, type ViewSummary } from "@/components/views/collectionView";

/** One cell of the summary row: its value, and for editors a menu to choose what it shows. */
function SummaryCell({ target, rows, summary, canEdit, onChange }: { target: { id: string; name: string; type: FilterTarget["type"]; numberFormat?: ViewProperty["numberFormat"] }; rows: readonly ViewRow[]; summary: SummaryFn | undefined; canEdit: boolean; onChange: (fn: SummaryFn | null) => void }) {
  const value = summary ? summarize(rows, target, summary) : "";
  const shown = summary ? (
    <span className="inline-flex min-w-0 items-baseline gap-1.5">
      <span className="ui-caps">{summaryLabel(target.type, summary)}</span>
      <span className="truncate tabular-nums text-ink">{value || "-"}</span>
    </span>
  ) : (
    <span className="text-faint opacity-0 transition-opacity group-hover/summary:opacity-100 group-focus-within/summary:opacity-100 pointer-coarse:opacity-100">Calculate</span>
  );
  if (!canEdit) return summary ? shown : null;
  const items: MenuEntry[] = [
    { label: "None", checked: !summary, onSelect: () => onChange(null) },
    "separator",
    ...summaryFns(target.type).map((fn) => ({ label: summaryLabel(target.type, fn), checked: summary === fn, onSelect: () => onChange(fn) })),
  ];
  return (
    <MenuButton
      label={`Summary for ${target.name}`}
      align="start"
      side="top"
      trigger={shown}
      items={items}
      triggerClassName="flex h-7 w-full min-w-0 items-center rounded-chip px-1 text-left text-xs hover:bg-surface pointer-coarse:h-11"
    />
  );
}

/**
 * The summary row under a table view: the title column, then each visible property. Shown when the view has a
 * summary or the person can add one.
 */
export function SummaryRow({
  rows,
  visible,
  summaries,
  canEdit,
  onChange,
}: {
  rows: readonly ViewRow[];
  visible: readonly ViewProperty[];
  summaries: readonly ViewSummary[] | undefined;
  canEdit: boolean;
  onChange: (next: ViewSummary[]) => void;
}) {
  const list = summaries ?? [];
  if (!canEdit && !list.length) return null;
  const fnOf = (id: string) => list.find((s) => s.propertyId === id)?.fn;
  const set = (id: string, fn: SummaryFn | null) => onChange([...list.filter((s) => s.propertyId !== id), ...(fn ? [{ propertyId: id, fn }] : [])]);
  const targets = [{ id: TITLE_ID, name: "Name", type: "title" as const }, ...visible.map((p) => ({ id: p.id, name: p.name, type: p.type, numberFormat: p.numberFormat }))];
  return (
    <tfoot>
      <tr className="group/summary text-xs text-muted" aria-label="Summaries">
        {targets.map((t, i) => (
          <td key={t.id} className={`px-2 py-1 ${i ? "border-l border-line" : ""}`}>
            <SummaryCell target={t} rows={rows} summary={fnOf(t.id)} canEdit={canEdit} onChange={(fn) => set(t.id, fn)} />
          </td>
        ))}
        {canEdit ? <td /> : null}
      </tr>
    </tfoot>
  );
}

const fileName = (name: string, ext: string) => `${(name.trim() || "Collection").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80)}.${ext}`;

/** Export: the view's rows (its filters and sorts, its visible properties) as CSV or Markdown. */
export function ExportMenu({ name, rows, visible, people }: { name: string; rows: readonly ViewRow[]; visible: readonly ViewProperty[]; people: readonly { id: string; name: string }[] }) {
  const convex = useConvex();
  const toast = useToast();
  /** Linked pages' titles, for relation columns (only when one is shown). */
  const titles = async (): Promise<Record<string, string>> => {
    const ids = [...new Set(visible.filter((p) => p.type === "relation").flatMap((p) => rows.flatMap((r) => (Array.isArray(r.values[p.id]) ? (r.values[p.id] as string[]) : []))))];
    if (!ids.length) return {};
    const out: Record<string, string> = {};
    for (let i = 0; i < ids.length; i += 200) {
      const got = await convex.query(api.documents.titles, { documentIds: ids.slice(i, i + 200) });
      for (const [id, t] of Object.entries(got)) out[id] = t.title || "Untitled";
    }
    return out;
  };
  const run = async (as: "csv" | "markdown", copy = false) => {
    try {
      const table = exportTable(rows, visible, { as, people, titles: await titles() });
      const text = as === "csv" ? toCsv(table) : toMarkdownTable(table);
      if (copy) {
        await navigator.clipboard.writeText(text);
        toast.show("Copied as Markdown");
        return;
      }
      // A byte order mark, so spreadsheet apps read the CSV as UTF-8.
      const blob = as === "csv" ? new Blob(["﻿", text], { type: "text/csv;charset=utf-8" }) : new Blob([text], { type: "text/markdown;charset=utf-8" });
      await saveFile(blob, fileName(name, as === "csv" ? "csv" : "md"));
    } catch {
      toast.show(copy ? "Couldn't copy. Try again." : "Couldn't export. Try again.", { tone: "error" });
    }
  };
  return (
    <MenuButton
      label="Export"
      trigger={
        <span className="inline-flex items-center gap-1">
          <Download size={13} aria-hidden /> Export
        </span>
      }
      items={[
        { label: "Download CSV", onSelect: () => void run("csv") },
        { label: "Download Markdown", onSelect: () => void run("markdown") },
        { label: "Copy as Markdown", onSelect: () => void run("markdown", true) },
      ]}
      triggerClassName="inline-flex h-7 items-center rounded-chip px-2.5 text-xs text-muted hover:bg-surface pointer-coarse:h-11"
    />
  );
}
