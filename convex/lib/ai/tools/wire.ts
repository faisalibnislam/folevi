// An agent run as the chat shows it (aiChat.get puts it on its answer): the proposed changes with what
// the preview needs (before and after), their state while executing, the report and Undo.
import type { Doc } from "../../../_generated/dataModel";

/** Markdown shown per operation in the preview (the whole of it is still what's applied). */
const PREVIEW_CHARS = 6_000;

export function wireRun(run: Doc<"aiRuns">) {
  return {
    id: run.publicId,
    status: run.status,
    executedAt: run.executedAt ?? null,
    undoneAt: run.undoneAt ?? null,
    changed: run.changed ?? null,
    operations: run.operations.map((o) => ({
      id: o.id,
      kind: o.kind,
      summary: o.summary,
      status: o.status,
      error: o.error ?? null,
      noteId: o.noteId ?? null,
      noteTitle: o.noteTitle ?? null,
      title: o.title ?? null,
      fromTitle: o.fromTitle ?? null,
      folderName: o.folderName ?? null,
      fromFolderName: o.fromFolderName ?? null,
      movesOut: o.kind === "move_note" && o.folderId === null,
      markdown: o.markdown !== undefined ? o.markdown.slice(0, PREVIEW_CHARS) : null,
      edits: (o.edits ?? []).map((e) => ({ action: e.action, before: e.before ?? "", after: e.markdown ?? "" })),
      items: o.items ?? [],
      tags: o.tags ?? [],
      sources: o.sources ?? [],
      result: o.result ? { noteId: o.result.noteId ?? null, folderId: o.result.folderId ?? null, title: o.result.title ?? null } : null,
      verified: o.verified ?? null,
      undone: o.undone ?? null,
    })),
  };
}

export type WireRun = ReturnType<typeof wireRun>;
