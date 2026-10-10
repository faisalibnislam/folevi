"use client";

import { useConvex, useMutation, useQuery } from "convex/react";
import { useEffect, useId, useState } from "react";
import { CornerLeftUp, FileText } from "lucide-react";
import { SCHEMA_VERSION, rankBetween, ulid, type WireBlock, type WireScope } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import type { SyncEngine } from "@/lib/sync/engine";
import { Dialog } from "@/components/ui/Dialog";
import { FolderBadge } from "@/components/views/FolderBadge";
import { useToast, errorMessage } from "@/components/ui/Toast";

type Client = ReturnType<typeof useConvex>;

function isPageBlockFor(b: WireBlock, documentId: string) {
  return b.type === "page" && (b.props as { documentId?: string }).documentId === documentId;
}

/**
 * Keeps nested-page cards in step with a move: the new parent gets a card for the page at its end, the
 * old parent loses its card. Only done where the person can edit; a failure here never undoes the move.
 */
export async function syncPageCards(client: Client, engine: SyncEngine, input: { documentId: string; title: string; from: string | null; to: string | null }) {
  if (input.to) {
    const [parent, list] = await Promise.all([client.query(api.documents.get, { documentId: input.to }), client.query(api.blocks.list, { documentId: input.to })]);
    if (parent && (parent.access === "write" || parent.access === "manage") && list && !list.blocks.some((b) => isPageBlockFor(b, input.documentId))) {
      const top = list.blocks.filter((b) => b.parentId === null).sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
      const block: WireBlock = {
        id: ulid(),
        type: "page",
        parentId: null,
        rank: rankBetween(top[top.length - 1]?.rank ?? null, null),
        schemaVersion: SCHEMA_VERSION,
        text: [],
        props: { documentId: input.documentId, display: "card", titleCache: input.title || "Untitled" },
      };
      engine.upsertBlock(input.to, block, ["content", "position"]);
    }
  }
  if (input.from) {
    const [parent, list] = await Promise.all([client.query(api.documents.get, { documentId: input.from }), client.query(api.blocks.list, { documentId: input.from })]);
    if (parent && (parent.access === "write" || parent.access === "manage") && list) {
      const cards = list.blocks.filter((b) => isPageBlockFor(b, input.documentId));
      if (cards.length) {
        engine.reconcileDocument(input.from, list.blocks);
        for (const c of cards) engine.deleteBlock(input.from, c.id);
      }
    }
  }
}

/** Moves a page under another page (or back to the top level), from the page menu or the Info panel. */
export function MovePageDialog(props: { open: boolean; onClose: () => void; documentId: string; title: string; currentParentId: string | null; home?: WireScope | null }) {
  return (
    <Dialog open={props.open} onClose={props.onClose} title="Move page" description={`Choose a page to nest “${props.title || "Untitled"}” under.`}>
      <PagePicker {...props} />
    </Dialog>
  );
}

/** The page search and list (also the Page side of a note's Move dialog). */
export function PagePicker({
  open,
  onClose,
  documentId,
  title,
  currentParentId,
  home,
}: {
  open: boolean;
  onClose: () => void;
  documentId: string;
  title: string;
  currentParentId: string | null;
  /** The page's own scope when you're a member there (pages only move within their scope); else the current context. */
  home?: WireScope | null;
}) {
  const { scope: current, engine } = useAppState();
  const scope = home ?? current;
  const client = useConvex();
  const move = useMutation(api.documents.move);
  const toast = useToast();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const baseId = useId();
  useEffect(() => {
    if (open) {
      setQ("");
      setError(null);
    }
  }, [open]);
  const query = q.trim();
  const results = useQuery(api.search.documents, open && query ? { scope, query, limit: 12 } : "skip");
  const recent = useQuery(api.documents.recent, open && !query ? { scope, limit: 12 } : "skip");
  const list = ((query ? results : recent) ?? []).filter((d) => d.id !== documentId && d.id !== currentParentId && ("kind" in d ? d.kind !== "template" : true));
  const loading = (query ? results : recent) === undefined;

  const doMove = async (parentId: string | null, parentTitle: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await move({ documentId, parentDocumentId: parentId });
      if (engine) {
        // Wait until the card edits are stored in the local queue: leaving or reloading right after the
        // move must not lose the parent's card (the queue sends it whenever it can).
        try {
          await syncPageCards(client, engine, { documentId, title, from: currentParentId, to: parentId });
          await engine.persisted();
        } catch {
          toast.show("Moved, but the page card in the parent page couldn’t be updated.", { tone: "error" });
        }
      }
      onClose();
      toast.show(parentId ? `Moved into “${parentTitle || "Untitled"}”` : "Moved to the top level", {
        action: {
          label: "Undo",
          onClick: () =>
            void move({ documentId, parentDocumentId: currentParentId }).then(
              () => engine && syncPageCards(client, engine, { documentId, title, from: parentId, to: currentParentId }),
              (e) => toast.show(errorMessage(e), { tone: "error" }),
            ),
        },
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <label htmlFor={`${baseId}-q`} className="sr-only">
        Search pages
      </label>
      <input
        id={`${baseId}-q`}
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search pages"
        className="ui-input h-10 w-full rounded-chip px-4 text-sm"
        aria-describedby={error ? `${baseId}-err` : undefined}
      />
      {error ? (
        <p id={`${baseId}-err`} role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <ul className="mt-3 max-h-[min(360px,50dvh)] space-y-0.5 overflow-y-auto" aria-label={query ? "Matching pages" : "Recent pages"} aria-busy={loading}>
        {currentParentId ? (
          <li>
            <button type="button" disabled={busy} onClick={() => void doMove(null, null)} className="ui-menu-item w-full disabled:opacity-50">
              <CornerLeftUp size={15} className="text-muted" aria-hidden />
              <span className="flex-1 text-left">Top level (no parent page)</span>
            </button>
          </li>
        ) : null}
        {list.map((d) => (
          <li key={d.id}>
            <button type="button" disabled={busy} onClick={() => void doMove(d.id, d.title)} className="ui-menu-item w-full disabled:opacity-50">
              <span aria-hidden className="w-5 text-center">
                <FileText size={15} className="inline text-muted" />
              </span>
              <span className="min-w-0 flex-1 truncate text-left">{d.title || "Untitled"}</span>
              <FolderBadge folder={d.homeFolder} />
            </button>
          </li>
        ))}
        {!loading && !list.length ? <li className="px-2 py-3 text-sm text-muted">{query ? `No pages match “${query}”.` : "Search for the page to move this one into."}</li> : null}
        {loading ? <li className="px-2 py-3 text-sm text-muted">Loading…</li> : null}
      </ul>
    </>
  );
}
