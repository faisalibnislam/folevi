"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useMemo, useState } from "react";
import { Check, ExternalLink, RotateCcw } from "lucide-react";
import { api } from "@/lib/convex/api";
import { AppLink, useAppRouter } from "@/lib/app/router";
import { ViewChrome } from "@/components/app/Shell";
import { formatRelative } from "@/lib/format";
import { diffVersions, type BlockChange } from "@/lib/history/diff";
import { changeCounts, whoChanged } from "@/lib/history/changeWords";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { ReadOnlyBlocks, type ChangePerson } from "@/components/doc/ReadOnlyBlocks";
import "@/components/editor/editor.css";

type ChangeList = FunctionReturnType<typeof api.changes.list>;
type NoteChanges = ChangeList["notes"][number];
type People = Record<string, ChangePerson & { key?: string }>;

/**
 * Changes: what other people, connected apps and Foli AI changed in notes you've opened since you last looked,
 * one card per note with what changed in it (from version history's diff). Open it, mark it seen, or undo it.
 */
export function ChangesView() {
  const data = useQuery(api.changes.list, {});
  const markSeen = useMutation(api.changes.markSeen);
  const toast = useToast();
  const notes = data?.notes ?? [];
  return (
    <ViewChrome
      title={<h1 className="text-sm font-semibold">Changes</h1>}
      subtitle={data === undefined ? undefined : notes.length ? `${notes.length} ${notes.length === 1 ? "note" : "notes"} changed since you last looked` : "Nothing new"}
      tabTitle="Changes"
    >
      <div className="mx-auto max-w-3xl px-4 pb-24 pt-6 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-xl text-sm text-muted">Edits other people, connected apps and Foli AI made to notes you’ve opened, since you last looked at each one.</p>
          {notes.length > 1 ? (
            <Button size="sm" onClick={() => void markSeen({ documentIds: notes.map((n) => n.id) }).catch((e) => toast.show(errorMessage(e), { tone: "error" }))}>
              <Check size={14} aria-hidden /> Mark all as seen
            </Button>
          ) : null}
        </div>
        {data === undefined ? (
          <div className="mt-6 h-32 animate-pulse rounded-control bg-surface motion-reduce:animate-none" aria-busy aria-label="Loading changes" />
        ) : notes.length === 0 ? (
          <div className="mt-16 text-center">
            <p className="ui-display text-2xl text-muted">You’re all caught up.</p>
            <p className="mt-2 text-sm text-muted">When someone else changes a note you’ve opened, it shows up here until you look.</p>
          </div>
        ) : (
          <ul className="mt-6 space-y-4" aria-label="Changed notes">
            {notes.map((n) => (
              <li key={n.id}>
                <ChangeCard note={n} people={data.people} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </ViewChrome>
  );
}

function ChangeCard({ note, people }: { note: NoteChanges; people: People }) {
  const { navigate } = useAppRouter();
  const toast = useToast();
  const markSeen = useMutation(api.changes.markSeen);
  const undo = useMutation(api.changes.undo);
  const restore = useMutation(api.documents.restoreSnapshot);
  const [busy, setBusy] = useState(false);
  const detail = useQuery(api.changes.note, { documentId: note.id });
  const everyone: People = useMemo(() => ({ ...people, ...detail?.people }), [people, detail]);
  const names = note.actors.map((k) => everyone[k]?.name ?? "Someone");
  const title = note.title || "Untitled";
  const headingId = `changes-${note.id}`;

  // The changed lines, marked like version history (word by word when the version from before is known).
  const diff = useMemo(() => {
    if (!detail) return null;
    if (detail.previous) {
      const d = diffVersions(detail.previous, detail.blocks, detail.authors, detail.removed);
      return { blocks: d.blocks.filter((b) => d.changes.has(b.id)), changes: d.changes };
    }
    const kinds = new Map(detail.kinds);
    const by = new Map(detail.authors.map(([id, key, at]) => [id, [key, at] as const]));
    const changes = new Map<string, BlockChange>();
    for (const b of detail.blocks) {
      const [author, at] = by.get(b.id) ?? [null, null];
      changes.set(b.id, { kind: kinds.get(b.id) === "added" ? "added" : "edited", author, at });
    }
    return { blocks: detail.blocks, changes };
  }, [detail]);

  const fileIds = useMemo(() => [...new Set((diff?.blocks ?? []).map((b) => (b.props as { fileId?: unknown }).fileId).filter((x): x is string => typeof x === "string"))], [diff]);
  const [now] = useState(() => Date.now());
  const files = useQuery(api.files.urls, fileIds.length ? { fileIds, now } : "skip");
  const fileUrls = useMemo(() => Object.fromEntries(Object.entries(files ?? {}).map(([id, f]) => [id, f.url])), [files]);

  const doUndo = async () => {
    setBusy(true);
    try {
      const { undoVersionId } = await undo({ documentId: note.id });
      toast.show(`Undid the changes to “${title}”`, {
        tone: "success",
        action: undoVersionId
          ? { label: "Undo", onClick: () => void restore({ snapshotId: undoVersionId }).then(() => toast.show("Changes put back"), (e) => toast.show(errorMessage(e), { tone: "error" })) }
          : undefined,
      });
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <article aria-labelledby={headingId} className="ui-card overflow-hidden rounded-control">
      <header className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 pb-2 pt-3">
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="truncate text-[15px] font-semibold text-heading">
            <AppLink href={`/d/${note.id}`} className="rounded-tiny outline-none hover:underline focus-visible:ring-2 focus-visible:ring-focus">
              {title}
            </AppLink>
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <span className="inline-flex items-center -space-x-1" aria-hidden>
              {note.actors.slice(0, 3).map((k) => (
                <Avatar key={k} name={everyone[k]?.name ?? "Someone"} url={everyone[k]?.avatarUrl} size={16} ring={`var(--color-${everyone[k]?.color ?? "ink-muted"})`} />
              ))}
            </span>
            <span>
              <span className="text-ink">{whoChanged(names)}</span> · {formatRelative(note.at)}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-muted">{changeCounts(note)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => navigate(`/d/${note.id}`)}>
            <ExternalLink size={14} aria-hidden /> Open note
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void markSeen({ documentIds: [note.id] }).catch((e) => toast.show(errorMessage(e), { tone: "error" }))}>
            <Check size={14} aria-hidden /> Mark as seen
          </Button>
          {detail?.canUndo ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void doUndo()}>
              <RotateCcw size={14} aria-hidden /> Undo this change
            </Button>
          ) : null}
        </div>
      </header>
      <div className="border-t border-line bg-[var(--color-surface-sunken)] px-4 py-3">
        {!diff ? (
          <div className="h-10 animate-pulse rounded-tiny bg-sunken motion-reduce:animate-none" aria-busy aria-label="Loading what changed" />
        ) : diff.blocks.length ? (
          <div className="fb-page max-h-80 overflow-y-auto text-[14px] [&>.fb-editor]:!pb-0" aria-label={`What changed in ${title}`} role="group">
            <ReadOnlyBlocks blocks={diff.blocks} fileUrls={fileUrls} changes={diff.changes} people={everyone} />
          </div>
        ) : (
          <p className="text-sm text-muted">{note.removed ? "Lines were removed." : "Only formatting or order changed."}</p>
        )}
      </div>
    </article>
  );
}
