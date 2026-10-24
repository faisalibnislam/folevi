"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useMemo, useState } from "react";
import { blocksFileIds } from "@folevi/editor-schema";
import { Check, ExternalLink, RotateCcw, X, FileDiff } from "lucide-react";
import { api } from "@/lib/convex/api";
import { AppLink, useAppRouter } from "@/lib/app/router";
import { ViewChrome } from "@/components/app/Shell";
import { formatRelative } from "@/lib/format";
import { useMinute } from "@/lib/hooks/useMinute";
import { diffVersions, type BlockChange } from "@/lib/history/diff";
import { changeCounts, whoChanged } from "@/lib/history/changeWords";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { ReadOnlyBlocks, type ChangePerson } from "@/components/doc/ReadOnlyBlocks";
import "@/components/editor/editor.css";
import "@/components/editor/insert-blocks.css";
import "@/components/editor/flowchart/flowchart.css";
import "@/components/editor/canvas/canvas.css";
import "@/components/editor/mindmap/mindmap.css";
import "@/components/editor/stickies/stickies.css";
import "@/components/editor/chart/chart.css";
import "@/components/editor/wireframe/wireframe.css";
import { EmptyState } from "@/components/ui/EmptyState";

type ChangeList = FunctionReturnType<typeof api.changes.list>;
type NoteChanges = ChangeList["notes"][number];
type Proposal = FunctionReturnType<typeof api.proposals.list>[number];
type People = Record<string, ChangePerson & { key?: string }>;
const NO_FILES: Record<string, string> = {};

/**
 * Changes: changes connected apps proposed to your notes, waiting for you to accept or reject them (Proposed),
 * and what other people, connected apps and Foli AI changed in notes you've opened since you last looked
 * (Changed), one card per note with what changed in it (from version history's diff). Open it, mark it seen,
 * or undo it.
 */
export function ChangesView() {
  const data = useQuery(api.changes.list, {});
  const now = useMinute();
  const proposals = useQuery(api.proposals.list, { now });
  const markSeen = useMutation(api.changes.markSeen);
  const toast = useToast();
  const notes = data?.notes ?? [];
  const waiting = proposals ?? [];
  const subtitle =
    data === undefined
      ? undefined
      : [waiting.length ? `${waiting.length} proposed` : null, notes.length ? `${notes.length} ${notes.length === 1 ? "note" : "notes"} changed since you last looked` : null].filter(Boolean).join(" · ") || "Nothing new";
  return (
    <ViewChrome title={<h1 className="text-subheadline font-semibold">Changes</h1>} subtitle={subtitle} tabTitle="Changes">
      <div className="mx-auto max-w-3xl px-4 pb-[max(6rem,var(--fab-clearance))] pt-6 sm:px-8">
        {waiting.length ? (
          <section aria-labelledby="changes-proposed" className="mb-10">
            <h2 id="changes-proposed" className="text-headline font-semibold text-heading">
              Proposed
            </h2>
            <p className="mt-1 max-w-xl text-subheadline text-muted">Changes connected apps want to make to your notes. Nothing changes until you accept.</p>
            <ul className="mt-4 space-y-4" aria-label="Proposed changes">
              {waiting.map((p) => (
                <li key={p.id}>
                  <ProposalCard proposal={p} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {waiting.length ? (
          <h2 className="mb-1 text-headline font-semibold text-heading" id="changes-changed">
            Changed
          </h2>
        ) : null}
        {notes.length > 1 ? (
          <div className="flex justify-end">
            <Button size="sm" onClick={() => void markSeen({ documentIds: notes.map((n) => n.id) }).catch((e) => toast.show(errorMessage(e), { tone: "error" }))}>
              <Check size={14} aria-hidden /> Mark all as seen
            </Button>
          </div>
        ) : null}
        {data === undefined ? (
          <div className="mt-6 h-32 animate-pulse rounded-control bg-surface motion-reduce:animate-none" aria-busy aria-label="Loading changes" />
        ) : notes.length === 0 && waiting.length ? (
          <p className="mt-4 text-subheadline text-muted">Nothing else changed since you last looked.</p>
        ) : notes.length === 0 ? (
          <EmptyState icon={FileDiff} title="You’re all caught up" body="When someone else changes a note you’ve opened, it shows up here until you look." />
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

/**
 * A change an app proposed: the note, who proposed what and when, and the lines it would add, marked as added
 * (like version history). Accept makes it (as the app, with a version saved first); Reject leaves the note
 * alone. When the note can't take it any more, it says why and only Reject is offered.
 */
function ProposalCard({ proposal }: { proposal: Proposal }) {
  const accept = useMutation(api.proposals.accept);
  const reject = useMutation(api.proposals.reject);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const shown = problem ?? proposal.problem;
  const title = proposal.title;
  const headingId = `proposal-${proposal.id}`;
  const people: People = useMemo(() => ({ app: { name: proposal.sourceName, color: "accent", avatarUrl: null } }), [proposal.sourceName]);
  const changes = useMemo(() => new Map<string, BlockChange>(proposal.blocks.map((b) => [b.id, { kind: "added", author: "app", at: proposal.createdAt }])), [proposal]);

  const run = async (action: "accept" | "reject") => {
    setBusy(true);
    try {
      if (action === "accept") {
        await accept({ proposalId: proposal.id });
        toast.show(`Added to “${title}”`, { tone: "success" });
      } else {
        await reject({ proposalId: proposal.id });
        toast.show("Proposal rejected");
      }
    } catch (e) {
      if (action === "accept") setProblem(errorMessage(e));
      else toast.show(errorMessage(e), { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <article aria-labelledby={headingId} className="ui-card overflow-hidden rounded-control">
      <header className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 pb-2 pt-3">
        <div className="min-w-0 flex-1">
          <h3 id={headingId} className="truncate text-headline font-semibold text-heading">
            {proposal.documentId ? (
              <AppLink href={`/d/${proposal.documentId}`} className="rounded-tiny outline-none hover:underline focus-visible:ring-2 focus-visible:ring-focus">
                {title}
              </AppLink>
            ) : (
              title
            )}
          </h3>
          <p className="mt-1 text-footnote text-muted">
            <span className="text-ink">{proposal.sourceName}</span> proposed this {formatRelative(proposal.createdAt)}
          </p>
          <p className="mt-0.5 text-footnote text-muted">{proposal.summary}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {!shown ? (
            <Button size="sm" variant="primary" disabled={busy} onClick={() => void run("accept")}>
              <Check size={14} aria-hidden /> Accept
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("reject")}>
            <X size={14} aria-hidden /> Reject
          </Button>
        </div>
      </header>
      {shown ? (
        <p role="alert" className="border-t border-line px-4 py-2 text-subheadline text-danger">
          {shown}
        </p>
      ) : null}
      <div className="border-t border-line bg-[var(--color-surface-sunken)] px-4 py-3">
        {proposal.blocks.length ? (
          <div className="fb-page max-h-80 overflow-y-auto text-body [&>.fb-editor]:!pb-0" aria-label={`What ${proposal.sourceName} would add to ${title}`} role="group">
            <ReadOnlyBlocks blocks={proposal.blocks} fileUrls={NO_FILES} changes={changes} people={people} />
          </div>
        ) : (
          <p className="text-subheadline text-muted">You can’t open this note, so its proposal isn’t shown.</p>
        )}
      </div>
    </article>
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

  const fileIds = useMemo(() => blocksFileIds(diff?.blocks ?? []), [diff]);
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
          <h2 id={headingId} className="truncate text-headline font-semibold text-heading">
            <AppLink href={`/d/${note.id}`} className="rounded-tiny outline-none hover:underline focus-visible:ring-2 focus-visible:ring-focus">
              {title}
            </AppLink>
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-footnote text-muted">
            <span className="inline-flex items-center -space-x-1" aria-hidden>
              {note.actors.slice(0, 3).map((k) => (
                <Avatar key={k} name={everyone[k]?.name ?? "Someone"} url={everyone[k]?.avatarUrl} size={16} ring={`var(--color-${everyone[k]?.color ?? "ink-muted"})`} />
              ))}
            </span>
            <span>
              <span className="text-ink">{whoChanged(names)}</span> · {formatRelative(note.at)}
            </span>
          </p>
          <p className="mt-0.5 text-footnote text-muted">{changeCounts(note)}</p>
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
          <div className="fb-page max-h-80 overflow-y-auto text-body [&>.fb-editor]:!pb-0" aria-label={`What changed in ${title}`} role="group">
            <ReadOnlyBlocks blocks={diff.blocks} fileUrls={fileUrls} changes={diff.changes} people={everyone} />
          </div>
        ) : (
          <p className="text-subheadline text-muted">{note.removed ? "Lines were removed." : "Only formatting or order changed."}</p>
        )}
      </div>
    </article>
  );
}
