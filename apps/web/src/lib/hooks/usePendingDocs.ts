"use client";

import { useMemo } from "react";
import type { SyncState } from "@folevi/editor-schema";
import { useAppState } from "@/lib/app/state";
import { useEngineState } from "@/lib/hooks/useEngine";

/** Unsynced local work for one document, derived from the durable operation log. */
export interface PendingDocument {
  documentId: string;
  /** Operations not yet acknowledged by the server (queued or in flight). */
  changes: number;
  /** Files attached on this device that haven't finished uploading. */
  uploads: number;
  /** The document was created on this device and doesn't exist on the server yet. */
  isNew: boolean;
  /** Latest title known locally from the queued operations (null when no op carries one). */
  localTitle: string | null;
}

/** Groups the engine's queued/in-flight operations and pending uploads by document (pure; exported for tests). */
export function pendingByDocument(state: Pick<SyncState, "pending" | "inflight" | "uploads">): PendingDocument[] {
  const map = new Map<string, PendingDocument>();
  const entry = (documentId: string) => {
    let e = map.get(documentId);
    if (!e) map.set(documentId, (e = { documentId, changes: 0, uploads: 0, isNew: false, localTitle: null }));
    return e;
  };
  for (const op of [...state.inflight, ...state.pending]) {
    if (op.kind === "document.create") {
      const e = entry(op.document.id);
      e.changes++;
      e.isNew = true;
      e.localTitle = op.document.title;
    } else {
      const e = entry(op.documentId);
      e.changes++;
      if (op.kind === "document.update" && op.patch.title !== undefined) e.localTitle = op.patch.title;
    }
  }
  for (const u of state.uploads) if (u.state !== "done") entry(u.documentId).uploads++;
  return [...map.values()];
}

/** All documents with unsynced edits on this device (live; re-renders as the queue drains). */
export function usePendingDocs(): PendingDocument[] {
  const { engine } = useAppState();
  const state = useEngineState(engine);
  return useMemo(() => pendingByDocument(state), [state]);
}

/**
 * Whether one document has edits on this device that the server hasn't confirmed yet. For markers on
 * document cards and rows, e.g. `const unsynced = useHasPendingChanges(doc.id);`.
 */
export function useHasPendingChanges(documentId: string): boolean {
  const pending = usePendingDocs();
  return pending.some((p) => p.documentId === documentId && (p.changes > 0 || p.uploads > 0));
}
