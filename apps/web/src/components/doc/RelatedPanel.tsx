"use client";

import { useMutation, useQuery } from "convex/react";
import { useCanCall, useCapabilities } from "@/lib/mode";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { Copy, FileText, Link2, Split } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppRouter } from "@/lib/app/router";
import { useAppState } from "@/lib/app/state";
import { Button } from "@/components/ui/Button";
import { errorMessage, useToast } from "@/components/ui/Toast";

type Related = FunctionReturnType<typeof api.aiGraph.related>;
type Duplicates = FunctionReturnType<typeof api.aiGraph.duplicates>;
type Contradictions = FunctionReturnType<typeof api.aiGraph.contradictions>;
type Missing = FunctionReturnType<typeof api.aiGraph.missingConnections>;

/** Where a note (and a block in it) opens. */
export const noteHref = (id: string, blockId?: string) => (blockId ? `/d/${id}#block-${blockId}` : `/d/${id}`);

/**
 * The Related tool in a note's sidebar: related notes with reasons, likely duplicates, contradictions, and
 * notes about the same things that aren't linked yet (one click adds the link).
 */
export function RelatedPanel({ documentId, canEdit = true }: { documentId: string; canEdit?: boolean }) {
  const { navigate } = useAppRouter();
  const { deviceId } = useAppState();
  const toast = useToast();
  // In local mode, only what reads links (the rest reads the server's embeddings, LOCAL_MODE_PLAN.md §2.4).
  const server = useCapabilities().aiServer;
  const related = useQuery(api.aiGraph.related, useCanCall(api.aiGraph.related) ? { documentId } : "skip");
  const duplicates = useQuery(api.aiGraph.duplicates, server ? { documentId } : "skip");
  const contradictions = useQuery(api.aiGraph.contradictions, server ? { documentId } : "skip");
  const missing = useQuery(api.aiGraph.missingConnections, server ? { documentId } : "skip");
  const linkNote = useMutation(api.aiGraph.linkNote);
  return (
    <RelatedList
      related={related}
      duplicates={duplicates}
      contradictions={contradictions}
      missing={missing}
      onOpen={(id, blockId) => navigate(noteHref(id, blockId))}
      onLink={
        canEdit
          ? (targetId, title) =>
              linkNote({ documentId, targetId, deviceId: deviceId ?? undefined }).then(
                () => toast.show(`Linked “${title || "Untitled"}” at the end of this note`, { tone: "success" }),
                (e) => toast.show(errorMessage(e), { tone: "error" }),
              )
          : undefined
      }
    />
  );
}

function NoteLink({ id, title, blockId, onOpen, children, className = "" }: { id: string; title: string; blockId?: string; onOpen: (id: string, blockId?: string) => void; children?: React.ReactNode; className?: string }) {
  return (
    <a
      href={noteHref(id, blockId)}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        onOpen(id, blockId);
      }}
      className={`flex min-w-0 items-start gap-2 rounded-chip px-1.5 py-1.5 hover:bg-accent-soft ${className}`}
    >
      {children ?? (
        <>
          <FileText size={14} aria-hidden className="mt-0.5 flex-none text-muted" />
          <span className="min-w-0 truncate font-medium text-heading">{title || "Untitled"}</span>
        </>
      )}
    </a>
  );
}

/**
 * The Related list itself (data in, links out), so it can be shown and tested without a server. Quiet:
 * sections without anything are left out, and with nothing at all it says so in one line.
 */
export function RelatedList({
  related,
  duplicates,
  contradictions,
  missing,
  onOpen,
  onLink,
}: {
  related: Related | undefined;
  duplicates: Duplicates | undefined;
  contradictions: Contradictions | undefined;
  missing?: Missing | undefined;
  onOpen: (id: string, blockId?: string) => void;
  /** Adds a link to the note (absent: the person can't edit this one). */
  onLink?: (targetId: string, title: string) => Promise<unknown>;
}) {
  const [linking, setLinking] = useState<string | null>(null);
  if (!related) return <p className="px-1 text-sm text-muted">Looking for related notes…</p>;
  const dupes = duplicates?.items ?? [];
  const clashes = contradictions?.items ?? [];
  const unlinked = missing?.items ?? [];
  const empty = !related.items.length && !dupes.length && !clashes.length && !unlinked.length;
  return (
    <div className="space-y-5 text-sm">
      {clashes.length ? (
        <section aria-labelledby="related-clashes">
          <h3 id="related-clashes" className="ui-caps mb-2 px-1">
            Doesn&apos;t agree with
          </h3>
          <ul className="space-y-2">
            {clashes.map((c) => (
              <li key={`${c.from.blockId}:${c.to.blockId}`} className="rounded-control bg-sunken/70 p-2">
                <p className="flex items-center gap-1.5 px-1 text-[12px] text-muted">
                  <Split size={12} aria-hidden />
                  {c.kind === "supersedes" ? "Replaces an earlier note" : "Says something different"}
                  {c.reason ? <span className="truncate"> · {c.reason}</span> : null}
                </p>
                {[c.from, c.to].map((side) => (
                  <NoteLink key={side.blockId} id={side.id} title={side.title} blockId={side.blockId} onOpen={onOpen} className="mt-1 flex-col !gap-0.5">
                    <span className="truncate text-[12px] font-medium text-heading">{side.title || "Untitled"}</span>
                    <q className="line-clamp-3 text-[13px] text-ink">{side.quote}</q>
                  </NoteLink>
                ))}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {dupes.length ? (
        <section aria-labelledby="related-dupes">
          <h3 id="related-dupes" className="ui-caps mb-2 px-1">
            Possible duplicates
          </h3>
          <ul className="space-y-0.5">
            {dupes.map((d) => (
              <li key={d.b.id}>
                <NoteLink id={d.b.id} title={d.b.title} onOpen={onOpen}>
                  <Copy size={14} aria-hidden className="mt-0.5 flex-none text-muted" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-heading">{d.b.title || "Untitled"}</span>
                    <span className="block text-[12px] text-muted">Almost the same content</span>
                  </span>
                </NoteLink>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {related.items.length ? (
        <section aria-labelledby="related-notes">
          <h3 id="related-notes" className="ui-caps mb-2 px-1">
            Related notes
          </h3>
          <ul className="space-y-0.5">
            {related.items.map((r) => (
              <li key={r.id}>
                <NoteLink id={r.id} title={r.title} onOpen={onOpen}>
                  <FileText size={14} aria-hidden className="mt-0.5 flex-none text-muted" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-heading">{r.title || "Untitled"}</span>
                    <span className="block text-[12px] text-muted">{r.reasons.join(" · ")}</span>
                  </span>
                </NoteLink>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {unlinked.length ? (
        <section aria-labelledby="related-unlinked">
          <h3 id="related-unlinked" className="ui-caps mb-2 px-1">
            You could link
          </h3>
          <ul className="space-y-0.5">
            {unlinked.map((m) => (
              <li key={m.id} className="flex items-start gap-1">
                <NoteLink id={m.id} title={m.title} onOpen={onOpen} className="min-w-0 flex-1">
                  <Link2 size={14} aria-hidden className="mt-0.5 flex-none text-muted" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-heading">{m.title || "Untitled"}</span>
                    <span className="block text-[12px] text-muted">{m.reason}</span>
                  </span>
                </NoteLink>
                {onLink ? (
                  <Button
                    size="sm"
                    variant="quiet"
                    className="mt-1 flex-none"
                    aria-label={`Link “${m.title || "Untitled"}” in this note`}
                    aria-busy={linking === m.id || undefined}
                    disabled={linking !== null}
                    onClick={() => {
                      setLinking(m.id);
                      void onLink(m.id, m.title).finally(() => setLinking(null));
                    }}
                  >
                    Add link
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {empty ? (
        <div className="space-y-1.5 px-1">
          <p className="text-muted">Nothing related yet. Links to and from this note show up here.</p>
          <p className="text-[12.5px] text-faint">Type [[ in the note to link another one. Notes that look alike or say something different show up here too.</p>
        </div>
      ) : null}
      {related.note ? <p className="px-1 text-[12px] text-faint">{related.note}</p> : null}
    </div>
  );
}
