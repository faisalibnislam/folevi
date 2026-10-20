// `index/library.findex` (LOCAL_MODE_PLAN.md §3.5): folders, tags, library settings and the permanently
// deleted notes, as one multi-writer CRDT merged like a note (registers by version vector, then c).
import { canonicalJson } from "@folevi/editor-schema";
import { fromUtf8, utf8 } from "./bytes";
import type { HybridClock } from "./hlc";
import { isHlc } from "./hlc";
import type { Codec } from "./io";
import { lww, mergeRegister } from "./merge";
import type { Register } from "./noteFile";
import { sha256Hex } from "./sha256";
import { bumpVv, isVersionVector, mergeVv, type VersionVector } from "./vv";

export const INDEX_FORMAT = "folevi-index";
export const INDEX_VERSION = 1;

/** Kept this long in `deletedNotes`, so a stale copy of a deleted note can't bring it back. */
export const DELETED_NOTE_RETENTION_MS = 365 * 24 * 3_600_000;

export interface FolderEntry {
  name?: Register<string>;
  color?: Register<string | null>;
  parentId?: Register<string | null>;
  rank?: Register<string>;
  deleted?: Register<boolean>;
}

export interface TagDef {
  name?: Register<string>;
  color?: Register<string | null>;
  deleted?: Register<boolean>;
}

export interface IndexFile {
  format: typeof INDEX_FORMAT;
  v: typeof INDEX_VERSION;
  libraryId: string;
  folders: Record<string, FolderEntry>;
  tags: Record<string, TagDef>;
  /** Profile name, appearance defaults, AI preferences, ... */
  settings: Record<string, Register<unknown>>;
  /** Permanently deleted notes: the stub's clock and what it had seen (§3.4's rule outlives the stub). */
  deletedNotes: Record<string, { c: string; seen: VersionVector }>;
  seen: VersionVector;
  sum?: string;
}

export function emptyIndex(libraryId: string): IndexFile {
  return {
    format: INDEX_FORMAT,
    v: INDEX_VERSION,
    libraryId,
    folders: {},
    tags: {},
    settings: {},
    deletedNotes: {},
    seen: {},
  };
}

function mergeEntries<T extends Record<string, Register<unknown> | undefined>>(
  a: T | undefined,
  b: T | undefined,
): T {
  const out: Record<string, Register<unknown>> = {};
  for (const key of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
    const r = mergeRegister(a?.[key], b?.[key]).value;
    if (r) out[key] = r;
  }
  return sortObj(out) as T;
}

function mergeById<T extends Record<string, Register<unknown> | undefined>>(
  a: Record<string, T>,
  b: Record<string, T>,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)]))
    out[id] = mergeEntries(a[id], b[id]);
  return sortObj(out);
}

function sortObj<T>(o: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of Object.keys(o).sort()) out[k] = o[k]!;
  return out;
}

/** Merges two library indexes. Commutative, associative and idempotent. */
export function mergeIndex(a: IndexFile, b: IndexFile): IndexFile {
  const deletedNotes: IndexFile["deletedNotes"] = {};
  for (const id of new Set([...Object.keys(a.deletedNotes), ...Object.keys(b.deletedNotes)])) {
    const x = a.deletedNotes[id];
    const y = b.deletedNotes[id];
    const c = lww(x ? { c: x.c } : undefined, y ? { c: y.c } : undefined)!.c;
    deletedNotes[id] = { c, seen: mergeVv(x?.seen, y?.seen) };
  }
  return {
    format: INDEX_FORMAT,
    v: INDEX_VERSION,
    libraryId: a.libraryId <= b.libraryId ? a.libraryId : b.libraryId,
    folders: mergeById(
      a.folders as Record<string, Record<string, Register<unknown>>>,
      b.folders as Record<string, Record<string, Register<unknown>>>,
    ) as Record<string, FolderEntry>,
    tags: mergeById(
      a.tags as Record<string, Record<string, Register<unknown>>>,
      b.tags as Record<string, Record<string, Register<unknown>>>,
    ) as Record<string, TagDef>,
    settings: mergeEntries(a.settings, b.settings),
    deletedNotes: sortObj(deletedNotes),
    seen: mergeVv(a.seen, b.seen),
  };
}

function setReg<T>(old: Register<T> | undefined, value: T, clock: HybridClock): Register<T> {
  const c = clock.tick();
  return { v: value, c, cv: bumpVv(old?.cv, clock.deviceId, c) };
}

/** Sets one field of a folder (creating the folder if needed). */
export function setFolderField<K extends keyof FolderEntry>(
  index: IndexFile,
  folderId: string,
  field: K,
  value: NonNullable<FolderEntry[K]>["v"],
  clock: HybridClock,
): IndexFile {
  const folder = index.folders[folderId] ?? {};
  const reg = setReg(folder[field] as Register<unknown> | undefined, value, clock);
  return {
    ...index,
    folders: { ...index.folders, [folderId]: { ...folder, [field]: reg } },
    seen: bumpVv(index.seen, clock.deviceId, reg.c),
  };
}

export function setTagField<K extends keyof TagDef>(
  index: IndexFile,
  tagId: string,
  field: K,
  value: NonNullable<TagDef[K]>["v"],
  clock: HybridClock,
): IndexFile {
  const tag = index.tags[tagId] ?? {};
  const reg = setReg(tag[field] as Register<unknown> | undefined, value, clock);
  return {
    ...index,
    tags: { ...index.tags, [tagId]: { ...tag, [field]: reg } },
    seen: bumpVv(index.seen, clock.deviceId, reg.c),
  };
}

export function setSetting(
  index: IndexFile,
  key: string,
  value: unknown,
  clock: HybridClock,
): IndexFile {
  const reg = setReg(index.settings[key], value, clock);
  return {
    ...index,
    settings: { ...index.settings, [key]: reg },
    seen: bumpVv(index.seen, clock.deviceId, reg.c),
  };
}

/** Records a permanent delete (from the note's stub). */
export function recordDeletedNote(
  index: IndexFile,
  docId: string,
  stub: { deleted: { c: string }; seen: VersionVector },
): IndexFile {
  const merged = mergeIndex(index, {
    ...emptyIndex(index.libraryId),
    deletedNotes: { [docId]: { c: stub.deleted.c, seen: stub.seen } },
  });
  const dev = stub.deleted.c.slice(stub.deleted.c.lastIndexOf("-") + 1);
  return { ...merged, seen: bumpVv(merged.seen, dev, stub.deleted.c) };
}

/** Drops `deletedNotes` older than a year. */
export function pruneDeletedNotes(
  index: IndexFile,
  now: number,
  hlcMsOf: (c: string) => number,
): IndexFile {
  const deletedNotes: IndexFile["deletedNotes"] = {};
  for (const [id, d] of Object.entries(index.deletedNotes))
    if (now - hlcMsOf(d.c) < DELETED_NOTE_RETENTION_MS) deletedNotes[id] = d;
  return { ...index, deletedNotes };
}

/** Folders as a valid tree: a missing, deleted or cyclic parent puts the folder at the top level. */
export function liveFolders(
  index: IndexFile,
): { id: string; name: string; color: string | null; parentId: string | null; rank: string }[] {
  const live = new Map<string, FolderEntry>();
  for (const [id, f] of Object.entries(index.folders)) if (!f.deleted?.v) live.set(id, f);
  const parentOf = (id: string): string | null => {
    const p = live.get(id)?.parentId?.v ?? null;
    return p !== null && live.has(p) ? p : null;
  };
  const out: {
    id: string;
    name: string;
    color: string | null;
    parentId: string | null;
    rank: string;
  }[] = [];
  for (const [id, f] of [...live].sort(([a], [b]) => (a < b ? -1 : 1))) {
    let parent = parentOf(id);
    const seen = new Set([id]);
    for (let cur = parent; cur !== null; cur = parentOf(cur)) {
      if (seen.has(cur)) {
        parent = null;
        break;
      }
      seen.add(cur);
    }
    out.push({
      id,
      name: f.name?.v ?? "",
      color: f.color?.v ?? null,
      parentId: parent,
      rank: f.rank?.v ?? "V",
    });
  }
  return out;
}

export class IndexFileError extends Error {
  override name = "IndexFileError";
}

export function encodeIndex(index: IndexFile): Uint8Array {
  const rest = { ...index };
  delete rest.sum;
  const body = canonicalJson(rest);
  return utf8(canonicalJson({ ...rest, sum: sha256Hex(body) }));
}

export function decodeIndex(bytes: Uint8Array): IndexFile {
  let value: Partial<IndexFile>;
  try {
    value = JSON.parse(fromUtf8(bytes)) as Partial<IndexFile>;
  } catch {
    throw new IndexFileError("The library index isn't complete JSON (it may still be arriving).");
  }
  if (!value || value.format !== INDEX_FORMAT)
    throw new IndexFileError("Not a Folevi library index.");
  if (typeof value.v !== "number" || value.v > INDEX_VERSION)
    throw new IndexFileError("Written by a newer Folevi.");
  const rest = { ...value };
  delete rest.sum;
  if (value.sum !== sha256Hex(canonicalJson(rest)))
    throw new IndexFileError("The library index checksum doesn't match.");
  if (!isVersionVector(value.seen) || typeof value.libraryId !== "string")
    throw new IndexFileError("The library index is missing fields.");
  for (const d of Object.values(value.deletedNotes ?? {}))
    if (!isHlc(d.c) || !isVersionVector(d.seen)) throw new IndexFileError("Invalid deleted note.");
  return { folders: {}, tags: {}, settings: {}, deletedNotes: {}, ...value } as IndexFile;
}

export const indexCodec: Codec<IndexFile> = {
  decode: decodeIndex,
  encode: encodeIndex,
  merge: mergeIndex,
};
