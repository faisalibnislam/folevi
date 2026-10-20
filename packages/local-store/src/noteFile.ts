// The `.fnote` file, schema version 1 (LOCAL_MODE_PLAN.md §3.3): one file per document, canonical JSON
// (sorted keys, no undefined) with `sum`, the SHA-256 of the canonical JSON without `sum`.
import { canonicalJson, isValidId } from "@folevi/editor-schema";
import { fromUtf8, utf8 } from "./bytes";
import { isDeviceId, isHlc } from "./hlc";
import { sha256Hex } from "./sha256";
import { isVersionVector, type VersionVector } from "./vv";

export const NOTE_FORMAT = "folevi-note";
export const NOTE_VERSION = 1;

/** A last-writer-wins register. With `cv`, causality decides first and `c` only breaks concurrent ties. */
export interface Register<T> {
  v: T;
  c: string;
  cv?: VersionVector;
}

/** OR-set entry, add wins: present when `add` is newer than `rm`. A remove stamps `rm` with the add it saw. */
export interface TagEntry {
  add: string;
  rm: string | null;
}

/** Document fields that are registers. */
export const DOC_REGISTER_FIELDS = [
  "title",
  "icon",
  "folderId",
  "parentDocumentId",
  "rank",
  "style",
  "cover",
  "starred",
  "archivedAt",
  "trashedAt",
  "templateKey",
  "dailyDate",
] as const;
export type DocRegisterField = (typeof DOC_REGISTER_FIELDS)[number];

/** Fields whose concurrent changes also produce a version and a notice (the rest merge silently). */
export const NOTICED_DOC_FIELDS: readonly DocRegisterField[] = ["title"];

export interface NoteDoc {
  title?: Register<string>;
  icon?: Register<string | null>;
  /** Fixed when the note is created. */
  kind?: { v: string };
  folderId?: Register<string | null>;
  parentDocumentId?: Register<string | null>;
  rank?: Register<string>;
  style?: Register<unknown>;
  cover?: Register<unknown>;
  starred?: Register<boolean>;
  archivedAt?: Register<number | null>;
  trashedAt?: Register<number | null>;
  templateKey?: Register<string | null>;
  /** A daily note's day (yyyy-mm-dd). */
  dailyDate?: Register<string | null>;
  createdAt?: number;
  tags: Record<string, TagEntry>;
}

/**
 * One block. The content group (type, schemaVersion, text, props, deleted, by) merges by version vector; the
 * position group (parentId, rank) and `collapsed` are last writer wins on their own stamps.
 * `props` never holds `collapsed`: a toggle's open state lives in `collapsed`, merged on its own.
 */
export interface BlockEntry {
  type: string;
  schemaVersion: number;
  text: unknown[];
  props: Record<string, unknown>;
  parentId: string | null;
  rank: string;
  collapsed?: boolean;
  c: { content: string; position: string; collapsed?: string };
  cv: VersionVector;
  deleted: null | { c: string };
  /** The device that wrote the content. */
  by: string;
}

/** An attachment owned by this note. `c` lets the palette (the only mutable part) merge last writer wins. */
export interface FileEntry {
  sha256: string;
  name: string;
  mime: string;
  size: number;
  kind: string;
  palette?: unknown;
  c: string;
}

export interface CollectionDef {
  name?: Register<string>;
  properties: Record<string, Register<unknown>>;
  views: Record<string, Register<unknown>>;
}

/** Only on collection-row notes. */
export interface RowData {
  collectionId: string;
  rank?: Register<string>;
  values: Record<string, Register<unknown>>;
}

export interface FileTextEntry {
  source: string;
  reader: string;
  text: string;
  pageStarts?: number[];
  fingerprint: string;
  c: string;
}

export type NoticeKind = "changed" | "deleted" | "restored";

/**
 * "Changed on another device" and friends. Ids are derived from what lost, so two devices that merge the same
 * pair produce the same notice. `from` and `at` describe the version that is now shown; `version` is the
 * history file that holds the other one.
 */
export interface Notice {
  blockId: string | null;
  /** For a document field (title) rather than a block. */
  field?: string;
  kind: NoticeKind;
  from: string;
  at: string;
  version: string | null;
  /** The device whose version went to history. */
  other?: string;
  dismissed?: { c: string };
}

export interface NoteFile {
  format: typeof NOTE_FORMAT;
  v: typeof NOTE_VERSION;
  id: string;
  doc: NoteDoc;
  blocks: Record<string, BlockEntry>;
  files: Record<string, FileEntry>;
  collections: Record<string, CollectionDef>;
  row?: RowData;
  fileText: Record<string, FileTextEntry>;
  versionNames: Record<string, Register<string | null>>;
  notices: Record<string, Notice>;
  /** Per device, the newest stamp it wrote that this state incorporates. */
  seen: VersionVector;
  /** Pointwise max of the version vectors of block tombstones removed by compaction (§3.5). */
  compacted?: VersionVector;
  sum?: string;
}

/** What a permanent delete leaves behind (kept 180 days). It drops only the edits it has seen. */
export interface NoteStub {
  format: typeof NOTE_FORMAT;
  v: typeof NOTE_VERSION;
  id: string;
  deleted: { c: string };
  seen: VersionVector;
  sum?: string;
}

export type NoteLike = NoteFile | NoteStub;

export function isStub(file: NoteLike): file is NoteStub {
  return (file as NoteStub).deleted !== undefined && (file as NoteFile).blocks === undefined;
}

export type NoteFileErrorCode =
  "not_utf8" | "not_json" | "wrong_format" | "unsupported_version" | "bad_sum" | "invalid";

/** A file that can't be used. Callers treat every code as "not arrived yet": never overwrite it. */
export class NoteFileError extends Error {
  override name = "NoteFileError";
  constructor(
    readonly code: NoteFileErrorCode,
    message: string,
    readonly path?: string,
  ) {
    super(path ? `${message} (at ${path})` : message);
  }
}

export function emptyNote(id: string): NoteFile {
  return {
    format: NOTE_FORMAT,
    v: NOTE_VERSION,
    id,
    doc: { tags: {} },
    blocks: {},
    files: {},
    collections: {},
    fileText: {},
    versionNames: {},
    notices: {},
    seen: {},
  };
}

/** Canonical JSON of a note or stub with `sum` filled in. */
export function canonicalNoteJson(file: NoteLike): string {
  const rest = { ...file } as Record<string, unknown>;
  delete rest.sum;
  if (!isStub(file) && file.compacted && Object.keys(file.compacted).length === 0)
    delete rest.compacted;
  const body = canonicalJson(rest);
  return canonicalJson({ ...rest, sum: sha256Hex(body) });
}

/** The checksum of a note or stub (its canonical JSON without `sum`). */
export function noteSum(file: NoteLike): string {
  const rest = { ...file } as Record<string, unknown>;
  delete rest.sum;
  if (!isStub(file) && file.compacted && Object.keys(file.compacted).length === 0)
    delete rest.compacted;
  return sha256Hex(canonicalJson(rest));
}

export function encodeNoteFile(file: NoteLike): Uint8Array {
  return utf8(canonicalNoteJson(file));
}

/** Parses and validates bytes. Throws NoteFileError with a clear reason; never returns a partial note. */
export function decodeNoteFile(bytes: Uint8Array): NoteLike {
  let text: string;
  try {
    text = fromUtf8(bytes);
  } catch {
    throw new NoteFileError(
      "not_utf8",
      "The note file isn't valid UTF-8 (it may still be arriving).",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new NoteFileError(
      "not_json",
      "The note file isn't complete JSON (it may still be arriving).",
    );
  }
  return parseNoteFile(value);
}

/** Validates a parsed value as a note or stub, including `sum`. */
export function parseNoteFile(value: unknown): NoteLike {
  if (!isObject(value)) throw new NoteFileError("wrong_format", "Not a Folevi note file.");
  if (value.format !== NOTE_FORMAT)
    throw new NoteFileError("wrong_format", "Not a Folevi note file.", "format");
  if (typeof value.v !== "number")
    throw new NoteFileError("invalid", "Missing schema version.", "v");
  if (value.v > NOTE_VERSION)
    throw new NoteFileError(
      "unsupported_version",
      `Written by a newer Folevi (format ${value.v}); update to read it.`,
      "v",
    );
  if (value.v !== NOTE_VERSION)
    throw new NoteFileError("invalid", `Unknown schema version ${value.v}.`, "v");
  if (typeof value.sum !== "string") throw new NoteFileError("bad_sum", "Missing checksum.", "sum");
  const file = value as unknown as NoteLike;
  if (noteSum(file) !== value.sum)
    throw new NoteFileError(
      "bad_sum",
      "The checksum doesn't match (the file is damaged or incomplete).",
      "sum",
    );
  const issues = validateNoteFile(file);
  if (issues.length) throw new NoteFileError("invalid", issues[0]!.message, issues[0]!.path);
  return file;
}

export interface NoteIssue {
  path: string;
  message: string;
}

/** Structural checks (shapes, ids, clocks). Returns every issue found. */
export function validateNoteFile(file: unknown): NoteIssue[] {
  const issues: NoteIssue[] = [];
  const bad = (path: string, message: string) => issues.push({ path, message });
  if (!isObject(file)) return [{ path: "", message: "Not an object." }];
  if (file.format !== NOTE_FORMAT) bad("format", "Wrong format.");
  if (file.v !== NOTE_VERSION) bad("v", "Wrong schema version.");
  if (!isValidId(file.id)) bad("id", "Invalid note id.");
  checkVv(file.seen, "seen", bad);
  if (file.blocks === undefined && file.deleted !== undefined) {
    if (!isObject(file.deleted) || !isHlc(file.deleted.c)) bad("deleted.c", "Invalid clock.");
    return issues;
  }
  const doc = file.doc;
  if (!isObject(doc)) bad("doc", "Missing doc.");
  else {
    for (const field of DOC_REGISTER_FIELDS)
      if (doc[field] !== undefined) checkRegister(doc[field], `doc.${field}`, bad);
    if (doc.title !== undefined && isObject(doc.title) && typeof doc.title.v !== "string")
      bad("doc.title.v", "Title must be a string.");
    if (doc.kind !== undefined && (!isObject(doc.kind) || typeof doc.kind.v !== "string"))
      bad("doc.kind", "Invalid kind.");
    if (doc.createdAt !== undefined && typeof doc.createdAt !== "number")
      bad("doc.createdAt", "Invalid createdAt.");
    if (!isObject(doc.tags)) bad("doc.tags", "Missing tags.");
    else
      for (const [id, t] of Object.entries(doc.tags)) {
        if (!isValidId(id)) bad(`doc.tags.${id}`, "Invalid tag id.");
        if (!isObject(t) || !isHlc(t.add) || !(t.rm === null || isHlc(t.rm)))
          bad(`doc.tags.${id}`, "Invalid tag entry.");
      }
  }
  if (!isObject(file.blocks)) bad("blocks", "Missing blocks.");
  else
    for (const [id, b] of Object.entries(file.blocks)) {
      const p = `blocks.${id}`;
      if (!isValidId(id)) bad(p, "Invalid block id.");
      if (!isObject(b)) {
        bad(p, "Invalid block.");
        continue;
      }
      if (typeof b.type !== "string" || !b.type) bad(`${p}.type`, "Missing type.");
      if (typeof b.schemaVersion !== "number") bad(`${p}.schemaVersion`, "Missing schemaVersion.");
      if (!Array.isArray(b.text)) bad(`${p}.text`, "Text must be an array.");
      if (!isObject(b.props)) bad(`${p}.props`, "Props must be an object.");
      else if ("collapsed" in b.props)
        bad(`${p}.props.collapsed`, "collapsed belongs outside props.");
      if (!(b.parentId === null || isValidId(b.parentId)))
        bad(`${p}.parentId`, "Invalid parent id.");
      if (typeof b.rank !== "string" || !b.rank) bad(`${p}.rank`, "Invalid rank.");
      if (b.collapsed !== undefined && typeof b.collapsed !== "boolean")
        bad(`${p}.collapsed`, "collapsed must be a boolean.");
      if (
        !isObject(b.c) ||
        !isHlc(b.c.content) ||
        !isHlc(b.c.position) ||
        !(b.c.collapsed === undefined || isHlc(b.c.collapsed))
      )
        bad(`${p}.c`, "Invalid clocks.");
      checkVv(b.cv, `${p}.cv`, bad);
      if (!(b.deleted === null || (isObject(b.deleted) && isHlc(b.deleted.c))))
        bad(`${p}.deleted`, "Invalid deleted.");
      if (!isDeviceId(b.by)) bad(`${p}.by`, "Invalid device.");
    }
  checkLwwMap(
    file.files,
    "files",
    bad,
    (e) =>
      typeof e.sha256 === "string" && /^[0-9a-f]{64}$/.test(e.sha256) && typeof e.mime === "string",
  );
  if (!isObject(file.collections)) bad("collections", "Missing collections.");
  else
    for (const [id, col] of Object.entries(file.collections)) {
      if (!isObject(col)) {
        bad(`collections.${id}`, "Invalid collection.");
        continue;
      }
      if (col.name !== undefined) checkRegister(col.name, `collections.${id}.name`, bad);
      for (const key of ["properties", "views"] as const) {
        if (!isObject(col[key])) bad(`collections.${id}.${key}`, "Missing map.");
        else
          for (const [k, r] of Object.entries(col[key]))
            checkRegister(r, `collections.${id}.${key}.${k}`, bad);
      }
    }
  if (file.row !== undefined) {
    const row = file.row;
    if (!isObject(row) || !isValidId(row.collectionId) || !isObject(row.values))
      bad("row", "Invalid row.");
    else {
      if (row.rank !== undefined) checkRegister(row.rank, "row.rank", bad);
      for (const [k, r] of Object.entries(row.values)) checkRegister(r, `row.values.${k}`, bad);
    }
  }
  checkLwwMap(file.fileText, "fileText", bad, (e) => typeof e.text === "string");
  if (!isObject(file.versionNames)) bad("versionNames", "Missing versionNames.");
  else
    for (const [k, r] of Object.entries(file.versionNames))
      checkRegister(r, `versionNames.${k}`, bad);
  if (!isObject(file.notices)) bad("notices", "Missing notices.");
  else
    for (const [id, n] of Object.entries(file.notices)) {
      const p = `notices.${id}`;
      if (
        !isObject(n) ||
        !["changed", "deleted", "restored"].includes(n.kind as string) ||
        !isHlc(n.at) ||
        !isDeviceId(n.from)
      )
        bad(p, "Invalid notice.");
      else if (n.dismissed !== undefined && (!isObject(n.dismissed) || !isHlc(n.dismissed.c)))
        bad(`${p}.dismissed`, "Invalid dismissal.");
    }
  if (file.compacted !== undefined) checkVv(file.compacted, "compacted", bad);
  return issues;
}

function checkRegister(r: unknown, path: string, bad: (p: string, m: string) => void) {
  if (!isObject(r) || !("v" in r) || !isHlc(r.c)) bad(path, "Invalid register.");
  else if (r.cv !== undefined) checkVv(r.cv, `${path}.cv`, bad);
}

function checkLwwMap(
  map: unknown,
  path: string,
  bad: (p: string, m: string) => void,
  ok: (e: Record<string, unknown>) => boolean,
) {
  if (!isObject(map)) return bad(path, "Missing map.");
  for (const [k, e] of Object.entries(map))
    if (!isObject(e) || !isHlc(e.c) || !ok(e)) bad(`${path}.${k}`, "Invalid entry.");
}

function checkVv(v: unknown, path: string, bad: (p: string, m: string) => void) {
  if (!isVersionVector(v)) bad(path, "Invalid version vector.");
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Every stamp in a note, for checks (`seen` must cover them all) and for catalogs. */
export function noteStamps(file: NoteLike): string[] {
  const out: string[] = [];
  if (isStub(file)) return [file.deleted.c];
  const reg = (r: Register<unknown> | undefined) => {
    if (r) out.push(r.c);
  };
  for (const f of DOC_REGISTER_FIELDS) reg(file.doc[f] as Register<unknown> | undefined);
  for (const t of Object.values(file.doc.tags)) {
    out.push(t.add);
    if (t.rm) out.push(t.rm);
  }
  for (const b of Object.values(file.blocks)) {
    out.push(b.c.content, b.c.position);
    if (b.c.collapsed) out.push(b.c.collapsed);
    if (b.deleted) out.push(b.deleted.c);
  }
  for (const f of Object.values(file.files)) out.push(f.c);
  for (const col of Object.values(file.collections)) {
    reg(col.name);
    for (const r of Object.values(col.properties)) reg(r);
    for (const r of Object.values(col.views)) reg(r);
  }
  if (file.row) {
    reg(file.row.rank);
    for (const r of Object.values(file.row.values)) reg(r);
  }
  for (const e of Object.values(file.fileText)) out.push(e.c);
  for (const r of Object.values(file.versionNames)) reg(r);
  for (const n of Object.values(file.notices)) if (n.dismissed) out.push(n.dismissed.c);
  return out;
}

/** The newest stamp in a note (its "updated" clock for catalogs). */
export function latestStamp(file: NoteLike): string | null {
  let best: string | null = null;
  for (const v of Object.values(file.seen)) if (best === null || v > best) best = v;
  return best;
}

/** A permanent-delete stub for a note: it remembers everything the note had seen. */
export function makeStub(note: NoteLike, deletedC: string): NoteStub {
  const seen = { ...note.seen };
  const dev = deletedC.slice(deletedC.lastIndexOf("-") + 1);
  if (deletedC > (seen[dev] ?? "")) seen[dev] = deletedC;
  return {
    format: NOTE_FORMAT,
    v: NOTE_VERSION,
    id: note.id,
    deleted: { c: deletedC },
    seen: sortKeysOf(seen),
  };
}

function sortKeysOf<T>(o: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of Object.keys(o).sort()) out[k] = o[k]!;
  return out;
}
