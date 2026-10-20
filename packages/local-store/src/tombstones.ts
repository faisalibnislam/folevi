// Compaction (LOCAL_MODE_PLAN.md §3.5): block tombstones go once every device listed in devices/ has seen
// past them and they are more than 90 days old. Compacted vectors are recorded in the note's `compacted`, so a
// stale copy that still has the block can't bring it back (see mergeNote).
import { seenByAll, type DeviceRecord } from "./catalog";
import { hlcMs } from "./hlc";
import type { NoteFile, NoteStub } from "./noteFile";
import { mergeVv } from "./vv";

export const TOMBSTONE_MIN_AGE_MS = 90 * 24 * 3_600_000;
export const STUB_RETENTION_MS = 180 * 24 * 3_600_000;

/** Whether one tombstone may be dropped. */
export function canCompactTombstone(
  deletedC: string,
  devices: readonly DeviceRecord[],
  now: number,
): boolean {
  if (devices.length === 0) return false;
  return now - hlcMs(deletedC) > TOMBSTONE_MIN_AGE_MS && seenByAll(devices, deletedC);
}

/** Drops every compactable tombstone, recording their vectors in `compacted`. Returns the note unchanged if none. */
export function compactTombstones(
  note: NoteFile,
  devices: readonly DeviceRecord[],
  now: number,
): { note: NoteFile; removed: string[] } {
  const removed: string[] = [];
  const blocks = { ...note.blocks };
  let compacted = note.compacted ?? {};
  for (const [id, b] of Object.entries(note.blocks)) {
    if (!b.deleted || !canCompactTombstone(b.deleted.c, devices, now)) continue;
    // A live child keeps its deleted parent's id meaningful only as "missing"; that is already how reads treat it.
    delete blocks[id];
    compacted = mergeVv(compacted, b.cv);
    removed.push(id);
  }
  if (!removed.length) return { note, removed };
  return { note: { ...note, blocks, compacted }, removed: removed.sort() };
}

/** A permanent-delete stub can be removed after 180 days (the index's deletedNotes keeps the rule for a year). */
export function stubExpired(stub: NoteStub, now: number): boolean {
  return now - hlcMs(stub.deleted.c) > STUB_RETENTION_MS;
}
