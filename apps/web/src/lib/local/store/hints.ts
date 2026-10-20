// What a mutation's commit was based on (store.ts CommitHints), read from its arguments. Only sync.push says:
// each op carries the revision the editor made its change on (docs/SYNC_PROTOCOL.md). A library store compares
// it with the revision another device's change arrived as, to tell an edit that didn't see that change.
import type { CommitHints } from "../store";

interface PushOp {
  kind?: unknown;
  documentId?: unknown;
  baseRevision?: unknown;
  block?: { id?: unknown };
  blockId?: unknown;
}

/** The hints for a mutation, or undefined when its arguments say nothing about what it was based on. */
export function commitHints(name: string, args: unknown): CommitHints | undefined {
  if (name !== "sync:push") return undefined;
  const ops = (args as { ops?: unknown } | null)?.ops;
  if (!Array.isArray(ops)) return undefined;
  const bases = new Map<string, number | null>();
  for (const raw of ops as PushOp[]) {
    if (!raw || typeof raw.documentId !== "string") continue;
    const base = typeof raw.baseRevision === "number" ? raw.baseRevision : null;
    if (raw.kind === "block.upsert" && typeof raw.block?.id === "string") keep(bases, `${raw.documentId}/${raw.block.id}`, base);
    else if ((raw.kind === "block.delete" || raw.kind === "block.restore") && typeof raw.blockId === "string") keep(bases, `${raw.documentId}/${raw.blockId}`, base);
    else if (raw.kind === "document.update") keep(bases, raw.documentId, base);
  }
  return bases.size ? { bases } : undefined;
}

/** Several ops on one thing in a batch: the oldest base is what the first of them saw. */
function keep(bases: Map<string, number | null>, key: string, base: number | null) {
  const had = bases.get(key);
  if (had === undefined) bases.set(key, base);
  else if (had !== null && (base === null || base < had)) bases.set(key, base);
}
