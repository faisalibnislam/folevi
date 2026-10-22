// Foli AI memories and encryption (docs/E2EE_DESIGN.md §5.7 aiMemory, "Settled while building WP3", WP8). A
// space's memories become this person's `aiMemory` records when the space is encrypted (moveMemories: the
// records are written and the server rows deleted in one mutation) and server rows again when it goes back to
// Standard (restoreMemories). Each record holds one entry, sealed with the space key.
import { api } from "@/lib/convex/api";
import type { LocalReader } from "@/lib/local/registry";
import { call, migrate, type MigrateEnv } from "./env";

export type MemoryKind = "tone" | "language" | "length" | "term" | "instruction";

/** One memory as its record holds it (the replica keeps it opened in meta, "record-value:aiMemory:<id>"). */
export interface MemoryRecord {
  e2eeKind: "aiMemory";
  recordId: string;
  kind: MemoryKind;
  text: string;
  source: "settings" | "chat";
  createdAt: number;
  updatedAt: number;
}

interface ListedMemory {
  id: string;
  kind: MemoryKind;
  text: string;
  source: "settings" | "chat";
  workspace: { id: string } | null;
  updatedAt: number;
}

const PER_CALL = 200;

export const memoryRecordId = (memoryId: string) => `mem-${memoryId}`;

/** The seal's cleanup: this person's memories of the space (Personal: the ones for everywhere) into records. */
export async function moveMemories(env: Pick<MigrateEnv, "server" | "sealer" | "space">): Promise<number> {
  const listed = ((await call.query(env, api.aiMemory.list, {})) as { items?: ListedMemory[] } | null)?.items ?? [];
  const scope = env.space.scope;
  const mine = listed.filter((m) => (scope.kind === "personal" ? m.workspace === null : m.workspace?.id === scope.workspaceId));
  for (let i = 0; i < mine.length; i += PER_CALL) {
    const batch = mine.slice(i, i + PER_CALL);
    const records = [];
    for (const m of batch) {
      const recordId = memoryRecordId(m.id);
      const value: MemoryRecord = { e2eeKind: "aiMemory", recordId, kind: m.kind, text: m.text, source: m.source, createdAt: m.updatedAt, updatedAt: m.updatedAt };
      const s = await env.sealer.sealRecordValue({ scope }, env.space.scopeId, "aiMemory", recordId, value);
      records.push({ recordId, sealed: s.sealed, keyVersion: s.keyVersion });
    }
    await call.mutation(env, migrate.moveMemories as never, { scope, records, memoryIds: batch.map((m) => m.id) });
  }
  return mine.length;
}

interface PullPage {
  records: { kind: string; recordId: string; documentId: string | null; sealed: ArrayBuffer; deletedAt: number | null }[];
  nextCursor: number;
  hasMore: boolean;
}

/**
 * This person's memory records in the space: from the replica when this window has one, else read from the
 * space's change feed (a cleanup runs once, so reading it all is fine).
 */
export async function memoryRecords(env: Pick<MigrateEnv, "server" | "sealer" | "space">, store: LocalReader | null): Promise<MemoryRecord[]> {
  if (store) {
    return ((await store.list("meta")) as unknown[]).filter((v): v is MemoryRecord => !!v && typeof v === "object" && (v as MemoryRecord).e2eeKind === "aiMemory");
  }
  const found = new Map<string, MemoryRecord | null>();
  let cursor = 0;
  for (let i = 0; i < 1000; i++) {
    const page = (await call.query(env, api.e2ee.pull.pull, { scope: env.space.scope, cursor, limit: 1000 })) as PullPage;
    for (const r of page.records) {
      if (r.kind !== "aiMemory" || r.documentId) continue;
      if (r.deletedAt) {
        found.set(r.recordId, null);
        continue;
      }
      try {
        found.set(r.recordId, (await env.sealer.openRecordValue({ scope: env.space.scope }, env.space.scopeId, "aiMemory", r.recordId, r.sealed)) as MemoryRecord);
      } catch {
        // Not readable here (an older key this device doesn't hold): left as it is.
      }
    }
    cursor = page.nextCursor;
    if (!page.hasMore) break;
  }
  return [...found.values()].filter((m): m is MemoryRecord => m !== null && m.e2eeKind === "aiMemory");
}
