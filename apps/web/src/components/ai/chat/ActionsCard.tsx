"use client";

import { ArrowRight, Check, FileText, Folder, FolderPlus, Loader2 } from "lucide-react";

/** A change Ask AI proposes (convex/lib/aiActions.ts); nothing happens until the person applies it. */
export type AiAction =
  | { type: "createFolder"; name: string }
  | { type: "createNote"; title: string; markdown: string; folderId?: string; folderName?: string }
  | { type: "moveNote"; noteId: string; noteTitle: string; folderId?: string; folderName?: string };

export interface Applied {
  folders: { id: string; name: string }[];
  notes: { id: string; title: string }[];
  moved: number;
}

/** "applying", the result, "dismissed", or an error message. */
export type ActionsOutcome = "applying" | "dismissed" | Applied | { error: string } | undefined;

/** The changes Ask AI proposes, to check and apply (or not). After applying, links to what was made. */
export function ActionsCard({ actions, outcome, onApply, onDismiss, onOpen }: { actions: AiAction[]; outcome: ActionsOutcome; onApply: () => void; onDismiss: () => void; onOpen: (href: string) => void }) {
  const where = (a: { folderId?: string; folderName?: string }) => (a.folderName ? ` in ${a.folderName}` : "");
  const applied = outcome && typeof outcome === "object" && "notes" in outcome ? outcome : null;
  return (
    <div className="mt-3 rounded-[12px] bg-[var(--glass-hover)] p-3 shadow-[inset_0_0_0_1px_var(--glass-border)]">
      <p className="ui-caps mb-2">{applied ? "Done" : "Changes to make"}</p>
      <ul className="space-y-1.5 text-[13px] text-ink">
        {actions.map((a, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-0.5 flex-none text-muted" aria-hidden>
              {applied ? <Check size={14} /> : a.type === "createFolder" ? <FolderPlus size={14} /> : a.type === "createNote" ? <FileText size={14} /> : <ArrowRight size={14} />}
            </span>
            <span className="min-w-0">
              {a.type === "createFolder" ? (
                <>
                  New folder <strong className="font-semibold text-heading">{a.name}</strong>
                </>
              ) : a.type === "createNote" ? (
                <>
                  New note <strong className="font-semibold text-heading">{a.title}</strong>
                  {where(a)}
                </>
              ) : (
                <>
                  Move <strong className="font-semibold text-heading">{a.noteTitle}</strong> to {a.folderName ?? "the folder"}
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
      {applied ? (
        applied.notes.length || applied.folders.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {applied.folders.map((f) => (
              <button key={f.id} type="button" onClick={() => onOpen(`/folders/${f.id}`)} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-[var(--glass-active)] px-2.5 py-1 text-[12.5px] text-ink hover:text-heading">
                <Folder size={12} aria-hidden className="flex-none text-muted" />
                <span className="truncate">{f.name}</span>
              </button>
            ))}
            {applied.notes.map((n) => (
              <button key={n.id} type="button" onClick={() => onOpen(`/d/${n.id}`)} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-[var(--glass-active)] px-2.5 py-1 text-[12.5px] text-ink hover:text-heading">
                <FileText size={12} aria-hidden className="flex-none text-muted" />
                <span className="truncate">{n.title}</span>
              </button>
            ))}
          </div>
        ) : null
      ) : outcome === "dismissed" ? (
        <p className="mt-2 text-[12.5px] text-muted">Not applied.</p>
      ) : (
        <>
          {outcome && typeof outcome === "object" && "error" in outcome ? (
            <p role="alert" className="mt-2 text-[12.5px] text-danger">
              {outcome.error}
            </p>
          ) : null}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={onApply} disabled={outcome === "applying"} className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-heading px-3 text-[13px] font-medium text-canvas disabled:opacity-60">
              {outcome === "applying" ? <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Check size={14} aria-hidden />}
              {outcome === "applying" ? "Applying…" : "Apply changes"}
            </button>
            <button type="button" onClick={onDismiss} disabled={outcome === "applying"} className="h-8 rounded-[8px] px-3 text-[13px] text-muted hover:bg-[var(--glass-active)] hover:text-heading">
              Not now
            </button>
          </div>
        </>
      )}
    </div>
  );
}
