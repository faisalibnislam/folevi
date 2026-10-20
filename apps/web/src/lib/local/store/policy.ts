// Where each kind of row lives in a library (docs/LOCAL_MODE_PLAN.md §3.1, §3.3, §3.5):
//
//   documents, blocks, notices, files, fileTexts, collections (and a row note's `row`)   the note's file
//   folders, tags, synced meta keys, studyReviews, calendars                              index/library.findex
//   versions                                                                             history/<note>/*.fver
//   recents, device-local meta keys, any table not listed here                           this device only
//
// Rows that stay on this device are kept in IndexedDB like the rest; they just never reach the folder. A new
// table that should sync gets a line here (and, if it belongs to a note, a mapping in project.ts and
// materialize.ts); until then it stays on the device it was written on, and development builds say so once.
import type { LocalTable } from "../store";

export type Placement = "note" | "index" | "history" | "device";

const PLACEMENT: Partial<Record<LocalTable, Placement>> = {
  documents: "note",
  blocks: "note",
  notices: "note",
  files: "note",
  fileTexts: "note",
  collections: "note",
  folders: "index",
  tags: "index",
  meta: "index",
  studyReviews: "index",
  calendars: "index",
  versions: "history",
  recents: "device",
};

/** Tables whose rows sync as whole rows through the index (last writer wins per row). */
export const INDEX_ROW_TABLES: ReadonlySet<LocalTable> = new Set<LocalTable>(["studyReviews", "calendars"]);

const warned = new Set<string>();

export function placementOf(table: LocalTable): Placement {
  const p = PLACEMENT[table];
  if (p) return p;
  if (process.env.NODE_ENV !== "production" && !warned.has(table)) {
    warned.add(table);
    console.warn(`[local mode] Rows of "${table}" stay on this device: add the table to lib/local/store/policy.ts to sync it.`);
  }
  return "device";
}

/**
 * Meta keys that stay on this device: change counters and orderings (each device numbers its own), sync
 * replay records, upload intents, caches of fetched data, and anything under "device:" (the search index's
 * storage, the library's own bookkeeping). Every other key (the profile, the avatar, preferences) syncs.
 */
export function isDeviceMeta(key: string): boolean {
  if (key === "seq" || key === "lastDocumentRank") return true;
  if (/^(op|upload|device|calendarEvents|local):/.test(key)) return true;
  return /(Ordinal|Seq|Counter)$/.test(key);
}

/** The index setting a synced meta key is kept under. */
export const metaSetting = (key: string) => `meta:${key}`;

/** The index setting a whole row of an index-row table is kept under. */
export const rowSetting = (table: string, partition: string | undefined, id: string) => `row:${table}:${partition ?? ""}:${id}`;

/** The inverse of `rowSetting`. */
export function parseRowSetting(key: string): { table: string; partition: string | undefined; id: string } | null {
  const m = /^row:([A-Za-z]+):([^:]*):(.+)$/.exec(key);
  return m ? { table: m[1]!, partition: m[2] || undefined, id: m[3]! } : null;
}
