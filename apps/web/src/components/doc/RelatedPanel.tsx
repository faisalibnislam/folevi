"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Copy, FileText, Split } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppRouter } from "@/lib/app/router";

type Related = FunctionReturnType<typeof api.aiGraph.related>;
type Duplicates = FunctionReturnType<typeof api.aiGraph.duplicates>;
type Contradictions = FunctionReturnType<typeof api.aiGraph.contradictions>;

/** Where a note (and a block in it) opens. */
export const noteHref = (id: string, blockId?: string) => (blockId ? `/d/${id}#block-${blockId}` : `/d/${id}`);

/** The Related tool in a note's sidebar: related notes with reasons, likely duplicates and contradictions. */
export function RelatedPanel({ documentId }: { documentId: string }) {
  const { navigate } = useAppRouter();
  const related = useQuery(api.aiGraph.related, { documentId });
  const duplicates = useQuery(api.aiGraph.duplicates, { documentId });
  const contradictions = useQuery(api.aiGraph.contradictions, { documentId });
  return <RelatedList related={related} duplicates={duplicates} contradictions={contradictions} onOpen={(id, blockId) => navigate(noteHref(id, blockId))} />;
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
      className={`flex min-w-0 items-start gap-2 rounded-[6px] px-1.5 py-1.5 hover:bg-accent-soft ${className}`}
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
  onOpen,
}: {
  related: Related | undefined;
  duplicates: Duplicates | undefined;
  contradictions: Contradictions | undefined;
  onOpen: (id: string, blockId?: string) => void;
}) {
  if (!related) return <p className="px-1 text-sm text-muted">Looking for related notes…</p>;
  const dupes = duplicates?.items ?? [];
  const clashes = contradictions?.items ?? [];
  const empty = !related.items.length && !dupes.length && !clashes.length;
  return (
    <div className="space-y-5 text-sm">
      {clashes.length ? (
        <section aria-labelledby="related-clashes">
          <h3 id="related-clashes" className="ui-caps mb-2 px-1">
            Doesn&apos;t agree with
          </h3>
          <ul className="space-y-2">
            {clashes.map((c) => (
              <li key={`${c.from.blockId}:${c.to.blockId}`} className="rounded-[8px] bg-sunken/70 p-2">
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
      {empty ? <p className="px-1 text-muted">Nothing related yet. Links to and from this note show up here.</p> : null}
      {related.note ? <p className="px-1 text-[12px] text-faint">{related.note}</p> : null}
    </div>
  );
}
