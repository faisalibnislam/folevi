// The native journal (LOCAL_MODE_PLAN.md §3.6): every local mutation is appended (fsync'd, in Application
// Support, outside the library) before it is acknowledged, so "Saved" means "on this device" even if the app
// dies before the note file is flushed. Records carry delta states, so replay is just a merge.
import { canonicalJson } from "@folevi/editor-schema";
import { fromUtf8, utf8 } from "./bytes";
import { mergeIndex, type IndexFile } from "./indexFile";
import { mergeNoteFiles } from "./merge";
import { isStub, validateNoteFile, type NoteFile, type NoteLike, type NoteStub } from "./noteFile";
import { sha256Hex } from "./sha256";
import { dominates } from "./vv";

export type JournalRecord =
  /** A note delta (the changed parts, see `diffNote`). */
  | { k: "note"; id: string; delta: NoteFile }
  /** A permanent delete. */
  | { k: "stub"; id: string; stub: NoteStub }
  /** A library index delta. */
  | { k: "index"; delta: IndexFile };

/** The native side of the journal (`shell.library.journal`). */
export interface JournalStore {
  append(record: Uint8Array): Promise<void>;
  readAll(): Promise<Uint8Array[]>;
  /** Drops the first `n` records. */
  truncate(n: number): Promise<void>;
}

/** One record: canonical JSON with its own checksum, so a torn final append is recognised and skipped. */
export function encodeJournalRecord(record: JournalRecord): Uint8Array {
  const body = canonicalJson(record);
  return utf8(canonicalJson({ r: record, sum: sha256Hex(body) }));
}

/** The record, or null if it is torn or damaged. */
export function decodeJournalRecord(bytes: Uint8Array): JournalRecord | null {
  try {
    const v = JSON.parse(fromUtf8(bytes)) as { r?: JournalRecord; sum?: string };
    if (!v.r || v.sum !== sha256Hex(canonicalJson(v.r))) return null;
    if (v.r.k === "note" && typeof v.r.id === "string" && v.r.delta?.id === v.r.id) return v.r;
    if (v.r.k === "stub" && typeof v.r.id === "string")
      return isStub(v.r.stub) && validateNoteFile(v.r.stub).length === 0 ? v.r : null;
    if (v.r.k === "index" && v.r.delta) return v.r;
    return null;
  } catch {
    return null;
  }
}

export interface Replica {
  notes: Map<string, NoteLike>;
  index: IndexFile | null;
}

/** Replays records into a replica (idempotent: replaying twice changes nothing). Returns the ids touched. */
export function replayJournal(
  records: readonly (JournalRecord | null)[],
  replica: Replica,
): { notes: string[]; index: boolean; skipped: number } {
  const touched = new Set<string>();
  let index = false;
  let skipped = 0;
  for (const r of records) {
    if (!r) {
      skipped++;
      continue;
    }
    if (r.k === "index") {
      replica.index = replica.index ? mergeIndex(replica.index, r.delta) : r.delta;
      index = true;
      continue;
    }
    const incoming: NoteLike = r.k === "note" ? r.delta : r.stub;
    const current = replica.notes.get(r.id);
    replica.notes.set(r.id, current ? mergeNoteFiles(current, incoming).file : incoming);
    touched.add(r.id);
  }
  return { notes: [...touched].sort(), index, skipped };
}

/** Whether a note file already holds a record (every stamp of the delta is covered by the file's `seen`). */
export function recordCovered(
  record: JournalRecord,
  files: { notes: ReadonlyMap<string, NoteLike>; index: IndexFile | null },
): boolean {
  if (record.k === "index") return !!files.index && dominates(files.index.seen, record.delta.seen);
  const file = files.notes.get(record.id);
  if (!file) return false;
  const seen = record.k === "note" ? record.delta.seen : record.stub.seen;
  return dominates(file.seen, seen);
}

/** How many leading records the files hold (the journal is truncated by that many). */
export function coveredPrefix(
  records: readonly (JournalRecord | null)[],
  files: { notes: ReadonlyMap<string, NoteLike>; index: IndexFile | null },
): number {
  let n = 0;
  for (const r of records) {
    if (r && !recordCovered(r, files)) break;
    n++;
  }
  return n;
}

/** Appends a record through the native journal. */
export async function appendRecord(store: JournalStore, record: JournalRecord): Promise<void> {
  await store.append(encodeJournalRecord(record));
}

/** Reads every record (torn ones as null, which replay skips). */
export async function readRecords(store: JournalStore): Promise<(JournalRecord | null)[]> {
  return (await store.readAll()).map(decodeJournalRecord);
}

/** An in-memory JournalStore for tests and the FakeShell. */
export class MemoryJournal implements JournalStore {
  records: Uint8Array[] = [];
  async append(record: Uint8Array): Promise<void> {
    this.records.push(record.slice());
  }
  async readAll(): Promise<Uint8Array[]> {
    return this.records.map((r) => r.slice());
  }
  async truncate(n: number): Promise<void> {
    this.records = this.records.slice(n);
  }
}
