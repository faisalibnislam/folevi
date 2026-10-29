import { useEffect, type MutableRefObject } from "react";
import type { SyncEngine } from "@/lib/sync/engine";

/** A version is kept this long after the last edit has reached the server (a meaningful version, not one per key). */
export const IDLE_SNAPSHOT_MS = 2 * 60_000;

/**
 * The note's "idle" version: once nothing of this note is on its way to the server after an edit, a version after
 * IDLE_SNAPSHOT_MS (started again by each new edit, and by `restart` changing, as the note's details arriving).
 * `lastEditAt` is set when an edit starts and cleared once the version is made (the "close" version reads it).
 * Whether saves are on their way is followed outside rendering: it changes with every save, and nothing shows it.
 */
export function useIdleSnapshot(
  engine: SyncEngine | null,
  documentId: string,
  writable: boolean,
  restart: unknown,
  createSnapshot: (args: { documentId: string; reason: "idle" }) => Promise<unknown>,
  lastEditAt: MutableRefObject<number | null>,
) {
  useEffect(() => {
    if (!engine) return;
    const pendingNow = () => engine.state.pending.some((op) => "documentId" in op && op.documentId === documentId) || engine.state.inflight.length > 0;
    let pending = pendingNow();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (pending || !lastEditAt.current || !writable) return;
      timer = setTimeout(() => {
        void createSnapshot({ documentId, reason: "idle" }).catch(() => undefined);
        lastEditAt.current = null;
      }, IDLE_SNAPSHOT_MS);
    };
    if (pending) lastEditAt.current = Date.now();
    arm();
    const off = engine.subscribe(() => {
      const next = pendingNow();
      if (next === pending) return;
      pending = next;
      if (pending) lastEditAt.current = Date.now();
      arm();
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [engine, documentId, writable, restart, createSnapshot, lastEditAt]);
}
