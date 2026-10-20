// Local edits on a note file. Each edit stamps what it changes with the device clock, advances the version
// vector of the content it touches, and records the stamp in `seen`, so merges can tell causality apart from
// concurrency. Edits are pure: they return a new note and leave the input unchanged.
import { canonicalJson, type ChangedField, type WireBlock } from "@folevi/editor-schema";
import type { HybridClock } from "./hlc";
import {
  emptyNote,
  isStub,
  type BlockEntry,
  type DocRegisterField,
  type FileEntry,
  type FileTextEntry,
  type NoteDoc,
  type NoteFile,
  type NoteLike,
  type Register,
} from "./noteFile";
import { bumpVv } from "./vv";

function withSeen(note: NoteFile, deviceId: string, stamp: string): NoteFile {
  return { ...note, seen: bumpVv(note.seen, deviceId, stamp) };
}

export interface NewNote {
  kind?: string;
  title?: string;
  createdAt: number;
  folderId?: string | null;
  parentDocumentId?: string | null;
  rank?: string;
}

/** A new, empty note with its creation fields stamped. */
export function createNote(id: string, init: NewNote, clock: HybridClock): NoteFile {
  let note = emptyNote(id);
  note.doc.createdAt = init.createdAt;
  note.doc.kind = { v: init.kind ?? "document" };
  if (init.title !== undefined) note = setDocField(note, "title", init.title, clock);
  if (init.folderId !== undefined) note = setDocField(note, "folderId", init.folderId, clock);
  if (init.parentDocumentId !== undefined)
    note = setDocField(note, "parentDocumentId", init.parentDocumentId, clock);
  if (init.rank !== undefined) note = setDocField(note, "rank", init.rank, clock);
  if (Object.keys(note.seen).length === 0) {
    // Even an untitled note carries a stamp, so a permanent delete can tell whether it saw this note.
    note = withSeen(note, clock.deviceId, clock.tick());
  }
  return note;
}

/** Sets a document field (title, folder, trash, ...). */
export function setDocField<K extends DocRegisterField>(
  note: NoteFile,
  field: K,
  value: NonNullable<NoteDoc[K]>["v"],
  clock: HybridClock,
): NoteFile {
  const old = note.doc[field] as Register<unknown> | undefined;
  const c = clock.tick();
  const reg: Register<unknown> = { v: value, c, cv: bumpVv(old?.cv, clock.deviceId, c) };
  return withSeen({ ...note, doc: { ...note.doc, [field]: reg } }, clock.deviceId, c);
}

/** Splits a wire block into the file's groups (`collapsed` lives outside props). */
function contentOf(
  block: WireBlock,
): Pick<BlockEntry, "type" | "schemaVersion" | "text" | "props"> & { collapsed?: boolean } {
  const props = { ...(block.props as Record<string, unknown>) };
  const collapsed = props.collapsed;
  delete props.collapsed;
  const out: Pick<BlockEntry, "type" | "schemaVersion" | "text" | "props"> & {
    collapsed?: boolean;
  } = {
    type: block.type,
    schemaVersion: block.schemaVersion,
    text: block.text as unknown[],
    props: JSON.parse(canonicalJson(props)) as Record<string, unknown>,
  };
  if (typeof collapsed === "boolean") out.collapsed = collapsed;
  return out;
}

/**
 * Writes a block. `fields` says which groups changed, as in the sync protocol: "content" (type, text, props),
 * "position" (parentId, rank), "collapsed". A new block gets every group.
 */
export function upsertBlock(
  note: NoteFile,
  block: WireBlock,
  fields: readonly ChangedField[],
  clock: HybridClock,
): NoteFile {
  const me = clock.deviceId;
  const old = note.blocks[block.id];
  const parts = contentOf(block);
  if (!old) {
    const c = clock.tick();
    const entry: BlockEntry = {
      type: parts.type,
      schemaVersion: parts.schemaVersion,
      text: parts.text,
      props: parts.props,
      parentId: block.parentId,
      rank: block.rank,
      c: { content: c, position: c },
      cv: { [me]: c },
      deleted: null,
      by: me,
    };
    if (parts.collapsed !== undefined) {
      entry.collapsed = parts.collapsed;
      entry.c.collapsed = c;
    }
    return withSeen({ ...note, blocks: { ...note.blocks, [block.id]: entry } }, me, c);
  }
  let entry: BlockEntry = { ...old, c: { ...old.c } };
  let seen = note.seen;
  if (fields.includes("content")) {
    const c = clock.tick();
    entry = {
      ...entry,
      type: parts.type,
      schemaVersion: parts.schemaVersion,
      text: parts.text,
      props: parts.props,
      by: me,
      cv: bumpVv(entry.cv, me, c),
    };
    entry.c.content = c;
    seen = bumpVv(seen, me, c);
  }
  if (fields.includes("position")) {
    const c = clock.tickAfter(old.c.position);
    entry.parentId = block.parentId;
    entry.rank = block.rank;
    entry.c.position = c;
    seen = bumpVv(seen, me, c);
  }
  if (fields.includes("collapsed")) {
    const c = clock.tickAfter(old.c.collapsed);
    entry.collapsed = parts.collapsed ?? false;
    entry.c.collapsed = c;
    seen = bumpVv(seen, me, c);
  }
  return { ...note, blocks: { ...note.blocks, [block.id]: entry }, seen };
}

/** Deletes a block (a content write: it competes with concurrent edits, and the loser goes to history). */
export function deleteBlock(note: NoteFile, blockId: string, clock: HybridClock): NoteFile {
  const old = note.blocks[blockId];
  if (!old || old.deleted) return note;
  const c = clock.tick();
  const entry: BlockEntry = {
    ...old,
    c: { ...old.c, content: c },
    cv: bumpVv(old.cv, clock.deviceId, c),
    deleted: { c },
    by: clock.deviceId,
  };
  return withSeen({ ...note, blocks: { ...note.blocks, [blockId]: entry } }, clock.deviceId, c);
}

/** Brings a deleted block back. */
export function restoreBlock(note: NoteFile, blockId: string, clock: HybridClock): NoteFile {
  const old = note.blocks[blockId];
  if (!old || !old.deleted) return note;
  const c = clock.tick();
  const entry: BlockEntry = {
    ...old,
    c: { ...old.c, content: c },
    cv: bumpVv(old.cv, clock.deviceId, c),
    deleted: null,
    by: clock.deviceId,
  };
  return withSeen({ ...note, blocks: { ...note.blocks, [blockId]: entry } }, clock.deviceId, c);
}

export function addTag(note: NoteFile, tagId: string, clock: HybridClock): NoteFile {
  const old = note.doc.tags[tagId];
  if (old && (old.rm === null || old.add > old.rm)) return note;
  const c = clock.tickAfter(old?.add, old?.rm);
  return withSeen(
    {
      ...note,
      doc: { ...note.doc, tags: { ...note.doc.tags, [tagId]: { add: c, rm: old?.rm ?? null } } },
    },
    clock.deviceId,
    c,
  );
}

/** Removes a tag: the remove covers only the add it saw, so a concurrent add elsewhere wins. */
export function removeTag(note: NoteFile, tagId: string, clock: HybridClock): NoteFile {
  const old = note.doc.tags[tagId];
  if (!old || (old.rm !== null && old.rm >= old.add)) return note;
  // The stamp goes into `seen` only, so anti-entropy re-asserts a remove that a provider dropped.
  const c = clock.tick();
  return withSeen(
    {
      ...note,
      doc: { ...note.doc, tags: { ...note.doc.tags, [tagId]: { add: old.add, rm: old.add } } },
    },
    clock.deviceId,
    c,
  );
}

/** The tags currently on a note. */
export function liveTags(note: NoteFile): string[] {
  return Object.entries(note.doc.tags)
    .filter(([, t]) => t.rm === null || t.add > t.rm)
    .map(([id]) => id)
    .sort();
}

export function setFile(
  note: NoteFile,
  fileId: string,
  entry: Omit<FileEntry, "c">,
  clock: HybridClock,
): NoteFile {
  const c = clock.tickAfter(note.files[fileId]?.c);
  return withSeen(
    { ...note, files: { ...note.files, [fileId]: { ...entry, c } } },
    clock.deviceId,
    c,
  );
}

export function setFileText(
  note: NoteFile,
  key: string,
  entry: Omit<FileTextEntry, "c">,
  clock: HybridClock,
): NoteFile {
  const c = clock.tickAfter(note.fileText[key]?.c);
  return withSeen(
    { ...note, fileText: { ...note.fileText, [key]: { ...entry, c } } },
    clock.deviceId,
    c,
  );
}

export function setVersionName(
  note: NoteFile,
  versionFile: string,
  name: string | null,
  clock: HybridClock,
): NoteFile {
  const c = clock.tickAfter(note.versionNames[versionFile]?.c);
  return withSeen(
    { ...note, versionNames: { ...note.versionNames, [versionFile]: { v: name, c } } },
    clock.deviceId,
    c,
  );
}

export function setRowValue(
  note: NoteFile,
  collectionId: string,
  propertyId: string,
  value: unknown,
  clock: HybridClock,
): NoteFile {
  const row = note.row ?? { collectionId, values: {} };
  const c = clock.tickAfter(row.values[propertyId]?.c);
  return withSeen(
    { ...note, row: { ...row, values: { ...row.values, [propertyId]: { v: value, c } } } },
    clock.deviceId,
    c,
  );
}

export function dismissNotice(note: NoteFile, noticeId: string, clock: HybridClock): NoteFile {
  const old = note.notices[noticeId];
  if (!old) return note;
  const c = clock.tickAfter(old.dismissed?.c);
  return withSeen(
    { ...note, notices: { ...note.notices, [noticeId]: { ...old, dismissed: { c } } } },
    clock.deviceId,
    c,
  );
}

/** A block as the editor sees it (`collapsed` back in props). */
export function blockToWire(id: string, entry: BlockEntry): WireBlock {
  const props: Record<string, unknown> = { ...entry.props };
  if (entry.collapsed !== undefined) props.collapsed = entry.collapsed;
  return {
    id,
    type: entry.type,
    parentId: entry.parentId,
    rank: entry.rank,
    schemaVersion: entry.schemaVersion,
    text: entry.text as WireBlock["text"],
    props,
  };
}

/** Folds every stamp of a file into the clock, so later local stamps sort after them. */
export function observeNote(clock: HybridClock, file: NoteLike): void {
  for (const v of Object.values(file.seen)) clock.receive(v);
  if (isStub(file)) clock.receive(file.deleted.c);
}

/**
 * The part of `after` that differs from `before`, as a note of its own (a delta state). Merging the delta into
 * any replica that holds `before` gives `after`. Journal records carry deltas.
 */
export function diffNote(before: NoteFile | null, after: NoteFile): NoteFile {
  const delta = emptyNote(after.id);
  const changed = (a: unknown, b: unknown) => canonicalJson(a ?? null) !== canonicalJson(b ?? null);
  const docB = (before?.doc ?? { tags: {} }) as unknown as Record<string, unknown>;
  const docA = after.doc as unknown as Record<string, unknown>;
  for (const key of Object.keys(docA)) {
    if (key === "tags") continue;
    if (changed(docA[key], docB[key]))
      (delta.doc as unknown as Record<string, unknown>)[key] = docA[key];
  }
  for (const [id, t] of Object.entries(after.doc.tags))
    if (changed(t, before?.doc.tags[id])) delta.doc.tags[id] = t;
  const maps = ["blocks", "files", "collections", "fileText", "versionNames", "notices"] as const;
  for (const m of maps) {
    const a = after[m] as Record<string, unknown>;
    const b = (before?.[m] ?? {}) as Record<string, unknown>;
    for (const [id, v] of Object.entries(a))
      if (changed(v, b[id])) (delta[m] as Record<string, unknown>)[id] = v;
  }
  if (after.row && changed(after.row, before?.row)) delta.row = after.row;
  delta.seen = { ...after.seen };
  return delta;
}
