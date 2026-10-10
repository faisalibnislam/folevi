"use client";

import { useId, useMemo, useState } from "react";
import { AlertCircle, Check, ChevronDown, FileText, Folder, Loader2, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { aiDiff, blocksPlain } from "../aiDiff";
import { AiDiffLegend, AiDiffView } from "../AiDiffView";
import type { ChatMessageData } from "./ChatMessage";

/** An agent run on its answer (convex/lib/ai/tools/wire.ts): proposed changes, then what became of them. */
export type AgentRun = NonNullable<NonNullable<ChatMessageData["agent"]>["run"]>;
export type AgentOperation = AgentRun["operations"][number];

/** What the person is doing with a run right now (an action on its way), and the last thing that failed. */
export interface RunActivity {
  busy: "approving" | "undoing" | "discarding" | null;
  error: string | null;
}

const DONE: Record<string, string> = { done: "Done", partial: "Partly done", failed: "Not done", undone: "Undone", undoing: "Undoing", executing: "Applying changes", discarded: "Not applied" };

/** Where a change's result opens: the note, or the folder it made. */
export function resultHref(op: AgentOperation): string | null {
  if (op.kind === "create_folder") return op.result?.folderId ? `/folders/${op.result.folderId}` : null;
  return op.result?.noteId ? `/d/${op.result.noteId}` : op.noteId ? `/d/${op.noteId}` : null;
}

/** The before and after of one change, for its preview. */
function Details({ op, id }: { op: AgentOperation; id: string }) {
  const body = (() => {
    switch (op.kind) {
      case "update_note":
        return (
          <ol className="space-y-2.5">
            {op.edits.map((e, i) => {
              const label = e.action === "replace" ? "Changed" : e.action === "insert" ? "Added" : "Removed";
              return (
                <li key={i}>
                  <p className="mb-0.5 text-[11.5px] font-medium text-muted">{label}</p>
                  <AiDiffView parts={e.action === "delete" ? [{ kind: "removed", text: e.before }] : e.action === "insert" ? [{ kind: "added", text: blocksPlain(e.after) }] : aiDiff(e.before, e.after).parts} />
                </li>
              );
            })}
          </ol>
        );
      case "rename_note":
        return <AiDiffView parts={[{ kind: "removed", text: op.fromTitle ?? "" }, { kind: "same", text: " " }, { kind: "added", text: op.title ?? "" }]} />;
      case "move_note":
        return (
          <p className="text-[13px] text-ink">
            From {op.fromFolderName ? <strong className="font-semibold text-heading">{op.fromFolderName}</strong> : "no folder"} to {op.movesOut ? "no folder" : <strong className="font-semibold text-heading">{op.folderName}</strong>}
          </p>
        );
      case "create_folder":
        return <p className="text-[13px] text-ink">An empty folder, ready for notes.</p>;
      case "add_tags":
        return <p className="text-[13px] text-ink">{op.tags.map((t) => `#${t}`).join("  ")}</p>;
      case "create_checklist":
      case "create_tasks":
        return (
          <ul className="space-y-1 text-[13px] text-ink">
            {op.items.map((it, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden className="mt-[3px] h-3 w-3 flex-none rounded-[4px] shadow-[inset_0_0_0_1.5px_currentColor] opacity-50" />
                <span>
                  {it.text}
                  {it.dueDate ? <span className="text-muted"> · due {it.dueDate}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        );
      case "merge_notes":
        return (
          <p className="text-[13px] text-ink">
            Adds {op.sources.map((s) => `“${s.title}”`).join(", ")} to the end of “{op.noteTitle}”, then moves {op.sources.length === 1 ? "it" : "them"} to Trash.
          </p>
        );
      default:
        // A new note or text added at the end: what it will say.
        return op.markdown ? <AiDiffView parts={[{ kind: "added", text: blocksPlain(op.markdown) }]} /> : null;
    }
  })();
  return (
    <div id={id} className="mt-2 max-h-[280px] overflow-y-auto rounded-[10px] bg-[var(--glass-hover)] px-3 py-2.5">
      {body}
      {op.kind === "update_note" || op.kind === "rename_note" ? <AiDiffLegend /> : null}
    </div>
  );
}

/** One proposed change: its checkbox, its line, and its details on demand. */
function ProposedRow({ op, checked, onToggle, disabled }: { op: AgentOperation; checked: boolean; onToggle: (next: boolean) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  return (
    <li className="py-1.5">
      <div className="flex items-start gap-2">
        <Checkbox checked={checked} onChange={onToggle} disabled={disabled} className="flex-1 text-[13px] text-ink">
          {op.summary}
        </Checkbox>
        <button type="button" aria-expanded={open} aria-controls={open ? detailsId : undefined} onClick={() => setOpen(!open)} className="inline-flex h-6 flex-none items-center gap-0.5 rounded-[6px] px-1.5 text-[12px] text-muted hover:bg-[var(--glass-active)] hover:text-heading">
          {open ? "Hide" : "Preview"}
          <ChevronDown size={12} aria-hidden className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>
      {open ? <Details op={op} id={detailsId} /> : null}
    </li>
  );
}

/** One change after the run: what happened, with a link to what it made or changed. */
function ResultRow({ op, onOpen, undone }: { op: AgentOperation; onOpen: (href: string) => void; undone: boolean }) {
  const href = resultHref(op);
  const icon =
    op.status === "applied" ? (
      <Check size={14} aria-hidden className="text-muted" />
    ) : op.status === "failed" ? (
      <AlertCircle size={14} aria-hidden className="text-danger" />
    ) : op.status === "proposed" ? (
      <Loader2 size={14} aria-hidden className="animate-spin text-muted motion-reduce:animate-none" />
    ) : (
      <X size={14} aria-hidden className="text-faint" />
    );
  const state = op.status === "applied" ? (undone ? (op.undone === "kept" ? "Left as it was" : "Undone") : op.verified === false ? "Done, but it didn't check out" : "Done") : op.status === "failed" ? "Couldn't be done" : op.status === "skipped" ? "Skipped" : "Waiting";
  return (
    <li className="flex items-start gap-2 py-1">
      <span className="mt-0.5 flex-none">{icon}</span>
      <span className="min-w-0 flex-1 text-[13px]">
        <span className={op.status === "skipped" ? "text-muted" : "text-ink"}>{op.summary}</span>
        <span className="sr-only">: {state}</span>
        {op.error ? <span className="block text-[12.5px] text-danger">{op.error}</span> : null}
        {undone && op.status === "applied" && op.undone === "kept" ? <span className="block text-[12px] text-muted">Left as it was.</span> : null}
        {op.status === "applied" && href && !undone ? (
          <button type="button" onClick={() => onOpen(href)} className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-[6px] bg-[var(--glass-active)] px-2.5 py-0.5 text-[12px] text-ink hover:text-heading">
            {op.kind === "create_folder" ? <Folder size={12} aria-hidden className="flex-none text-muted" /> : <FileText size={12} aria-hidden className="flex-none text-muted" />}
            <span className="truncate">Open {op.kind === "create_folder" ? (op.result?.title ?? op.folderName ?? "folder") : (op.result?.title ?? op.noteTitle ?? "note")}</span>
          </button>
        ) : null}
      </span>
    </li>
  );
}

/**
 * An agent's proposed changes on its answer: each one to check (with a preview of what it would do), then
 * Approve selected or Discard. While they run, each change's progress; after, what happened with links
 * to the notes, and one Undo for the lot. When Undo finds notes changed since, it asks before going on.
 * `readOnly` (a conversation someone shared) lists the changes and what happened, with nothing to act on.
 */
export function AgentRunCard({
  run,
  activity,
  onApprove,
  onDiscard,
  onUndo,
  onOpen,
  readOnly = false,
}: {
  run: AgentRun;
  activity: RunActivity;
  onApprove: (operationIds: string[]) => void;
  onDiscard: () => void;
  onUndo: (changed?: "all" | "rest") => void;
  onOpen: (href: string) => void;
  readOnly?: boolean;
}) {
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(run.operations.map((o) => o.id)));
  const [askDismissed, setAskDismissed] = useState(false);
  const headingId = useId();
  const busy = activity.busy !== null;
  const preview = run.status === "preview";
  const applied = run.operations.filter((o) => o.status === "applied").length;
  const failed = run.operations.filter((o) => o.status === "failed").length;
  const pending = run.operations.filter((o) => o.status === "proposed").length;
  const picked = useMemo(() => run.operations.filter((o) => chosen.has(o.id)).map((o) => o.id), [chosen, run.operations]);
  const all = picked.length === run.operations.length;
  const changed = run.changed && !askDismissed && run.status !== "undone" ? run.changed : null;

  const toggle = (id: string, on: boolean) =>
    setChosen((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <section aria-labelledby={headingId} className="mt-3 rounded-[14px] bg-[var(--glass-hover)] p-3 shadow-[inset_0_0_0_1px_var(--glass-border)]">
      <div className="mb-1.5 flex items-center gap-2">
        <h3 id={headingId} className="ui-caps">
          {preview ? "Proposed changes" : (DONE[run.status] ?? "Changes")}
        </h3>
        {preview && !readOnly && run.operations.length > 1 ? (
          <button type="button" disabled={busy} onClick={() => setChosen(all ? new Set() : new Set(run.operations.map((o) => o.id)))} className="ml-auto text-[12px] text-muted hover:text-heading disabled:opacity-40">
            {all ? "Select none" : "Select all"}
          </button>
        ) : null}
      </div>

      {preview && readOnly ? (
        <>
          <p className="mb-1 text-[12.5px] text-muted">Proposed, not approved yet.</p>
          <ul className="list-disc space-y-0.5 pl-4 text-[13px] text-ink">
            {run.operations.map((o) => (
              <li key={o.id}>{o.summary}</li>
            ))}
          </ul>
        </>
      ) : preview ? (
        <>
          <p className="mb-1 text-[12.5px] text-muted">Nothing changes until you approve. A version of each note is saved first, and you can undo it all.</p>
          <ul className="divide-y divide-line/60">
            {run.operations.map((o) => (
              <ProposedRow key={o.id} op={o} checked={chosen.has(o.id)} onToggle={(on) => toggle(o.id, on)} disabled={busy} />
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" size="sm" disabled={busy || !picked.length} onClick={() => onApprove(picked)}>
              {activity.busy === "approving" ? <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Check size={14} aria-hidden />}
              {activity.busy === "approving" ? "Applying…" : all ? "Approve all" : `Approve selected (${picked.length})`}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={onDiscard}>
              Discard
            </Button>
          </div>
        </>
      ) : run.status === "discarded" ? (
        <p className="text-[12.5px] text-muted">Nothing was changed.</p>
      ) : (
        <>
          {run.status === "executing" || run.status === "undoing" ? (
            <p role="status" className="mb-1 flex items-center gap-2 text-[12.5px] text-muted">
              <Loader2 size={13} className="animate-spin motion-reduce:animate-none" aria-hidden />
              {run.status === "undoing" ? "Undoing…" : `Applying ${Math.min(applied + failed + 1, applied + failed + pending)} of ${applied + failed + pending}…`}
            </p>
          ) : run.status === "undone" ? (
            <p className="mb-1 text-[12.5px] text-muted">Everything Foli changed was put back. The notes&apos; versions before the undo are in their version history.</p>
          ) : (
            <p className="mb-1 text-[12.5px] text-muted">
              {applied ? `${applied} change${applied === 1 ? "" : "s"} made` : "No changes made"}
              {failed ? `, ${failed} couldn't be made` : ""}.
            </p>
          )}
          <ul>
            {run.operations.map((o) => (
              <ResultRow key={o.id} op={o} onOpen={onOpen} undone={run.status === "undone"} />
            ))}
          </ul>
          {readOnly ? null : changed ? (
            <div role="alert" className="mt-3 rounded-[10px] bg-[var(--glass-active)] p-2.5 text-[12.5px] text-ink">
              <p className="font-medium text-heading">Some of this changed after the AI&apos;s edits:</p>
              <ul className="mt-1 list-disc pl-4">
                {changed.map((c) => (
                  <li key={c.key}>{c.label}</li>
                ))}
              </ul>
              <p className="mt-1 text-muted">Undo anyway puts them back as they were before Foli (the later edits stay in version history).</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button variant="primary" size="sm" disabled={busy} onClick={() => onUndo("all")}>
                  Undo anyway
                </Button>
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => onUndo("rest")}>
                  Undo the rest
                </Button>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => setAskDismissed(true)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (run.status === "done" || run.status === "partial") && applied ? (
            <div className="mt-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setAskDismissed(false);
                  onUndo();
                }}
              >
                {activity.busy === "undoing" ? <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <RotateCcw size={14} aria-hidden />}
                {activity.busy === "undoing" ? "Undoing…" : "Undo"}
              </Button>
            </div>
          ) : null}
        </>
      )}
      {activity.error ? (
        <p role="alert" className="mt-2 text-[12.5px] text-danger">
          {activity.error}
        </p>
      ) : null}
    </section>
  );
}
