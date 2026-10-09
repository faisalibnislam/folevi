"use client";

import type { FunctionReturnType } from "convex/server";
import { Check, FilePlus2, FileText, Loader2, Minus, X } from "lucide-react";
import type { api } from "@/lib/convex/api";

export type ResearchJob = FunctionReturnType<typeof api.aiResearch.forConversation>[number];

/** What a research job's card needs to act on it. */
export interface ResearchHandlers {
  job: ResearchJob;
  /** Saving the report as a note, or why that failed. */
  saving: "saving" | { error: string } | null;
  onCancel: () => void;
  onSave: () => void;
}

const BUTTON = "inline-flex h-7 items-center gap-1 rounded-[6px] px-1.5 text-[12px] text-muted transition-colors hover:bg-[var(--glass-hover)] hover:text-heading disabled:opacity-40";

function StepIcon({ status }: { status: ResearchJob["steps"][number]["status"] }) {
  if (status === "running") return <Loader2 size={13} className="animate-spin motion-reduce:animate-none" aria-hidden />;
  if (status === "done") return <Check size={13} aria-hidden />;
  if (status === "failed") return <X size={13} aria-hidden />;
  return <Minus size={13} aria-hidden />;
}

const STATUS_WORDS: Record<ResearchJob["steps"][number]["status"], string> = { running: "in progress", done: "done", failed: "didn't work", skipped: "skipped" };

/** A job's steps, as they happen. */
export function ResearchSteps({ job }: { job: ResearchJob }) {
  if (!job.steps.length) return null;
  return (
    <ol aria-label={job.status === "running" ? "Research in progress" : "Research steps"} className="space-y-1">
      {job.steps.map((s, i) => (
        <li key={`${i}-${s.kind}`} className={`flex items-start gap-2 text-[12.5px] ${s.status === "running" ? "text-ink" : "text-muted"}`}>
          <span className="mt-[2px] flex-none">
            <StepIcon status={s.status} />
          </span>
          <span className="min-w-0 break-words">
            {s.label}
            <span className="sr-only"> ({STATUS_WORDS[s.status]})</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** A research job while it runs: its steps and Cancel. */
export function ResearchProgress({ research }: { research: ResearchHandlers }) {
  const { job } = research;
  return (
    <div className="rounded-[14px] rounded-bl-[4px] bg-[var(--glass-active)] px-4 py-3 shadow-[var(--glass-edge)]">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p role="status" className="flex items-center gap-2 text-[13px] font-medium text-heading">
          <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden /> Researching…
        </p>
        <button type="button" onClick={research.onCancel} className={BUTTON}>
          <span aria-hidden className="h-2 w-2 rounded-[2px] bg-current" /> Cancel
        </button>
      </div>
      <ResearchSteps job={job} />
      <p className="mt-2 text-[11.5px] text-faint">This can take a few minutes. You can leave; the report appears here when it&apos;s ready.</p>
    </div>
  );
}

/** Under a finished report: Save as note (or Open note once saved). Cancelled jobs say so. */
export function ResearchFooter({ research, onOpen }: { research: ResearchHandlers; onOpen: (href: string) => void }) {
  const { job, saving } = research;
  if (job.status === "cancelled") return <span className="px-1.5 text-[12px] text-faint">Research cancelled</span>;
  if (job.status !== "done") return null;
  return (
    <>
      {job.noteId ? (
        <button type="button" onClick={() => onOpen(`/d/${encodeURIComponent(job.noteId!)}`)} className={BUTTON}>
          <FileText size={12} aria-hidden /> Open note
        </button>
      ) : (
        <button type="button" disabled={saving === "saving"} onClick={research.onSave} className={BUTTON}>
          {saving === "saving" ? <Loader2 size={12} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <FilePlus2 size={12} aria-hidden />}
          Save as note
        </button>
      )}
      {saving && saving !== "saving" ? (
        <span role="alert" className="px-1.5 text-[12px] text-danger">
          {saving.error}
        </span>
      ) : null}
    </>
  );
}
